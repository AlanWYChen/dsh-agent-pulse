import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initState } from '../src/engine.js';
import { ActivityCoordinator } from '../src/coordinator.js';
const digest = (body) =>
  createHash('sha256')
    .update(JSON.stringify(['root', 'child', body]))
    .digest('hex');
const assignment = (id, turn) => ({
  id,
  parentSessionId: 'root',
  parentCardId: `outcome:${turn}`,
  parentTurn: turn,
  callSeq: turn,
  childSessionId: 'child',
  label: `Followup ${id}`,
  kind: 'message',
  status: 'accepted',
});
const card = (sessionId, turn, inputId) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: 'Research finding',
  summary: 'Research finding',
  status: 'observed',
  time: 1,
  agentId: sessionId,
  evidence: [],
  files: [],
  verification: { status: 'not-run', label: 'No test evidence' },
  _turn: turn,
  _finalized: true,
  _reportedResult: `Finding ${turn}`,
  testRuns: [],
  inputMessageIds: inputId ? [inputId] : [],
});
function fixture({
  calls = [
    ['a', 1, 'alpha'],
    ['b', 2, 'beta'],
  ],
  inputs = [
    ['in-a', 10, 'alpha'],
    ['in-b', 20, 'beta'],
  ],
  bindings = {},
} = {}) {
  const root = {
    ...initState({ id: 'root' }),
    assignments: calls.map(([id, turn]) => assignment(id, turn)),
    cards: [...new Set(calls.map(([, turn]) => turn))].map((turn) => ({
      ...card('root', turn),
      _delegatedActivity: true,
    })),
    _assignmentMessageDigests: Object.fromEntries(
      calls.map(([id, , body]) => [id, digest(body)]),
    ),
  };
  const child = {
    ...initState({ id: 'child', origin: 'subagent', parentSession: 'root' }),
    cards: inputs.map(([id, turn]) => card('child', turn, id)),
    inputs: inputs.map(([id, turn], seq) => ({
      id,
      turn,
      seq,
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'root' },
    })),
    _inputMessageDigests: Object.fromEntries(
      inputs.map(([id, , body]) => [id, digest(body)]),
    ),
  };
  const c = new ActivityCoordinator({
    enabled: false,
    assignmentBindingFor: (sessionId, callId) => bindings[callId],
  });
  c.update({ id: 'root' }, root);
  c.update({ id: 'child' }, child);
  return {
    c,
    task(turn, id) {
      return c
        .snapshot('root')
        .sessions.find((s) => s.sessionId === 'root')
        .cards.find((item) => item.id === `outcome:${turn}`)
        .subtasks?.find((item) => item.id === id);
    },
  };
}

test('unique exact historical digests recover reused child assignment ownership without canonical receipts', async () => {
  const f = fixture();
  try {
    assert.equal(f.task(1, 'a')?.attribution, 'linked');
    assert.deepEqual(
      f.task(1, 'a').cards.map((c) => c.id),
      ['outcome:10'],
    );
    assert.deepEqual(
      f.task(2, 'b').cards.map((c) => c.id),
      ['outcome:20'],
    );
  } finally {
    await f.c.close();
  }
});

test('duplicate same-target parent delivery digests refuse ambiguous historical matching', async () => {
  const f = fixture({
    calls: [
      ['a', 1, 'same'],
      ['b', 2, 'same'],
    ],
    inputs: [['only', 10, 'same']],
  });
  try {
    for (const [turn, id] of [
      [1, 'a'],
      [2, 'b'],
    ]) {
      assert.equal(f.task(turn, id)?.attribution, 'unavailable');
      assert.deepEqual(f.task(turn, id).cards, []);
    }
  } finally {
    await f.c.close();
  }
});

test('duplicate child relay digests refuse ambiguous historical matching', async () => {
  const f = fixture({
    calls: [['a', 1, 'same']],
    inputs: [
      ['one', 10, 'same'],
      ['two', 20, 'same'],
    ],
  });
  try {
    assert.equal(f.task(1, 'a')?.attribution, 'unavailable');
    assert.deepEqual(f.task(1, 'a').cards, []);
  } finally {
    await f.c.close();
  }
});

test('canonical receipt identity takes precedence over duplicate historical digest ambiguity', async () => {
  const f = fixture({
    calls: [
      ['a', 1, 'same'],
      ['b', 2, 'same'],
    ],
    inputs: [
      ['one', 10, 'same'],
      ['two', 20, 'same'],
    ],
    bindings: { a: { messageId: 'two' } },
  });
  try {
    assert.equal(f.task(1, 'a')?.attribution, 'linked');
    assert.deepEqual(
      f.task(1, 'a').cards.map((c) => c.id),
      ['outcome:20'],
    );
    assert.equal(f.task(2, 'b')?.attribution, 'unavailable');
  } finally {
    await f.c.close();
  }
});

test('historical digest matching is exact and does not trim or normalize message text', async () => {
  const f = fixture({
    calls: [['a', 1, ' task\n']],
    inputs: [['different', 10, 'task']],
  });
  try {
    assert.equal(f.task(1, 'a')?.attribution, 'unavailable');
    assert.deepEqual(f.task(1, 'a').cards, []);
  } finally {
    await f.c.close();
  }
});
