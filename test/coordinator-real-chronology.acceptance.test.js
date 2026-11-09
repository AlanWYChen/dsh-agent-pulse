import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent } from '../src/engine.js';
import { ActivityCoordinator } from '../src/coordinator.js';

// Actual engine events, not synthetic card timestamps or injected startedAt fields.
function projection(id, parentSession) {
  let state = initState({
    id,
    ...(parentSession ? { origin: 'subagent', parentSession } : {}),
  });
  let seq = 0;
  const event = (type, time, data) => {
    state = reduceEvent(state, { type, seq: seq++, time, data });
  };
  return {
    run(callId, startedAt, finishedAt) {
      event('tool/call', startedAt, {
        turn: 1,
        callId,
        name: 'bash',
        arguments: JSON.stringify({ command: 'node --test' }),
      });
      event('tool/result', finishedAt, {
        turn: 1,
        message: {
          toolCallId: callId,
          content: [
            {
              type: 'text',
              text: '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n[exit code: 0]',
            },
          ],
        },
      });
    },
    get state() {
      return state;
    },
  };
}

test('real per-run start times survive projection and order descendant history across interleaved sessions', async () => {
  const root = projection('root');
  const child = projection('child', 'root');
  root.run('root-earliest', 100, 150);
  child.run('child-middle', 200, 250);
  root.run('root-latest', 300, 350);
  const coordinator = new ActivityCoordinator({ enabled: false });
  try {
    coordinator.update({ id: 'root' }, root.state);
    coordinator.update({ id: 'child' }, child.state);
    const snapshot = coordinator.snapshot('root');
    const latest = snapshot.sessions
      .find((s) => s.sessionId === 'root')
      .cards.filter((c) => c.category === 'outcome')
      .sort((a, b) => b.time - a.time)[0];
    assert.deepEqual(
      latest.testRuns.map((r) => `${r.sessionId}:${r.id}`),
      ['root:root-latest', 'child:child-middle', 'root:root-earliest'],
    );
    assert.deepEqual(
      latest.testRuns.map((r) => r.startedAt),
      [300, 200, 100],
      'snapshot start metadata must reflect original tool/call event.time, not mutable card time or completion time',
    );
    // Updating an unchanged descendant may not alter chronology or duplicate runs.
    coordinator.update({ id: 'child' }, structuredClone(child.state));
    const again = coordinator
      .snapshot('root')
      .sessions.find((s) => s.sessionId === 'root')
      .cards.find((c) => c.id === latest.id);
    assert.deepEqual(again.testRuns, latest.testRuns);
  } finally {
    await coordinator.close();
  }
});
