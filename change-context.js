import { createHash } from 'node:crypto';
import path from 'node:path';
import { unifiedDiff, hunkHeader } from './unified-diff.js';
import { reconstructFullFile } from './full-file-context.js';
import { highlightDiff } from './syntax-highlight.js';

const MAX_EVENTS = 1500,
  MAX_FILES = 12,
  MAX_SCAN = 100000,
  MAX_FILE = 2000;

const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validSeq = (value) => Number.isSafeInteger(value) && value >= 0;

const matches = (pattern, text) => {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
};

/** Content exclusion is deliberately stricter than the sensitive-access alert policy.
 * Exclusions cannot opt a built-in secret path back into model/browser evidence. */
export function isSensitivePath(value, config = {}) {
  const p = String(value || '').replaceAll('\\', '/');

  return (
    /(?:^|\/)(?:\.env(?:[^/]*|$)|\.ssh|\.aws|\.gnupg|\.kube)(?:\/|$)/i.test(
      p,
    ) ||
    /(?:^|\/)(?:credentials?|creds|secrets?|keys)(?:\/|[._-][^/]*$|$)/i.test(
      p,
    ) ||
    /(?:^|\/)(?:\.git-credentials|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|service[-_]?account[^/]*\.json)$/i.test(
      p,
    ) ||
    /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(p) ||
    [
      ...(config.sensitivePatterns || []),
      ...(config.excludedPatterns || []),
    ].some((pattern) => matches(pattern, p))
  );
}

/** Best-effort defense in depth, not a guarantee of complete secret detection.
 * Keep ordinary literals: UI labels, storage keys and logic are valuable evidence. */
