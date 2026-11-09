import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

function fixture() {
  let state = initState({ id: 'session-a' });
  let seq = 0;
  let call = 0;
  return {
    get state() {
      return state;
    },
    invoke(name, args, text = '') {
      const id = `call-${call++}`;
      state = reduceEvent(
        state,
        {
          type: 'tool/call',
          seq: seq++,
          time: 1000 + seq,
          data: {
            turn: 1,
            step: 1,
            callId: id,
            name,
            arguments: JSON.stringify(args),
          },
        },
        {},
      );
      state = reduceEvent(
        state,
        {
          type: 'tool/result',
          seq: seq++,
          time: 1000 + seq,
          data: {
            turn: 1,
            step: 1,
            message: {
              toolCallId: id,
              content: [{ type: 'text', text }],
            },
          },
        },
        {},
      );
      return state;
    },
  };
}
const card = (f) => f.state.cards.find((item) => item.category === 'outcome');

test('npm run check records a check run, never a test run', () => {
  const f = fixture();
  f.invoke('bash', { command: 'npm run check' }, '[exit code: 0]');
  const outcome = card(f);
  assert.ok(outcome);
  assert.equal(outcome.testRuns?.length || 0, 0);
  assert.equal(outcome.checkRuns.length, 1);
  assert.equal(outcome.checkRuns[0].label, 'npm run check');
  assert.equal(outcome.checkRuns[0].executionStatus, 'completed');
  assert.equal(outcome.checkRuns[0].exitCode, 0);
  assert.equal(viewState(f.state).cards[0].checkRuns[0].label, 'npm run check');
});

test('lint, typecheck, prettier --check, tsc --noEmit and node --check are checks', () => {
  for (const [command, label] of [
    ['npm run lint', 'npm run lint'],
    ['npm run typecheck', 'npm run typecheck'],
    ['npx prettier --check client.js', 'prettier --check'],
    ['npx tsc --noEmit', 'tsc --noEmit'],
    ['node --check client.js', 'node --check'],
  ]) {
    const f = fixture();
    f.invoke('bash', { command }, '[exit code: 0]');
    const outcome = card(f);
    assert.equal(outcome.testRuns?.length || 0, 0, command);
    assert.equal(outcome.checkRuns.length, 1, command);
    assert.equal(outcome.checkRuns[0].label, label, command);
  }
});

test('npm test remains a test run and is not duplicated as a check', () => {
  const f = fixture();
  f.invoke(
    'bash',
    { command: 'npm test' },
    '# pass 1\n# fail 0\n[exit code: 0]',
  );
  const outcome = card(f);
  assert.equal(outcome.testRuns.length, 1);
  assert.equal(outcome.checkRuns?.length || 0, 0);
});
