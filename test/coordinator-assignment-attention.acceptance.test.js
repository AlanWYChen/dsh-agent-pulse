import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const card = (id, turn, inputId, status = 'observed') => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: 'Delegated research',
  summary: 'Delegated research',
  status,
  time: 1,
  agentId: id,
  evidence: [],
  files: [],
  testRuns: [],
  inputMessageIds: inputId ? [inputId] : [],
  verification: { status: 'not-run', label: 'No test execution' },
  _turn: turn,
  _finalized: true,
});
const assignment = (parentSessionId, childSessionId, id, turn) => ({
  id,
  parentSessionId,
  childSessionId,
  parentCardId: `outcome:${turn}`,
  parentTurn: turn,
  callSeq: 2,
  label: 'Delegated research',
  kind: 'spawn',
  status: 'accepted',
});

test('a failed grandchild without test runs propagates attention through every owning assignment', async () => {
  const root = {
    ...initState({ id: 'root' }),
    cards: [{ ...card('root', 1), _delegatedActivity: true }],
    assignments: [assignment('root', 'child', 'outer', 1)],
  };
  const child = {
    ...initState({ id: 'child', origin: 'subagent', parentSession: 'root' }),
    cards: [{ ...card('child', 3, 'child-input'), _delegatedActivity: true }],
    inputs: [{ id: 'child-input', turn: 3, seq: 0, source: { kind: 'user' } }],
    assignments: [assignment('child', 'grandchild', 'inner', 3)],
  };
  const grandchild = {
    ...initState({
      id: 'grandchild',
      origin: 'subagent',
      parentSession: 'child',
    }),
    cards: [card('grandchild', 7, 'grandchild-input', 'failed')],
    inputs: [
      { id: 'grandchild-input', turn: 7, seq: 0, source: { kind: 'user' } },
    ],
  };
  const c = new ActivityCoordinator({ enabled: false });
  try {
    for (const state of [root, child, grandchild])
      c.update({ id: state.sessionId }, state);
    const snapshot = c.snapshot('root');
    const outer = snapshot.sessions.find((s) => s.sessionId === 'root').cards[0]
      .subtasks[0];
    const inner = outer.cards[0].subtasks[0];
    assert.equal(inner.status, 'failed');
    assert.equal(
      outer.status,
      'failed',
      'nested failure must not be hidden by completed intermediate coordination',
    );
    assert.deepEqual(inner.cards[0].testRuns, []);
  } finally {
    await c.close();
  }
});
