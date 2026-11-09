import path from 'node:path';

const MAX_EVENTS = 1500;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const toolName = (event) =>
  String(event?.data?.name || '')
    .split('.')
    .at(-1);

function canonical(file, cwd) {
  const api =
    /^[A-Za-z]:[\\/]/.test(file) || /^[A-Za-z]:[\\/]/.test(cwd || '')
      ? path.win32
      : path.posix;
  const raw = String(file || '').replaceAll('\\', '/');

  return (
    api.isAbsolute(raw) && cwd ? api.relative(cwd, raw) : api.normalize(raw)
  ).replaceAll('\\', '/');
}

function argsOf(call) {
  try {
    const args = call.data?.arguments;
    return typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch {
    return {};
  }
}

function textOf(result) {
  const content = result?.data?.message?.content;
  return Array.isArray(content)
    ? content
        .filter(
          (part) => part?.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
    : typeof content === 'string'
      ? content
      : '';
}

function successful(result, read = false) {
  if (
    result?.type !== 'tool/result' ||
    result.data?.error ||
    result.data?.message?.isError
  )
    return false;

  // File contents may themselves say Error; only mutation results use textual errors.
  return (
    read ||
    !/(?:\[sandbox:|\[exit code: (?!0\])|permission denied|access denied|operation not permitted|ENOENT|EACCES|(?:^|\n)\s*(?:error|failed|failure)\b)/i.test(
      textOf(result),
    )
  );
}

const normalized = (value) => value.replace(/\r\n/g, '\n');
const lineText = (value) => normalized(value).replace(/\n$/, '');

function within(text, maxChars, maxLines) {
  return (
    typeof text === 'string' &&
    text.length <= maxChars &&
    (text === '' ? 0 : lineText(text).split('\n').length) <= maxLines
  );
}

const caveat =
  'Reconstructed from recorded complete reads/writes and successful logged edits, not authoritative whole-file snapshots. Newline endings normalized; unobserved or concurrent changes are not established.';
const unavailable = (notice) => ({ coverage: 'unavailable', notice });

/** Accept a single complete, untruncated DSH read; never stitch read windows.
 * Full line evidence cannot establish original CRLF or final-newline bytes. */
export function completeReadText(
  call,
  result,
  { path: target, cwd, maxChars = 200000, maxLines = 5000 } = {},
) {
  if (
    toolName(call) !== 'read' ||
    !successful(result, true) ||
    result.data?.message?.toolCallId !== call.data?.callId ||
    call.seq >= result.seq
  )
    return undefined;

  const args = argsOf(call),
    callPath = args.file_path ?? args.path ?? args.filename;
  if (
    typeof callPath !== 'string' ||
    canonical(callPath, cwd) !== canonical(target, cwd) ||
    (args.offset ?? 1) !== 1
  )
    return undefined;

  const text = textOf(result);
  if (
    text.length > maxChars + maxLines * 12 + 512 ||
    /\(line truncated to \d+ chars\)/i.test(text)
  )
    return undefined;

  const envelope =
    /^<path>([^\n]+)<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/.exec(
      text,
    );
  if (!envelope || canonical(envelope[1], cwd) !== canonical(target, cwd))
    return undefined;

  const footer = /(?:^|\n\n)\(End of file - total (\d+) lines\)$/.exec(
    envelope[2],
  );
  if (!footer) return undefined;

  const total = Number(footer[1]);
  if (!integer(total) || total > maxLines) return undefined;

  const body = envelope[2].slice(0, footer.index);
  const numbered = body ? body.split('\n') : [];
  if (numbered.length !== total) return undefined;

  const lines = [];
  for (const [index, line] of numbered.entries()) {
    const match = /^(\d+): (.*)$/.exec(line);
    if (!match || Number(match[1]) !== index + 1) return undefined;
    lines.push(match[2]);
  }

  const meta = result.data?.meta ?? result.data?.message?.meta;
  if (meta !== undefined) {
    if (
      !meta ||
      canonical(meta.path, cwd) !== canonical(target, cwd) ||
      meta.offset !== 1 ||
      meta.totalLines !== total ||
      meta.truncatedByBytes ||
      !Array.isArray(meta.lines) ||
      meta.lines.length !== total
    )
      return undefined;
    if (
      !meta.lines.every(
        (line, index) =>
          line?.number === index + 1 && line.text === lines[index],
      )
    )
      return undefined;
  }

  const content = lines.join('\n');

  return within(content, maxChars, maxLines) ? content : undefined;
}

function applyEdit(state, args, maxChars, maxLines) {
  if (
    typeof args.old_string !== 'string' ||
    !args.old_string ||
    typeof args.new_string !== 'string'
  )
    return undefined;

  const old = normalized(args.old_string),
    next = normalized(args.new_string);
  const candidates =
    state.endingUnknown && state.text !== ''
      ? [state.text, `${state.text}\n`]
      : [state.text];

  const outcomes = [];
  for (const text of candidates) {
    let first = text.indexOf(old);
    if (first < 0 || (!args.replace_all && text.indexOf(old, first + 1) >= 0))
      continue;

    const count = args.replace_all ? text.split(old).length - 1 : 1;
    // Bound allocation before constructing a replacement that may expand enormously.
    if (text.length + count * (next.length - old.length) > maxChars) continue;

    const after = args.replace_all
      ? text.split(old).join(next)
      : text.slice(0, first) + next + text.slice(first + old.length);
    if (within(after, maxChars, maxLines)) outcomes.push(after);
  }

  if (!outcomes.length || new Set(outcomes.map(lineText)).size !== 1)
    return undefined;

  return {
    text: outcomes[0],
    endingUnknown: state.endingUnknown && outcomes.length > 1,
  };
}

/** Pure, bounded historical reconstruction. The caller must exclude sensitive
 * paths and redact ENTIRE returned texts before using them in browser diffs.
 * No filesystem access and no attempt to infer full files from edit blocks. */
export function reconstructFullFile(
  events,
  {
    path: target,
    cwd,
    changeRefs = [],
    turn,
    maxChars = 200000,
    maxLines = 5000,
  } = {},
) {
  if (typeof target !== 'string' || !target)
    return unavailable(
      'Full-file history unavailable: no enumerated file reference.',
    );

  maxChars = Math.max(
    1,
    Math.min(200000, Number.isSafeInteger(maxChars) ? maxChars : 200000),
  );
  maxLines = Math.max(
    1,
    Math.min(5000, Number.isSafeInteger(maxLines) ? maxLines : 5000),
  );

  const tail = Array.isArray(events) ? events.slice(-MAX_EVENTS) : [];
  const bySeq = new Map(
    tail
      .filter((event) => integer(event?.seq))
      .map((event) => [event.seq, event]),
  );

  const calls = new Map();
  for (const event of tail)
    if (event?.type === 'tool/call' && typeof event.data?.callId === 'string') {
      const id = event.data.callId;
      // Duplicate call identifiers are ambiguous; never pair a result heuristically.
      calls.set(id, calls.has(id) ? null : event);
    }

  const operations = [];
  const results = new Set();
  for (const result of tail) {
    if (result?.type !== 'tool/result') continue;

    const call = calls.get(result.data?.message?.toolCallId);
    if (!call || call.seq >= result.seq) continue;

    const kind = toolName(call);
    if (
      !['read', 'edit', 'write'].includes(kind) ||
      !successful(result, kind === 'read')
    )
      continue;

    const args = argsOf(call),
      file = args.file_path ?? args.path ?? args.filename;
    if (
      typeof file !== 'string' ||
      canonical(file, cwd) !== canonical(target, cwd)
    )
      continue;

    if (results.has(call.data.callId))
      return unavailable(
        'Full-file history unavailable: duplicate successful result references.',
      );

    results.add(call.data.callId);
    operations.push({ call, result, args, kind });
  }

  operations.sort((a, b) => a.call.seq - b.call.seq);

  const mutations = operations.filter((op) => op.kind !== 'read');
  let targets;

  if (changeRefs.length) {
    if (changeRefs.length > MAX_EVENTS)
      return unavailable(
        'Full-file history unavailable: change references exceed the bounded history.',
      );

    targets = [];
    for (const ref of changeRefs) {
      if (!bySeq.has(ref.callSeq) || !bySeq.has(ref.resultSeq))
        return unavailable(
          'Full-file history unavailable: a change is outside the bounded 1500-event history.',
        );

      const operation = mutations.find(
        (op) => op.call.seq === ref.callSeq && op.result.seq === ref.resultSeq,
      );
      if (
        !operation ||
        (turn != null &&
          (operation.call.data?.turn !== turn ||
            operation.result.data?.turn !== turn))
      )
        return unavailable(
          'Full-file history unavailable: change reference does not match a successful mutation.',
        );

      targets.push(operation);
    }
  } else
    targets = mutations.filter(
      (op) =>
        turn != null &&
        op.call.data?.turn === turn &&
        op.result.data?.turn === turn,
    );

  if (!targets.length)
    return unavailable(
      'Full-file history unavailable: no successful file mutations in bounded recorded history.',
    );

  targets.sort((a, b) => a.call.seq - b.call.seq);
  const first = targets[0],
    last = targets.at(-1);

  // A target file mutation not listed between the card refs is still replayed;
  // overlapping operations cannot establish a definite replacement order.
  const relevant = mutations.filter((op) => op.call.seq <= last.call.seq);
  for (let i = 1; i < relevant.length; i++)
    if (relevant[i].call.seq < relevant[i - 1].result.seq)
      return unavailable(
        'Full-file history unavailable: overlapping file mutations are ambiguous.',
      );

  let baseline, state;
  for (const op of operations) {
    if (op.result.seq >= first.call.seq) continue;
    if (op.kind === 'read') {
      if (
        mutations.some(
          (mutation) =>
            mutation.call.seq < op.result.seq &&
            mutation.result.seq > op.call.seq,
        )
      )
        continue;

      const text = completeReadText(op.call, op.result, {
        path: target,
        cwd,
        maxChars,
        maxLines,
      });
      if (
        text !== undefined &&
        (!baseline || op.result.seq > baseline.result.seq)
      ) {
        baseline = op;
        state = { text, endingUnknown: true };
      }
    } else if (
      op.kind === 'write' &&
      within(op.args.content, maxChars, maxLines) &&
      (!baseline || op.result.seq > baseline.result.seq)
    ) {
      baseline = op;
      state = { text: normalized(op.args.content), endingUnknown: false };
    }
  }

  const replay = relevant.filter(
    (op) => !baseline || op.call.seq > baseline.result.seq,
  );
  let before,
    failed = false;

  for (const op of replay) {
    if (op.call.seq === first.call.seq && state) before = lineText(state.text);
    if (op.kind === 'write') {
      state = within(op.args.content, maxChars, maxLines)
        ? { text: normalized(op.args.content), endingUnknown: false }
        : undefined;
      failed ||= !state;
    } else if (state) {
      const updated = applyEdit(state, op.args, maxChars, maxLines);
      if (!updated) {
        state = undefined;
        failed = true;
      } else state = updated;
    }
  }

  if (!state)
    return unavailable(
      `Full-file history unavailable: ${failed ? 'a logged replacement could not be applied exactly or exceeded viewer limits' : 'no complete preceding read/write baseline'}.`,
    );

  // A later complete write can recover after-only evidence after an invalid chain,
  // but never resurrect a before snapshot that could not be reconstructed.
  if (failed) before = undefined;
  const after = lineText(state.text);

  return {
    coverage: before === undefined ? 'after-only' : 'full-lines',
    ...(before === undefined ? {} : { before }),
    after,
    notice: `${caveat}${before === undefined ? ' Complete after-only file content; no before snapshot is available. Not a full replacement diff.' : ' Whole-file line context covers the first through last referenced change.'}`,
  };
}
