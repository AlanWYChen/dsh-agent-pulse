import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

// First increment: local event projection only. No UI, descendant aggregation,
// .NET/Java recognition, or background completion protocol is specified here.
function fixture() {
  let state = initState({ id: 'session-history', agentId: 'agent-history' });
  let seq = 0;
  const event = (type, data) => {
    const e = { type, seq: seq++, time: 1000 + seq, data };
    state = reduceEvent(state, e);
    return e.seq;
  };
  const start = (id, command, extra = {}) =>
    event('tool/call', {
      turn: 1,
      step: 1,
      callId: id,
      name: 'bash',
      arguments: JSON.stringify({ command, ...extra }),
    });
  const finish = (id, text, extra = {}) =>
    event('tool/result', {
      turn: 1,
      step: 1,
      message: { toolCallId: id, content: [{ type: 'text', text }], ...extra },
    });
  return {
    event,
    start,
    finish,
    edit() {
      event('tool/call', {
        turn: 1,
        callId: 'edit',
        name: 'edit',
        arguments: JSON.stringify({
          file_path: '/app/engine.js',
          old_string: 'old',
          new_string: 'new',
        }),
      });
      event('tool/result', {
        turn: 1,
        message: {
          toolCallId: 'edit',
          content: [{ type: 'text', text: 'Edited' }],
        },
      });
    },
    get state() {
      return state;
    },
    get view() {
      return viewState(state);
    },
  };
}
const runs = (f) => f.view.cards.flatMap((card) => card.testRuns || []);
const expected = (
  id,
  callSeq,
  resultSeq,
  executionStatus,
  resultStatus,
  counts,
  exitCode,
) => ({
  id,
  callSeq,
  resultSeq,
  executionStatus,
  resultStatus,
  counts,
  exitCode,
  agentId: 'agent-history',
  sessionId: 'session-history',
});
const tap = '# tests 5\n# pass 3\n# fail 1\n# skipped 1\n[exit code: 1]';

test('public card history keeps every local run newest-started first, not only last verification', () => {
  const f = fixture();
  f.edit();
  const a = f.start('node-run', 'node --test');
  const ar = f.finish('node-run', tap);
  const b = f.start('python-run', 'python3 -m pytest');
  const br = f.finish(
    'python-run',
    '===== 7 passed, 2 skipped in 0.12s =====\n[exit code: 0]',
  );
  const card = f.view.cards.find((c) => c.category === 'outcome');
  assert.deepEqual(card.testRuns, [
    expected(
      'python-run',
      b,
      br,
      'completed',
      'passed',
      { passed: 7, failed: 0, skipped: 2 },
      0,
    ),
    expected(
      'node-run',
      a,
      ar,
      'command-failed',
      'failed',
      { passed: 3, failed: 1, skipped: 1 },
      1,
    ),
  ]);
  assert.equal(JSON.stringify(f.state).includes('===== 7 passed'), false);
  // Replay must neither append duplicates nor mutate an already exported view.
  const snapshot = f.view;
  f.finish('node-run', tap);
  assert.deepEqual(f.view, snapshot);
});

test('standalone in-flight run is visible; reverse completion order preserves start ordering', () => {
  const f = fixture();
  const a = f.start('first', 'pytest');
  assert.deepEqual(runs(f), [
    expected('first', a, null, 'running', 'unknown', null, null),
  ]);
  const b = f.start('second', 'node --test');
  const br = f.finish('second', '# tests 1\n# pass 1\n# fail 0\n# skipped 0');
  const ar = f.finish('first', '===== 1 skipped in 0.01s =====');
  assert.deepEqual(runs(f), [
    expected(
      'second',
      b,
      br,
      'completed',
      'passed',
      { passed: 1, failed: 0, skipped: 0 },
      0,
    ),
    expected(
      'first',
      a,
      ar,
      'completed',
      'unknown',
      { passed: 0, failed: 0, skipped: 1 },
      0,
    ),
  ]);
});

for (const [label, output, execution, exit] of [
  [
    'zero exit without report',
    'build complete\n[exit code: 0]',
    'completed',
    0,
  ],
  [
    'nonzero infrastructure failure',
    'Error: executable missing\n[exit code: 127]',
    'command-failed',
    127,
  ],
  [
    'incomplete output',
    '[output truncated]\n# tests 1\n# pass 1\n# fail 0',
    'incomplete',
    null,
  ],
])
  test(`honest status: ${label} is not a parsed assertion result`, () => {
    const f = fixture();
    const a = f.start('run', 'node --test');
    const r = f.finish('run', output);
    assert.deepEqual(runs(f), [
      expected('run', a, r, execution, 'unknown', null, exit),
    ]);
  });

test('background launch remains running rather than completed or discarded', () => {
  const f = fixture();
  const a = f.start('background', 'node --test', { run_in_background: true });
  const r = f.finish(
    'background',
    'Running in background; job id: job-history',
  );
  assert.deepEqual(runs(f), [
    expected('background', a, r, 'running', 'unknown', null, null),
  ]);
});

test('no AI or prose claims become parsed counts; lookalike commands remain excluded', () => {
  const f = fixture();
  f.start('echo', 'echo "node --test"');
  f.finish('echo', '# tests 5\n# pass 5\n# fail 0');
  assert.deepEqual(runs(f), []);
  const a = f.start('actual', 'pytest');
  const r = f.finish(
    'actual',
    'Assistant says all 100 tests passed.\n[exit code: 0]',
  );
  f.event('assistant/message', {
    turn: 1,
    message: { content: 'All tests passed, 100 passed.' },
  });
  assert.deepEqual(runs(f), [
    expected('actual', a, r, 'completed', 'unknown', null, 0),
  ]);
});
