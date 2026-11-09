import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../src/index.js';
import { initState, reduceEvent, PROJECTION_KEY } from '../src/engine.js';

async function completedRun(stdout, exitCode) {
  const rows = new Map(),
    routes = new Map(),
    events = new Map(),
    effects = [];
  const session = {
    id: 'root',
    header: { cwd: '/project' },
    requestHeader: () => undefined,
  };
  const state = reduceEvent(initState({ id: 'root' }), {
    type: 'tool/call',
    seq: 0,
    time: 1,
    data: {
      turn: 1,
      callId: 'tests',
      name: 'bash',
      arguments: JSON.stringify({ command: 'node --test' }),
    },
  });
  let changed;
  const ctx = {
    storageDomain: {
      open: async () => ({
        table: () => ({
          entries: () => rows.entries(),
          get: (key) => rows.get(key),
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
    get: () => undefined,
    inject(_names, fn) {
      return fn({ tools: { register: () => () => {} } });
    },
    sessionProjections: {
      register() {},
      onChanged(fn) {
        changed = fn;
      },
      stateOf: () => state,
    },
    sessions: {
      list: () => [session],
      get: (id) => (id === 'root' ? session : undefined),
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
        assert.fail('canonical lifecycle enrichment must not call a model');
      },
    },
  };
  await apply(ctx, Config.parse({ summaries: false }));
  try {
    const exec = {
      name: 'bash',
      callId: 'tests',
      rootCallId: 'tests',
      agent: { id: 'root', session },
      arguments: { command: 'node --test' },
    };
    const result = {
      isError: false,
      value: {
        kind: 'foreground',
        cwd: '/project',
        exitCode,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: 1000,
        stdout: { text: stdout, truncated: false },
        stderr: { text: '', truncated: false },
      },
      content: [{ type: 'text', text: stdout }],
    };
    for (const listener of events.get('tools/result') || [])
      listener(exec, result);
    changed(session, PROJECTION_KEY);
    const route = routes.get('/api/agentActivityIntelligence.watch');
    const response = await route.fetch(
      new Request('http://localhost' + route.path, {
        method: 'POST',
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'terminal-test',
          method: 'agentActivityIntelligence.watch',
          payload: { sessionId: 'root' },
        }),
      }),
    );
    const envelope = await response.json();
    return envelope.result.value.sessions
      .flatMap((view) => view.cards)
      .flatMap((card) => card.testRuns || [])
      .find((run) => run.id === 'tests');
  } finally {
    for (const dispose of effects.reverse())
      if (typeof dispose === 'function') await dispose();
  }
}

for (const prose of ['background job ownership', 'job_id is validated']) {
  for (const exitCode of [0, 1]) {
    test(`canonical terminal exit ${exitCode} beats test-report prose mentioning ${prose}`, async () => {
      const failed = exitCode === 1;
      const run = await completedRun(
        `test: ${prose}\n# tests 2\n# pass ${failed ? 1 : 2}\n# fail ${failed ? 1 : 0}\n`,
        exitCode,
      );
      assert.ok(
        run,
        'canonical completed invocation must remain in test history',
      );
      assert.equal(
        run.executionStatus,
        failed ? 'command-failed' : 'completed',
        'canonical lifecycle is authoritative over words printed by a completed test',
      );
      assert.equal(run.exitCode, exitCode);
      assert.equal(run.resultStatus, failed ? 'failed' : 'passed');
      assert.deepEqual(run.counts, {
        passed: failed ? 1 : 2,
        failed: failed ? 1 : 0,
        skipped: 0,
      });
      assert.equal(run.output.complete, true);
    });
  }
}
