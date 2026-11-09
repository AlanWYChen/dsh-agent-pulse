import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

function state(finalized) {
  const s = initState({ id: 'root' });
  return {
    ...s,
    cards: [
      {
        id: 'outcome:1',
        category: 'outcome',
        title: 'Work',
        summary: 'Work',
        status: 'observed',
        time: 1,
        agentId: 'root',
        evidence: [],
        files: [],
        verification: { status: 'not-run', label: 'No test run observed' },
        _turn: 1,
        _finalized: finalized,
        testRuns: [],
      },
    ],
  };
}

test('public cards mark changes ready only after the turn is finalized', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  try {
    c.update({ id: 'root' }, state(false));
    const running = c.snapshot('root').sessions[0].cards[0];
    assert.equal(running.changesReady, false);
    c.update({ id: 'root' }, state(true));
    const stopped = c.snapshot('root').sessions[0].cards[0];
    assert.equal(stopped.changesReady, true);
  } finally {
    await c.close();
  }
});
