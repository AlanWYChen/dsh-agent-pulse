import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

function card(sessionId, turn, summary, inputMessageIds = []) {
  return {
    id: `outcome:${turn}`,
    category: 'outcome',
    title: summary,
    summary,
    status: 'observed',
    time: 100,
    agentId: sessionId,
    evidence: [],
    files: [],
    verification: {
      status: 'not-run',
      label: 'No supported test result observed',
    },
    _turn: turn,
    _finalized: true,
    inputMessageIds,
    _reportedResult: summary,
    testRuns: [],
  };
}
const input = (id, turn, seq, kind = 'user', senderSessionId) => ({
  id,
  turn,
  seq,
  source: { kind, ...(senderSessionId ? { senderSessionId } : {}) },
});
const assignment = (id, turn, childSessionId, kind = 'spawn') => ({
  id,
  parentSessionId: 'root',
  parentCardId: `outcome:${turn}`,
  parentTurn: turn,
  callSeq: turn,
  childSessionId,
  label: `Task ${id}`,
  kind,
  status: 'accepted',
});
function state(id, parentSession, cards, inputs = [], assignments = []) {
  const s = initState({
    id,
    ...(parentSession ? { origin: 'subagent', parentSession } : {}),
  });
  return {
    ...s,
    cards,
    inputs,
    assignments,
    ...(parentSession ? { taskLabel: 'Child work' } : {}),
  };
}
function root(assignments) {
  return state(
    'root',
    null,
    [...new Set(assignments.map((a) => a.parentTurn))].map((turn) => ({
      ...card('root', turn, 'Parent delegated work'),
      _delegatedActivity: true,
    })),
    [],
    assignments,
  );
}
const update = (c, s) => c.update({ id: s.sessionId }, s);
const parentCard = (c, turn, sessionId = 'root') =>
  c
    .snapshot('root')
    .sessions.find((s) => s.sessionId === sessionId)
    .cards.find((item) => item.id === `outcome:${turn}`);
const task = (c, turn, id) =>
  parentCard(c, turn).subtasks?.find((item) => item.id === id);
const run = (id, sessionId) => ({
  id,
  sessionId,
  agentId: sessionId,
  callSeq: 1,
  resultSeq: 2,
  executionStatus: 'completed',
  resultStatus: 'passed',
  counts: { passed: 1, failed: 0, skipped: 0 },
  exitCode: 0,
});

function coordinator(bindings = {}) {
  return new ActivityCoordinator({
    enabled: false,
    assignmentBindingFor: (parentSessionId, callId) =>
      bindings[`${parentSessionId}:${callId}`],
  });
}

test('same child reused across parent outcomes has separate input-linked subcards and owned test histories', async () => {
  const c = coordinator({ 'root:later': { messageId: 'receipt-later' } });
  const a = assignment('initial', 1, 'child');
  const b = assignment('later', 2, 'child', 'message');
  const old = card('child', 11, 'Initial parser research', ['initial-input']);
  const newer = card('child', 22, 'Followup renderer research', [
    'receipt-later',
  ]);
  old.testRuns = [run('old-test', 'child')];
  newer.testRuns = [run('new-test', 'child')];
  const r = root([a, b]);
  r.cards[0].testRuns = [run('parent-local', 'root')];
  const child = state(
    'child',
    'root',
    [old, newer],
    [
      input('initial-input', 11, 1),
      input('receipt-later', 22, 8, 'agent-message', 'root'),
    ],
  );
  const before = structuredClone({ r, child });
  try {
    update(c, r);
    update(c, child);
    assert.deepEqual(
      task(c, 1, 'initial')?.cards.map((x) => x.id),
      ['outcome:11'],
    );
    assert.deepEqual(
      task(c, 2, 'later')?.cards.map((x) => x.id),
      ['outcome:22'],
    );
    assert.equal(task(c, 1, 'initial').sessionId, 'child');
    assert.equal(task(c, 1, 'initial').attribution, 'linked');
    assert.equal(task(c, 2, 'later').status, 'completed');
    assert.equal(task(c, 2, 'later').label, 'Task later');
    assert.deepEqual(
      parentCard(c, 1)
        .testRuns.map((x) => x.id)
        .sort(),
      ['old-test', 'parent-local'],
    );
    assert.deepEqual(
      parentCard(c, 2).testRuns.map((x) => x.id),
      ['new-test'],
    );
    assert.equal(parentCard(c, 1).verification.status, 'not-run');
    assert.deepEqual(
      { r, child },
      before,
      'derived ownership never mutates engine state',
    );
  } finally {
    await c.close();
  }
});

