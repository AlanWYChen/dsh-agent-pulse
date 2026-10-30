import { redactText } from './change-context.js';

// Deterministic, JSON-only projection. Raw arguments and tool output never enter state.
export const PROJECTION_KEY = 'agentActivityIntelligence';
const MAX_EVIDENCE = 30;
const MAX_DEDUPE = 512;
const MAX_PENDING = 256;

const basename = (p) =>
  String(p).replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '';

const cleanName = (p) =>
  basename(p)
    .replace(/[^\p{L}\p{N}._@+ -]/gu, '')
    .slice(0, 120);

const toolName = (name) =>
  String(name || '')
    .split('.')
    .at(-1);

const evidence = (event, label) => ({ seq: event.seq, label });
const failureText =
  /(?:permission denied|access denied|operation not permitted|not found|no such file|EACCES|ENOENT|\[sandbox:|\b(?:error|failed|failure)\s*:|(?:^|\n)\s*(?:error|failed)\b)/i;

const safePattern = (pattern, value) => {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
};

export function initState(header = {}, inheritedEventCount = 0) {
  return {
    version: 2,
    agentId: String(header.agentId ?? header.id ?? header.sessionId ?? 'agent'),
    sessionId: String(header.sessionId ?? header.id ?? 'agent'),
    origin: typeof header.origin === 'string' ? header.origin : null,
    parentSession:
      header.origin === 'subagent' ? (header.parentSession ?? null) : null,
    inheritedEventCount:
      Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0
        ? inheritedEventCount
        : 0,
    cards: [],
    pending: {},
    completed: [],
    seen: [],
    watermark: -1,
    lastOutcomeId: null,
    lastTest: null,
    lastWorkspaceChange: null,
    lastTurnEnd: null,
  };
}

function sensitivePath(path, config) {
  const p = String(path).replaceAll('\\', '/');

  if ((config.excludedPatterns || []).some((x) => safePattern(x, p)))
    return false;

  const name = basename(p);
  const env =
    /^\.env(?:\.|$)/i.test(name) &&
    !/(?:^|[._-])(?:example|sample|template)(?:[._-]|$)/i.test(name);
  const ssh =
    /(?:^|\/)\.ssh\//i.test(p) &&
    /^(?:id_[\w-]+(?:\.pub)?|authorized_keys|known_hosts|config)$/i.test(name);
  const credentials =
    /^(?:credentials(?:\.[\w-]+)?|\.netrc|\.npmrc|\.pypirc|secrets?\.(?:json|ya?ml|toml)|service[-_]?account(?:[._-].*)?\.json|.*\.(?:pem|p12|pfx|key))$/i.test(
      name,
    );

  return (
    env ||
    ssh ||
    credentials ||
    (config.sensitivePatterns || []).some((x) => safePattern(x, p))
  );
}

function parseArgs(value) {
  try {
    const a = JSON.parse(value);
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
}

// Only direct known test invocations are eligible, never echoed strings or arbitrary scripts.
function testCommand(command, args) {
  if (
    typeof command !== 'string' ||
    args.run_in_background ||
    /[;|&<>`\n]|\$\(/.test(command)
  )
    return null;

  const words =
    command
      .trim()
      .match(/(?:"[^"]*"|'[^']*'|\S+)/g)
      ?.map((x) => x.replace(/^(['"])(.*)\1$/, '$2')) || [];
  let rest;

  if (/^(?:node|nodejs)$/.test(words[0]) && words[1] === '--test')
    rest = words.slice(2);
  else if (words[0] === 'pytest') rest = words.slice(1);
  else if (
    /^python(?:3(?:\.\d+)?)?$/.test(words[0]) &&
    words[1] === '-m' &&
    words[2] === 'pytest'
  )
    rest = words.slice(3);
  else if (/^(?:vitest|jest)$/.test(words[0])) rest = words.slice(1);
  else if (/^(?:npm|pnpm|yarn|bun)$/.test(words[0]) && words[1] === 'test')
    rest = words.slice(2);
  else if (
    /^(?:npm|pnpm|yarn|bun)$/.test(words[0]) &&
    words[1] === 'run' &&
    words[2] === 'test'
  )
    rest = words.slice(3);
  else if (
    /^(?:npx|pnpm|bunx)$/.test(words[0]) &&
    /^(?:vitest|jest)$/.test(words[1])
  )
    rest = words.slice(2);
  else if (
    words[0] === 'pnpm' &&
    words[1] === 'exec' &&
    /^(?:vitest|jest)$/.test(words[2])
  )
    rest = words.slice(3);
  else return null;

  if (rest.some((x) => /^(?:--watch|-w|--watchAll)(?:=|$)/.test(x)))
    return null;

  // Unknown switches and positional filters constrain scope rather than implying a full suite.
  const ignored = new Set([
    '--',
    '--run',
    'run',
    '--runInBand',
    '--silent',
    '-q',
    '-v',
    '--verbose',
    '--no-watch',
  ]);
  const targets = rest.filter(
    (x, i) =>
      !ignored.has(x) &&
      !/^--test-reporter=(?:tap|spec|dot)$/.test(x) &&
      x !== '--test-reporter' &&
      !(rest[i - 1] === '--test-reporter' && /^(?:tap|spec|dot)$/.test(x)),
  );

  return {
    targets: targets.map(cleanName).filter(Boolean),
    all: targets.length === 0,
  };
}

function semanticHints(source) {
  if (typeof source !== 'string') return [];

  const hints = [];

  // Mask comments and literals before looking for declarations; never mine string values.
  let masked = '',
    cursor = 0;
  const literals =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

  for (const match of source.matchAll(literals)) {
    masked += source.slice(cursor, match.index);
    if (/^['"]/.test(match[0]) && /\b(?:from|import)\s*$/.test(masked)) {
      const module = match[0].slice(1, -1);
      if (
        /^@?[a-zA-Z][\w.-]*(?:\/[\w.-]+)?$/.test(module) &&
        module.length <= 80
      )
        hints.push({ kind: 'package', name: module });
    }
    masked += ' '.repeat(match[0].length);
    cursor = match.index + match[0].length;
  }

  masked += source.slice(cursor);

  for (const match of masked.matchAll(
    /\b(?:function|class|interface)\s+([A-Za-z_$][\w$]{0,63})|\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]{0,63})/g,
  )) {
    const name = match[1] || match[2];
    if (!/(?:secret|password|token|credential|privatekey)/i.test(name))
      hints.push({ kind: 'symbol', name });
  }

  return hints
    .filter(
      (hint, i, all) =>
        all.findIndex((x) => x.kind === hint.kind && x.name === hint.name) ===
        i,
    )
    .slice(0, 20);
}

function callMetadata(event, config) {
  const d = event.data || {},
    a = parseArgs(d.arguments),
    name = toolName(d.name);

  const paths = [a.file_path, a.path, a.filename].filter(
    (x) => typeof x === 'string',
  );
  const files = [...new Set(paths.map(cleanName).filter(Boolean))];

  if (['read', 'read_image'].includes(name)) {
    if (!paths.some((p) => sensitivePath(p, config))) return null;
    return { kind: 'sensitive', turn: d.turn ?? null, files };
  }

  if (['edit', 'write'].includes(name))
    return {
      kind: 'edit',
      turn: d.turn ?? null,
      files,
      hints: paths.some((p) => sensitivePath(p, config))
        ? []
        : semanticHints(a.new_string ?? a.content),
    };

  if (name === 'bash') {
    const test = testCommand(a.command, a);
    if (test) return { kind: 'test', turn: d.turn ?? null, files: [], test };
  }

  return null;
}

function textOf(result) {
  return (result.message?.content || [])
    .filter((x) => x?.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text)
    .join('\n');
}

function toolFailed(result, text) {
  if (result.message?.isError || result.error) return true;

  // A successful DSH file-read envelope can contain arbitrary error-looking file text.
  // Inspect its header, not its contents, when classifying the operation outcome.
  if (/^<path>[^\n]*<\/path>\s*\n<type>file<\/type>\s*\n<content>/.test(text))
    return false;

  return failureText.test(text);
}

function addEvidence(card, event, label) {
  if (!card.evidence.some((x) => x.seq === event.seq))
    card.evidence = [...card.evidence, evidence(event, label)].slice(
      -MAX_EVIDENCE,
    );
}

function baseCard(state, event, id, category, files) {
  return {
    id,
    category,
    title: '',
    summary: '',
    status: 'observed',
    time: event.time ?? null,
    agentId: state.agentId,
    evidence: [],
    files,
    verification: {
      status: 'not-run',
      label: 'No supported test result observed',
    },
    _turn: event.data?.turn ?? null,
    _finalized: false,
  };
}

function countsFrom(text) {
  let pass = 0,
    fail = 0,
    found = false;
  const tap = { tests: [], pass: [], fail: [] };

  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/^\s*(?:#|ℹ\uFE0F?) (tests|pass|fail)\s+(\d+)\s*$/);
    if (m) {
      tap[m[1]].push(Number(m[2]));
      continue;
    }

    // pytest's summary line, not arbitrary prose mentioning a test count.
    m = line.match(
      /^\s*=+\s+((?:\d+ (?:passed|failed|skipped|xfailed|xpassed|errors?)(?:, )?)+)(?:\s+in\s+\d+(?:\.\d+)?s(?:\s+\([^)]*\))?)?\s*=+\s*$/,
    );
    if (m) {
      for (const hit of m[1].matchAll(/(\d+) (passed|failed|errors?)/g)) {
        found = true;
        if (hit[2] === 'passed') pass += Number(hit[1]);
        else fail += Number(hit[1]);
      }
      continue;
    }

    m = line.match(
      /^\s*Tests\s+((?:\d+ (?:passed|failed|skipped|todo)(?:\s*\|\s*|, )?)+)\s*\(\d+\)\s*$/,
    );
    // Jest uses "Tests: 2 passed, 2 total".
    if (!m)
      m = line.match(
        /^\s*Tests:\s+((?:\d+ (?:passed|failed|skipped|todo|total)(?:, )?)+)\s*$/,
      );
    if (m)
      for (const hit of m[1].matchAll(/(\d+) (passed|failed)/g)) {
        found = true;
        if (hit[2] === 'passed') pass += Number(hit[1]);
        else fail += Number(hit[1]);
      }
  }

  if (
    tap.tests.length &&
    tap.tests.length === tap.pass.length &&
    tap.pass.length === tap.fail.length
  ) {
    const tests = tap.tests.reduce((a, b) => a + b, 0),
      p = tap.pass.reduce((a, b) => a + b, 0),
      f = tap.fail.reduce((a, b) => a + b, 0);
    if (p + f <= tests) {
      found = true;
      pass += p;
      fail += f;
    }
  }

  return { pass, fail, found };
}

function testResult(result, text) {
  const exits = [...text.matchAll(/^\s*\[exit code: (-?\d+)\]\s*$/gm)];
  const counts = countsFrom(text);

  if (
    result.message?.isError ||
    result.error ||
    exits.some((m) => Number(m[1]) !== 0) ||
    counts.fail > 0
  )
    return {
      status: 'failed',
      label: `Tests failed${counts.found ? ` (${counts.pass} passed, ${counts.fail} failed)` : ''}`,
    };

  if (
    /(?:running in (?:the )?background|background job|job[_ ]id|\[still running)/i.test(
      text,
    )
  )
    return {
      status: 'pending',
      label: 'Background test started; no foreground result',
    };

  if (
    /\[(?:timed out|stopped:|killed by signal:|sandbox:|output truncated\b)|\(Output capped\./i.test(
      text,
    )
  )
    return {
      status: 'unknown',
      label: 'Test output is incomplete or execution did not finish',
    };

  // DSH bash renderResult emits [exit code: N] only for nonzero exits. A completed,
  // non-error foreground result with no stop/background/truncation marker implies zero.
  // Explicit zero markers remain supported for imported event logs.
  if (exits.length <= 1 && counts.found && counts.pass > 0)
    return {
      status: 'passed',
      label: `Tests passed (${counts.pass} passed, 0 failed)`,
    };

  return { status: 'unknown', label: 'No conclusive foreground test result' };
}

function scopeSupports(test, files) {
  if (test.all) return true;
  if (!files.length) return false;

  return files.every((file) =>
    test.targets.some(
      (target) =>
        target === file ||
        target.replace(/\.(?:test|spec)(?=\.)/g, '') === file ||
        (file.startsWith('test_') && target === file),
    ),
  );
}

export function reduceEvent(state, event, config = {}) {
  // Durable session events arrive in seq order; the accepted-event watermark blocks
  // replay even after bounded diagnostic/deduplication windows have rolled over.
  if (
    !event ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < state.inheritedEventCount ||
    event.seq <= (state.watermark ?? -1) ||
    state.seen.includes(event.seq)
  )
    return state;

  if (event.type === 'workspace/changes') {
    return {
      ...state,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
      lastWorkspaceChange: {
        seq: event.seq,
        turn: event.data?.turn ?? null,
        time: event.time ?? null,
      },
    };
  }

  if (event.type === 'turn/end') {
    const cards = state.cards.filter(
      (card) => card._turn === event.data?.turn && !card._finalized,
    );
    const reason =
      typeof event.data?.reason?.kind === 'string' &&
      /^[a-z_-]{1,40}$/i.test(event.data.reason.kind)
        ? event.data.reason.kind
        : null;

    return {
      ...state,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
      lastTurnEnd: {
        seq: event.seq,
        turn: event.data?.turn ?? null,
        time: event.time ?? null,
        reason,
      },
      cards: state.cards.map((card) =>
        cards.includes(card)
          ? {
              ...card,
              _finalized: true,
              status: ['error', 'failed'].includes(reason)
                ? 'failed'
                : ['interrupted', 'cancelled', 'aborted'].includes(reason)
                  ? 'interrupted'
                  : card.status,
            }
          : card,
      ),
    };
  }

  if (!['tool/call', 'tool/result'].includes(event.type)) return state;

  const data = event.data || {};

  if (event.type === 'tool/call') {
    const metadata = callMetadata(event, config);
    if (!metadata || typeof data.callId !== 'string') return state;

    const key = data.callId;
    if (state.pending[key] || state.completed.includes(key)) return state;

    const pending = {
      ...state.pending,
      [key]: { ...metadata, callSeq: event.seq },
    };

    for (const stale of Object.keys(pending).slice(
      0,
      Math.max(0, Object.keys(pending).length - MAX_PENDING),
    ))
      delete pending[stale];

    return {
      ...state,
      pending,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  const key = data.message?.toolCallId;
  const call = state.pending[key];
  if (!call) return state;

  const next = JSON.parse(JSON.stringify(state));
  delete next.pending[key];
  next.completed = [...next.completed, key].slice(-MAX_DEDUPE);
  next.seen = [...next.seen, event.seq].slice(-MAX_DEDUPE);
  next.watermark = event.seq;

  const text = textOf(data),
    failed = toolFailed(data, text);

  if (call.kind === 'sensitive') {
    const card = baseCard(
      next,
      event,
      `sensitive:${call.callSeq}`,
      'sensitive',
      call.files,
    );
    const denied = /denied|not permitted|EACCES|\[sandbox:/i.test(text);

    card.status = failed ? (denied ? 'denied' : 'failed') : 'observed';
    card.title = failed
      ? denied
        ? 'Sensitive read denied'
        : 'Sensitive read failed'
      : 'Sensitive file read';
    card.summary = failed
      ? 'A sensitive file read was attempted but did not succeed.'
      : 'A sensitive file read succeeded. File contents are not retained.';
    card.verification = {
      status: 'not-applicable',
      label: 'Sensitive access observation',
    };

    addEvidence(card, { seq: call.callSeq }, 'Sensitive read requested');
    addEvidence(card, event, failed ? 'Read unsuccessful' : 'Read succeeded');
    next.cards.push(card);
  } else if (call.kind === 'edit') {
    if (failed) {
      const card = baseCard(
        next,
        event,
        `attention:${call.callSeq}`,
        'attention',
        call.files,
      );

      card.status = 'failed';
      card.title = 'File modification failed';
      card.summary =
        'A file modification was attempted; no successful change was observed.';

      addEvidence(card, event, 'Modification unsuccessful');
      next.cards.push(card);
    } else {
      const id = `outcome:${String(call.turn ?? 'unknown')}`;
      let card = next.cards.find((x) => x.id === id);

      if (!card) {
        card = baseCard(next, event, id, 'outcome', []);
        card._turn = call.turn ?? null;
        next.cards.push(card);
      }

      card.files = [...new Set([...card.files, ...call.files])];
      card.semanticHints = [
        ...(card.semanticHints || []),
        ...(call.hints || []),
      ]
        .filter(
          (hint, i, all) =>
            all.findIndex(
              (x) => x.kind === hint.kind && x.name === hint.name,
            ) === i,
        )
        .slice(0, 20);

      card.title = 'Changes awaiting summary';
      card.summary =
        'The behavior-level summary will be generated from the recorded changes when this turn ends.';
      card._changes = [
        ...(card._changes || []),
        { callSeq: call.callSeq, resultSeq: event.seq },
      ].slice(-100);

      if (
        card.verification.status !== 'not-run' ||
        (next.lastTest && scopeSupports(next.lastTest.test, card.files))
      )
        card.verification = {
          status: 'stale',
          label: 'Files changed after the observed test result',
        };

      card._editSeq = event.seq;
      card._modifications = (card._modifications || 0) + 1;
      card._finalized = false;
      card.time = event.time ?? card.time;

      addEvidence(card, event, 'Successful file modification');
      next.lastOutcomeId = id;

      // Any older outcome verification is no longer current after a subsequent write.
      for (const previous of next.cards)
        if (
          previous.category === 'outcome' &&
          previous.id !== id &&
          ['passed', 'partial'].includes(previous.verification.status)
        )
          previous.verification = {
            status: 'stale',
            label: 'Files changed after the observed test result',
          };
    }
  } else if (call.kind === 'test') {
    const verification = testResult(data, text);
    next.lastTest = { seq: event.seq, test: call.test };
    const card =
      next.cards.find(
        (x) => x.id === `outcome:${String(call.turn ?? 'unknown')}`,
      ) || next.cards.find((x) => x.id === next.lastOutcomeId);

    if (card && scopeSupports(call.test, card.files)) {
      // A test started before the last write cannot verify that write.
      card.verification =
        call.callSeq < card._editSeq
          ? { status: 'stale', label: 'Files changed after this test started' }
          : verification;
      addEvidence(
        card,
        event,
        verification.status === 'passed'
          ? 'Numeric foreground test result'
          : 'Test execution observed',
      );
    } else if (card && verification.status === 'passed') {
      card.verification =
        call.callSeq < card._editSeq
          ? { status: 'stale', label: 'Files changed after this test started' }
          : {
              status: 'partial',
              label: `${countsFrom(text).pass} selected tests passed; scope not mapped to all changed files`,
            };
      addEvidence(
        card,
        event,
        'Numeric selected-test result; scope not mapped',
      );
    } else if (verification.status === 'failed') {
      const attention = baseCard(
        next,
        event,
        `attention:${call.callSeq}`,
        'attention',
        [],
      );

      attention.title = 'Test execution failed';
      attention.summary = 'A supported test command reported a failure.';
      attention.status = 'failed';
      attention.verification = verification;

      addEvidence(attention, event, 'Test failure observed');
      next.cards.push(attention);
    }
  }

  const maxCards =
    Number.isSafeInteger(config.maxCards) && config.maxCards > 0
      ? config.maxCards
      : 100;
  next.cards = next.cards.slice(-maxCards);

  return next;
}

export function viewState(state) {
  return {
    sessionId: state.sessionId,
    parentSession: structuredClone(state.parentSession),
    cards: state.cards.map((card) => ({
      ...Object.fromEntries(
        [
          'id',
          'category',
          'title',
          'summary',
          'status',
          'time',
          'agentId',
          'evidence',
          'files',
          'verification',
        ].map((key) => [key, structuredClone(card[key])]),
      ),
      ...(Array.isArray(card.changeFiles)
        ? { changeFiles: structuredClone(card.changeFiles) }
        : {}),
    })),
  };
}

export function summaryInput(card) {
  if (!card || card.category !== 'outcome') return null;

  return {
    id: card.id,
    category: card.category,
    mutationSeq: card._editSeq ?? null,
    modificationCount: card._modifications ?? 0,
    files: card.files.map(cleanName),
    changes: structuredClone(card._changes || []),
    semanticHints: {
      status: 'metadata-only',
      items: structuredClone(card.semanticHints || []),
    },
  };
}

function safeModelText(value, max) {
  if (typeof value !== 'string') return null;

  let text = value
    .replace(/`/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove unsupported execution claims without discarding an otherwise useful
  // feature description. Verification always comes from the deterministic field.
  const executionClaim =
    /(?:\b(?:all |every )?tests?\s+(?:passed|pass|failed|succeeded|are green)\b|\b\d+\s+(?:tests?\s+)?(?:passed|failed)\b|\b(?:verified working|production.ready|deployed to production)\b|测试.{0,8}(?:通过|成功|失败)|\d+\s*(?:项|个)?测试)/i;
  text = text
    .split(/(?<=[.!?。！？])\s+/u)
    .filter((sentence) => !executionClaim.test(sentence))
    .join(' ')
    .trim();

  if (
    !text ||
    /(?:<script\b|BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*\S+)/i.test(
      text,
    )
  )
    return null;
  if (
    /(?:observed file modifications|related file modifications|expand evidence for affected files)/i.test(
      text,
    )
  )
    return null;

  return redactText(text).slice(0, max);
}

export function summaryValidationIssue(card, parsed, options = {}) {
  if (
    !card ||
    card.category !== 'outcome' ||
    !parsed ||
    typeof parsed !== 'object'
  )
    return 'invalid-output-shape';
  if (parsed.insufficientContext === true)
    return 'model-reported-insufficient-context';

  const title = safeModelText(parsed.title, 100),
    summary = safeModelText(parsed.summary, 600);
  if (!title) return 'missing-or-unsupported-title';

  if (
    !summary ||
    summary.length <
      (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(summary)
        ? 10
        : 24) ||
    summary.toLowerCase() === title.toLowerCase()
  )
    return 'missing-or-unsupported-description';

  if (options.changeIds) {
    const references = parsed.supportingChangeIds;
    if (!Array.isArray(references) || !references.length)
      return 'missing-supporting-change-references';
    if (!references.every((id) => options.changeIds.includes(id)))
      return 'unknown-supporting-change-reference';
  }

  return null;
}

export function applySummary(card, parsed, options = {}) {
  // Atomic acceptance: a vague title must never replace a useful pending/error state.
  if (summaryValidationIssue(card, parsed, options)) return card;

  const title = safeModelText(parsed.title, 100),
    summary = safeModelText(parsed.summary, 600);

  return {
    ...card,
    title,
    summary,
    _summarySource: options.changeIds ? 'changes' : 'metadata',
    verification: card.verification,
  };
}
