import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedTestOutputs } from '../src/test-output.js';

test('an output update at durable-write completion is not stranded and close flushes latest terminal evidence', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const rows = new Map(),
    writes = [],
    listeners = new Set(),
    chunks = [];
  const job = {
    id: 'bash-race',
    owner: 'owner',
    kind: 'bash',
    label: 'pytest',
    status: 'running',
    startedAt: 1,
    output: { total: 0, earliest: 0 },
  };
  const jobs = {
    events: {
      subscribe(_filter, listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    get: () => structuredClone(job),
    read() {
      assert.fail('artifact capture cannot consume model cursor');
    },
    readAt(_id, from, owner) {
      assert.equal(owner, 'owner');
      return {
        chunks: structuredClone(
          chunks.filter(
            (chunk) => chunk.at + Buffer.byteLength(chunk.text) > from,
          ),
        ),
        next: job.output.total,
        lossy: false,
      };
    },
  };
  const table = {
    entries: () => rows.entries(),
    get: (key) => rows.get(key),
    put(key, value) {
      writes.push(structuredClone(value));
      rows.set(key, structuredClone(value));
      // Expose the storage completion promise itself: consumers must handle
      // producer notifications sharing this promise's microtask checkpoint.
      return writes.length === 1 ? gate : Promise.resolve();
    },
    delete: async (key) => rows.delete(key),
  };
  const capture = new RecordedTestOutputs({ table, jobs });
  capture.observe(
    {
      name: 'bash',
      callId: 'test-race',
      rootCallId: 'test-race',
      agent: { id: 'owner' },
      arguments: { command: 'pytest' },
    },
    {
      isError: false,
      value: { kind: 'background', jobId: job.id, cwd: '/project' },
    },
  );
  await Promise.resolve();
  assert.equal(
    writes.length,
    1,
    'initial write must be waiting on controlled durable completion',
  );
  gate.then(() => {
    const text = 'latest terminal output\n';
    chunks.push({ at: 0, text, channel: 'stdout' });
    job.output.total = Buffer.byteLength(text);
    for (const listener of listeners)
      listener({
        type: 'output',
        id: job.id,
        owner: job.owner,
        total: job.output.total,
      });
    job.status = 'completed';
    job.detail = 'exit code: 0';
    job.finishedAt = 2;
    for (const listener of listeners)
      listener({
        type: 'settled',
        job: structuredClone(job),
        cause: 'producer',
        awaited: false,
      });
  });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    capture.get('owner', 'test-race').stdout,
    'latest terminal output\n',
    'live capture received final evidence',
  );
  await capture.close();
  const persisted = [...rows.values()];
  assert.equal(persisted.length, 1);
  assert.equal(
    persisted[0].stdout,
    'latest terminal output\n',
    'close must flush updates queued at the drain-loop completion boundary',
  );
  assert.equal(persisted[0].status, 'completed');
  assert.equal(persisted[0].exitCode, 0);
  assert.equal(persisted[0].complete, true);
  assert.ok(
    writes.length <= 3,
    'race recovery retains coalesced bounded persistence',
  );
});
