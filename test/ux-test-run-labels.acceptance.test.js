import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

function run(command, text) {
  let state = initState({ id: 'root' });
  state = reduceEvent(state, {
    type: 'tool/call',
    seq: 0,
    time: 1,
    data: {
      turn: 1,
      callId: 'call-with-ugly-execution-id|fc_internal',
      name: 'bash',
      arguments: JSON.stringify({ command }),
    },
  });
  state = reduceEvent(state, {
    type: 'tool/result',
    seq: 1,
    time: 2,
    data: {
      turn: 1,
      message: {
        toolCallId: 'call-with-ugly-execution-id|fc_internal',
        content: [{ type: 'text', text }],
      },
    },
  });
  return viewState(state).cards.flatMap((card) => card.testRuns || [])[0];
}

test('recognized test runs carry a bounded human command label', () => {
  for (const [command, expected] of [
    ['node --test test/a.test.js', 'node --test'],
    ['pytest tests', 'pytest'],
    ['python3 -m pytest', 'pytest'],
    ['dotnet test', 'dotnet test'],
    ['mvn test', 'mvn test'],
    ['gradle test', 'gradle test'],
  ]) {
    const value = run(command, '1 passed\n[exit code: 0]');
    assert.ok(value, `${command} must create a test run`);
    assert.equal(value.label, expected);
  }
});

test('test labels never expose an opaque execution id as the visible title', () => {
  const value = run('pytest', '2 passed\n[exit code: 0]');
  assert.match(value.label, /pytest/);
  assert.doesNotMatch(value.label, /call-with-ugly|fc_internal/);
});
