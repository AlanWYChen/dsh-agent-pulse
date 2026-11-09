import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeContextService } from '../src/change-context.js';
import { initState, reduceEvent } from '../src/engine.js';

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

// Keep the outcome card and its opaque file reference fixed while the session
// acquires the native workspace comparison after an earlier context read.
function delayedWorkspaceFixture(options = {}, workspaceTurn = 1) {
  const f = fixture(options);
  const events = f.session.snapshotEvents(0, 4);
  f.session.seq = events.length;
  f.session.eventAt = (seq) => events[seq];
  f.session.snapshotEvents = (from, to) => events.slice(from, to);
  f.card = events
    .reduce(reduceEvent, initState({ id: 'root', cwd: '/project' }))
    .cards.find((card) => card.category === 'outcome');
  f.appendWorkspace = () => {
    events.push({
      type: 'workspace/changes',
      data: { turn: workspaceTurn },
      seq: events.length,
      time: events.length + 1,
    });
    f.session.seq = events.length;
  };
  return f;
}

for (const firstRead of ['prepare', 'diff']) {
  test(`late workspace comparison resolves the original opaque file after ${firstRead}`, async () => {
    const f = delayedWorkspaceFixture({ files: ['src/b.js', 'src/a.js'] });
    const cardBefore = structuredClone(f.card);
    const file = f.service.describe(f.session, f.card)[0];
    let preparedBefore;
    if (firstRead === 'prepare') {
      preparedBefore = await f.service.prepare(f.session, f.card);
      assert.equal(preparedBefore.files[0].id, file.id);
    } else {
      const before = await f.service.diff(f.session, f.card, file.id);
      assert.equal(before.nativeReview, null);
      assert.equal(before.status, 'available');
    }

    f.appendWorkspace();
    assert.equal(f.session.seq, 5);
    assert.deepEqual(f.card, cardBefore, 'no refreshed card is required');
    assert.equal(f.service.describe(f.session, f.card)[0].id, file.id);
    if (preparedBefore) {
      const preparedAfter = await f.service.prepare(f.session, f.card);
      assert.equal(preparedAfter.fingerprint, preparedBefore.fingerprint);
      assert.deepEqual(preparedAfter.input, preparedBefore.input);
    }
    const after = await f.service.diff(f.session, f.card, file.id);
    assert.deepEqual(after.nativeReview, {
      sessionId: 'root',
      seq: 4,
      turn: 1,
      index: 1,
    });
    assert.equal(after.editorPath, '/project/src/a.js');
    assert.equal(after.status, 'available');
    assert.equal(
      f.calls.length,
      0,
      'navigation does not fetch native diff content',
    );
  });

  test(`late workspace comparison still rejects wrong turn or path after ${firstRead}`, async () => {
    for (const { options, workspaceTurn } of [
      { options: { summaryTurn: 2 }, workspaceTurn: 2 },
      { options: { summaryTurn: 2 }, workspaceTurn: 1 },
      { options: { files: ['other/a.js'] }, workspaceTurn: 1 },
    ]) {
      const f = delayedWorkspaceFixture(options, workspaceTurn);
      const file = f.service.describe(f.session, f.card)[0];
      if (firstRead === 'prepare') await f.service.prepare(f.session, f.card);
      else
        assert.equal(
          (await f.service.diff(f.session, f.card, file.id)).nativeReview,
          null,
        );
      f.appendWorkspace();
      const after = await f.service.diff(f.session, f.card, file.id);
      assert.equal(after.nativeReview, null);
      assert.equal(after.editorPath, '/project/src/a.js');
      assert.equal(f.calls.length, 0);
    }
  });
}

for (const laterHistory of [
  'rolled snapshot window',
  'transient snapshot failure',
]) {
  test(`discovered late Review survives ${laterHistory}`, async () => {
    const f = delayedWorkspaceFixture({ files: ['src/b.js', 'src/a.js'] });
    const cardBefore = structuredClone(f.card);
    const file = f.service.describe(f.session, f.card)[0];
    const preparedBefore = await f.service.prepare(f.session, f.card);
    assert.equal(
      (await f.service.diff(f.session, f.card, file.id)).nativeReview,
      null,
    );

    f.appendWorkspace();
    const expectedReview = { sessionId: 'root', seq: 4, turn: 1, index: 1 };
    assert.deepEqual(
      (await f.service.diff(f.session, f.card, file.id)).nativeReview,
      expectedReview,
      'the late comparison is discovered before subsequent history changes',
    );

    const events = f.session.snapshotEvents(0, f.session.seq);
    const count = laterHistory === 'rolled snapshot window' ? 1501 : 1;
    for (let i = 0; i < count; i++) {
      events.push({
        type: 'turn/start',
        data: { turn: i + 2 },
        seq: events.length,
        time: events.length + 1,
      });
    }
    f.session.seq = events.length;
    f.session.eventAt = (seq) => events[seq];
    f.session.snapshotEvents = (from, to) => {
      if (laterHistory === 'transient snapshot failure') {
        throw new Error('Session history temporarily unavailable');
      }
      return events.slice(from, to);
    };

    const after = await f.service.diff(f.session, f.card, file.id);
    assert.deepEqual(
      after.nativeReview,
      expectedReview,
      'a previously discovered comparison remains navigable',
    );
    assert.equal(after.editorPath, '/project/src/a.js');
    assert.equal(after.status, 'available');
    assert.deepEqual(f.card, cardBefore);
    assert.equal(f.service.describe(f.session, f.card)[0].id, file.id);
    const preparedAfter = await f.service.prepare(f.session, f.card);
    assert.equal(preparedAfter.fingerprint, preparedBefore.fingerprint);
    assert.deepEqual(preparedAfter.input, preparedBefore.input);
    assert.equal(f.calls.length, 0);
  });
}

test('child session without workspace events exposes actual recorded edits for historical navigation', async () => {
  const f = delayedWorkspaceFixture();
  f.session.id = 'child /session';
  const childEvents = f.session.snapshotEvents(0, f.session.seq);
  assert.ok(childEvents.every((event) => event.type !== 'workspace/changes'));
  let summaryCalls = 0;
  f.service.workspaceChanges = {
    summary: () => {
      summaryCalls++;
      return undefined;
    },
    diff: () =>
      assert.fail('a child without native history must not fetch native diffs'),
  };
  const file = f.service.describe(f.session, f.card)[0];
  const prepared = await f.service.prepare(f.session, f.card);
  const value = await f.service.diff(f.session, f.card, file.id);
  assert.equal(value.nativeReview, null);
  assert.equal(value.status, 'available');
  assert.equal(value.file, 'src/a.js');
  assert.equal(value.editorPath, '/project/src/a.js');
  assert.ok(
    value.lines.some(
      (line) => line.kind === 'remove' && line.text.includes('const a = 1;'),
    ),
  );
  assert.ok(
    value.lines.some(
      (line) => line.kind === 'add' && line.text.includes('const a = 2;'),
    ),
  );
  assert.equal(prepared.files[0].id, file.id);
  assert.equal(summaryCalls, 0);
  assert.equal(f.session.seq, 4, 'no workspace event is expected to arrive');
});
