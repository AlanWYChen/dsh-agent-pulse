import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

// Synthetic public engine records isolate aggregation from command parsing.
const run = (sessionId, id, callSeq = 1) => ({
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
function state(id, parent, time, runs = []) {
  const s = initState({
    id,
    agentId: id,
    ...(parent ? { origin: 'subagent', parentSession: parent } : {}),
  });
  s.cards = [
    {
      id: 'outcome:1',
      category: 'outcome',
      title: id,
      summary: id,
      status: 'observed',
      time,
      agentId: id,
      evidence: [],
      files: ['module.js'],
      verification: {
        status: 'not-run',
        label: 'No supported test result observed',
      },
      _turn: 1,
      _finalized: false,
      testRuns: runs,
    },
  ];
  return s;
}
const update = (c, s) => c.update({ id: s.sessionId }, s);
const rootCard = (snapshot, id = 'root') =>
  snapshot.sessions
    .find((s) => s.sessionId === id)
    .cards.find((c) => c.id === 'outcome:1');
const keys = (card) =>
  (card.testRuns || []).map((r) => `${r.sessionId}:${r.id}`);

test('snapshot aggregates descendants recursively with source identities and cross-session ordering', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  try {
    update(c, state('root', null, 100, [run('root', 'same')]));
    update(c, state('child', 'root', 200, [run('child', 'same')]));
    update(c, state('grandchild', 'child', 300, [run('grandchild', 'same')]));
    update(c, state('unrelated', null, 999, [run('unrelated', 'same')]));
    const snapshot = c.snapshot('root');
    assert.deepEqual(keys(rootCard(snapshot)), [
      'grandchild:same',
      'child:same',
      'root:same',
    ]);
    assert.deepEqual(keys(rootCard(snapshot, 'child')), [
      'grandchild:same',
      'child:same',
    ]);
    assert.deepEqual(keys(rootCard(snapshot, 'grandchild')), [
      'grandchild:same',
    ]);
    assert.equal(
      snapshot.sessions.some((s) => s.sessionId === 'unrelated'),
      false,
    );
    // Descendant tests are evidence, not proof that root changes were verified.
    assert.equal(rootCard(snapshot).verification.status, 'not-run');
  } finally {
    await c.close();
  }
});

test('aggregation is idempotent, deduplicates session+call identity, and does not mutate engine state', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  const root = state('root', null, 100, [run('root', 'local')]);
  const child = state('child', 'root', 200, [
    run('child', 'repeat', 4),
    run('child', 'repeat', 4),
  ]);
  const before = structuredClone({ root, child });
  try {
    update(c, root);
    update(c, child);
    const first = c.snapshot('root');
    assert.deepEqual(keys(rootCard(first)), ['child:repeat', 'root:local']);
    update(c, structuredClone(child));
    assert.deepEqual(keys(rootCard(c.snapshot('root'))), [
      'child:repeat',
      'root:local',
    ]);
    assert.deepEqual({ root, child }, before);
    first.sessions[0].cards[0].testRuns[0].counts.passed = 999;
    assert.equal(rootCard(c.snapshot('root')).testRuns[0].counts.passed, 1);
  } finally {
    await c.close();
  }
});

test('only latest parent outcome receives subtree rollup; history remains attached to its own card', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  const root = state('root', null, 100, [run('root', 'older')]);
  root.cards.push({
    ...structuredClone(root.cards[0]),
    id: 'outcome:2',
    time: 250,
    _turn: 2,
    testRuns: [run('root', 'newer', 9)],
  });
  try {
    update(c, root);
    update(c, state('child', 'root', 300, [run('child', 'remote')]));
    const cards = c
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root').cards;
    assert.deepEqual(keys(cards.find((x) => x.id === 'outcome:1')), [
      'root:older',
    ]);
    assert.deepEqual(keys(cards.find((x) => x.id === 'outcome:2')), [
      'child:remote',
      'root:newer',
    ]);
  } finally {
    await c.close();
  }
});
