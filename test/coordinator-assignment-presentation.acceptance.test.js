import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const card = (id, turn, report, ids = []) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: report,
  summary: report,
  status: 'observed',
  time: 1,
  agentId: id,
  evidence: [],
  files: [],
  testRuns: [],
  verification: { status: 'not-run', label: 'No verification observed' },
  _turn: turn,
  _finalized: true,
  ...(report ? { _reportedResult: report } : {}),
  inputMessageIds: ids,
});
const session = {
  id: 'root',
  requestHeader: () => ({ provider: 'p', model: 'm' }),
};
function setup(label = 'Delegated follow-up', enabled = false) {
  let modelCalls = 0;
  const c = new ActivityCoordinator({
    enabled,
    assignmentBindingFor: () => ({ messageId: 'current-input' }),
    summarize: async () => {
      modelCalls++;
      throw new Error('Delegation-only summaries must not use a model');
    },
  });
  const root = {
    ...initState({ id: 'root' }),
    cards: [{ ...card('root', 2, ''), _delegatedActivity: true }],
    assignments: [
      {
        id: 'followup',
        parentSessionId: 'root',
        parentCardId: 'outcome:2',
        parentTurn: 2,
        callSeq: 8,
        childSessionId: 'child',
        label,
        kind: 'message',
        status: 'accepted',
      },
    ],
  };
  c.update(session, root);
  function child(report) {
    c.update(
      { id: 'child' },
      {
        ...initState({
          id: 'child',
          origin: 'subagent',
          parentSession: 'root',
        }),
        taskLabel: 'Initial database research',
        cards: [
          card('child', 1, 'Old schema inventory', ['old-input']),
          card('child', 9, report, ['current-input']),
        ],
        inputs: [
          { id: 'old-input', turn: 1, seq: 1, source: { kind: 'user' } },
          {
            id: 'current-input',
            turn: 9,
            seq: 9,
            source: {
              kind: 'agent-message',
              form: 'relay',
              senderSessionId: 'root',
            },
          },
        ],
      },
    );
  }
  child('Implemented Stripe checkout');
  return {
    c,
    child,
    get modelCalls() {
      return modelCalls;
    },
    parent() {
      return c.snapshot('root').sessions.find((s) => s.sessionId === 'root')
        .cards[0];
    },
  };
}

test('Refresh summary reports deterministic delegated synthesis with no AI request and keeps linked work live', async () => {
  const f = setup('Delegated follow-up', true);
  try {
    const result = f.c.requestSummary(session, 'outcome:2');
    assert.ok(
      ['reported', 'ready'].includes(result.status),
      `expected deterministic refresh, got ${result.status}`,
    );
    assert.equal(f.modelCalls, 0);
    assert.match(f.parent().summary, /Implemented Stripe checkout/);
    f.child('Added Stripe webhook validation');
    assert.match(f.parent().summary, /Added Stripe webhook validation/);
    assert.equal(f.modelCalls, 0);
    assert.equal(f.parent().verification.status, 'not-run');
  } finally {
    await f.c.close();
  }
});

test('generic reused-child followup caption describes the current child task, not its initial agent descriptor', async () => {
  const f = setup();
  try {
    const subtask = f.parent().subtasks.find((item) => item.id === 'followup');
    assert.match(subtask.label, /Implemented Stripe checkout/);
    assert.doesNotMatch(
      subtask.label,
      /Initial database research|Old schema inventory/,
    );
    assert.ok(subtask.label.length <= 100);
  } finally {
    await f.c.close();
  }
});

test('an explicit assignment caption stays intact instead of being replaced by child report text', async () => {
  const f = setup('Review payment integration');
  try {
    assert.equal(f.parent().subtasks[0].label, 'Review payment integration');
  } finally {
    await f.c.close();
  }
});

test('derived generic caption redacts and bounds current task report rather than exposing secrets', async () => {
  const f = setup();
  try {
    f.child(
      `Implemented payment flow password=caption-secret ${'details '.repeat(50)}`,
    );
    const label = f.parent().subtasks[0].label;
    assert.match(label, /Implemented payment flow/);
    assert.doesNotMatch(label, /caption-secret/);
    assert.ok(label.length <= 100);
  } finally {
    await f.c.close();
  }
});