test('spawn binds first own user input by durable sequence, not card order or timestamps', async () => {
  const c = coordinator();
  const child = state(
    'child',
    'root',
    [
      card('child', 9, 'Later independent work', ['second-user']),
      card('child', 3, 'First assigned work', ['first-user']),
      card('child', 1, 'Inherited work', ['inherited-user']),
    ],
    [
      input('inherited-user', 1, 1),
      input('second-user', 9, 30),
      input('first-user', 3, 11),
    ],
  );
  child.inheritedEventCount = 10;
  try {
    update(c, root([assignment('spawn', 1, 'child')]));
    update(c, child);
    assert.deepEqual(
      task(c, 1, 'spawn')?.cards.map((x) => x.id),
      ['outcome:3'],
    );
  } finally {
    await c.close();
  }
});

test('two assignments consumed in one child turn are explicitly shared, never falsely exclusive', async () => {
  const c = coordinator({
    'root:a': { messageId: 'message-a' },
    'root:b': { messageId: 'message-b' },
  });
  try {
    update(
      c,
      root([
        assignment('a', 1, 'child', 'message'),
        assignment('b', 2, 'child', 'message'),
      ]),
    );
    update(
      c,
      state(
        'child',
        'root',
        [card('child', 8, 'Combined work', ['message-a', 'message-b'])],
        [
          input('message-a', 8, 1, 'agent-message', 'root'),
          input('message-b', 8, 2, 'agent-message', 'root'),
        ],
      ),
    );
    for (const [turn, id] of [
      [1, 'a'],
      [2, 'b'],
    ]) {
      assert.equal(task(c, turn, id)?.attribution, 'shared');
      assert.deepEqual(
        task(c, turn, id).cards.map((x) => x.id),
        ['outcome:8'],
      );
    }
  } finally {
    await c.close();
  }
});

test('legacy send without canonical receipt is unavailable, never copies the newest child task or tests', async () => {
  const c = coordinator();
  const childCard = card('child', 80, 'Unrelated child result', ['some-input']);
  childCard.testRuns = [run('unrelated-test', 'child')];
  try {
    update(c, root([assignment('old-send', 1, 'child', 'message')]));
    update(
      c,
      state('child', 'root', [childCard], [input('some-input', 80, 100)]),
    );
    const subtask = task(c, 1, 'old-send');
    assert.ok(subtask, 'accepted but unbound assignment remains visible');
    assert.equal(subtask.attribution, 'unavailable');
    assert.equal(subtask.status, 'unavailable');
    assert.deepEqual(subtask.cards, []);
    assert.deepEqual(parentCard(c, 1).testRuns, []);
    assert.doesNotMatch(parentCard(c, 1).summary, /Unrelated child result/);
  } finally {
    await c.close();
  }
});

test('upward relays and unrelated sessions are not nested assignments even with matching receipt', async () => {
  const c = coordinator({
    'root:up': { messageId: 'up-input' },
    'root:other': { messageId: 'other-input' },
  });
  try {
    update(
      c,
      root([
        assignment('up', 1, 'ancestor', 'message'),
        assignment('other', 1, 'other', 'message'),
      ]),
    );
    update(
      c,
      state(
        'ancestor',
        null,
        [card('ancestor', 1, 'Ancestor report', ['up-input'])],
        [input('up-input', 1, 1)],
      ),
    );
    update(
      c,
      state(
        'other',
        'another-root',
        [card('other', 1, 'Other report', ['other-input'])],
        [input('other-input', 1, 1)],
      ),
    );
    assert.deepEqual(parentCard(c, 1).subtasks || [], []);
  } finally {
    await c.close();
  }
});

