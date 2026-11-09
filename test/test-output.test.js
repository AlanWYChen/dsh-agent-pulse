import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedTestOutputs } from '../src/test-output.js';

function table() {
  const map = new Map();
  return {
    map,
    get: (key) => map.get(key),
    entries: () => map.entries(),
    put: async (key, value) => {
      assert.match(key, /^[A-Za-z0-9_-]+$/);
      map.set(key, structuredClone(value));
    },
    delete: async (key) => map.delete(key),
  };
}

const execution = (
  callId = 'test-1',
  command = 'node --test',
  owner = 'session-1',
) => ({
  name: 'bash',
  callId,
  rootCallId: callId,
  agent: { id: owner },
  arguments: { command },
});
const foreground = (
  stdout = 'unrecognized runner report\n',
  stderr = '',
  extra = {},
) => ({
  isError: false,
  value: {
    kind: 'foreground',
    cwd: '/project',
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
    ...extra,
  },
  content: [
    { type: 'text', text: 'model-facing rendering is not canonical output' },
  ],
});

function jobs() {
  const listeners = new Set();
  const records = new Map();
  const reads = [];
  let disposed = 0;
  return {
    reads,
    records,
    get disposed() {
      return disposed;
    },
    events: {
      subscribe(filter, listener) {
        assert.deepEqual(filter, { owners: 'scope' });
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          disposed++;
        };
      },
    },
    list: (owner) =>
      [...records.values()]
        .filter((item) => item.view.owner === owner)
        .map((item) => item.view),
    get(id, owner) {
      const item = records.get(id);
      assert.equal(item.view.owner, owner);
      return structuredClone(item.view);
    },
    read() {
      assert.fail(
        'artifact observers must not consume the model output cursor',
      );
    },
    readAt(id, from, owner) {
      const item = records.get(id);
      assert.equal(item.view.owner, owner);
      reads.push({ id, from, owner });
      return {
        chunks: structuredClone(
          item.chunks.filter(
            (chunk) => chunk.at + Buffer.byteLength(chunk.text) > from,
          ),
        ),
        next: item.view.output.total,
        lossy: from < item.view.output.earliest,
      };
    },
    seed(id = 'bash-job', owner = 'session-1') {
      records.set(id, {
        chunks: [],
        view: {
          id,
          owner,
          kind: 'bash',
          label: 'node --test',
          status: 'running',
          startedAt: 1,
          output: { total: 0, earliest: 0 },
        },
      });
    },
    append(id, text, channel = 'stdout') {
      const item = records.get(id);
      item.chunks.push({ at: item.view.output.total, text, channel });
      item.view.output.total += Buffer.byteLength(text);
      this.emit({
        type: 'output',
        id,
        owner: item.view.owner,
        total: item.view.output.total,
      });
    },
    settle(id, detail = 'exit code: 0', status = 'completed') {
      const item = records.get(id);
      item.view = { ...item.view, detail, status, finishedAt: 2 };
      this.emit({
        type: 'settled',
        job: structuredClone(item.view),
        cause: 'producer',
        awaited: false,
      });
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

// Capture is evidence retention, not a promise that every runner summary parses.
test('captures canonical foreground stdout/stderr as an owner-scoped immutable .out artifact and restores it', async () => {
  const store = table();
  const capture = new RecordedTestOutputs({ table: store });
  capture.observe(
    execution(),
    foreground('runner says something novel\n', 'diagnostic\n'),
  );
  const artifact = capture.get('session-1', 'test-1');
  assert.ok(
    artifact,
    'recognized test invocation must create an output artifact',
  );
  assert.equal(artifact.version, 1);
  assert.equal(artifact.sessionId, 'session-1');
  assert.equal(artifact.callId, 'test-1');
  assert.match(artifact.name, /^[A-Za-z0-9._-]+\.out$/);
  assert.equal(artifact.command, 'node --test');
  assert.equal(artifact.stdout, 'runner says something novel\n');
  assert.equal(artifact.stderr, 'diagnostic\n');
  assert.equal(artifact.exitCode, 0);
  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.complete, true);
  assert.equal(artifact.truncated, false);
  assert.equal(capture.get('foreign-owner', 'test-1'), undefined);
  try {
    artifact.stdout = 'tampered';
  } catch {}
  assert.equal(
    capture.get('session-1', 'test-1').stdout,
    'runner says something novel\n',
  );
  await capture.close();
  const restored = new RecordedTestOutputs({ table: store });
  assert.deepEqual(
    restored.get('session-1', 'test-1'),
    capture.get('session-1', 'test-1'),
  );
  await restored.close();
});

test('recognizes direct Node and Python tests but excludes arbitrary commands, echoed tests and failed tool dispatch', async () => {
  const capture = new RecordedTestOutputs({ table: table() });
  for (const [index, command] of [
    'node --test test/a.test.js',
    'python3 -m pytest tests',
    'pytest',
    'npm test',
  ].entries()) {
    capture.observe(execution(`allowed-${index}`, command), foreground());
    assert.ok(capture.get('session-1', `allowed-${index}`), command);
  }
  for (const [index, command] of [
    'echo "node --test"',
    'cat report.out',
    'node arbitrary.js',
    'npm test; cat .env',
    'pytest --watch',
  ].entries()) {
    capture.observe(
      execution(`denied-${index}`, command),
      foreground('private unrelated output'),
    );
    assert.equal(
      capture.get('session-1', `denied-${index}`),
      undefined,
      command,
    );
  }
  capture.observe(execution('failed-tool'), {
    isError: true,
    content: [{ type: 'text', text: 'spawn failed' }],
  });
  capture.observe({ ...execution('not-bash'), name: 'read' }, foreground());
  capture.observe({ ...execution('no-owner'), agent: undefined }, foreground());
  for (const id of ['failed-tool', 'not-bash', 'no-owner'])
    assert.equal(capture.get('session-1', id), undefined);
  await capture.close();
});

test('nonzero test exit keeps output and failure facts; incomplete results never masquerade as complete capture', async () => {
  const capture = new RecordedTestOutputs({ table: table() });
  capture.observe(
    execution('failure'),
    foreground('1 failed\n', 'assertion error\n', { exitCode: 1 }),
  );
  const failure = capture.get('session-1', 'failure');
  assert.ok(
    failure,
    'nonzero process exit is a successful canonical tool result worth retaining',
  );
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.stdout, '1 failed\n');
  assert.equal(failure.complete, true);
  capture.observe(
    execution('truncated'),
    foreground('', '', {
      stdout: {
        text: 'retained tail',
        truncated: true,
        spillPath: '/must-not-open/private-spill',
      },
    }),
  );
  assert.equal(capture.get('session-1', 'truncated').stdout, 'retained tail');
  assert.equal(capture.get('session-1', 'truncated').truncated, true);
  assert.equal(capture.get('session-1', 'truncated').complete, false);
  capture.observe(
    execution('aborted'),
    foreground('partial', '', { aborted: true, exitCode: null }),
  );
  assert.equal(capture.get('session-1', 'aborted').complete, false);
  capture.observe(
    execution('timeout'),
    foreground('partial', '', { timedOut: true, exitCode: null }),
  );
  assert.equal(capture.get('session-1', 'timeout').complete, false);
  await capture.close();
});

