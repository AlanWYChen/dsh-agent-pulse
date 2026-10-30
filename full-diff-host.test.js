import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from './index.js';
import { initState, reduceEvent } from './engine.js';

test('actual canonical tool result becomes a native-sidebar full-file diff without filesystem reads', async () => {
  const events = [],
    callbacks = new Map(),
    routes = new Map(),
    effects = [],
    rows = new Map();
  let changed;
  let state = initState({ id: 'root', cwd: '/project' });

  const append = (type, data) => {
    const e = { type, data, seq: events.length, time: events.length + 1 };

    events.push(e);
    state = reduceEvent(state, e);
  };

  const before = Array.from(
    { length: 30 },
    (_, i) => `const value${i + 1} = ${i + 1};`,
  ).join('\n');
  const after = before.replace('const value15 = 15;', 'const value15 = 150;');

  append('turn/start', { turn: 1 });
  append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'edit-full',
    name: 'edit',
    arguments: JSON.stringify({
      file_path: '/project/app.js',
      old_string: 'const value15 = 15;',
      new_string: 'const value15 = 150;',
    }),
  });

  const session = {
    id: 'root',
    header: { cwd: '/project' },

    get seq() {
      return events.length;
    },

    eventAt: (seq) => events[seq],

    snapshotEvents: (from, to) => {
      assert.ok(to <= events.length);

      return events.slice(from, to);
    },

    requestHeader: () => undefined,
  };
  const table = {
    get: (k) => rows.get(k),
    entries: () => rows.entries(),
    put: async (k, v) => rows.set(k, structuredClone(v)),
    delete: async (k) => rows.delete(k),
  };
  const ctx = {
    storageDomain: {
      open: async () => ({ table: () => table, close: async () => {} }),
    },

    effect: (fn) => {
      const disposer = fn();

      effects.push(disposer);

      return disposer;
    },

    sessionProjections: {
      register: () => {},

      stateOf: () => state,

      onChanged: (fn) => {
        changed = fn;
      },
    },
    sessions: {
      list: () => [session],
      get: (id) => (id === 'root' ? session : undefined),
    },
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route);

          return () => {};
        },
      },
    },
    inject: (_deps, fn) => fn({ tools: { register: () => () => {} } }),

    on: (event, fn) => {
      callbacks.set(event, fn);
    },

    get: () => undefined,
    llm: { stream: () => assert.fail('A diff must not make a model call') },
  };

  await apply(ctx, Config.parse({ summaries: false }));
  // This is the exact public tools/result envelope shape, emitted before durable tool/result.
  callbacks.get('tools/result')(
    { agent: { id: 'root' }, callId: 'edit-full', name: 'edit' },
    {
      isError: false,
      value: { path: '/project/app.js', before, after },
      content: [],
    },
  );
  append('tool/result', {
    turn: 1,
    step: 1,
    message: {
      toolCallId: 'edit-full',
      content: [{ type: 'text', text: 'Updated file' }],
    },
  });
  append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  changed(session, 'agentActivityIntelligence');

  async function rpc(method, payload) {
    const route = routes.get('/api/' + method);

    return (
      await (
        await route.fetch(
          new Request('http://localhost/api/' + method, {
            method: 'POST',
            body: JSON.stringify({
              type: 'client-request',
              rpcId: 'test',
              method,
              payload,
            }),
          }),
        )
      ).json()
    ).result.value;
  }

  const view = await rpc('agentActivityIntelligence.watch', {
    sessionId: 'root',
  });
  const card = view.sessions[0].cards[0];

  assert.equal(card.changeFiles[0].label, 'app.js');

  const diff = await rpc('agentActivityIntelligence.diff', {
    sessionId: 'root',
    cardId: card.id,
    fileId: card.changeFiles[0].id,
  });

  assert.equal(diff.status, 'available');
  assert.equal(diff.coverage, 'recorded-full');
  assert.equal(diff.editorPath, '/project/app.js');
  assert.equal(diff.nativeReview, null);
  assert.equal(diff.lines.filter((line) => line.kind === 'context').length, 29);
  assert.ok(
    diff.lines.some(
      (line) => line.kind === 'context' && line.text === 'const value1 = 1;',
    ),
  );
  assert.ok(
    diff.lines.some(
      (line) => line.kind === 'context' && line.text === 'const value30 = 30;',
    ),
  );
  assert.ok(
    diff.lines.some(
      (line) => line.kind === 'remove' && line.text === 'const value15 = 15;',
    ),
  );
  assert.ok(
    diff.lines.some(
      (line) => line.kind === 'add' && line.text === 'const value15 = 150;',
    ),
  );

  const tampered = await rpc('agentActivityIntelligence.diff', {
    sessionId: 'root',
    cardId: card.id,
    fileId: 'untrusted-path',
  });

  assert.equal(tampered.status, 'unavailable');

  for (const dispose of effects.reverse()) await dispose?.();
});
