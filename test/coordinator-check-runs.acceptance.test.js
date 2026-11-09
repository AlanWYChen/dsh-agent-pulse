import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const card = (sessionId, turn, extra = {}) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: `Outcome ${turn}`,
  summary: `Outcome ${turn}`,
  status: 'observed',
  time: turn,
  agentId: sessionId,
  evidence: [],
  files: [],
  testRuns: [],
  verification: { status: 'not-run', label: 'No verification' },
  _turn: turn,
  _finalized: true,
  ...extra,
});

test('delegated child checks roll up into the owning parent card', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  try {
    c.update(
      { id: 'root' },
      {
        ...initState({ id: 'root' }),
        cards: [{ ...card('root', 1), _delegatedActivity: true }],
        assignments: [
          {
            id: 'call',
            parentSessionId: 'root',
            parentCardId: 'outcome:1',
            parentTurn: 1,
            callSeq: 1,
            childSessionId: 'child',
            label: 'Research',
            kind: 'spawn',
            status: 'accepted',
          },
        ],
      },
    );
    c.update(
      { id: 'child' },
      {
        ...initState({
          id: 'child',
          origin: 'subagent',
          parentSession: 'root',
        }),
        cards: [
          card('child', 1, {
            checkRuns: [
              {
                id: 'check',
                label: 'npm run check',
                executionStatus: 'completed',
                resultStatus: 'unknown',
                exitCode: 0,
                sessionId: 'child',
                callSeq: 1,
              },
            ],
          }),
        ],
      },
    );
    const parent = c
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root').cards[0];
    assert.equal(parent.checkRuns.length, 1);
    assert.equal(parent.checkRuns[0].label, 'npm run check');
  } finally {
    await c.close();
  }
});
