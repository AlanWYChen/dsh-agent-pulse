import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent } from './engine.js';
import { ActivityCoordinator, fingerprint } from './coordinator.js';

function child(events = []) {
  let state = initState({
    id: 'child',
    origin: 'subagent',
    parentSession: 'root',
  });
  [
    {
      type: 'subagent/descriptor',
      data: { label: 'Inspect native settings APIs' },
    },
    ...events,
  ].forEach((event, seq) => {
    state = reduceEvent(state, { ...event, seq });
  });
  return state;
}
const report = (text) => ({
  type: 'assistant/message',
  data: { turn: 1, message: { content: [{ type: 'text', text }] } },
});
const end = {
  type: 'turn/end',
  data: { turn: 1, reason: { kind: 'completed' } },
};
const session = {
  id: 'child',
  requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
};

test('research-only child reports produce useful outcomes without model usage', async () => {
  let calls = 0;
  const coordinator = new ActivityCoordinator({
    summarize: async () => {
      calls++;
    },
  });
  const state = child([
    report('Found the native model selection API; no source files changed.'),
    end,
  ]);
  coordinator.update(session, state);
  const [card] = coordinator.snapshot('root').sessions[0].cards;
  assert.equal(card.title, 'Inspect native settings APIs');
  assert.match(card.summary, /Agent report \(unverified\): Found/);
  assert.equal(card.summarySource, 'agent-report');
  assert.equal(card.summaryStatus, 'reported');
  assert.equal(card.verification.status, 'not-run');
  assert.deepEqual(card.files, []);
  assert.equal(calls, 0);
  await coordinator.close();
});

test('native result fallback preserves model failure diagnostics and verification', async () => {
  const coordinator = new ActivityCoordinator({ enabled: false });
  const state = child([report('Located a read-only API.'), end]);
  const card = state.cards[0];
  coordinator.update(session, state);
  coordinator.summaries.set(fingerprint(card), {
    status: 'failed',
    rejectionReason: 'test-failure',
  });
  coordinator.enabled = true;
  const output = coordinator.snapshot('root').sessions[0].cards[0];
  assert.equal(output.behaviorSummaryStatus, 'failed');
  assert.equal(output.summaryIssue, 'test-failure');
  assert.equal(output.summaryStatus, 'reported');
  assert.deepEqual(output.verification, card.verification);
  await coordinator.close();
});

test('native previews redact secrets before bounding, omit prompts/tools, and stay child-only', () => {
  const sensitive =
    'password=super-secret sk-proj-abcdefghijklmnop https://user:pass@example.com ';
  const state = child([
    { type: 'user/message', data: { content: 'PRIVATE PROMPT' } },
    report(`${sensitive}${'research finding '.repeat(200)}`),
    end,
  ]);
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(
    serialized,
    /super-secret|abcdefghijklmnop|user:pass|PRIVATE PROMPT/,
  );
  assert.ok(state.cards[0]._reportedResult.length <= 600);
  assert.match(serialized, /REDACTED/);
  const root = reduceEvent(initState({ id: 'root' }), {
    ...report('private root response'),
    seq: 0,
  });
  assert.equal(root.cards.length, 0);
});

test('native task label is useful while running before a report arrives', async () => {
  const coordinator = new ActivityCoordinator({ enabled: false });
  const state = child([{ type: 'turn/start', data: { turn: 1 } }]);
  coordinator.update(session, state);
  const [card] = coordinator.snapshot('root').sessions[0].cards;
  assert.equal(card.title, 'Inspect native settings APIs');
  assert.match(card.summary, /No closing result/);
  assert.equal(card.summaryStatus, 'in_progress');
  await coordinator.close();
});

test('latest native report replaces earlier preview and remains useful while running', async () => {
  const coordinator = new ActivityCoordinator({ enabled: false });
  const state = child([report('First draft.'), report('Final API findings.')]);
  coordinator.update(session, state);
  const [card] = coordinator.snapshot('root').sessions[0].cards;
  assert.match(card.summary, /Final API findings/);
  assert.doesNotMatch(card.summary, /First draft/);
  assert.equal(card.summaryStatus, 'in_progress');
  await coordinator.close();
});
