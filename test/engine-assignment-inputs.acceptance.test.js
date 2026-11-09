import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';

function fixture(inherited = 0) {
  let state = initState(
    { id: 'child', origin: 'subagent', parentSession: 'root' },
    inherited,
  );
  let seq = 0;
  return {
    get state() {
      return state;
    },
    event(type, data) {
      state = reduceEvent(state, { seq: seq++, time: 1, type, data });
    },
    input(id, turn, source = { kind: 'user' }) {
      this.event('user/message', {
        turn,
        step: 0,
        message: {
          id,
          source,
          content: [
            {
              type: 'text',
              text: 'PRIVATE_INPUT_CONTENT password=secret-input',
            },
          ],
        },
      });
    },
    report(turn) {
      this.event('assistant/message', {
        turn,
        message: { content: [{ type: 'text', text: `Result turn ${turn}` }] },
      });
    },
  };
}

test('child outcomes expose exact input message identities for their own turn, never message content', () => {
  const f = fixture();
  f.input('initial', 1);
  f.report(1);
  f.input('follow-up', 2, { kind: 'agent-message', senderSessionId: 'root' });
  f.report(2);
  assert.deepEqual(f.state.inputs, [
    { id: 'initial', turn: 1, seq: 0, source: { kind: 'user' } },
    {
      id: 'follow-up',
      turn: 2,
      seq: 2,
      source: { kind: 'agent-message', senderSessionId: 'root' },
    },
  ]);
  const cards = viewState(f.state).cards;
  assert.deepEqual(cards.find((c) => c.id === 'outcome:1').inputMessageIds, [
    'initial',
  ]);
  assert.deepEqual(cards.find((c) => c.id === 'outcome:2').inputMessageIds, [
    'follow-up',
  ]);
  assert.doesNotMatch(
    JSON.stringify(f.state),
    /PRIVATE_INPUT_CONTENT|secret-input/,
  );
});

test('multiple inputs consumed in one child turn retain all IDs, including input arriving after card creation', () => {
  const f = fixture();
  f.input('first', 4, { kind: 'agent-message', senderSessionId: 'root' });
  f.report(4);
  f.input('second', 4, { kind: 'agent-message', senderSessionId: 'root' });
  f.report(4);
  assert.deepEqual(viewState(f.state).cards[0].inputMessageIds, [
    'first',
    'second',
  ]);
});

test('root closing report enriches an existing delegation outcome without retaining the initiating prompt', () => {
  let state = initState({ id: 'root' });
  const events = [
    {
      type: 'user/message',
      data: {
        turn: 1,
        step: 0,
        message: {
          id: 'root-input',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'PRIVATE_ROOT_REQUEST' }],
        },
      },
    },
    {
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'spawn',
        name: 'subagent',
        arguments: JSON.stringify({
          description: 'Payment implementation',
          prompt: 'PRIVATE_CHILD_REQUEST',
        }),
      },
    },
    {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          toolCallId: 'spawn',
          content: [{ type: 'text', text: 'started subagent child' }],
        },
      },
    },
    {
      type: 'assistant/message',
      data: {
        turn: 1,
        message: {
          content: [
            { type: 'text', text: 'Implemented Stripe as payment method' },
          ],
        },
      },
    },
  ];
  events.forEach((event, seq) => {
    state = reduceEvent(state, { ...event, seq });
  });
  assert.match(
    state.cards.find((c) => c.id === 'outcome:1')._reportedResult || '',
    /Implemented Stripe as payment method/,
  );
  assert.equal(viewState(state).cards[0].verification.status, 'not-run');
  assert.doesNotMatch(
    JSON.stringify(state),
    /PRIVATE_ROOT_REQUEST|PRIVATE_CHILD_REQUEST/,
  );
});

test('inherited inputs are excluded from child own assignment attribution', () => {
  const f = fixture(2);
  f.input('inherited-user', 1);
  f.report(1);
  f.input('own-user', 2);
  f.report(2);
  assert.deepEqual(viewState(f.state).cards[0].inputMessageIds, ['own-user']);
  assert.doesNotMatch(JSON.stringify(f.state), /inherited-user/);
});