test('redacts stdout, stderr and command secrets before returning or persisting any artifact', async () => {
  const store = table();
  const capture = new RecordedTestOutputs({ table: store });
  capture.observe(
    execution('secret', 'pytest --password=command-private-value'),
    foreground(
      'API_KEY=stdout-private-value\nnormal output\n',
      'password=stderr-private-value\n',
    ),
  );
  assert.ok(capture.get('session-1', 'secret'));
  const memory = JSON.stringify(capture.get('session-1', 'secret'));
  assert.equal(memory.includes('private-value'), false);
  assert.match(memory, /normal output/);
  await capture.close();
  assert.equal(
    JSON.stringify([...store.map.values()]).includes('private-value'),
    false,
  );
});

test('captures background chunks without moving model cursor, isolates owners, settles using real exit detail, disposes', async () => {
  const registry = jobs();
  registry.seed();
  registry.append('bash-job', 'before observer\n');
  const store = table();
  let changes = 0;
  const capture = new RecordedTestOutputs({
    table: store,
    jobs: registry,
    onChanged: () => {
      changes++;
    },
  });
  capture.observe(execution(), {
    isError: false,
    value: { kind: 'background', jobId: 'bash-job', cwd: '/project' },
  });
  const initial = capture.get('session-1', 'test-1');
  assert.ok(
    initial,
    'background handle must create an artifact and read existing retained output',
  );
  assert.equal(initial.stdout, 'before observer\n');
  assert.equal(initial.status, 'running');
  assert.equal(initial.complete, false);
  registry.emit({
    type: 'output',
    id: 'bash-job',
    owner: 'foreign-owner',
    total: 999,
  });
  registry.append('bash-job', 'later\n');
  registry.append('bash-job', 'failure detail\n', 'stderr');
  registry.settle('bash-job', 'exit code: 2');
  const final = capture.get('session-1', 'test-1');
  assert.equal(final.stdout, 'before observer\nlater\n');
  assert.equal(final.stderr, 'failure detail\n');
  assert.equal(
    final.exitCode,
    2,
    'generic job completed does not mean tests passed',
  );
  assert.equal(final.status, 'completed');
  assert.equal(final.complete, true);
  assert.equal(final.truncated, false);
  assert.ok(changes > 0, 'capture changes must wake host-derived state');
  assert.ok(registry.reads.length > 0);
  assert.ok(registry.reads.every((read) => read.owner === 'session-1'));
  await capture.close();
  assert.equal(registry.disposed, 1);
  const restored = new RecordedTestOutputs({ table: store });
  assert.deepEqual(restored.get('session-1', 'test-1'), final);
  await restored.close();
});

