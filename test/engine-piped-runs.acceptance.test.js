import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCommand,
  initState,
  reduceEvent,
  testCommand,
  viewState,
} from '../src/engine.js';

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
const outcome = (f) =>
  f.state.cards.find((item) => item.category === 'outcome');

test('piped test and check commands are captured as piped runs', () => {
  assert.deepEqual(testCommand('npm test 2>&1 | tail -12'), {
    targets: [],
    all: true,
    label: 'npm test',
    piped: true,
  });
  assert.deepEqual(
    testCommand(
      'npx prettier --write client.js && node --check client.js && node --test client.test.js 2>&1 | grep -E "pass|fail"',
    ),
    {
      targets: ['client.test.js'],
      all: false,
      label: 'node --test',
      piped: true,
    },
  );
  assert.deepEqual(checkCommand('npm run check 2>&1 | tail -2'), {
    targets: [],
    all: true,
    label: 'npm run check',
    piped: true,
  });
});

test('piped test output records a run but never certifies changed files', () => {
  const f = fixture();
  f.invoke(
    'bash',
    { command: 'npm test 2>&1 | tail -12' },
    '# tests 3\n# pass 3\n# fail 0\n[exit code: 0]',
  );
  const card = outcome(f);
  assert.equal(card.testRuns.length, 1);
  assert.equal(card.testRuns[0].piped, true);
  assert.equal(card.testRuns[0].resultStatus, 'passed');
  assert.equal(card.checkRuns?.length || 0, 0);
  assert.equal(card.verification.status, 'not-run');
  assert.equal(viewState(f.state).cards[0].testRuns[0].piped, true);
});

test('piped check output records a completed check with an unverified result', () => {
  const f = fixture();
  f.invoke(
    'bash',
    { command: 'npm run check 2>&1 | tail -2' },
    'checked 12 files\n[exit code: 0]',
  );
  const card = outcome(f);
  assert.equal(card.testRuns?.length || 0, 0);
  assert.equal(card.checkRuns.length, 1);
  assert.equal(card.checkRuns[0].piped, true);
  assert.equal(card.checkRuns[0].executionStatus, 'completed');
  assert.equal(card.checkRuns[0].resultStatus, 'unknown');
  assert.equal(card.verification.status, 'not-run');
});

test('pipes that hide the test/check command are still ignored', () => {
  assert.equal(testCommand('echo ok | npm test'), null);
  assert.equal(testCommand('cat results.txt | grep pass'), null);
  assert.equal(testCommand('npm test > out.txt'), null);
  assert.equal(checkCommand('echo ok | npm run check'), null);
});
