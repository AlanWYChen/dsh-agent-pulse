import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initState, reduceEvent, viewState } from '../src/engine.js';
const digest = (sender, target, text) => createHash('sha256').update(JSON.stringify([sender, target, text])).digest('hex');
function project(header, events) {
  return events.reduce((s, event, seq) => reduceEvent(s, { ...event, seq, time: 1 }), initState(header));
}
const send = (id, text, isError = false) => [
  { type: 'tool/call', data: { turn: 1, step: 1, callId: id, name: 'send_message', arguments: JSON.stringify({ agent_id: 'child', message: text }) } },
  { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: id, isError, content: [{ type: 'text', text: 'message delivered to agent child' }] } } },
];
const relay = (id, content, source = { kind: 'agent-message', form: 'relay', senderSessionId: 'root' }) => ({
  type: 'user/message', data: { turn: 3, step: 0, message: { id, source, content } },
});
const text = (text) => ({ type: 'text', text });

test('accepted historical send stores only private exact-content digest keyed by call identity', () => {
  const body = '  PRIVATE_DELIVERY_BODY password=secret-value\n';
  const state = project({ id: 'root' }, send('delivery', body));
  assert.deepEqual(state._assignmentMessageDigests, { delivery: digest('root', 'child', body) });
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_DELIVERY_BODY|secret-value/);
  assert.equal(viewState(state)._assignmentMessageDigests, undefined);
  const failed = project({ id: 'root' }, send('failed', body, true));
  assert.deepEqual(failed._assignmentMessageDigests || {}, {});
});

test('verified relay prefix and exact remaining text reproduce parent digest without storing content', () => {
  const body = '  PRIVATE_RELAY_BODY\n';
  const state = project({ id: 'child', origin: 'subagent', parentSession: 'root' }, [
    relay('receipt', [text('Agent root sent a message: '), text(body)]),
  ]);
  assert.deepEqual(state._inputMessageDigests, { receipt: digest('root', 'child', body) });
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_RELAY_BODY/);
  assert.equal(viewState(state)._inputMessageDigests, undefined);
});

test('unknown, spoofed, multipart, or non-relay child inputs never generate historical ownership digests', () => {
  const prefix = text('Agent root sent a message: ');
  const state = project({ id: 'child', origin: 'subagent', parentSession: 'root' }, [
    relay('wrong-prefix', [text('Agent other sent a message: '), text('body')]),
    relay('near-prefix', [text('Agent root sent a message:  '), text('body')]),
    relay('multipart', [prefix, text('body'), text('more')]),
    relay('attachment', [prefix, { type: 'image', url: 'private-image' }]),
    relay('wrong-form', [prefix, text('body')], { kind: 'agent-message', form: 'unknown', senderSessionId: 'root' }),
    relay('ordinary-user', [prefix, text('body')], { kind: 'user' }),
  ]);
  assert.deepEqual(state._inputMessageDigests || {}, {});
});