export function redactText(value) {
  let text = String(value ?? '');

  text = text.replace(
    /-----BEGIN [^-\r\n]*(?:PRIVATE KEY|CERTIFICATE)[^-\r\n]*-----[\s\S]*?(?:-----END [^-\r\n]+-----|$)/gi,
    (block) =>
      block
        .split('\n')
        .map(() => '[REDACTED PEM]')
        .join('\n'),
  );
  text = text.replace(
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
    '[REDACTED TOKEN]',
  );
  text = text.replace(
    /(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi,
    '$1[REDACTED]@',
  );
  text = text.replace(
    /([?&](?:access[_-]?token|api[_-]?key|key|token|secret|password|passwd|auth|authorization|signature|sig|credential|client_secret)=)[^&#\s"'<>]*/gi,
    '$1[REDACTED]',
  );
  text = text.replace(
    /\b(Bearer|Basic)(\s+)[A-Za-z0-9+/_=.:-]+/gi,
    (match, scheme, spacing) => `${scheme}${spacing}[REDACTED]`,
  );

  // Quoted or unquoted assignment values, including JSON keys and environment syntax.
  text = text.replace(
    /((?:["']?)(?:[\w.-]*(?:password|passwd|secret|credential|authorization|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[\w.-]*|token|auth)(?:["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[^\s,;}\n]+)/gi,
    (match, prefix, value) =>
      `${prefix}"${value
        .split('\n')
        .map(() => '[REDACTED]')
        .join('\n')}"`,
  );

  // Unusually long mixed-alphabet literals/opaque identifiers. Plain words stay useful.
  text = text.replace(/[A-Za-z0-9+/_=-]{24,}/g, (token) => {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[+/_=-]/].filter((re) =>
      re.test(token),
    ).length;

    const counts = new Map();
    for (const c of token) counts.set(c, (counts.get(c) || 0) + 1);

    const entropy = [...counts.values()].reduce(
      (sum, n) => sum - (n / token.length) * Math.log2(n / token.length),
      0,
    );

    return (classes >= 3 && entropy >= 3.5) ||
      (classes >= 2 && /\d/.test(token) && entropy >= 4) ||
      (/^[a-f0-9]{32,}$/i.test(token) && entropy >= 3)
      ? '[REDACTED OPAQUE VALUE]'
      : token;
  });

  return text;
}

function canonicalPath(raw, cwd) {
  const windows =
    /^[A-Za-z]:[\\/]/.test(raw) || /^[A-Za-z]:[\\/]/.test(cwd || '');
  const api = windows ? path.win32 : path.posix;
  const normalized = String(raw).replaceAll('\\', '/');

  return (
    api.isAbsolute(normalized)
      ? cwd
        ? api.relative(cwd, normalized)
        : `external/${api.basename(normalized)}`
      : api.normalize(normalized)
  ).replaceAll('\\', '/');
}

function labelFor(raw, cwd) {
  const relative = redactText(canonicalPath(raw, cwd)).replace(
    /[^\p{L}\p{N}._/@+ ()\[\]-]/gu,
    '_',
  );

  return relative.slice(0, 200) || 'unnamed file';
}

function textOf(event) {
  const content = event?.data?.message?.content ?? event?.data?.content;
  if (typeof content === 'string') return content;

  return Array.isArray(content)
    ? content
        .filter(
          (part) => part?.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
    : '';
}

function lastTextOf(event) {
  const content = event?.data?.message?.content ?? event?.data?.content;
  return Array.isArray(content)
    ? content
        .filter(
          (part) => part?.type === 'text' && typeof part.text === 'string',
        )
        .at(-1)?.text || ''
    : typeof content === 'string'
      ? content
      : '';
}

function successful(result) {
  if (
    result?.type !== 'tool/result' ||
    result.data?.error ||
    result.data?.message?.isError
  )
    return false;

  return !/(?:\[sandbox:|\[exit code: (?!0\])|-?permission denied|access denied|operation not permitted|ENOENT|EACCES|(?:^|\n)\s*(?:error|failed|failure)\b)/i.test(
    textOf(result),
  );
}

function argsOf(event) {
  try {
    const args = event.data?.arguments;
    return typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch {
    return {};
  }
}

function limitText(raw, budget, limitations) {
  if (raw.length > MAX_SCAN)
    limitations.add(
      'Evidence scan truncated; omitted content was not inspected.',
    );

  const safe = redactText(raw.slice(0, MAX_SCAN));
  if (safe.length > budget)
    limitations.add('Evidence text truncated to bounded excerpts.');

  return safe.slice(0, Math.max(0, budget));
}

function boundedLines(lines, budget, limitations) {
  const size = lines.reduce((sum, line) => sum + line.text.length + 1, 0);
  if (size <= budget) return { lines, truncated: false };

  limitations.add(
    'Evidence text truncated to bounded excerpts; displayed coordinates may contain gaps.',
  );

  const sections = [];
  for (const line of lines) {
    if (line.kind === 'hunk' || !sections.length) sections.push([]);
    sections.at(-1).push(line);
  }

  // Each surviving edit keeps its own header. Avoid one huge block starving later edits.
  const selected = sections.slice(
    0,
    Math.max(1, Math.min(12, Math.floor(budget / 80))),
  );
  const sectionBudget = Math.floor(budget / Math.max(1, selected.length));

  const result = [];
  for (const section of selected) {
    const header = section[0]?.kind === 'hunk' ? section[0] : null;
    if (header)
      result.push({ ...header, text: header.text.slice(0, sectionBudget - 1) });

    const remainingBudget =
      sectionBudget -
      (header ? Math.min(sectionBudget, header.text.length + 1) : 0);
    const groups = ['context', 'remove', 'add'].filter((kind) =>
      section.some((line) => line.kind === kind),
    );
    const remaining = Object.fromEntries(
      groups.map((kind) => [kind, Math.floor(remainingBudget / groups.length)]),
    );

    for (const line of section) {
      if (line.kind === 'hunk') continue;
      const available = remaining[line.kind];
      if (available <= 1) continue;

      const text = line.text.slice(0, available - 1);
      result.push({ ...line, text });
      remaining[line.kind] -= text.length + 1;
    }
  }

  return { lines: result, truncated: true };
}

function modelBlocks(blocks, budget, limitations) {
  if (blocks.length > 12)
    limitations.add('Logged edit blocks truncated to 12 blocks per file.');

  blocks = blocks.slice(0, 12);
  const fields = blocks.reduce(
    (sum, block) =>
      sum +
      ['before', 'after'].filter((field) => typeof block[field] === 'string')
        .length,
    0,
  );
  const each = Math.floor(budget / Math.max(1, fields));
  const result = { before: [], after: [] };

  for (const [index, block] of blocks.entries()) {
    for (const field of ['before', 'after']) {
      if (typeof block[field] !== 'string') continue;
      const label = blocks.length > 1 ? `[Logged block ${index + 1}]\n` : '';
      result[field].push(
        label +
          limitText(
            block[field],
            Math.max(0, each - label.length - 2),
            limitations,
          ),
      );
    }
  }

  return {
    before: result.before.join('\n\n'),
    after: result.after.join('\n\n'),
  };
}

/** No filesystem or git access. All evidence is logged arguments or native recorded hunks. */
export class ChangeContextService {
  constructor({ workspaceChanges, recordedFiles, config = {} } = {}) {
    this.workspaceChanges = workspaceChanges;
    this.recordedFiles = recordedFiles;
    this.config = config;
    this.cache = new Map();
    this.descriptors = new Map();
  }

  cacheKey(session, card) {
    return hash([
      session?.id,
      card?.id,
      card?._turn,
      card?._changes || null,
      card?._workspaceRef || null,
      (card?.evidence || []).map((e) => e.seq),
    ]);
  }

  /** Synchronous labels only: never fetches diffs or filesystem content. */
  describe(session, card) {
    const key = this.cacheKey(session, card);
    if (this.descriptors.has(key))
      return structuredClone(this.descriptors.get(key));

    const files = [],
      seen = new Set();

    const add = (raw, coordinates) => {
      if (typeof raw !== 'string' || !raw || files.length >= MAX_FILES) return;

      const normalized = canonicalPath(raw, session?.header?.cwd);
      if (seen.has(normalized)) return;

      seen.add(normalized);
      files.push({
        id: hash([key, normalized, coordinates]).slice(0, 32),
        label: labelFor(raw, session?.header?.cwd),
      });
    };

    const at = (seq) => {
      try {
        const event = session?.eventAt?.(seq);
        return event?.then ? undefined : event;
      } catch {
        return undefined;
      }
    };

    let pairs = card?._changes || [];
    if (!pairs.length) {
      const to = validSeq(session?.seq)
        ? session.seq
        : Math.max(
            0,
            ...(card?.evidence || []).map((e) => e.seq).filter(validSeq),
          ) + 1;
      let tail;
      try {
        tail = session?.snapshotEvents?.(Math.max(0, to - MAX_EVENTS), to);
      } catch {
        /* unavailable */
      }

      if (Array.isArray(tail)) {
        const wanted = new Set((card?.evidence || []).map((e) => e.seq));
        const calls = new Map(
          tail
            .slice(-MAX_EVENTS)
            .filter((event) => event.type === 'tool/call')
            .map((event) => [event.data?.callId, event]),
        );
        pairs = tail
          .slice(-MAX_EVENTS)
          .filter(
            (event) => event.type === 'tool/result' && wanted.has(event.seq),
          )
          .map((event) => ({
            callSeq: calls.get(event.data?.message?.toolCallId)?.seq,
            resultSeq: event.seq,
          }));
      }
    }

    for (const pair of pairs.slice(0, 1500)) {
      const call = at(pair.callSeq),
        result = at(pair.resultSeq);
      if (
        call?.type !== 'tool/call' ||
        !successful(result) ||
        !call.data?.callId ||
        call.data.callId !== result.data?.message?.toolCallId ||
        call.seq >= result.seq ||
        (card?._turn != null &&
          (call.data?.turn !== card._turn ||
            result.data?.turn !== card._turn)) ||
        !['edit', 'write'].includes(String(call.data?.name).split('.').at(-1))
      )
        continue;

      const args = argsOf(call);
      add(args.file_path ?? args.path ?? args.filename, pair);
    }

    if (card?._workspaceRef) {
      try {
        const summary = this.workspaceChanges?.summary(
          session?.id,
          card._workspaceRef.seq,
        );
        if (summary?.turn === card._workspaceRef.turn)
          for (const [index, file] of (summary.files || [])
            .slice(0, MAX_FILES)
            .entries())
            add(file.path, [card._workspaceRef.seq, index]);
      } catch {
        /* disposed/native history unavailable */
      }
    }

    this.descriptors.set(key, files);
    while (this.descriptors.size > 100)
      this.descriptors.delete(this.descriptors.keys().next().value);

    return structuredClone(files);
  }

  async prepare(session, card, signal) {
    const entry = await this.entry(session, card, signal);
    return structuredClone(entry.prepared);
  }

  async entry(session, card, signal) {
    signal?.throwIfAborted();

    const key = this.cacheKey(session, card);

    if (!this.cache.has(key)) {
      const pending = this.build(session, card, signal, key);
      this.cache.set(key, pending);
      while (this.cache.size > 100)
        this.cache.delete(this.cache.keys().next().value);
      pending.catch(() => {
        if (this.cache.get(key) === pending) this.cache.delete(key);
      });
    }

    const result = await this.cache.get(key);
    signal?.throwIfAborted();

    return result;
  }

  async build(session, card, signal, key) {
    const limitations = new Set([
      'Secret filtering is best-effort and may not detect every secret.',
    ]);
    const records = new Map(),
      operationRefs = new Map(),
      resolvedEvents = new Map();
    const refs = Array.isArray(card?._changes) ? card._changes : [];
    const evidence = (card?.evidence || []).map((e) => e.seq).filter(validSeq);
    const anchors = [
      ...evidence,
      ...refs.flatMap((r) => [r.callSeq, r.resultSeq]),
      card?._workspaceRef?.seq,
    ].filter(validSeq);
    const latest = Math.max(0, ...anchors);

    // One bounded log read per evidence version; never re-run for unrelated projection changes.
    const to = validSeq(session?.seq) ? session.seq : latest + 1;
    const from = Math.max(0, to - MAX_EVENTS);
    let tail = [];

    try {
      const events = await session?.snapshotEvents?.(from, to);
      tail = Array.isArray(events) ? events.slice(-MAX_EVENTS) : [];
    } catch {
      limitations.add('Historical session context unavailable.');
    }

    if (from > 0)
      limitations.add(
        'Session context limited to the last 1500 events; earlier context may be omitted.',
      );

    const bySeq = new Map(tail.map((event) => [event.seq, event]));
    const eventAt = async (seq) => {
      if (!validSeq(seq)) return undefined;
      if (bySeq.has(seq)) return bySeq.get(seq);

      try {
        return await session?.eventAt?.(seq);
      } catch {
        return undefined;
      }
    };

    const turn = card?._turn ?? card?._workspaceRef?.turn;
    const sameTurn = (event) => turn != null && event?.data?.turn === turn;
    const start = tail.find(
      (event) => event.type === 'turn/start' && sameTurn(event),
    );
    const firstTurnEvent = start || tail.find(sameTurn);
    const request =
      firstTurnEvent &&
      [...tail]
        .reverse()
        .find(
          (event) =>
            event.type === 'user/message' && event.seq <= firstTurnEvent.seq,
        );
    const report = [...tail]
      .reverse()
      .find(
        (event) =>
          event.type === 'assistant/message' &&
          sameTurn(event) &&
          textOf(event),
      );

    const input = { changes: [], limitations: [] };
    if (request) input.task = limitText(textOf(request), 800, limitations);
    else
      limitations.add(
        'Nearest preceding user request unavailable in bounded history.',
      );
    if (report) {
      input.agentReport = limitText(lastTextOf(report), 1000, limitations);
      limitations.add(
        'Agent report is unverified self-report, not proof of behavior or completion.',
      );
    }

    const addRecord = (
      rawPath,
      coordinates,
      kind,
      lines,
      notice,
      truncated = false,
      redacted = false,
      block,
    ) => {
      if (typeof rawPath !== 'string' || !rawPath) return;

      const normalized = canonicalPath(rawPath, session?.header?.cwd);
      const existing = records.get(normalized);
      if (!existing && records.size >= MAX_FILES) {
        limitations.add('File list truncated to 12 files.');
        return;
      }

      if (existing) {
        if (redacted) {
          existing.redacted = true;
          existing.lines = [];
          existing.blocks = [];
          existing.notice = notice;
          return;
        }

        // Prefer native turn-level hunks to partial logged blocks of the same file.
        if (!existing.redacted && kind === 'workspace' && lines.length) {
          existing.kind = kind;
          existing.lines = lines;
          existing.blocks = [];
          existing.notice = notice;
          existing.truncated = truncated;
          return;
        }

        if (!existing.redacted && kind !== 'workspace') {
          existing.lines.push(...lines);
          if (block) existing.blocks.push(block);
        }

        existing.truncated ||= truncated;
        if (!existing.notice.includes(notice)) existing.notice += ` ${notice}`;
        return;
      }

      const label = labelFor(rawPath, session?.header?.cwd);
      records.set(normalized, {
        id: hash([key, normalized, coordinates]).slice(0, 32),
        label,
        path: normalized,
        editorPath: (() => {
          if (rawPath.includes('\0')) return null;
          const api =
            /^[A-Za-z]:[\\/]|^\\\\/.test(rawPath) ||
            /^[A-Za-z]:[\\/]|^\\\\/.test(session?.header?.cwd || '')
              ? path.win32
              : path.posix;
          if (api.isAbsolute(rawPath)) return api.normalize(rawPath);
          return api.isAbsolute(session?.header?.cwd || '')
            ? api.resolve(session.header.cwd, rawPath)
            : null;
        })(),
        kind,
        lines,
        notice,
        truncated,
        redacted,
        blocks: block ? [block] : [],
      });
    };

    let pairs = refs.slice(0, 1500);
    if (refs.length > pairs.length)
      limitations.add('Change reference scan truncated.');

    if (!refs.length) {
      const wanted = new Set(evidence);
      const calls = new Map(
        tail
          .filter((event) => event.type === 'tool/call' && sameTurn(event))
          .map((event) => [event.data?.callId, event]),
      );
      pairs = tail
        .filter(
          (event) =>
            event.type === 'tool/result' &&
            wanted.has(event.seq) &&
            sameTurn(event),
        )
        .map((result) => ({
          callSeq: calls.get(result.data?.message?.toolCallId)?.seq,
          resultSeq: result.seq,
        }));
      limitations.add(
        'Legacy change references resolved from bounded history; older calls may be unavailable.',
      );
    }

    for (const pair of pairs) {
      signal?.throwIfAborted();
      const call = await eventAt(pair.callSeq),
        result = await eventAt(pair.resultSeq);
      if (!call || !result) {
        limitations.add('Historical edit evidence unavailable.');
        continue;
      }

      const kind = String(call.data?.name || '')
        .split('.')
        .at(-1);
      if (
        call.type !== 'tool/call' ||
        !['edit', 'write'].includes(kind) ||
        !successful(result) ||
        !call.data?.callId ||
        call.data.callId !== result.data?.message?.toolCallId ||
        call.seq >= result.seq ||
        (turn != null && (!sameTurn(call) || !sameTurn(result)))
      )
        continue;

      const args = argsOf(call),
        file = args.file_path ?? args.path ?? args.filename;
      if (typeof file !== 'string') continue;

      const normalizedPath = canonicalPath(file, session?.header?.cwd);
      resolvedEvents.set(call.seq, call);
      resolvedEvents.set(result.seq, result);
      if (!operationRefs.has(normalizedPath))
        operationRefs.set(normalizedPath, []);
      operationRefs
        .get(normalizedPath)
        .push({ ...pair, callId: call.data.callId });

      const existing = records.get(normalizedPath);
      if (!existing && records.size >= MAX_FILES) {
        limitations.add('File list truncated to 12 files.');
        continue;
      }

      if (existing?.blocks.length >= 12) {
        existing.truncated = true;
        limitations.add('Logged edit blocks truncated to 12 blocks per file.');
        if (!existing.notice.includes('Additional logged blocks omitted.'))
          existing.notice += ' Additional logged blocks omitted.';
        continue;
      }

      let notice =
        kind === 'edit'
          ? 'Partial edit block from logged arguments; line numbers are block-relative, not file positions. Not a full-file diff.'
          : 'Logged write content only; no before snapshot. Line numbers are content-relative. Not a full replacement diff.';
      if (isSensitivePath(file, this.config)) {
        addRecord(
          file,
          pair,
          kind,
          [],
          'Sensitive file content excluded.',
          false,
          true,
        );
        limitations.add('Sensitive file content excluded.');
        continue;
      }

      const fields =
        kind === 'edit'
          ? [
              ['before', args.old_string],
              ['after', args.new_string],
            ]
          : [['after', args.content]];

      const block = {};
      for (const [field, value] of fields) {
        if (typeof value === 'string')
          block[field] = limitText(
            value,
            MAX_FILE / fields.length,
            limitations,
          );
      }

      let lines = [],
        coarse = false;
      if (kind === 'edit') {
        // Redaction precedes comparison: secret replacements never enter the diff algorithm.
        const compared = unifiedDiff(block.before || '', block.after || '');
        lines = compared.lines;
        coarse = compared.coarse;
        if (compared.notice) {
          notice += ` ${compared.notice}`;
          limitations.add(compared.notice);
        }
      } else if (typeof block.after === 'string' && block.after) {
        lines = block.after.split('\n').map((text, index) => ({
          kind: 'context',
          text,
          oldLine: null,
          newLine: index + 1,
        }));
      }

      const truncated =
        coarse ||
        fields.some(
          ([, value]) =>
            typeof value === 'string' &&
            value.length > MAX_FILE / fields.length,
        );

      addRecord(file, pair, kind, lines, notice, truncated, false, block);
    }

    const workspaceRef = card?._workspaceRef;
    if (workspaceRef && validSeq(workspaceRef.seq)) {
      let summary;
      try {
        summary = await this.workspaceChanges?.summary(
          session?.id,
          workspaceRef.seq,
        );
      } catch {
        /* explicit limitation below */
      }

      if (
        !summary ||
        summary.turn !== workspaceRef.turn ||
        (turn != null && summary.turn !== turn)
      )
        limitations.add(
          'Recorded workspace comparison unavailable (including historical or disposed sessions).',
        );
      else {
        if (summary.total > MAX_FILES || summary.files?.length > MAX_FILES)
          limitations.add('File list truncated to 12 files.');

        for (const [index, file] of (summary.files || [])
          .slice(0, MAX_FILES)
          .entries()) {
          if (typeof file.path !== 'string') continue;

          if (isSensitivePath(file.path, this.config)) {
            addRecord(
              file.path,
              [workspaceRef.seq, index],
              'workspace',
              [],
              'Sensitive file content excluded.',
              false,
              true,
            );
            limitations.add('Sensitive file content excluded.');
            continue;
          }

          let native;
          try {
            native = await this.workspaceChanges?.diff(
              session.id,
              workspaceRef.seq,
              index,
              signal || new AbortController().signal,
            );
          } catch (error) {
            signal?.throwIfAborted();
          }

          signal?.throwIfAborted();
          if (!native || native.kind !== 'text') {
            addRecord(
              file.path,
              [workspaceRef.seq, index],
              'workspace',
              [],
              `Recorded workspace diff unavailable${native?.kind === 'binary' ? ' (binary file)' : native?.kind === 'oversized' ? ' (oversized file)' : '; historical snapshot missing'}.`,
            );
            limitations.add('Some recorded workspace diffs unavailable.');
            continue;
          }

          // Reject a service mismatch rather than displaying another file's contents.
          if (
            typeof native.path !== 'string' ||
            canonicalPath(native.path, session?.header?.cwd) !==
              canonicalPath(file.path, session?.header?.cwd) ||
            isSensitivePath(native.path, this.config)
          ) {
            addRecord(
              file.path,
              [workspaceRef.seq, index],
              'workspace',
              [],
              'Recorded workspace diff unavailable (path mismatch).',
            );
            continue;
          }

          const lines = [];
          let scanned = 0;
          const hunks = (native.hunks || []).slice(0, 1500);

          for (const hunk of hunks) {
            const oldStart = validSeq(hunk.oldStart) ? hunk.oldStart : null;
            const newStart = validSeq(hunk.newStart) ? hunk.newStart : null;
            let oldLine = oldStart,
              newLine = newStart;

            lines.push(
              hunkHeader(
                oldStart ?? 0,
                validSeq(hunk.oldLines) ? hunk.oldLines : 0,
                newStart ?? 0,
                validSeq(hunk.newLines) ? hunk.newLines : 0,
              ),
            );

            for (const line of hunk.lines || []) {
              if (scanned >= MAX_SCAN) break;
              if (typeof line !== 'string' || !/^[ +\-]/.test(line)) continue;

              const text = line.slice(1, MAX_SCAN - scanned + 1);
              scanned += line.length;
              const kind =
                line[0] === '+'
                  ? 'add'
                  : line[0] === '-'
                    ? 'remove'
                    : 'context';

              lines.push({
                kind,
                text,
                oldLine: kind === 'add' ? null : oldLine,
                newLine: kind === 'remove' ? null : newLine,
              });

              if (kind !== 'add' && oldLine !== null) oldLine++;
              if (kind !== 'remove' && newLine !== null) newLine++;
            }

            if (scanned >= MAX_SCAN) break;
          }

          // Preserve row kinds and coordinates while masking PEM/credentials across
          // remove/add/context (and hunk) boundaries. Redaction preserves newlines.
          const body = lines.filter((line) => line.kind !== 'hunk');
          const safeLines = body.length
            ? redactText(body.map((line) => line.text).join('\n')).split('\n')
            : [];
          let safeIndex = 0;
          const structureChanged = safeLines.length !== body.length;
          const output = body.length
            ? lines.map((line) =>
                line.kind === 'hunk'
                  ? line
                  : {
                      ...line,
                      text: structureChanged
                        ? '[REDACTED EVIDENCE]'
                        : safeLines[safeIndex++],
                    },
              )
            : [];

          const scanTruncated =
            scanned >= MAX_SCAN || (native.hunks || []).length > hunks.length;
          if (scanTruncated)
            limitations.add(
              'Evidence scan truncated; omitted content was not inspected.',
            );
          if (structureChanged)
            limitations.add(
              'Evidence redacted because text structure could not be preserved safely.',
            );

          addRecord(
            file.path,
            [workspaceRef.seq, index],
            'workspace',
            output,
            `Recorded native workspace hunks${native.coarse ? ' (coarse comparison)' : ''}; line numbers are recorded file positions. Concurrent-agent attribution may be uncertain.`,
            scanTruncated || Boolean(native.coarse),
          );
        }
      }
    }

    const entries = [...records.values()];
    const budget = Math.min(
      MAX_FILE,
      Math.floor(15500 / Math.max(1, entries.length)),
    );

    for (const record of entries) {
      const bounded = boundedLines(record.lines, budget, limitations);
      record.lines = bounded.lines;
      record.truncated ||= bounded.truncated;
      if (record.redacted) continue;
      limitations.add(record.notice);
      if (!record.lines.length) continue;

      const change = { id: record.id, file: record.label, source: record.kind };
      if (record.kind === 'edit' || record.kind === 'write') {
        const blocks = modelBlocks(record.blocks, budget, limitations);
        if (record.kind === 'edit') change.before = blocks.before;
        change.after = blocks.after;
      } else
        change.diff = record.lines
          .map((line) =>
            line.kind === 'hunk'
              ? line.text
              : `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}${line.text}`,
          )
          .join('\n');

      input.changes.push(change);
      limitations.add(record.notice);
    }

    input.limitations = [...limitations];

    // JSON escaping can expand excerpts. Bound the actual model payload, fairly.
    while (
      JSON.stringify(input).length > 20000 &&
      input.changes.some((change) =>
        ['before', 'after', 'diff'].some((field) => change[field]?.length),
      )
    ) {
      for (const change of input.changes)
        for (const field of ['before', 'after', 'diff'])
          if (change[field])
            change[field] = change[field].slice(
              0,
              Math.floor(change[field].length * 0.8),
            );
      if (
        !input.limitations.includes(
          'Model payload truncated to 20000 characters.',
        )
      )
        input.limitations.push('Model payload truncated to 20000 characters.');
    }

    const prepared = {
      input,
      files: entries.map((record) => ({ id: record.id, label: record.label })),
      fingerprint: hash(input),
    };

    // Browser-only full evidence is derived from this same bounded log read and
    // never attached to prepared.input (or sent to the summary model).
    const browserTail = [
      ...new Map(
        [...tail, ...resolvedEvents.values()].map((event) => [
          event.seq,
          event,
        ]),
      ).values(),
    ].sort((a, b) => a.seq - b.seq);

    for (const record of entries)
      if (!record.redacted) {
        record.browser = this.browserContext(
          session,
          card,
          record,
          operationRefs.get(record.path) || [],
          browserTail,
          refs.length > 1500,
        );
      }

    return {
      prepared,
      records: new Map(entries.map((record) => [record.id, record])),
      nativeRefs: [
        card?._workspaceRef,
        ...tail
          .filter(
            (event) => event.type === 'workspace/changes' && sameTurn(event),
          )
          .reverse()
          .map((event) => ({ seq: event.seq, turn: event.data.turn })),
      ].filter((ref) => ref && validSeq(ref.seq) && ref.turn === turn),
    };
  }

  browserContext(session, card, record, refs, tail, incompleteRefs) {
    let full;

    // Only IDs from successfully paired card mutations may access captures.
    if (refs.length && !incompleteRefs && this.recordedFiles?.get) {
      const captures = [];
      for (const ref of [...refs].sort((a, b) => a.callSeq - b.callSeq)) {
        let capture;
        try {
          capture = this.recordedFiles.get(session?.id, ref.callId);
        } catch {
          /* unavailable */
        }

        if (
          !capture ||
          typeof capture.path !== 'string' ||
          canonicalPath(capture.path, session?.header?.cwd) !== record.path ||
          isSensitivePath(capture.path, this.config) ||
          typeof capture.after !== 'string' ||
          !(capture.before === null || typeof capture.before === 'string') ||
          [capture.before, capture.after].some(
            (text) =>
              typeof text === 'string' &&
              (text.length > 200000 || text.split('\n').length > 5000),
          )
        ) {
          captures.length = 0;
          break;
        }

        captures.push(capture);
      }

      if (captures.length === refs.length) {
        const gap = captures
          .slice(1)
          .some((capture, index) => capture.before !== captures[index].after);
        full = {
          before: captures[0].before,
          after: captures.at(-1).after,
          coverage: 'recorded-full',
          notice: `Complete before/after file content recorded from successful file-tool results; first through last referenced change.${captures[0].before === null ? ' Before state was recorded absent (new file).' : ''}${gap ? ' Capture chain has gaps; concurrent or unobserved changes may be included.' : ' Concurrent changes outside these recorded endpoints are not established.'} ${redactText([...new Set(captures.map((capture) => capture.notice).filter((value) => typeof value === 'string'))].join(' ')).slice(0, 1000)}`,
        };
      }
    }

    const end = refs.length
      ? Math.max(...refs.map((ref) => ref.resultSeq))
      : validSeq(card?._workspaceRef?.seq)
        ? card._workspaceRef.seq
        : Math.max(
            0,
            ...(card?.evidence || []).map((item) => item.seq).filter(validSeq),
          );
    const evidenceTail = tail
      .filter((event) => event.seq <= end)
      .slice(-MAX_EVENTS);

    if (!full && !incompleteRefs)
      full = reconstructFullFile(evidenceTail, {
        path: record.path,
        cwd: session?.header?.cwd,
        changeRefs: refs,
        turn: card?._turn ?? card?._workspaceRef?.turn,
        maxChars: 200000,
        maxLines: 5000,
      });

    if (!full || full.coverage === 'unavailable')
      return {
        coverage: 'partial',
        notice: `${record.notice} Only recorded partial blocks/hunks are available; whole-file history is unavailable.${full?.notice ? ` ${full.notice}` : ''}`,
      };

    // Redact complete texts BEFORE comparing them, independently of the model's
    // much smaller per-file excerpts. No raw snapshot survives in this cache.
    const after = redactText(full.after);
    let lines,
      coarse = false,
      extra = '';

    if (full.coverage === 'after-only') {
      lines =
        after === ''
          ? []
          : after.split('\n').map((text, index) => ({
              kind: 'context',
              text,
              oldLine: null,
              newLine: index + 1,
            }));
      extra =
        'Before content is unknown; unchanged-style rows do not attribute additions or removals.';
    } else {
      const compared = unifiedDiff(
        full.before === null ? '' : redactText(full.before),
        after,
      );
      lines = compared.lines;
      coarse = compared.coarse;
      extra = compared.notice;
    }

    let chars = 0,
      clipped = false;
    const bounded = [];

    for (const line of lines) {
      if (bounded.length >= 5000 || chars >= 200000) {
        clipped = true;
        break;
      }

      const available = 200000 - chars - 1;
      if (available < 0) {
        clipped = true;
        break;
      }

      const text = line.text.slice(0, available);
      bounded.push({ ...line, text });
      chars += text.length + 1;

      if (text.length !== line.text.length) {
        clipped = true;
        break;
      }
    }

    return {
      coverage: clipped ? 'partial' : full.coverage,
      lines: bounded,
      truncated: clipped || coarse,
      notice: `${full.notice}${extra ? ` ${extra}` : ''}${clipped ? ' Viewer limited to 200000 characters / 5000 rows; whole-file context is clipped.' : ''}`,
    };
  }

  /** Resolve the same native Review coordinates used by DSH's Edited files card.
   * This is explicit navigation to DSH's existing viewer, not a sanitized plugin
   * preview. Source/code filtering must not substitute a different viewer. */
  async nativeReview(session, record, refs, signal) {
    if (record.redacted || !this.workspaceChanges) return null;
    for (const ref of refs || []) {
      signal?.throwIfAborted();
      let summary;
      try {
        summary = await this.workspaceChanges.summary(session.id, ref.seq);
      } catch {
        continue;
      }
      signal?.throwIfAborted();
      if (
        !summary ||
        summary.turn !== ref.turn ||
        !validSeq(ref.turn) ||
        (summary.seq != null && summary.seq !== ref.seq) ||
        !Array.isArray(summary.files)
      )
        continue;
      const index = summary.files.findIndex(
        (file) =>
          typeof file.path === 'string' &&
          canonicalPath(file.path, session.header?.cwd) === record.path,
      );
      if (index >= 0)
        return { sessionId: session.id, seq: ref.seq, turn: ref.turn, index };
    }
    return null;
  }

  async diff(session, card, fileId, signal) {
    const entry = await this.entry(session, card, signal);
    const record =
      typeof fileId === 'string' ? entry.records.get(fileId) : undefined;

    if (!record)
      return {
        status: 'unavailable',
        coverage: 'unavailable',
        file: '',
        kind: 'workspace',
        lines: [],
        truncated: false,
        notice: 'Unknown file reference; no path lookup was performed.',
      };

    const browser = record.browser;
    const full = Array.isArray(browser?.lines);
    const nativeReview = await this.nativeReview(
      session,
      record,
      entry.nativeRefs,
      signal,
    );
    signal?.throwIfAborted();
    const editorPath = !record.redacted ? record.editorPath : null;
    const rows = record.redacted ? [] : full ? browser.lines : record.lines;
    const lines = nativeReview
      ? rows
      : await highlightDiff(record.label, rows, signal);

    return structuredClone({
      status: record.redacted
        ? 'redacted'
        : full || record.lines.length
          ? 'available'
          : 'unavailable',
      coverage: record.redacted
        ? 'redacted'
        : full
          ? browser.coverage
          : record.lines.length
            ? 'partial'
            : 'unavailable',
      file: record.label,
      editorPath,
      nativeReview,
      kind: record.kind,
      lines,
      truncated: full ? browser.truncated : record.truncated,
      notice: browser?.notice || record.notice,
    });
  }
}

export const ChangeContext = ChangeContextService;