test('promoted jobs and already-settled lossy rings retain only actual available output and label missing bytes', async () => {
  const registry = jobs();
  registry.seed();
  registry.append('bash-job', 'retained tail\n');
  registry.records.get('bash-job').view.output.earliest = 5;
  registry.settle('bash-job');
  const capture = new RecordedTestOutputs({ table: table(), jobs: registry });
  capture.observe(execution(), {
    isError: false,
    value: {
      kind: 'promoted',
      cwd: '/project',
      jobId: 'bash-job',
      timeoutMs: 1000,
      output: 'rendered prefix must not be counted a second time',
    },
  });
  const artifact = capture.get('session-1', 'test-1');
  assert.ok(artifact);
  assert.equal(artifact.stdout, 'retained tail\n');
  assert.equal(artifact.truncated, true);
  assert.equal(artifact.complete, false);
  assert.equal(artifact.status, 'completed');
  await capture.close();
});

test('bounded captures mark truncation, preserve call identity, and evict durably rather than exceeding retention', async () => {
  const store = table();
  const capture = new RecordedTestOutputs({
    table: store,
    maxChars: 16,
    maxRecords: 1,
    maxTotalChars: 16,
  });
  capture.observe(
    execution('old'),
    foreground('01234567890123456789', 'stderr over limit'),
  );
  const artifact = capture.get('session-1', 'old');
  assert.ok(artifact);
  assert.ok(artifact.stdout.length + artifact.stderr.length <= 16);
  assert.equal(artifact.truncated, true);
  assert.equal(artifact.complete, false);
  capture.observe(execution('new'), foreground('new output'));
  capture.observe(execution('new'), foreground('new output'));
  assert.equal(capture.get('session-1', 'old'), undefined);
  assert.equal(capture.get('session-1', 'new').stdout, 'new output');
  await capture.close();
  const restored = new RecordedTestOutputs({
    table: store,
    maxChars: 16,
    maxRecords: 1,
    maxTotalChars: 16,
  });
  assert.equal(restored.get('session-1', 'old'), undefined);
  assert.equal(restored.get('session-1', 'new').stdout, 'new output');
  await restored.close();
});
