import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedFiles } from './recorded-files.js';

function table() {
  const map = new Map();

  return {
    get: (k) => map.get(k),
    entries: () => map.entries(),

    put: async (k, v) => {
      assert.match(k, /^[A-Za-z0-9_-]+$/);

      map.set(k, structuredClone(v));
    },

    delete: async (k) => map.delete(k),
    map,
  };
}

const execution = (callId = 'edit-1', name = 'edit') => ({
  agent: { id: 'session-1' },
  callId,
  name,
});

const result = (
  path = '/project/file.js',
  before = 'const previous = 1;\n',
  after = 'const current = 2;\n',
) => ({ isError: false, value: { path, before, after } });

test('records complete canonical before/after without reading current filesystem; survives reload', async () => {
  const store = table(),
    files = new RecordedFiles({ table: store, cwdOf: () => '/project' });

  files.observe(execution(), result());

  const item = files.get('session-1', 'edit-1');

  assert.equal(item.coverage, 'recorded-full');
  assert.equal(item.path, 'file.js');
  assert.equal(item.before, 'const previous = 1;\n');
  assert.equal(item.after, 'const current = 2;\n');

  await files.close();

  const restored = new RecordedFiles({ table: store });

  assert.deepEqual(restored.get('session-1', 'edit-1'), item);

  await restored.close();
});

test('only successful edit/write canonical full file results are captured', async () => {
  const files = new RecordedFiles({ table: table() });

  files.observe(execution('failed'), { ...result(), isError: true });
  files.observe(execution('read', 'read'), result());
  files.observe(execution('missing-before'), {
    isError: false,
    value: { path: 'file.js', after: 'not enough' },
  });
  files.observe({ ...execution('no-agent'), agent: undefined }, result());

  for (const id of ['failed', 'read', 'missing-before', 'no-agent'])
    assert.equal(files.get('session-1', id), undefined);

  files.observe(
    execution('create', 'write'),
    result('new.js', null, 'export const newFile = true;'),
  );

  assert.equal(files.get('session-1', 'create').before, null);

  await files.close();
});

test('sensitive paths excluded and source secrets redacted before memory or persistence', async () => {
  const store = table(),
    files = new RecordedFiles({ table: store });

  files.observe(
    execution('env'),
    result('/project/.env', null, 'API_KEY=do-not-store'),
  );
  files.observe(
    execution('secret'),
    result(
      '/project/config.js',
      'const api_key = "before-private-value";',
      'const password = "after-private-value";',
    ),
  );

  assert.equal(files.get('session-1', 'env'), undefined);
  assert.equal(
    JSON.stringify(files.get('session-1', 'secret')).includes('private-value'),
    false,
  );

  await files.close();

  assert.equal(
    JSON.stringify([...store.map.values()]).includes('private-value'),
    false,
  );
});

test('bounded whole files are never silently truncated; eviction and duplicate observations safe', async () => {
  const store = table(),
    files = new RecordedFiles({
      table: store,
      maxChars: 30,
      maxLines: 3,
      maxRecords: 1,
      maxTotalChars: 60,
    });

  files.observe(execution('big'), result('big.js', null, 'x'.repeat(31)));
  files.observe(execution('lines'), result('big.js', null, 'a\nb\nc\nd'));

  assert.equal(files.get('session-1', 'big'), undefined);
  assert.equal(files.get('session-1', 'lines'), undefined);

  files.observe(execution('a'), result('a.js', 'old', 'new'));
  files.observe(execution('a'), result('a.js', 'unexpected', 'overwrite'));

  assert.equal(files.get('session-1', 'a').after, 'new');

  files.observe(execution('b'), result('b.js', 'old', 'next'));

  await files.close();

  assert.equal(files.get('session-1', 'a'), undefined);
  assert.equal(store.map.size, 1);
});

test('a stricter policy on reload hides previously allowed capture', async () => {
  const store = table(),
    files = new RecordedFiles({ table: store });

  files.observe(execution(), result());

  await files.close();

  const strict = new RecordedFiles({
    table: store,
    config: { sensitivePatterns: ['file\\.js$'] },
  });

  assert.equal(strict.get('session-1', 'edit-1'), undefined);

  await strict.close();
});
