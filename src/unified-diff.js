// Pure line comparison. Callers must redact before passing evidence here.
// No dependency on live filesystem state; the DP table is at most 501 x 501.
const splitLines = (text) => (text === '' ? [] : String(text).split('\n'));

export function hunkHeader(oldStart, oldLines, newStart, newLines) {
  return {
    kind: 'hunk',
    text: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    oldLine: null,
    newLine: null,
  };
}

/** Minimal insert/remove line diff below the hard 500-line-per-side DP cap.
 * Above it, retain common prefix/suffix and emit a coarse changed middle.
 * Coordinates are relative to these blocks, NOT absolute file positions. */
export function unifiedDiff(before, after, { maxLines = 500 } = {}) {
  const old = splitLines(before),
    next = splitLines(after);
  const cap = Number.isSafeInteger(maxLines)
    ? Math.max(0, Math.min(500, maxLines))
    : 500;

  let prefix = 0;
  while (
    prefix < old.length &&
    prefix < next.length &&
    old[prefix] === next[prefix]
  )
    prefix++;

  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;

  const a = old.length - prefix - suffix,
    b = next.length - prefix - suffix;
  const coarse = a > cap || b > cap;

  const operations = [];
  const emit = (kind, text) => operations.push({ kind, text });

  for (let i = 0; i < prefix; i++) emit('context', old[i]);

  if (coarse) {
    for (let i = prefix; i < old.length - suffix; i++) emit('remove', old[i]);
    for (let j = prefix; j < next.length - suffix; j++) emit('add', next[j]);
  } else {
    const width = b + 1,
      table = new Uint16Array((a + 1) * width);

    for (let i = a - 1; i >= 0; i--) {
      for (let j = b - 1; j >= 0; j--) {
        table[i * width + j] =
          old[prefix + i] === next[prefix + j]
            ? 1 + table[(i + 1) * width + j + 1]
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }

    let i = 0,
      j = 0;
    while (i < a || j < b) {
      if (i < a && j < b && old[prefix + i] === next[prefix + j]) {
        emit('context', old[prefix + i]);
        i++;
        j++;
      } else if (
        i < a &&
        (j === b || table[(i + 1) * width + j] >= table[i * width + j + 1])
      ) {
        emit('remove', old[prefix + i++]);
      } else emit('add', next[prefix + j++]);
    }
  }

  for (let i = old.length - suffix; i < old.length; i++)
    emit('context', old[i]);

  let oldLine = 1,
    newLine = 1;
  const lines = operations.length
    ? [
        hunkHeader(
          old.length ? 1 : 0,
          old.length,
          next.length ? 1 : 0,
          next.length,
        ),
      ]
    : [];

  for (const operation of operations)
    lines.push({
      ...operation,
      oldLine: operation.kind === 'add' ? null : oldLine++,
      newLine: operation.kind === 'remove' ? null : newLine++,
    });

  return {
    lines,
    coarse,
    notice: coarse
      ? 'Coarse line comparison: 500-line DP bound exceeded; common prefix/suffix retained, changed middle shown as removals/additions.'
      : '',
  };
}
