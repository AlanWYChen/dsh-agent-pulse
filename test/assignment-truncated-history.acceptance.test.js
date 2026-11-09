import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initState, reduceEvent } from '../src/engine.js';
import { ActivityCoordinator } from '../src/coordinator.js';

test('assignment retention truncation persists a conservative ownership-history marker', () => {
  let state = initState({ id: 'root' });
  let seq = 0;
  for (let index = 0; index < 257; index++) {
    state = reduceEvent(state, { seq: seq++, type: 'tool/call', data: {
      turn: 1, step: index, callId: `call-${index}`, name: 'send_message',
      arguments: JSON.stringify({ agent_id: 'child', message: 'PRIVATE_REPEATED_DELIVERY' }),
    } });
    state = reduceEvent(state, { seq: seq++, type: 'tool/result', data: {
      turn: 1, step: index, message: { toolCallId: `call-${index}`, content: [{ type: 'text', text: 'message delivered to agent child' }] },
    } });
  }
  assert.equal(state._assignmentsTruncated, true);
  assert.equal(state.assignments.length, 256);
  assert.equal(JSON.parse(JSON.stringify(state))._assignmentsTruncated, true);
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_REPEATED_DELIVERY/);
});

const card = (id, turn, inputs = []) => ({ id: `outcome:${turn}`, category: 'outcome',
  title: 'Research', summary: 'Research', status: 'observed', time: 1, agentId: id,
  evidence: [], files: [], testRuns: [], inputMessageIds: inputs,
  verification: { status: 'not-run', label: 'No verification' }, _turn: turn, _finalized: true });
async function truncated(binding) {
  const hash = createHash('sha256').update(JSON.stringify(['root', 'child', 'identical message'])).digest('hex');
  const root = { ...initState({ id: 'root' }), _assignmentsTruncated: true,
    cards: [{ ...card('root', 2), _delegatedActivity: true }],
    assignments: [{ id: 'retained', parentSessionId: 'root', parentCardId: 'outcome:2', parentTurn: 2,
      callSeq: 500, childSessionId: 'child', kind: 'message', label: 'Followup', status: 'accepted' }],
    _assignmentMessageDigests: { retained: hash } };
  const child = { ...initState({ id: 'child', origin: 'subagent', parentSession: 'root' }),
    cards: [card('child', 4, ['old-input'])],
    inputs: [{ id: 'old-input', turn: 4, seq: 1, source: { kind: 'agent-message', form: 'relay', senderSessionId: 'root' } }],
    _inputMessageDigests: { 'old-input': hash } };
  const c = new ActivityCoordinator({ enabled: false, assignmentBindingFor: () => binding });
  try {
    c.update({ id: 'root' }, root); c.update({ id: 'child' }, child);
    return c.snapshot('root').sessions.find((s) => s.sessionId === 'root').cards[0].subtasks[0];
  } finally { await c.close(); }
}

test('truncated parent history cannot establish digest uniqueness from only retained assignments', async () => {
  const subtask = await truncated();
  assert.equal(subtask.attribution, 'unavailable');
  assert.deepEqual(subtask.cards, []);
});

test('exact canonical receipt remains usable despite truncated parent assignment history', async () => {
  const subtask = await truncated({ messageId: 'old-input' });
  assert.equal(subtask.attribution, 'linked');
  assert.deepEqual(subtask.cards.map((c) => c.id), ['outcome:4']);
});
