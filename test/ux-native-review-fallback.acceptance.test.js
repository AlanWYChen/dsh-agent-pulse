import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeContextService } from '../src/change-context.js';
import { initState, reduceEvent } from '../src/engine.js';

function fixture() {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'edit-a',
        name: 'edit',
        arguments: JSON.stringify({
          file_path: '/project/src/a.js',
          old_string: 'a',
          new_string: 'b',
        }),
      },
    },
    {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          toolCallId: 'edit-a',
          content: [{ type: 'text', text: 'Updated' }],
        },
      },
    },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'workspace/changes', data: { turn: 1 } },
  ].map((event, seq) => ({ ...event, seq, time: seq + 1 }));
  const session = {
    id: 'root',
    header: { cwd: '/project' },
    seq: events.length,
    eventAt: (seq) => events[seq],
    snapshotEvents: (from, to) => events.slice(from, to),
  };
  let state = initState({ id: 'root', cwd: '/project' });
  for (const event of events) state = reduceEvent(state, event);
  const card = state.cards.find((item) => item.category === 'outcome');
  return { session, card };
}

test('a native Review resolved from a recorded turn remains available after the live service is disposed', async () => {
  const { session, card } = fixture();
  const service = new ChangeContextService({
    workspaceChanges: {
      summary: () => ({
        seq: 4,
        turn: 1,
        total: 1,
        files: [{ path: '/project/src/a.js' }],
      }),
      diff: async () => ({
        kind: 'text',
        path: '/project/src/a.js',
        hunks: [],
      }),
    },
  });
  card._workspaceRef = { seq: 4, turn: 1 };
  const file = service.describe(session, card)[0];
  assert.ok(file, 'recorded workspace file must have a descriptor');
  service.workspaceChanges = undefined;
  const value = await service.diff(session, card, file.id);
  assert.deepEqual(value.nativeReview, {
    sessionId: 'root',
    seq: 4,
    turn: 1,
    index: 0,
  });
});
