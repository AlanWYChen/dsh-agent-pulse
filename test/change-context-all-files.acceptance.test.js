import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeContextService } from '../src/change-context.js';

// All evidence is historical tool events or the recorded native diff provider.
// Deliberately nonexistent cwd: current workspace files are not evidence.
function fixture(id = 'all-files-source') {
  const events = [{ type: 'turn/start', seq: 0, data: { turn: 1 } }];
  const card = { id: 'outcome:many', _turn: 1, _changes: [], evidence: [] };
  const session = {
    id,
    header: { cwd: '/historical-only/not-current-workspace' },
    get seq() {
      return events.length;
    },
    eventAt(seq) {
      return events[seq];
    },
    snapshotEvents(from, to) {
      return events.slice(from, to);
    },
  };
  for (let index = 0; index < 24; index++) {
    const name = index % 2 ? 'write' : 'edit';
    const args = {
      file_path: `src/change-${index}.js`,
      ...(name === 'write'
        ? {
            content: `export const recorded${index} = "historical ${index}";\n`,
          }
        : {
            old_string: `old value ${index}`,
            new_string: `new value ${index}`,
          }),
    };
    const callSeq = events.length;
    const callId = `operation-${index}`;
    events.push({
      type: 'tool/call',
      seq: callSeq,
      data: { turn: 1, callId, name, arguments: JSON.stringify(args) },
    });
    const resultSeq = events.length;
    events.push({
      type: 'tool/result',
      seq: resultSeq,
      data: {
        turn: 1,
        message: {
          toolCallId: callId,
          content: [{ type: 'text', text: 'Success' }],
        },
      },
    });
    card._changes.push({ callSeq, resultSeq });
    card.evidence.push({ seq: resultSeq });
  }
  return { session, card };
}

function later(files, index) {
  const file = files.find(
    (file) =>
      file.label === `src/change-${index}.js` ||
      file.label === `change-${index}.js`,
  );
  assert.ok(
    file,
    `observed file ${index} beyond the summary cap must have a clickable descriptor`,
  );
  assert.match(file.id, /^[a-f0-9]{32}$/);
  return file;
}

test('all 24 successful direct changes have stable opaque clickable descriptors', () => {
  const { session, card } = fixture();
  const service = new ChangeContextService();
  const files = service.describe(session, card);
  assert.equal(
    files.length,
    24,
    'navigation must not inherit the 12-file model cap',
  );
  assert.equal(new Set(files.map((file) => file.id)).size, 24);
  for (let index = 0; index < 24; index++) later(files, index);
  assert.deepEqual(service.describe(session, card), files);
});

test('late created and edited files resolve real recorded diffs, not cosmetic links', async () => {
  const { session, card } = fixture();
  // User-approved fixture correction: creation attribution requires a recorded
  // absent before-state, not merely a successful write with unknown history.
  const service = new ChangeContextService({
    recordedFiles: {
      get(owner, callId) {
        assert.equal(
          owner,
          session.id,
          'recorded captures must remain source-session scoped',
        );
        if (callId !== 'operation-23') return undefined;
        return {
          path: `${session.header.cwd}/src/change-23.js`,
          before: null,
          after: 'export const recorded23 = "historical 23";\n',
        };
      },
    },
  });
  const files = service.describe(session, card);
  for (const index of [22, 23]) {
    const file = later(files, index);
    const diff = await service.diff(session, card, file.id);
    assert.equal(diff.status, 'available');
    const additions = diff.lines
      .filter((line) => line.kind === 'add')
      .map((line) => line.text)
      .join('\n');
    assert.ok(
      additions.includes(
        index === 23
          ? 'export const recorded23 = "historical 23";'
          : 'new value 22',
      ),
    );
    if (index === 22)
      assert.ok(
        diff.lines.some(
          (line) =>
            line.kind === 'remove' && line.text.includes('old value 22'),
        ),
      );
  }
});

test('full navigation keeps summary input bounded and rejects foreign/unknown references', async () => {
  const { session, card } = fixture();
  const service = new ChangeContextService();
  const files = service.describe(session, card);
  const prepared = await service.prepare(session, card);
  assert.ok(prepared.input.changes.length > 0);
  assert.ok(
    prepared.input.changes.length <= 12,
    'summary model still receives at most 12 changes',
  );
  assert.ok(JSON.stringify(prepared.input).length <= 20000);
  for (const invalid of [
    'unknown-id',
    'src/change-23.js',
    '../private',
    files[0].id,
  ]) {
    const target =
      invalid === files[0].id ? fixture('different-source').session : session;
    const diff = await service.diff(target, card, invalid);
    assert.equal(diff.status, 'unavailable');
    assert.deepEqual(diff.lines, []);
  }
  // prepare.files may remain a bounded summary subset; describe owns navigation.
  assert.deepEqual(service.describe(session, card), files);
});

test('native historical workspace file beyond index 12 resolves its recorded coordinates', async () => {
  const { session } = fixture('native-many-source');
  const card = {
    id: 'native:many',
    _turn: 1,
    _changes: [],
    evidence: [],
    _workspaceRef: { seq: 0, turn: 1 },
  };
  const files = Array.from({ length: 24 }, (_, index) => ({
    path: `native/file-${index}.js`,
    added: 1,
    deleted: 1,
  }));
  const requests = [];
  const service = new ChangeContextService({
    workspaceChanges: {
      summary(id, seq) {
        assert.equal(id, session.id);
        assert.equal(seq, 0);
        return { turn: 1, total: files.length, files };
      },
      async diff(id, seq, index) {
        assert.equal(id, session.id);
        assert.equal(seq, 0);
        requests.push(index);
        return {
          kind: 'text',
          path: files[index].path,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [
                `-historical before ${index}`,
                `+historical after ${index}`,
              ],
            },
          ],
        };
      },
    },
  });
  const descriptions = service.describe(session, card);
  assert.equal(requests.length, 0, 'describing files must not fetch content');
  assert.equal(descriptions.length, 24);
  const file = descriptions.find((file) => file.label.endsWith('file-23.js'));
  assert.match(file.id, /^[a-f0-9]{32}$/);
  const prepared = await service.prepare(session, card);
  assert.ok(prepared.input.changes.length <= 12);
  assert.ok(JSON.stringify(prepared.input).length <= 20000);
  const diff = await service.diff(session, card, file.id);
  assert.equal(diff.status, 'available');
  assert.ok(
    diff.lines.some(
      (line) =>
        line.kind === 'add' && line.text.includes('historical after 23'),
    ),
  );
  assert.ok(
    requests.includes(23),
    'native history lookup must use the late file index',
  );
});
