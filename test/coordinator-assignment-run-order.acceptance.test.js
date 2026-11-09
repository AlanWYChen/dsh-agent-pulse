import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const run = (sessionId, id, callSeq) => ({
  id,
  sessionId,
  agentId: sessionId,
  callSeq,
  resultSeq: callSeq + 1,
  executionStatus: 'completed',
  resultStatus: 'passed',
  counts: { passed: 1, failed: 0, skipped: 0 },
  exitCode: 0,
});
const card = (sessionId, turn, testRuns, started) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: 'Research',
  summary: 'Research',
  status: 'observed',
  time: 9999,
  agentId: sessionId,
  evidence: [],
  files: [],
  verification: {
    status: 'not-run',
    label: 'No claim about parent verification',
  },
  _turn: turn,
  _finalized: true,
  testRuns,
  _testStartedAt: started,
});

test('assignment-owned parent test history orders each own and delegated run by actual start, not summary-card time', async () => {
  const root = {
    ...initState({ id: 'root' }),
    cards: [
      card(
        'root',
        1,
        [run('root', 'local-old', 1), run('root', 'local-new', 9)],
        { 'local-old': 100, 'local-new': 300 },
      ),
    ],
    assignments: [
      {
        id: 'spawn',
        parentSessionId: 'root',
        parentCardId: 'outcome:1',
        parentTurn: 1,
        callSeq: 4,
        childSessionId: 'child',
        label: 'Delegated research',
        kind: 'spawn',
        status: 'accepted',
      },
    ],
  };
  const child = {
    ...initState({ id: 'child', origin: 'subagent', parentSession: 'root' }),
    cards: [
      {
        ...card('child', 3, [run('child', 'delegated-middle', 1)], {
          'delegated-middle': 200,
        }),
        inputMessageIds: ['initial'],
      },
    ],
    inputs: [{ id: 'initial', turn: 3, seq: 0, source: { kind: 'user' } }],
  };
  const before = structuredClone({ root, child });
  const c = new ActivityCoordinator({ enabled: false });
  try {
    c.update({ id: 'root' }, root);
    c.update({ id: 'child' }, child);
    const result = c
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root').cards[0];
    assert.deepEqual(
      result.testRuns.map((r) => r.id),
      ['local-new', 'delegated-middle', 'local-old'],
    );
    assert.deepEqual(
      result.testRuns.map((r) => r.startedAt),
      [300, 200, 100],
    );
    assert.deepEqual({ root, child }, before);
  } finally {
    await c.close();
  }
});
