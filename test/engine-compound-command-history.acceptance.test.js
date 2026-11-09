import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

// A top-level semicolon chain is only eligible when EVERY segment is a directly
// recognized test or check command. Captured compound runs are execution history
// only: they must never establish change coverage.
const PASS_OUTPUT = [
  '> npm test',
  '',
  'ℹ tests 9',
  'ℹ pass 9',
  'ℹ fail 0',
  '[exit code: 0]',
].join('\n');

function project(command, text = PASS_OUTPUT) {
  let state = initState({ id: 'session-compound' });
  let seq = 0;
  const event = (type, data) => {
    state = reduceEvent(
      state,
      { type, seq: seq++, time: 1000 + seq, data },
      {},
    );
  };
  event('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call-compound',
    name: 'bash',
    arguments: JSON.stringify({ command }),
  });
  event('tool/result', {
    turn: 1,
    step: 1,
    message: {
      toolCallId: 'call-compound',
      content: [{ type: 'text', text }],
    },
  });
  const view = viewState(state);
  const outcomeCards = view.cards.filter((card) => card.category === 'outcome');
  const runs = (key) => outcomeCards.flatMap((card) => card[key] || []);
  return {
    state,
    view,
    outcomeCards,
    testRuns: runs('testRuns'),
    checkRuns: runs('checkRuns'),
  };
}

const labels = (runs) => runs.map((run) => run.label).sort();

test('a fully recognized semicolon chain records its test and check on the turn card', () => {
  const result = project(
    'npm test 2>&1 | tail -8; npm run check 2>&1 | tail -2',
  );
  assert.equal(result.outcomeCards.length, 1);
  assert.equal(result.outcomeCards[0].testRuns.length, 1);
  assert.equal(result.outcomeCards[0].checkRuns.length, 1);
  assert.deepEqual(labels(result.testRuns), ['npm test']);
  assert.deepEqual(labels(result.checkRuns), ['npm run check']);
});

test('a format-check, check, and test chain records one test run and two check runs', () => {
  const result = project(
    'npm run format:check 2>&1 | tail -3; npm run check 2>&1 | tail -2; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"',
  );
  assert.equal(result.outcomeCards.length, 1);
  assert.equal(result.testRuns.length, 1);
  assert.deepEqual(labels(result.testRuns), ['npm test']);
  assert.equal(result.checkRuns.length, 2);
  assert.deepEqual(labels(result.checkRuns), [
    'npm run check',
    'npm run format:check',
  ]);
});

test('compound runs are history only: unknown result, no counts, no certification', () => {
  for (const command of [
    'npm test 2>&1 | tail -8; npm run check 2>&1 | tail -2',
    'npm run format:check 2>&1 | tail -3; npm run check 2>&1 | tail -2; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"',
    'npm test; npm run check 2>&1 | tail -2',
  ]) {
    const result = project(command);
    assert.ok(
      result.testRuns.length || result.checkRuns.length,
      `${command} must record compound history`,
    );
    for (const run of [...result.testRuns, ...result.checkRuns]) {
      assert.equal(run.compound, true, `${command}: ${run.label}`);
      assert.equal(run.resultStatus, 'unknown', `${command}: ${run.label}`);
      assert.equal(run.counts, null, `${command}: ${run.label}`);
    }
    assert.equal(result.outcomeCards.length, 1);
    assert.equal(result.outcomeCards[0].verification.status, 'not-run');
    assert.equal(result.view.cards[0].verification.status, 'not-run');
  }
});

test('pipeline marking follows each segment, not the whole chain', () => {
  const checkPiped = project('npm test; npm run check 2>&1 | tail -2');
  assert.equal(checkPiped.testRuns.length, 1);
  assert.equal(checkPiped.testRuns[0].compound, true);
  assert.ok(!checkPiped.testRuns[0].piped);
  assert.equal(checkPiped.checkRuns.length, 1);
  assert.equal(checkPiped.checkRuns[0].compound, true);
  assert.equal(checkPiped.checkRuns[0].piped, true);

  const testPiped = project('npm test 2>&1 | tail -8; npm run check');
  assert.equal(testPiped.testRuns.length, 1);
  assert.equal(testPiped.testRuns[0].compound, true);
  assert.equal(testPiped.testRuns[0].piped, true);
  assert.equal(testPiped.checkRuns.length, 1);
  assert.equal(testPiped.checkRuns[0].compound, true);
  assert.ok(!testPiped.checkRuns[0].piped);
});

test('a chain with any unrecognized segment records no partial test or check capture', () => {
  for (const command of [
    'npm test; echo done',
    'npm test; npm run check; rm -rf /tmp/x',
  ]) {
    const result = project(command);
    assert.equal(result.testRuns.length, 0, command);
    assert.equal(result.checkRuns.length, 0, command);
    for (const card of result.view.cards)
      assert.equal(card.verification.status, 'not-run', command);
  }
});

test('npm run test:package and its env-prefixed form are checks, never test runs', () => {
  for (const command of [
    'npm run test:package',
    'npm_config_cache=/tmp/cache npm run test:package',
  ]) {
    const result = project(
      command,
      'package contents verified\n[exit code: 0]',
    );
    assert.equal(result.testRuns.length, 0, command);
    assert.equal(result.checkRuns.length, 1, command);
    assert.equal(result.checkRuns[0].label, 'npm run test:package');
    assert.equal(result.outcomeCards.length, 1);
    assert.equal(result.outcomeCards[0].title, 'Checks');
    assert.equal(result.outcomeCards[0].verification.status, 'not-run');
  }
});
