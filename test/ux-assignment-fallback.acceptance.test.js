import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const card = (sessionId, turn, summary, inputMessageIds = []) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: summary,
  summary,
  status: 'observed',
  time: 100,
  agentId: sessionId,
  evidence: [],
  files: [],
  testRuns: [],
  verification: { status: 'not-run', label: 'No verification observed' },
  _turn: turn,
  _finalized: true,
  ...(inputMessageIds.length ? { inputMessageIds } : {}),
});
const assignment = (id, turn, childSessionId, kind) => ({
  id,
  parentSessionId: 'root',
  parentCardId: `outcome:${turn}`,
  parentTurn: turn,
  callSeq: turn,
  childSessionId,
  label: kind === 'spawn' ? 'Research parser' : 'Delegated follow-up',
  kind,
  status: 'accepted',
});
const root = (assignments) => ({
  ...initState({ id: 'root' }),
  cards: [
    { ...card('root', 1, 'Parent delegated work'), _delegatedActivity: true },
  ],
  assignments,
});

test('legacy spawn without inbox identities still owns its first child turn', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  try {
    c.update({ id: 'root' }, root([assignment('spawn', 1, 'child', 'spawn')]));
    c.update(
      { id: 'child' },
      {
        ...initState({
          id: 'child',
          origin: 'subagent',
          parentSession: 'root',
        }),
        inputs: [],
        cards: [
          card('child', 3, 'First parser research'),
          card('child', 9, 'Unrelated later work'),
        ],
      },
    );
    const parent = c
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root').cards[0];
    const subtask = parent.subtasks.find((item) => item.id === 'spawn');
    assert.deepEqual(
      subtask.cards.map((item) => item.id),
      ['outcome:3'],
    );
    assert.equal(subtask.attribution, 'legacy');
  } finally {
    await c.close();
  }
});

test('legacy follow-up without a receipt or inbox identity stays unavailable with a reason', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  try {
    c.update(
      { id: 'root' },
      root([assignment('follow', 1, 'child', 'message')]),
    );
    c.update(
      { id: 'child' },
      {
        ...initState({
          id: 'child',
          origin: 'subagent',
          parentSession: 'root',
        }),
        inputs: [],
        cards: [card('child', 4, 'Later output')],
      },
    );
    const parent = c
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root').cards[0];
    const subtask = parent.subtasks.find((item) => item.id === 'follow');
    assert.equal(subtask.attribution, 'unavailable');
    assert.deepEqual(subtask.cards, []);
    assert.ok(
      subtask.reason,
      'unavailable assignments explain why no child evidence is linked',
    );
  } finally {
    await c.close();
  }
});
