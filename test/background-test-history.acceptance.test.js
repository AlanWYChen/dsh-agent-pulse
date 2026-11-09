import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../src/index.js';
import { initState, reduceEvent } from '../src/engine.js';

// Canonical Jobs observer interface: readAt must not consume the model cursor.
function jobs() {
  const listeners = new Set();
  const records = new Map();
  const emit = (event) => listeners.forEach((fn) => fn(event));
  return {
    events: {
      subscribe: (_, fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    list: (owner) =>
      [...records.values()]
        .filter((r) => r.view.owner === owner)
        .map((r) => structuredClone(r.view)),
    get(id, owner) {
      const r = records.get(id);
      assert.equal(r.view.owner, owner);
      return structuredClone(r.view);
    },
    read() {
      assert.fail('background history must never advance model output cursor');
    },
    readAt(id, from, owner) {
      const r = records.get(id);
      assert.equal(r.view.owner, owner);
      return {
        chunks: structuredClone(
          r.chunks.filter((c) => c.at + Buffer.byteLength(c.text) > from),
        ),
        next: r.view.output.total,
        lossy: from < r.view.output.earliest,
      };
    },
    seed(id, owner) {
      records.set(id, {
        view: {
          id,
          owner,
          kind: 'bash',
          label: 'node --test',
          status: 'running',
          startedAt: 10,
          output: { total: 0, earliest: 0 },
        },
        chunks: [],
      });
    },
    append(id, text, channel = 'stdout') {
      const r = records.get(id);
      r.chunks.push({ at: r.view.output.total, channel, text });
      r.view.output.total += Buffer.byteLength(text);
      emit({
        type: 'output',
        id,
        owner: r.view.owner,
        total: r.view.output.total,
      });
    },
    settle(id, exit, { lossy = false } = {}) {
      const r = records.get(id);
      if (lossy) r.view.output.earliest = r.view.output.total + 1;
      r.view = {
        ...r.view,
        status: 'completed',
        detail: `exit code: ${exit}`,
        finishedAt: 20,
      };
      emit({
        type: 'settled',
        job: structuredClone(r.view),
        cause: 'producer',
        awaited: false,
      });
    },
  };
}
async function host() {
  const registry = jobs();
  const rows = new Map(),
    routes = new Map(),
    events = new Map(),
    effects = [];
  const sessions = new Map(),
    states = new Map();
  let changed;
  for (const id of ['root', 'foreign']) {
    const s = {
      id,
      header: { cwd: '/project' },
      requestHeader: () => undefined,
    };
    sessions.set(id, s);
    let state = initState({ id, agentId: id });
    let seq = 0;
    const event = (type, data) => {
      state = reduceEvent(state, { type, seq: seq++, time: 100 + seq, data });
    };
    event('tool/call', {
      turn: 1,
      callId: 'edit',
      name: 'edit',
      arguments: JSON.stringify({
        file_path: '/project/module.js',
        old_string: 'a',
        new_string: 'b',
      }),
    });
    event('tool/result', {
      turn: 1,
      message: {
        toolCallId: 'edit',
        content: [{ type: 'text', text: 'Edited' }],
      },
    });
    event('tool/call', {
      turn: 1,
      callId: 'test-1',
      name: 'bash',
      arguments: JSON.stringify({
        command: 'node --test',
        run_in_background: true,
      }),
    });
    event('tool/result', {
      turn: 1,
      message: {
        toolCallId: 'test-1',
        content: [
          { type: 'text', text: `Running in background; job id: job-${id}` },
        ],
      },
    });
    states.set(id, state);
    registry.seed(`job-${id}`, id);
  }
  await apply(
    {
      jobs: registry,
      storageDomain: {
        open: async () => ({
          table: () => ({
            get: (k) => rows.get(k),
            entries: () => rows.entries(),
            put: async (k, v) => rows.set(k, structuredClone(v)),
            delete: async (k) => rows.delete(k),
          }),
          close: async () => {},
        }),
      },
      effect(fn) {
        const dispose = fn();
        effects.push(dispose);
        return dispose;
      },
      on(name, fn) {
        const list = events.get(name) || [];
        list.push(fn);
        events.set(name, list);
      },
      get: (name) => (name === 'jobs' ? registry : undefined),
      inject: (_, fn) =>
        fn({ tools: { register: () => () => {} }, jobs: registry }),
      sessionProjections: {
        register() {},
        onChanged(fn) {
          changed = fn;
        },
        stateOf: (s) => states.get(s.id),
      },
      sessions: {
        list: () => [...sessions.values()],
        get: (id) => sessions.get(id),
      },
      connection: {
        fetch: {
          register(route) {
            routes.set(route.path, route);
            return () => {};
          },
        },
      },
      llm: {
        stream() {
          assert.fail(
            'background summary parsing must be deterministic, not AI',
          );
        },
      },
    },
    Config.parse({ summaries: false }),
  );
  const request = async (method, sessionId = 'root') => {
    const route = routes.get(`/api/agentActivityIntelligence.${method}`);
    assert.ok(route);
    const response = await route.fetch(
      new Request(`http://localhost${route.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'background-rpc',
          method: `agentActivityIntelligence.${method}`,
          payload: {
            sessionId,
            ...(method === 'testOutput' ? { callId: 'test-1' } : {}),
          },
        }),
      }),
    );
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.result.ok, true);
    return envelope.result.value;
  };
  return {
    jobs: registry,
    request,
    launch(owner = 'root') {
      const exec = {
        name: 'bash',
        callId: 'test-1',
        rootCallId: 'test-1',
        agent: { id: owner, session: sessions.get(owner) },
        arguments: { command: 'node --test', run_in_background: true },
      };
      const result = {
        isError: false,
        value: { kind: 'background', jobId: `job-${owner}`, cwd: '/project' },
        content: [
          {
            type: 'text',
            text: 'launch renderer is not canonical test output',
          },
        ],
      };
      for (const fn of events.get('tools/result') || []) fn(exec, result);
      changed(sessions.get(owner), 'agentActivityIntelligence');
    },
    async close() {
      for (const dispose of effects.reverse())
        if (typeof dispose === 'function') await dispose();
    },
  };
}
const runs = (snapshot) =>
  snapshot.sessions.flatMap((s) => s.cards).flatMap((c) => c.testRuns || []);
const tap = '# tests 6\n# pass 4\n# fail 1\n# skipped 1\n';

for (const [label, output, exit, executionStatus, resultStatus, counts] of [
  [
    'parsed failing tests',
    tap,
    1,
    'command-failed',
    'failed',
    { passed: 4, failed: 1, skipped: 1 },
  ],
  [
    'parsed passing tests',
    '# tests 3\n# pass 2\n# fail 0\n# skipped 1\n',
    0,
    'completed',
    'passed',
    { passed: 2, failed: 0, skipped: 1 },
  ],
  [
    'infrastructure failure without report',
    'Error: missing executable\n',
    127,
    'command-failed',
    'unknown',
    null,
  ],
  [
    'zero exit without report',
    'runner did not print a known summary\n',
    0,
    'completed',
    'unknown',
    null,
  ],
])
  test(`watch finalizes original background run from retained canonical output: ${label}`, async () => {
    const h = await host();
    try {
      h.launch();
      const initial = runs(await h.request('watch'));
      assert.equal(initial.length, 1);
      assert.equal(initial[0].executionStatus, 'running');
      h.jobs.append('job-root', output);
      // A complete-looking report before producer settlement is still in-flight.
      const midway = runs(await h.request('watch'));
      assert.equal(midway[0].executionStatus, 'running');
      assert.equal(midway[0].resultStatus, 'unknown');
      h.jobs.settle('job-root', exit);
      const snapshot = await h.request('watch');
      const final = runs(snapshot);
      assert.equal(
        final.length,
        1,
        'settlement updates rather than appends a second run',
      );
      assert.equal(final[0].id, 'test-1');
      assert.equal(final[0].sessionId, 'root');
      assert.equal(final[0].callSeq, initial[0].callSeq);
      assert.equal(final[0].executionStatus, executionStatus);
      assert.equal(final[0].resultStatus, resultStatus);
      assert.deepEqual(final[0].counts, counts);
      assert.equal(final[0].exitCode, exit);
      assert.equal(final[0].output.complete, true);
      const parent = snapshot.sessions
        .find((s) => s.sessionId === 'root')
        .cards.find((c) => c.category === 'outcome');
      assert.notEqual(
        parent.verification.status,
        'passed',
        'background evidence is not foreground verification of edited files',
      );
      assert.equal(
        JSON.stringify(snapshot).includes(output.trim()),
        false,
        'watch must not inline canonical stdout',
      );
      const artifact = await h.request('testOutput');
      assert.equal(
        artifact.artifact.stdout,
        output,
        'output viewer retains the exact canonical report separately',
      );
    } finally {
      await h.close();
    }
  });

test('settlement keeps owner isolation even when both sessions use the same call id', async () => {
  const h = await host();
  try {
    h.launch('root');
    h.launch('foreign');
    h.jobs.append('job-foreign', tap);
    h.jobs.settle('job-foreign', 1);
    const foreign = runs(await h.request('watch', 'foreign'));
    assert.equal(foreign[0].resultStatus, 'failed');
    const root = runs(await h.request('watch'));
    assert.equal(root.length, 1);
    assert.equal(root[0].executionStatus, 'running');
    assert.equal(root[0].counts, null);
    assert.equal(root[0].exitCode, null);
  } finally {
    await h.close();
  }
});

test('settled lossy output does not fabricate parsed pass counts from a retained tail', async () => {
  const h = await host();
  try {
    h.launch();
    h.jobs.append('job-root', '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n');
    h.jobs.settle('job-root', 0, { lossy: true });
    const final = runs(await h.request('watch'));
    assert.equal(final.length, 1);
    assert.equal(final[0].executionStatus, 'incomplete');
    assert.equal(final[0].resultStatus, 'unknown');
    assert.equal(final[0].counts, null);
    assert.equal(final[0].output.complete, false);
    assert.equal(final[0].output.truncated, true);
  } finally {
    await h.close();
  }
});
