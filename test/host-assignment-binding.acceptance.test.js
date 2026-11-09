import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../src/index.js';
import { initState } from '../src/engine.js';

const outcome = (sessionId, turn, ids = []) => ({
  id: `outcome:${turn}`, category: 'outcome', title: 'Assigned research', summary: 'Assigned research',
  status: 'observed', time: 1, agentId: sessionId, evidence: [], files: [],
  verification: { status: 'not-run', label: 'No test evidence' },
  _turn: turn, _finalized: true, testRuns: [], inputMessageIds: ids,
});
function states() {
  return new Map([
    ['root', { ...initState({ id: 'root' }), cards: [{ ...outcome('root', 2), _delegatedActivity: true }],
      assignments: [{ id: 'later', parentSessionId: 'root', parentCardId: 'outcome:2', parentTurn: 2,
        callSeq: 4, childSessionId: 'child', label: 'Delegated follow-up', kind: 'message', status: 'accepted' }] }],
    ['child', { ...initState({ id: 'child', origin: 'subagent', parentSession: 'root' }),
      taskLabel: 'Child research', cards: [
        { ...outcome('child', 1, ['older']), _reportedResult: 'Old unrelated research' },
        { ...outcome('child', 9, ['receipt']), _reportedResult: 'Correct followup research' },
      ], inputs: [
        { id: 'older', turn: 1, seq: 1, source: { kind: 'user' } },
        { id: 'receipt', turn: 9, seq: 9, source: { kind: 'agent-message', form: 'relay', senderSessionId: 'root' } },
      ] }],
  ]);
}
async function host(rows = new Map()) {
  const effects = [], routes = new Map(), listeners = new Map();
  const projections = states();
  const sessions = new Map([...projections.keys()].map((id) => [id, { id, requestHeader: () => undefined }]));
  const table = { get: (key) => rows.get(key), entries: () => rows.entries(),
    put: async (key, value) => { rows.set(key, structuredClone(value)); },
    delete: async (key) => rows.delete(key) };
  const ctx = {
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    effect: (fn) => { const dispose = fn(); effects.push(dispose); return dispose; },
    sessionProjections: { register: () => {}, onChanged: () => {}, stateOf: (session) => projections.get(session.id) },
    sessions: { list: () => [...sessions.values()], get: (id) => sessions.get(id) },
    connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
    inject: (_names, fn) => fn({ tools: { register: () => () => {} } }),
    on: (name, fn) => { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
    get: () => undefined,
    llm: { stream: () => assert.fail('summaries off must not invoke a model') },
  };
  await apply(ctx, Config.parse({ summaries: false }));
  return {
    rows,
    async watch() {
      const route = routes.get('/api/agentActivityIntelligence.watch');
      const response = await route.fetch(new Request(`http://localhost${route.path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          type: 'client-request', rpcId: 'assignment-watch', method: 'agentActivityIntelligence.watch', payload: { sessionId: 'root' },
        }),
      }));
      const body = await response.json();
      assert.equal(body.result.ok, true);
      return body.result.value;
    },
    async receipt(isError = false) {
      const exec = { name: 'send_message', callId: 'later', agent: { id: 'root' },
        arguments: { agent_id: 'child', message: 'PRIVATE_HOST_DELIVERY_CONTENT' } };
      const result = { isError, value: { messageId: 'receipt' } };
      for (const fn of listeners.get('tools/result') || []) await fn(exec, result);
    },
    async close() { for (const fn of [...effects].reverse()) if (typeof fn === 'function') await fn(); },
  };
}
const subtask = (snapshot) => snapshot.sessions.find((s) => s.sessionId === 'root').cards
  .find((c) => c.id === 'outcome:2').subtasks?.find((s) => s.id === 'later');

test('live canonical send receipt links exactly its child input and invalidates watch without a new projection event', async () => {
  const h = await host();
  try {
    const before = await h.watch();
    assert.equal(subtask(before)?.attribution, 'unavailable');
    await h.receipt();
    const after = await h.watch();
    assert.equal(subtask(after)?.attribution, 'linked');
    assert.deepEqual(subtask(after).cards.map((c) => c.id), ['outcome:9']);
    assert.ok(after.revision > before.revision, 'receipt-only change must wake activity watchers');
    assert.doesNotMatch(JSON.stringify(after), /PRIVATE_HOST_DELIVERY_CONTENT/);
    assert.doesNotMatch(JSON.stringify([...h.rows]), /PRIVATE_HOST_DELIVERY_CONTENT/);
  } finally { await h.close(); }
});

test('canonical receipt binding survives storage-domain restore and keeps unrelated child turns excluded', async () => {
  const rows = new Map();
  const first = await host(rows);
  try { await first.receipt(); } finally { await first.close(); }
  const restored = await host(rows);
  try {
    const snapshot = await restored.watch();
    assert.equal(subtask(snapshot)?.attribution, 'linked');
    assert.deepEqual(subtask(snapshot).cards.map((c) => c.id), ['outcome:9']);
    assert.doesNotMatch(JSON.stringify([...rows]), /PRIVATE_HOST_DELIVERY_CONTENT/);
  } finally { await restored.close(); }
});

test('failed host delivery cannot create a canonical binding even with a messageId-shaped value', async () => {
  const h = await host();
  try {
    await h.receipt(true);
    const snapshot = await h.watch();
    assert.equal(subtask(snapshot)?.attribution, 'unavailable');
    assert.deepEqual(subtask(snapshot).cards, []);
    assert.doesNotMatch(JSON.stringify([...h.rows]), /PRIVATE_HOST_DELIVERY_CONTENT/);
  } finally { await h.close(); }
});
