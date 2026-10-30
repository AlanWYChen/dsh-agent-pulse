import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeContextService } from './change-context.js';
import { initState, reduceEvent } from './engine.js';

function fixture({
  files = ['src/a.js', 'src/b.js'],
  summaryTurn = 1,
  wrongDiffPath = false,
  secret = false,
} = {}) {
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
          old_string: 'const a = 1;',
          new_string: 'const a = 2;',
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
          content: [{ type: 'text', text: 'Updated file' }],
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
  const card = events
    .reduce(reduceEvent, initState({ id: 'root', cwd: '/project' }))
    .cards.find((card) => card.category === 'outcome');
  const calls = [];
  const service = new ChangeContextService({
    workspaceChanges: {
      summary: () => ({
        seq: 4,
        turn: summaryTurn,
        total: files.length,
        files: files.map((path) => ({ path })),
      }),
      diff: async (id, seq, index) => {
        calls.push({ id, seq, index });
        return {
          kind: 'text',
          path: wrongDiffPath ? 'wrong.js' : files[index],
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [
                '-const a = 1;',
                secret && index === 1
                  ? '+const api_key = "secret-visible-only-in-other-file";'
                  : '+const a = 2;',
              ],
            },
          ],
        };
      },
    },
  });
  return { service, session, card, calls };
}

async function load(f) {
  const file = f.service.describe(f.session, f.card)[0];
  return f.service.diff(f.session, f.card, file.id);
}

test('matching recorded workspace comparison routes to exact native Review file index', async () => {
  const f = fixture({ files: ['src/b.js', 'src/a.js'] });
  const value = await load(f);
  assert.deepEqual(value.nativeReview, {
    sessionId: 'root',
    seq: 4,
    turn: 1,
    index: 1,
  });
  assert.equal(value.editorPath, '/project/src/a.js');
  assert.equal(value.status, 'available');
  assert.equal(
    f.calls.length,
    0,
    'native navigation uses recorded coordinates, not content filtering',
  );
  await load(f);
  assert.equal(
    f.calls.length,
    0,
    'navigation never reads unrelated picker files',
  );
  const prepared = await f.service.prepare(f.session, f.card);
  assert.ok(!JSON.stringify(prepared.input).includes('editorPath'));
  assert.ok(!JSON.stringify(prepared.input).includes('nativeReview'));
  assert.ok(!JSON.stringify(prepared.input).includes('/project'));
});

test('native Review requires matching turn and exact canonical path, not basename', async () => {
  for (const options of [{ summaryTurn: 2 }, { files: ['other/a.js'] }]) {
    const f = fixture(options);
    assert.equal((await load(f)).nativeReview, null);
  }
});

test('explicit native Review navigation keeps native viewer semantics instead of substituting a plugin diff', async () => {
  for (const options of [{ files: ['src/a.js', '.env'] }, { secret: true }]) {
    const f = fixture(options);
    const value = await load(f);
    assert.deepEqual(value.nativeReview, {
      sessionId: 'root',
      seq: 4,
      turn: 1,
      index: 0,
    });
    assert.equal(value.status, 'available');
    assert.equal(
      f.calls.length,
      0,
      'the native viewer owns its file picker, not plugin-wide preview rules',
    );
    assert.ok(
      !JSON.stringify(value).includes('secret-visible-only-in-other-file'),
    );
  }
});

test('unknown opaque references cannot resolve editor paths or native navigation', async () => {
  const f = fixture();
  const value = await f.service.diff(f.session, f.card, '/project/src/a.js');
  assert.equal(value.status, 'unavailable');
  assert.ok(!value.editorPath);
  assert.ok(!value.nativeReview);
  assert.equal(f.calls.length, 0);
});

test('missing native service/history preserves recorded fallback and safe absolute path', async () => {
  const f = fixture();
  f.service.workspaceChanges = undefined;
  const value = await load(f);
  assert.equal(value.nativeReview, null);
  assert.equal(value.editorPath, '/project/src/a.js');
  assert.equal(value.status, 'available');
});
