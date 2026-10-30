import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from './index.js';
import { initState, reduceEvent, PROJECTION_KEY } from './engine.js';

test('Host registers pure projection and owner-fenced exact route with valid RPC envelopes', async () => {
  const effects = [],
    rows = new Map(),
    routes = new Map(),
    tools = new Map();
  let definition,
    changed,
    closed = false,
    unregistered = false;
  const table = {
    get: (k) => rows.get(k),
    entries: () => rows.entries(),

    put: async (k, v) => {
      rows.set(k, structuredClone(v));
    },

    delete: async (k) => rows.delete(k),
  };
  let state = initState({ id: 'root' });

  state = reduceEvent(state, {
    type: 'tool/call',
    seq: 0,
    time: 1,
    data: {
      turn: 1,
      callId: 'read',
      name: 'read',
      arguments: JSON.stringify({ file_path: '.env' }),
    },
  });
  state = reduceEvent(state, {
    type: 'tool/result',
    seq: 1,
    time: 2,
    data: {
      turn: 1,
      message: {
        toolCallId: 'read',
        content: [{ type: 'text', text: 'SECRET=never-cache-this' }],
      },
    },
  });

  const session = { id: 'root', requestHeader: () => undefined };
  const ctx = {
    storageDomain: {
      open: async (spec) => {
        assert.match(spec.name, /^[a-z][a-z0-9_]*$/);

        return {
          table: () => table,

          close: async () => {
            closed = true;
          },
        };
      },
    },

    effect: (fn) => {
      const dispose = fn();

      effects.push(dispose);

      return dispose;
    },

    sessionProjections: {
      register: (d) => {
        definition = d;
      },

      onChanged: (fn) => {
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
        register: (value) => {
          routes.set(value.path, value);

          return async () => {
            unregistered = true;
          };
        },
      },
    },
    inject: (_names, fn) =>
      fn({
        tools: {
          register: (value) => {
            tools.set(value.name, value);

            return () => {};
          },
        },
      }),

    on: () => {},

    get: () => undefined,
    llm: {
      stream: () => assert.fail('sensitive events must never call model'),
    },
  };

  await apply(ctx, Config.parse({ summaries: false }));

  assert.equal(definition.key, PROJECTION_KEY);
  assert.equal(definition.stateSchema.safeParse(state).success, true);

  const route = routes.get('/api/agentActivityIntelligence.watch');

  assert.equal(route.path, '/api/agentActivityIntelligence.watch');
  assert.deepEqual(route.methods, ['POST']);

  const request = (payload) =>
    new Request('http://localhost' + route.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'test-1',
        method: 'agentActivityIntelligence.watch',
        payload,
      }),
    });

  const malformed = await route.fetch(
    request({ sessionId: 'root', extra: 'bad' }),
  );

  assert.equal((await malformed.json()).result.ok, false);

  const response = await route.fetch(request({ sessionId: 'root' }));

  const envelope = await response.json();

  assert.equal(envelope.type, 'server-response');
  assert.equal(envelope.rpcId, 'test-1');
  assert.equal(
    envelope.result.value.sessions[0].cards[0].category,
    'sensitive',
  );
  assert.equal(JSON.stringify(envelope).includes('never-cache-this'), false);
  assert.equal(
    (
      await route.fetch(
        new Request('http://localhost' + route.path, {
          method: 'POST',
          body: 'bad',
        }),
      )
    ).status,
    400,
  );

  const modelRoute = routes.get('/api/agentActivityIntelligence.model');
  const tool = tools.get('activity_summary_model');

  assert.equal(tool.name, 'activity_summary_model');
  assert.equal(tools.get('activity_outcomes').name, 'activity_outcomes');

  const outcomes = await tools
    .get('activity_outcomes')
    .execute({ sessionId: 'root' });

  assert.deepEqual(
    outcomes,
    JSON.parse(JSON.stringify(outcomes)),
    'All tool fields must be lossless JSON, including sensitive-only cards',
  );

  const diffRoute = routes.get('/api/agentActivityIntelligence.diff');

  const missing = await diffRoute.fetch(
    new Request('http://localhost' + diffRoute.path, {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'diff-test',
        method: 'agentActivityIntelligence.diff',
        payload: {
          sessionId: 'missing',
          cardId: 'outcome:1',
          fileId: 'tampered',
        },
      }),
    }),
  );

  assert.equal((await missing.json()).result.value.status, 'unavailable');

  await tool.execute(
    { action: 'set', mode: 'off' },
    { signal: new AbortController().signal },
  );

  const modelResponse = await modelRoute.fetch(
    new Request('http://localhost' + modelRoute.path, {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'model-test',
        method: 'agentActivityIntelligence.model',
        payload: { action: 'get' },
      }),
    }),
  );

  assert.equal((await modelResponse.json()).result.value.selection.mode, 'off');

  const badModelResponse = await modelRoute.fetch(
    new Request('http://localhost' + modelRoute.path, {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'model-test',
        method: 'agentActivityIntelligence.model',
        payload: { action: 'set', mode: 'model', model: 'x' },
      }),
    }),
  );

  assert.equal((await badModelResponse.json()).result.ok, false);

  const summaryRoute = routes.get('/api/agentActivityIntelligence.summarize');

  const summaryResponse = await summaryRoute.fetch(
    new Request('http://localhost' + summaryRoute.path, {
      method: 'POST',
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'summary-test',
        method: 'agentActivityIntelligence.summarize',
        payload: { sessionId: 'root', cardId: 'outcome:1' },
      }),
    }),
  );

  const toolRefresh = await tools
    .get('activity_outcomes')
    .execute({ sessionId: 'root', regenerateCardId: 'outcome:1' });

  assert.deepEqual(
    (await summaryResponse.json()).result.value,
    toolRefresh.regeneration,
    'UI and tool use one regeneration operation',
  );

  changed(session, PROJECTION_KEY);
  for (const dispose of effects.reverse()) await dispose?.();

  assert.equal(closed, true);
  assert.equal(unregistered, true);
});
