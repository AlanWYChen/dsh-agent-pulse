import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff, hunkHeader } from './unified-diff.js';

const body = (result) => result.lines.filter((line) => line.kind !== 'hunk');

const reconstruct = (result, side) =>
  body(result)
    .filter((line) => line.kind !== (side === 'before' ? 'add' : 'remove'))
    .map((line) => line.text)
    .join('\n');

test('unchanged rows appear once; only changed rows are red/green with proper coordinates', () => {
  const result = unifiedDiff(
    'function select() {\n  return main;\n}',
    'function select() {\n  return summary;\n}',
  );

  assert.equal(result.coarse, false);
  assert.deepEqual(result.lines, [
    hunkHeader(1, 3, 1, 3),
    { kind: 'context', text: 'function select() {', oldLine: 1, newLine: 1 },
    { kind: 'remove', text: '  return main;', oldLine: 2, newLine: null },
    { kind: 'add', text: '  return summary;', oldLine: null, newLine: 2 },
    { kind: 'context', text: '}', oldLine: 3, newLine: 3 },
  ]);
  assert.equal(
    reconstruct(result, 'before'),
    'function select() {\n  return main;\n}',
  );
  assert.equal(
    reconstruct(result, 'after'),
    'function select() {\n  return summary;\n}',
  );
});

test('identical, empty, insertion, deletion and trailing empty lines', () => {
  assert.deepEqual(unifiedDiff('', '').lines, []);
  assert.deepEqual(
    body(unifiedDiff('a\nb', 'a\nb')).map((line) => line.kind),
    ['context', 'context'],
  );
  assert.deepEqual(unifiedDiff('', 'one').lines, [
    hunkHeader(0, 0, 1, 1),
    { kind: 'add', text: 'one', oldLine: null, newLine: 1 },
  ]);
  assert.deepEqual(unifiedDiff('one', '').lines, [
    hunkHeader(1, 1, 0, 0),
    { kind: 'remove', text: 'one', oldLine: 1, newLine: null },
  ]);

  const trailing = unifiedDiff('a\n', 'a\nb\n');

  assert.equal(reconstruct(trailing, 'before'), 'a\n');
  assert.equal(reconstruct(trailing, 'after'), 'a\nb\n');
});

test('LCS retains interior common lines and deterministic remove-before-add ordering', () => {
  const result = unifiedDiff(
    'old one\nkeep\nold two',
    'new one\nkeep\nnew two',
  );

  assert.deepEqual(
    body(result).map((line) => line.kind),
    ['remove', 'add', 'context', 'remove', 'add'],
  );
  assert.equal(body(result).filter((line) => line.text === 'keep').length, 1);
  assert.deepEqual(
    result,
    unifiedDiff('old one\nkeep\nold two', 'new one\nkeep\nnew two'),
  );
});

test('short generated inputs reconstruct exactly and DP edit counts are minimal', () => {
  const inputs = ['', 'a', 'b', 'a\nb', 'b\na', 'a\na', 'a\nb\na', 'b\na\nb'];
  // Independent insertion/deletion distance recurrence for tiny fixtures.

  const distance = (a, b) => {
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    return a[0] === b[0]
      ? distance(a.slice(1), b.slice(1))
      : 1 + Math.min(distance(a.slice(1), b), distance(a, b.slice(1)));
  };

  for (const before of inputs)
    for (const after of inputs) {
      const result = unifiedDiff(before, after);

      assert.equal(reconstruct(result, 'before'), before);
      assert.equal(reconstruct(result, 'after'), after);
      assert.equal(
        body(result).filter((line) => line.kind !== 'context').length,
        distance(
          before ? before.split('\n') : [],
          after ? after.split('\n') : [],
        ),
      );
    }
});

test('DP is capped at 500x500 even when requested limit is larger; fallback keeps prefix/suffix', () => {
  const before = [
    'prefix',
    ...Array.from({ length: 501 }, (_, i) => `old ${i}`),
    'suffix',
  ].join('\n');
  const after = [
    'prefix',
    ...Array.from({ length: 501 }, (_, i) => `new ${i}`),
    'suffix',
  ].join('\n');
  const result = unifiedDiff(before, after, { maxLines: 50000 });

  assert.ok(result.coarse);
  assert.match(result.notice, /500-line DP bound/);
  assert.equal(body(result)[0].kind, 'context');
  assert.equal(body(result).at(-1).kind, 'context');
  assert.equal(reconstruct(result, 'before'), before);
  assert.equal(reconstruct(result, 'after'), after);
  assert.equal(
    unifiedDiff('one\ntwo', 'new\ntwo', { maxLines: 0 }).coarse,
    true,
  );
});

test('large shared prefixes do not consume the DP budget', () => {
  const prefix = Array.from({ length: 1000 }, (_, i) => `shared ${i}`).join(
    '\n',
  );
  const result = unifiedDiff(`${prefix}\nold\nend`, `${prefix}\nnew\nend`);

  assert.equal(result.coarse, false);
  assert.equal(body(result).filter((line) => line.kind === 'remove').length, 1);
  assert.equal(body(result).filter((line) => line.kind === 'add').length, 1);
});
