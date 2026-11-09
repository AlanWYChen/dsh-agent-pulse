import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedAssignmentBindings } from '../src/recorded-files.js';

function table() {
  const map = new Map();
  return {
    map,
    entries: () => map.entries(),
    put: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}
const exec = (callId, name = 'send_message', parent = 'parent-A') => ({
  agent: { id: parent },
  callId,
  name,
  arguments: { agent_id: 'child-X', message: 'PRIVATE PROMPT DO NOT RETAIN' },
});
const ok = (value) => ({
  isError: false,
  value,
  content: [{ type: 'text', text: 'PRIVATE REPORT DO NOT RETAIN' }],
});
const binding = (
  callId,
  kind = 'message',
  messageId = 'input-1',
  parent = 'parent-A',
) => ({
  parentSessionId: parent,
  parentCallId: callId,
  childSessionId: 'child-X',
  kind,
  messageId,
});

test('accepted send receipt preserves exact input identity, owner scope, and clone isolation', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  records.observe(exec('call-1'), ok({ messageId: 'input-1' }));
  assert.deepEqual(records.get('parent-A', 'call-1'), binding('call-1'));
  assert.equal(records.get('parent-B', 'call-1'), undefined);
  const copy = records.get('parent-A', 'call-1');
  copy.childSessionId = 'tampered';
  assert.deepEqual(records.get('parent-A', 'call-1'), binding('call-1'));
  await records.close();
});

test('spawn and fork receipts retain child but never invent initial inbox identity', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  for (const name of ['subagent', 'subagent_fork']) {
    records.observe(
      exec(name, name),
      ok({ kind: 'activation', subagentId: 'child-X' }),
    );
    assert.deepEqual(
      records.get('parent-A', name),
      binding(name, 'spawn', null),
    );
  }
  await records.close();
});

test('known basenames normalize namespace prefixes without retaining execution arguments', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  records.observe(
    exec('namespaced', 'functions.send_message'),
    ok({ messageId: 'input-1' }),
  );
  assert.deepEqual(
    records.get('parent-A', 'namespaced'),
    binding('namespaced'),
  );
  records.observe(
    exec('fork', 'functions.subagent_fork'),
    ok({ kind: 'activation', subagentId: 'child-X' }),
  );
  assert.deepEqual(
    records.get('parent-A', 'fork'),
    binding('fork', 'spawn', null),
  );
  await records.close();
});

test('binding persistence restores exact receipts without prompts, arguments, output, or agent graphs', async () => {
  const store = table();
  const records = new RecordedAssignmentBindings({ table: store });
  records.observe(
    exec('persist'),
    ok({ messageId: 'input-1', report: 'PRIVATE EXTRA DO NOT RETAIN' }),
  );
  await records.close();
  assert.ok(store.map.size > 0, 'accepted binding must be durably written');
  const persisted = JSON.stringify([...store.map]);
  assert.doesNotMatch(persisted, /PRIVATE|arguments|content|report/);
  const restored = new RecordedAssignmentBindings({ table: store });
  assert.deepEqual(restored.get('parent-A', 'persist'), binding('persist'));
  await restored.close();
});

test('reused child assignments and colliding call ids across parents stay distinct', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  records.observe(exec('first'), ok({ messageId: 'input-1' }));
  records.observe(exec('later'), ok({ messageId: 'input-2' }));
  records.observe(
    exec('first', 'send_message', 'parent-B'),
    ok({ messageId: 'input-B' }),
  );
  assert.deepEqual(records.get('parent-A', 'first'), binding('first'));
  assert.deepEqual(
    records.get('parent-A', 'later'),
    binding('later', 'message', 'input-2'),
  );
  assert.deepEqual(
    records.get('parent-B', 'first'),
    binding('first', 'message', 'input-B', 'parent-B'),
  );
  await records.close();
});

test('accepted bindings notify their owner to reproject completed assignment cards', async () => {
  const changes = [];
  const records = new RecordedAssignmentBindings({
    table: table(),
    onChanged: (...args) => changes.push(args),
  });
  records.observe(exec('notify'), ok({ messageId: 'input-1' }));
  await records.close();
  assert.ok(
    changes.length > 0,
    'receipt acceptance must trigger reprojection notification',
  );
});

test('first accepted receipt is stable under duplicate observer delivery', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  records.observe(exec('duplicate'), ok({ messageId: 'input-1' }));
  records.observe(exec('duplicate'), ok({ messageId: 'input-replacement' }));
  assert.deepEqual(records.get('parent-A', 'duplicate'), binding('duplicate'));
  await records.close();
});

test('bounded eviction removes old receipts durably, including after reload', async () => {
  const store = table();
  const records = new RecordedAssignmentBindings({
    table: store,
    maxRecords: 2,
  });
  for (const call of ['old', 'middle', 'new'])
    records.observe(exec(call), ok({ messageId: call }));
  assert.equal(records.get('parent-A', 'old'), undefined);
  assert.deepEqual(
    records.get('parent-A', 'middle'),
    binding('middle', 'message', 'middle'),
  );
  assert.deepEqual(
    records.get('parent-A', 'new'),
    binding('new', 'message', 'new'),
  );
  await records.close();
  const restored = new RecordedAssignmentBindings({
    table: store,
    maxRecords: 2,
  });
  assert.equal(restored.get('parent-A', 'old'), undefined);
  assert.deepEqual(
    restored.get('parent-A', 'new'),
    binding('new', 'message', 'new'),
  );
  await restored.close();
});

test('ignores failed, malformed, and noncanonical receipts rather than parsing rendered text', async () => {
  const records = new RecordedAssignmentBindings({ table: table() });
  const cases = [
    [exec('bad'), { ...ok({ messageId: 'input-1' }), isError: true }],
    [exec('bad'), { value: { messageId: 'input-1' } }],
    [exec('bad'), ok({})],
    [exec('bad'), ok({ messageId: '' })],
    [exec('bad'), ok({ messageId: 42 })],
    [exec('bad', 'bash'), ok({ messageId: 'input-1' })],
    [exec('bad', 'send_message_extra'), ok({ messageId: 'input-1' })],
    [
      exec('bad', 'not_subagent'),
      ok({ kind: 'activation', subagentId: 'child-X' }),
    ],
    [exec('bad', 'subagent'), ok({ kind: 'wrong', subagentId: 'child-X' })],
    [exec('bad', 'subagent'), ok({ kind: 'activation', subagentId: '' })],
    [{ ...exec('bad'), agent: undefined }, ok({ messageId: 'input-1' })],
  ];
  for (const [execution, result] of cases) {
    records.observe(execution, result);
    assert.equal(records.get('parent-A', 'bad'), undefined);
  }
  await records.close();
});