test('pure orchestrator summary updates from only owned child outcomes without claiming verification or using AI', async () => {
  const c = coordinator();
  try {
    update(c, root([assignment('owned', 1, 'child')]));
    update(
      c,
      state(
        'child',
        'root',
        [card('child', 1, 'Located parser ownership boundaries', ['initial'])],
        [input('initial', 1, 1)],
      ),
    );
    assert.match(
      parentCard(c, 1).summary,
      /Located parser ownership boundaries/,
    );
    update(
      c,
      state(
        'child',
        'root',
        [
          card('child', 1, 'Documented durable ownership rules', ['initial']),
          card('child', 2, 'UNRELATED_SECOND_TASK', ['later']),
        ],
        [input('initial', 1, 1), input('later', 2, 9)],
      ),
    );
    const summary = parentCard(c, 1).summary;
    assert.match(summary, /Documented durable ownership rules/);
    assert.doesNotMatch(
      summary,
      /UNRELATED_SECOND_TASK|tests? passed|deployed to production/i,
    );
    assert.equal(parentCard(c, 1).verification.status, 'not-run');
  } finally {
    await c.close();
  }
});

test('pure delegation closing report is useful but unverified and still represents linked child work', async () => {
  const c = coordinator();
  const r = root([assignment('payment', 1, 'child')]);
  r.cards[0]._reportedResult = 'Implemented Stripe as payment method';
  try {
    update(c, r);
    update(
      c,
      state(
        'child',
        'root',
        [card('child', 3, 'Added checkout payment adapter', ['initial'])],
        [input('initial', 3, 1)],
      ),
    );
    const result = parentCard(c, 1);
    assert.match(
      `${result.title} ${result.summary}`,
      /Implemented Stripe as payment method/,
    );
    assert.match(result.summary, /Added checkout payment adapter/);
    assert.doesNotMatch(
      result.summary,
      /behavior summary unavailable|not enough supported context/i,
    );
    assert.equal(result.verification.status, 'not-run');
  } finally {
    await c.close();
  }
});

test('linked child activity distinguishes running and failed outcomes', async () => {
  const c = coordinator();
  try {
    update(c, root([assignment('work', 1, 'child')]));
    const running = {
      ...card('child', 4, 'Working on parser', ['initial']),
      _finalized: false,
    };
    update(c, state('child', 'root', [running], [input('initial', 4, 1)]));
    assert.equal(task(c, 1, 'work')?.status, 'running');
    update(
      c,
      state(
        'child',
        'root',
        [{ ...running, _finalized: true, status: 'failed' }],
        [input('initial', 4, 1)],
      ),
    );
    assert.equal(task(c, 1, 'work')?.status, 'failed');
  } finally {
    await c.close();
  }
});

test('recursive assignment cards preserve source identity and nested ownership', async () => {
  const c = coordinator();
  const nested = {
    ...assignment('nested', 4, 'grandchild'),
    parentSessionId: 'child',
    parentCardId: 'outcome:4',
  };
  try {
    update(c, root([assignment('first', 1, 'child')]));
    update(
      c,
      state(
        'child',
        'root',
        [
          {
            ...card('child', 4, 'Child coordination', ['child-in']),
            _delegatedActivity: true,
          },
        ],
        [input('child-in', 4, 1)],
        [nested],
      ),
    );
    update(
      c,
      state(
        'grandchild',
        'child',
        [card('grandchild', 6, 'Grandchild finding', ['grand-in'])],
        [input('grand-in', 6, 1)],
      ),
    );
    const child = task(c, 1, 'first');
    assert.equal(child?.sessionId, 'child');
    const grand = child.cards[0].subtasks?.find((x) => x.id === 'nested');
    assert.equal(grand?.sessionId, 'grandchild');
    assert.equal(grand.cards[0].id, 'outcome:6');
    assert.match(parentCard(c, 1).summary, /Grandchild finding/);
  } finally {
    await c.close();
  }
});
