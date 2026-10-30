import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, applySummary } from './engine.js';
import {
  ActivityCoordinator,
  SUMMARY_SYSTEM,
  SUMMARY_VERSION,
} from './coordinator.js';
import { ChangeContextService } from './change-context.js';

function scenario() {
  const events = [];
  let state = initState({ id: 'summary-model-fixture', cwd: '/project' });

  const append = (type, data) => {
    const e = { type, data, seq: events.length, time: events.length + 1 };
    events.push(e);
    state = reduceEvent(state, e);
  };

  append('user/message', {
    content: [
      {
        type: 'text',
        text: 'Add a dropdown to select a separate lightweight model for activity summaries without changing the main chat model.',
      },
    ],
  });
  append('turn/start', { turn: 1 });
  append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'edit-1',
    name: 'edit',
    arguments: JSON.stringify({
      file_path: '/project/model-settings.js',
      old_string: 'const summaryModel = chatModel;',
      new_string:
        'const saved = await modelSettings.save({ provider, model });\nconst summaryModel = saved.model;\n// A separate summary route leaves chatModel unchanged.',
    }),
  });
  append('tool/result', {
    turn: 1,
    step: 1,
    message: {
      toolCallId: 'edit-1',
      content: [{ type: 'text', text: 'Updated file' }],
    },
  });
  append('assistant/message', {
    turn: 1,
    message: {
      content: [
        {
          type: 'text',
          text: 'Added independent saved summary-model selection.',
        },
      ],
    },
  });
  append('turn/end', { turn: 1, reason: { kind: 'completed' } });

  const session = {
    id: 'summary-model-fixture',
    header: { cwd: '/project' },
    seq: events.length,
    eventAt: (seq) => events[seq],

    snapshotEvents: (from, to) => {
      assert.ok(
        to <= events.length,
        'exclusive end must not exceed session cursor',
      );

      return events.slice(from, to);
    },

    requestHeader: () => ({
      config: { provider: 'small-provider', model: 'small-model' },
    }),
  };

  return { session, state };
}

const settled = async (c) => {
  for (let i = 0; i < 100; i++) {
    if (!c.running) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw Error('summary did not settle');
};

test('the model receives task and actual before/after behavior, not just filenames', async () => {
  const { session, state } = scenario(),
    context = new ChangeContextService();
  let sent;
  const persisted = new Map();
  const c = new ActivityCoordinator({
    table: {
      entries: () => persisted.entries(),
      put: async (k, v) => persisted.set(k, structuredClone(v)),
    },
    prepareContext: (s, card, signal) => context.prepare(s, card, signal),

    summarize: async (_selection, input) => {
      sent = input;

      return {
        title: 'Independent summary-model selection',
        summary:
          'Added persistent provider/model selection for activity summaries so they no longer have to use the main chat model.',
        supportingChangeIds: [input.changes[0].id],
      };
    },
  });

  c.update(session, state);
  await settled(c);

  assert.equal(
    sent.changes[0].id,
    'change-1',
    'Small models receive short exact citation IDs',
  );
  assert.match(sent.task, /lightweight model/);
  assert.match(sent.changes[0].before, /summaryModel = chatModel/);
  assert.match(sent.changes[0].after, /modelSettings.save/);

  const card = c.snapshot(session.id).sessions[0].cards[0];

  assert.match(card.summary, /no longer have to use the main chat model/);
  assert.equal(card.summarySource, 'changes');
  assert.equal(card.summaryStatus, 'ready');
  assert.equal(card.verification.status, 'not-run');
  assert.ok(
    !/Observed file modifications|Related file modifications|^Inferred:/.test(
      card.summary,
    ),
  );
  // Only coordinates and validated narrative persist; snippets remain bounded transient context.
  assert.equal(
    JSON.stringify([...persisted.values()]).includes('const saved = await'),
    false,
  );

  await c.close();
});

test('no code context never becomes a confident metadata-only summary', async () => {
  const { session, state } = scenario();
  const c = new ActivityCoordinator({
    prepareContext: async () => ({
      input: { changes: [], limitations: ['Historical edits unavailable'] },
    }),
    summarize: async () => assert.fail('Do not spend on a filename-only guess'),
  });

  c.update(session, state);
  await settled(c);

  const card = c.snapshot(session.id).sessions[0].cards[0];

  assert.equal(card.summaryStatus, 'insufficient');
  assert.match(card.title, /unavailable/);
  assert.equal(card.summarySource, 'unavailable');

  await c.close();
});

test('partial titles and invented evidence IDs cannot replace pending narrative', () => {
  const { state } = scenario(),
    card = state.cards[0];

  assert.equal(
    applySummary(card, { title: 'Model settings' }, { changeIds: ['a'] }),
    card,
  );
  assert.equal(
    applySummary(
      card,
      {
        title: 'Added selection',
        summary:
          'Related file modifications observed; expand evidence for affected files.',
        supportingChangeIds: ['a'],
      },
      { changeIds: ['a'] },
    ),
    card,
  );
  assert.equal(
    applySummary(
      card,
      {
        title: 'Added selection',
        summary:
          'Added a separate provider and model setting for activity summaries.',
        supportingChangeIds: ['fiction'],
      },
      { changeIds: ['a'] },
    ),
    card,
  );

  const formatted = applySummary(
    card,
    {
      title: 'Persist the selected summary model',
      summary:
        'Changed `settings:summary-model` to a path-safe storage key so the chosen summary model survives restarts.',
      supportingChangeIds: ['a'],
    },
    { changeIds: ['a'] },
  );

  assert.notEqual(formatted, card);
  assert.ok(!formatted.summary.includes('`'));

  const withRunClaim = applySummary(
    card,
    {
      title: 'Independent summary model',
      summary:
        'Added a separate summary-model dropdown without changing the chat model. 77 tests passed.',
      supportingChangeIds: ['a'],
    },
    { changeIds: ['a'] },
  );

  assert.notEqual(withRunClaim, card);
  assert.ok(!withRunClaim.summary.includes('77'));
  assert.equal(withRunClaim.verification, card.verification);

  const chinese = applySummary(
    card,
    {
      title: '独立摘要模型',
      summary: '支持独立选择摘要模型并保存设置。',
      supportingChangeIds: ['a'],
    },
    { changeIds: ['a'] },
  );

  assert.notEqual(
    chinese,
    card,
    'Useful CJK descriptions need not be 24 English characters long',
  );
  assert.equal(SUMMARY_VERSION, 4);
  assert.match(SUMMARY_SYSTEM, /WHAT BEHAVIOR CHANGED/);
});
