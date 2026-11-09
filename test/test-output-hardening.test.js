import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedTestOutputs } from '../src/test-output.js';

function table(gate) {
  const map = new Map();
  const puts = [];
  return {
    map,
    puts,
    entries: () => map.entries(),
    get: (key) => map.get(key),
    async put(key, value) {
      puts.push(structuredClone(value));
      if (gate) await gate;
      map.set(key, structuredClone(value));
    },
    delete: async (key) => map.delete(key),
  };
}

function registry() {
  const listeners = new Set(),
    chunks = [];
  const view = {
    id: 'bash-live',
    owner: 'owner',
    kind: 'bash',
    label: 'pytest',
    status: 'running',
    startedAt: 1,
    output: { total: 0, earliest: 0 },
  };
  return {
    events: {
      subscribe(_filter, listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    get(id, owner) {
      assert.equal(id, view.id);
      assert.equal(owner, view.owner);
      return structuredClone(view);
    },
    read() {
      assert.fail('privacy capture must never consume the model cursor');
    },
    readAt(id, from, owner) {
      assert.equal(id, view.id);
      assert.equal(owner, view.owner);
      return {
        chunks: structuredClone(
          chunks.filter(
            (chunk) => chunk.at + Buffer.byteLength(chunk.text) > from,
          ),
        ),
        next: view.output.total,
        lossy: false,
      };
    },
    append(text, channel = 'stdout') {
      chunks.push({ at: view.output.total, channel, text });
      view.output.total += Buffer.byteLength(text);
      for (const listener of listeners)
        listener({
          type: 'output',
          id: view.id,
          owner: view.owner,
          total: view.output.total,
        });
    },
    settle() {
      view.status = 'completed';
      view.detail = 'exit code: 0';
      view.finishedAt = 2;
      for (const listener of listeners)
        listener({
          type: 'settled',
          job: structuredClone(view),
          cause: 'producer',
          awaited: false,
        });
    },
  };
}
const exec = {
  name: 'bash',
  callId: 'tests',
  rootCallId: 'tests',
  agent: { id: 'owner' },
  arguments: { command: 'pytest' },
};
const background = {
  isError: false,
  value: { kind: 'background', jobId: 'bash-live', cwd: '/project' },
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const channel of ['stdout', 'stderr']) {
  test(`streaming ${channel} credential suffixes never leak across chunks or queued persistence`, async () => {
    const store = table(),
      jobs = registry();
    const capture = new RecordedTestOutputs({ table: store, jobs });
    capture.observe(exec, background);
    const forbidden = [
      'first-private-prefix',
      'second-private-suffix',
      'token-private-prefix',
      'token-private-suffix',
    ];
    const check = () => {
      const exposed = JSON.stringify({
        artifact: capture.get('owner', 'tests'),
        writes: store.puts,
        stored: [...store.map.values()],
      });
      for (const secret of forbidden)
        assert.equal(
          exposed.includes(secret),
          false,
          `must redact ${secret} before every read/write`,
        );
    };
    jobs.append('password=first-private-prefix', channel);
    await flush();
    check();
    jobs.append('second-private-suffix\n', channel);
    await flush();
    check();
    jobs.append('API_KEY=token-private-prefix', channel);
    await flush();
    check();
    jobs.append('token-private-suffix\n', channel);
    await flush();
    check();
    jobs.append('public diagnostic after secret\n', channel);
    jobs.settle();
    await capture.close();
    check();
    assert.match(
      capture.get('owner', 'tests')[channel],
      /public diagnostic after secret/,
    );
  });
}

test('streaming multiline private-key bodies remain redacted even before the end marker arrives', async () => {
  const store = table(),
    jobs = registry();
  const capture = new RecordedTestOutputs({ table: store, jobs });
  capture.observe(exec, background);
  jobs.append('-----BEGIN PRIVATE KEY-----\n');
  jobs.append('private-key-body-first-half');
  await flush();
  assert.equal(
    JSON.stringify(capture.get('owner', 'tests')).includes('private-key-body'),
    false,
    'an unfinished PEM must not expose its body',
  );
  jobs.append(
    'private-key-body-second-half\n-----END PRIVATE KEY-----\npublic result\n',
  );
  jobs.settle();
  await capture.close();
  assert.equal(
    JSON.stringify([...store.map.values()]).includes('private-key-body'),
    false,
  );
  assert.equal(
    JSON.stringify(store.puts).includes('private-key-body'),
    false,
    'no intermediate queued write may contain the PEM body',
  );
  assert.match(capture.get('owner', 'tests').stdout, /public result/);
});

test('chatty jobs coalesce pending durable writes while storage is blocked and persist the latest bounded artifact', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = table(gate),
    jobs = registry();
  const capture = new RecordedTestOutputs({
    table: store,
    jobs,
    maxChars: 128,
    maxRecords: 1,
    maxTotalChars: 128,
  });
  capture.observe(exec, background);
  await flush();
  for (let index = 0; index < 80; index++) jobs.append('x');
  jobs.settle();
  await flush();
  assert.ok(
    store.puts.length <= 1,
    'at most one durable write is in flight while blocked',
  );
  release();
  await capture.close();
  assert.ok(
    store.puts.length <= 3,
    'blocked updates must coalesce to latest state, not drain one retained snapshot per output event',
  );
  const retained = [...store.map.values()];
  assert.equal(retained.length, 1);
  assert.equal(retained[0].stdout, 'x'.repeat(80));
  assert.equal(retained[0].status, 'completed');
  assert.equal(retained[0].complete, true);
});

test('restoring an unresumable running capture marks it interrupted/incomplete instead of running forever', async () => {
  const store = table(),
    jobs = registry();
  const original = new RecordedTestOutputs({ table: store, jobs });
  original.observe(exec, background);
  jobs.append('last captured diagnostic\n');
  await original.close();
  const restored = new RecordedTestOutputs({ table: store });
  const artifact = restored.get('owner', 'tests');
  assert.ok(
    artifact,
    'interrupted output remains inspectable after restoration',
  );
  assert.equal(
    ['running', 'stopping'].includes(artifact.status),
    false,
    'no live producer is attached after restoration',
  );
  assert.equal(artifact.complete, false);
  assert.equal(artifact.exitCode, null);
  assert.match(
    JSON.stringify(artifact),
    /interrupted|unavailable|unknown|not.{0,20}(?:resume|reconnect)/i,
    'artifact must explain the missing terminal observation',
  );
  assert.match(artifact.stdout, /last captured diagnostic/);
  await restored.close();
});
