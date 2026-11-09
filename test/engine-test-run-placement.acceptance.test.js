import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

// A run in turn N belongs to outcome:N. The last-outcome fallback is only for
// runs without a turn; it must never pull a later turn's run into an older card.
function session() {
  let state = initState({ id: 'session-placement' });
  let seq = 0;
  const emit = (type, data) => {
    state = reduceEvent(
      state,
      { type, seq: seq++, time: 1000 + seq, data },
      {},
    );
  };
  const envelope = (turn, data) => {
    if (turn != null) data.turn = turn;
    return data;
  };
  const call = (turn, callId, name, args) =>
    emit(
      'tool/call',
      envelope(turn, {
        step: 1,
        callId,
        name,
        arguments: JSON.stringify(args),
      }),
    );
  const result = (turn, callId, text) =>
    emit(
      'tool/result',
      envelope(turn, {
        step: 1,
        message: { toolCallId: callId, content: [{ type: 'text', text }] },
      }),
    );
  const edit = (turn, callId, file = '/app/client.js') => {
    call(turn, callId, 'edit', {
      file_path: file,
      old_string: 'old',
      new_string: 'new',
    });
    result(turn, callId, 'Edited');
  };
  const bash = (turn, callId, command, text = '[exit code: 0]') => {
    call(turn, callId, 'bash', { command });
    result(turn, callId, text);
  };
  return {
    edit,
    bash,
    get state() {
      return state;
    },
    get view() {
      return viewState(state);
    },
  };
}
const outcomeCards = (view) =>
  view.cards.filter((card) => card.category === 'outcome');
const outcome = (view, id) => outcomeCards(view).find((card) => card.id === id);
const testRunsOn = (card) => card?.testRuns?.length || 0;
const checkRunsOn = (card) => card?.checkRuns?.length || 0;

test('a test run in a later turn creates outcome:N instead of reusing the previous card', () => {
  const s = session();
  s.edit(1, 'edit-1');
  s.bash(2, 'test-2', 'npm test');
  const view = s.view;

  const earlier = outcome(view, 'outcome:1');
  const current = outcome(view, 'outcome:2');
  assert.ok(earlier, 'the turn 1 edit must create outcome:1');
  assert.ok(current, 'the turn 2 test run must create outcome:2');
  assert.equal(
    testRunsOn(earlier),
    0,
    'outcome:1 must not gain the turn 2 run',
  );
  assert.equal(checkRunsOn(earlier), 0);
  assert.equal(testRunsOn(current), 1);
  assert.equal(current.testRuns[0].label, 'npm test');
});

test('a later run in the same turn attaches to the test-created turn card', () => {
  const s = session();
  s.edit(1, 'edit-1');
  s.bash(2, 'test-2a', 'npm test');
  s.bash(2, 'test-2b', 'npm test');
  const view = s.view;

  const currentCards = outcomeCards(view).filter(
    (card) => card.id === 'outcome:2',
  );
  assert.equal(currentCards.length, 1, 'turn 2 must have exactly one card');
  assert.equal(testRunsOn(currentCards[0]), 2);
  assert.deepEqual(
    currentCards[0].testRuns.map((run) => run.label),
    ['npm test', 'npm test'],
  );
  assert.equal(testRunsOn(outcome(view, 'outcome:1')), 0);
});

test('check runs in a later turn create and reuse outcome:N', () => {
  const s = session();
  s.edit(1, 'edit-1');
  s.bash(2, 'check-2a', 'npm run check');
  s.bash(2, 'check-2b', 'npm run check');
  const view = s.view;

  const currentCards = outcomeCards(view).filter(
    (card) => card.id === 'outcome:2',
  );
  assert.equal(currentCards.length, 1, 'turn 2 must have exactly one card');
  assert.equal(checkRunsOn(currentCards[0]), 2);
  assert.deepEqual(
    currentCards[0].checkRuns.map((run) => run.label),
    ['npm run check', 'npm run check'],
  );
  const earlier = outcome(view, 'outcome:1');
  assert.equal(checkRunsOn(earlier), 0, 'outcome:1 must not gain the checks');
  assert.equal(testRunsOn(earlier), 0);
});

test('a run without a turn may still fall back to the last outcome card', () => {
  const s = session();
  s.edit(1, 'edit-1');
  s.bash(null, 'test-no-turn', 'npm test');
  const view = s.view;

  const cards = outcomeCards(view);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'outcome:1');
  assert.equal(testRunsOn(cards[0]), 1);
  assert.equal(
    cards.some((card) => card.id === 'outcome:unknown'),
    false,
    'a turn-less run must reuse the last outcome instead of creating outcome:unknown',
  );
});

test('a later edit in the turn merges into the test-created card without a duplicate', () => {
  const s = session();
  s.edit(1, 'edit-1');
  s.bash(2, 'test-2', 'npm test');
  s.edit(2, 'edit-2');
  const view = s.view;

  const currentCards = outcomeCards(view).filter(
    (card) => card.id === 'outcome:2',
  );
  assert.equal(currentCards.length, 1, 'turn 2 must not gain a duplicate card');
  assert.equal(testRunsOn(currentCards[0]), 1);
  assert.deepEqual(currentCards[0].files, ['client.js']);
  const earlier = outcome(view, 'outcome:1');
  assert.equal(testRunsOn(earlier), 0);
  assert.deepEqual(earlier.files, ['client.js']);
});
