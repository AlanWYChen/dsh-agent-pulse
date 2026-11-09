import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

// Host durable events, not transient tool return values, are the ownership evidence.
function fixture() {
  let state = initState({ id: 'root' });
  let seq = 0;
  const events = [];
  return {
    get state() { return state; },
    event(type, data) {
      const event = { type, data, seq: seq++, time: 42 };
      events.push(event);
      state = reduceEvent(state, event);
      return event;
    },
    dispatch({ id, name = 'subagent', turn = 1, args = {}, text, error, isError }) {
      const call = this.event('tool/call', {
        turn, step: 1, callId: id, name, arguments: JSON.stringify(args),
      });
      this.event('tool/result', {
        turn, step: 1, ...(error ? { error } : {}),
        message: { toolCallId: id, isError, content: [{ type: 'text', text }] },
      });
      return call;
    },
    restoreAndReplay() {
      state = JSON.parse(JSON.stringify(state));
      for (const event of events) state = reduceEvent(state, event);
    },
  };
}
const assignments = (f) => f.state.assignments || [];
const outcomes = (f) => f.state.cards.filter((card) => card.category === 'outcome');

test('durable successful spawn records exact source coordinates and creates a pure orchestrator outcome', () => {
  const f = fixture();
  const call = f.dispatch({ id: 'spawn-a', name: 'functions.subagent', turn: 7,
    args: { description: 'Inspect ownership', prompt: 'PRIVATE_SPAWN_PROMPT' },
    text: 'started subagent child-a' });
  assert.deepEqual(assignments(f), [{
    id: 'spawn-a', parentSessionId: 'root', parentCardId: 'outcome:7',
    parentTurn: 7, callSeq: call.seq, childSessionId: 'child-a',
    label: 'Inspect ownership', kind: 'spawn', status: 'accepted',
  }]);
  const card = outcomes(f).find((item) => item.id === 'outcome:7');
  assert.ok(card, 'delegation-only parent task must have an outcome');
  assert.equal(card._delegatedActivity, true);
  assert.deepEqual(card.files, []);
  assert.equal(card.verification.status, 'not-run');
  assert.deepEqual(viewState(f.state).assignments, assignments(f));
});

test('reusing one child creates separate accepted assignments on exact parent cards without time inference', () => {
  const f = fixture();
  f.dispatch({ id: 'spawn', name: 'subagent_fork', turn: 2,
    args: { description: 'First task', prompt: 'PRIVATE_FIRST_PROMPT' },
    text: 'started subagent reused' });
  f.dispatch({ id: 'followup', name: 'functions.send_message', turn: 9,
    args: { agent_id: 'reused', message: 'PRIVATE_FOLLOWUP_MESSAGE' },
    text: 'message delivered to agent reused' });
  assert.deepEqual(assignments(f).map(({ id, parentCardId, childSessionId, kind, label }) =>
    ({ id, parentCardId, childSessionId, kind, label })), [
    { id: 'spawn', parentCardId: 'outcome:2', childSessionId: 'reused', kind: 'spawn', label: 'First task' },
    { id: 'followup', parentCardId: 'outcome:9', childSessionId: 'reused', kind: 'message', label: 'Delegated follow-up' },
  ]);
  assert.deepEqual(outcomes(f).map((card) => card.id), ['outcome:2', 'outcome:9']);
  const before = structuredClone(assignments(f));
  f.restoreAndReplay();
  assert.deepEqual(assignments(f), before, 'JSON restore and duplicate replay retain each accepted edge exactly once');
  assert.doesNotMatch(JSON.stringify(f.state), /PRIVATE_FIRST_PROMPT|PRIVATE_FOLLOWUP_MESSAGE/);
});

test('multiple accepted invocations in one parent task retain separate assignment identities', () => {
  const f = fixture();
  for (const id of ['one', 'two']) f.dispatch({ id, turn: 3,
    args: { description: id }, text: `started subagent child-${id}` });
  assert.deepEqual(assignments(f).map((item) => [item.id, item.parentCardId]),
    [['one', 'outcome:3'], ['two', 'outcome:3']]);
  assert.equal(outcomes(f).length, 1);
});

test('failed, unconfirmed, or wrong-recipient deliveries never manufacture accepted ownership', () => {
  const f = fixture();
  f.dispatch({ id: 'error', args: {}, text: 'started subagent failed', isError: true });
  f.dispatch({ id: 'throw', args: {}, text: 'started subagent failed', error: 'dispatch failed' });
  f.dispatch({ id: 'unknown', args: {}, text: 'tool completed' });
  f.dispatch({ id: 'mismatch', name: 'send_message', args: { agent_id: 'expected', message: 'PRIVATE' },
    text: 'message delivered to agent different' });
  f.event('tool/call', { turn: 1, step: 1, callId: 'pending', name: 'subagent',
    arguments: JSON.stringify({ description: 'Pending' }) });
  assert.deepEqual(assignments(f), []);
  assert.equal(outcomes(f).length, 0);
});

test('spawn assignment labels are bounded and redacted while prompts never enter the durable projection', () => {
  const f = fixture();
  f.dispatch({ id: 'private', args: {
    description: `password=super-secret ${'research '.repeat(100)}`,
    prompt: 'DO_NOT_RETAIN_DELEGATION_PROMPT',
  }, text: 'started subagent safe-child' });
  assert.equal(assignments(f).length, 1);
  assert.ok(assignments(f)[0].label.length <= 100);
  assert.match(assignments(f)[0].label, /REDACTED/);
  assert.doesNotMatch(JSON.stringify(f.state), /super-secret|DO_NOT_RETAIN_DELEGATION_PROMPT/);
});
