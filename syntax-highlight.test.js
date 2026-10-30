import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightDiff } from './syntax-highlight.js';
const row = (text, kind = 'context', n = 1) => ({
  kind,
  text,
  oldLine: kind === 'add' ? null : n,
  newLine: kind === 'remove' ? null : n,
});

test('local TextMate highlighting supplies real dual-theme colors while preserving exact Unicode text', async () => {
  const lines = [
    row('const label = "Summary model 🐳";'),
    row('return label;', 'add', 2),
  ];
  const result = await highlightDiff('src/ui.ts', lines);
  assert.deepEqual(
    result.map((line) => line.text),
    lines.map((line) => line.text),
  );
  for (const line of result) {
    assert.ok(line.tokens?.length);
    assert.equal(line.tokens.map((token) => token.text).join(''), line.text);
  }
  assert.ok(
    new Set(result[0].tokens.map((token) => token.dark)).size > 1,
    'keywords and strings actually have different colors',
  );
  assert.ok(
    result[0].tokens.every(
      (token) =>
        /^#[\da-f]{3,8}$/i.test(token.light) &&
        /^#[\da-f]{3,8}$/i.test(token.dark),
    ),
  );
  assert.ok(!lines[0].tokens, 'historical/model cache is not mutated');
});

test('old/new syntax streams maintain independent multiline grammar state', async () => {
  const lines = [
    row('/*', 'remove'),
    row('const active = true;', 'add'),
    row('active();'),
  ];
  const result = await highlightDiff('file.js', lines);
  assert.ok(result[1].tokens?.length);
  assert.ok(
    new Set(result[1].tokens.map((token) => token.dark)).size > 1,
    'added code must not inherit removed comment state',
  );
});

test('unknown languages and oversized inputs remain unchanged, aborts propagate', async () => {
  const lines = [row('<script>not executed</script>')];
  assert.equal(await highlightDiff('file.unknown', lines), lines);
  const large = Array.from({ length: 5001 }, () => row('const a=1;'));
  assert.equal(await highlightDiff('file.js', large), large);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(highlightDiff('file.js', lines, controller.signal), {
    name: 'AbortError',
  });
});
