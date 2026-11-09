import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../src/index.js';
import { initState, reduceEvent } from '../src/engine.js';

const canonical = (
  stdout = 'host retained evidence\n',
  stderr = 'diagnostic\n',
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
  },
  content: [
    { type: 'text', text: 'rendered projection is not the canonical evidence' },
  ],
});

async function harness(registry) {
  const rows = new Map(),
    routes = new Map(),
    events = new Map(),
    effects = [];
  const states = new Map(),
    sessions = new Map();
  let changed;
  for (const id of ['root', 'foreign']) {
    const session = {
      id,
      header: { cwd: '/project' },
      requestHeader: () => undefined,
    };
    sessions.set(id, session);
    let state = initState({ id });
    state = reduceEvent(state, {
      type: 'tool/call',
      seq: 0,
      time: 1,
      data: {
        turn: 1,
        callId: 'test-1',
        name: 'bash',
        arguments: JSON.stringify({ command: 'node --test' }),
      },
    });
    states.set(id, state);
  }
  const ctx = {
    jobs: registry,
    storageDomain: {
      open: async () => ({
        table: () => ({
          get: (key) => rows.get(key),
          entries: () => rows.entries(),
          put: async (key, value) => rows.set(key, structuredClone(value)),
          delete: async (key) => rows.delete(key),
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
    get(name) {
      return name === 'jobs' ? registry : undefined;
    },
    inject(names, fn) {
      const scope = { tools: { register: () => () => {} }, jobs: registry };
      if (!names.includes('jobs') || registry) return fn(scope);
    },
    sessionProjections: {
      register() {},
      onChanged(fn) {
        changed = fn;
      },
      stateOf: (session) => states.get(session.id),
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
        assert.fail('capture must not request model summaries');
      },
    },
  };
  await apply(ctx, Config.parse({ summaries: false }));
  return {
    routes,
    rows,
    emitResult(result, owner = 'root') {
      const exec = {
        name: 'bash',
        callId: 'test-1',
        rootCallId: 'test-1',
        agent: { id: owner, session: sessions.get(owner) },
        arguments: { command: 'node --test' },
      };
      for (const listener of events.get('tools/result') || [])
        listener(exec, result);
      changed(sessions.get(owner), 'agentActivityIntelligence');
    },
    async request(method, payload, rpcId = 'capture-rpc') {
      const route = routes.get(`/api/agentActivityIntelligence.${method}`);
      assert.ok(route, `Host must register the ${method} API`);
      const response = await route.fetch(
        new Request(`http://localhost${route.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId,
            method: `agentActivityIntelligence.${method}`,
            payload,
          }),
        }),
      );
      return {
        response,
        envelope: response.status === 400 ? null : await response.json(),
      };
    },
    async close() {
      for (const dispose of effects.reverse())
        if (typeof dispose === 'function') await dispose();
    },
  };
}

test('Host captures canonical tools/result and serves exact owner/call .out artifacts through buffered POST RPC', async () => {
  const host = await harness();
  try {
    host.emitResult(
      canonical(
        'API_KEY=private-host-secret\nvisible output\n',
        'stderr diagnostic\n',
      ),
    );
    const { envelope } = await host.request('testOutput', {
      sessionId: 'root',
      callId: 'test-1',
    });
    const route = host.routes.get('/api/agentActivityIntelligence.testOutput');
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
    assert.equal(envelope.type, 'server-response');
    assert.equal(envelope.rpcId, 'capture-rpc');
    assert.equal(envelope.result.ok, true);
    assert.equal(envelope.result.value.status, 'available');
    const artifact = envelope.result.value.artifact;
    assert.match(artifact.name, /\.out$/);
    assert.equal(artifact.sessionId, 'root');
    assert.equal(artifact.callId, 'test-1');
    assert.match(artifact.stdout, /visible output/);
    assert.equal(artifact.stderr, 'stderr diagnostic\n');
    assert.equal(
      JSON.stringify(envelope).includes('private-host-secret'),
      false,
    );
    const foreign = await host.request('testOutput', {
      sessionId: 'foreign',
      callId: 'test-1',
    });
    assert.equal(foreign.envelope.result.value.status, 'unavailable');
    const missing = await host.request('testOutput', {
      sessionId: 'missing',
      callId: 'test-1',
    });
    assert.equal(missing.envelope.result.value.status, 'unavailable');
    const unknown = await host.request('testOutput', {
      sessionId: 'root',
      callId: 'unknown',
    });
    assert.equal(unknown.envelope.result.value.status, 'unavailable');
  } finally {
    await host.close();
  }
});

test('output RPC validates identity payload and envelope, never accepts arbitrary file paths', async () => {
  const host = await harness();
  try {
    for (const payload of [
      {},
      { sessionId: 'root' },
      { sessionId: '', callId: 'x' },
      { sessionId: 'root', callId: 'test-1', path: '/etc/passwd' },
    ]) {
      const { response, envelope } = await host.request('testOutput', payload);
      assert.ok(
        response.status === 400 || envelope?.result?.ok === false,
        'strict payload must reject extra/missing identity fields',
      );
    }
    const route = host.routes.get('/api/agentActivityIntelligence.testOutput');
    for (const body of [
      'not JSON',
      JSON.stringify({
        type: 'client-request',
        rpcId: 'x',
        method: 'wrong.method',
        payload: { sessionId: 'root', callId: 'test-1' },
      }),
    ]) {
      const response = await route.fetch(
        new Request('http://localhost' + route.path, { method: 'POST', body }),
      );
      assert.equal(response.status, 400);
    }
  } finally {
    await host.close();
  }
});

test('watch enriches test-run output metadata without including stdout/stderr bodies', async () => {
  const host = await harness();
  try {
    host.emitResult(
      canonical(
        'stdout-raw-evidence-sentinel\n',
        'stderr-raw-evidence-sentinel\n',
      ),
    );
    const { envelope } = await host.request('watch', { sessionId: 'root' });
    const run = envelope.result.value.sessions
      .flatMap((session) => session.cards)
      .flatMap((card) => card.testRuns || [])
      .find((item) => item.id === 'test-1');
    assert.ok(run, 'test run must remain attached to its outcome');
    assert.ok(
      run.output,
      'captured output must be discoverable from the corresponding test run',
    );
    assert.match(run.output.name, /\.out$/);
    const wire = JSON.stringify(envelope);
    assert.equal(wire.includes('stdout-raw-evidence-sentinel'), false);
    assert.equal(wire.includes('stderr-raw-evidence-sentinel'), false);
    assert.equal(run.output.stdout, undefined);
    assert.equal(run.output.stderr, undefined);
  } finally {
    await host.close();
  }
});
