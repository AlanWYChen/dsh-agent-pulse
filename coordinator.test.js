import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityCoordinator,
  generateSummary,
  fingerprint,
} from './coordinator.js';
import { initState, reduceEvent } from './engine.js';

function state(id = 'root', parentSession, origin) {
  let s = initState({ id, parentSession, origin });
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'c',
        name: 'edit',
        arguments: JSON.stringify({
          file_path: 'src/payment.js',
          old_string: 'x',
          new_string: 'export function createStripePayment() {}',
        }),
      },
    },
    {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          toolCallId: 'c',
          content: [{ type: 'text', text: 'Updated file' }],
        },
      },
    },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  events.forEach((e, seq) => {
    s = reduceEvent(s, { ...e, seq, time: seq + 1 });
  });

  return s;
}

const session = (id) => ({
  id,
  requestHeader: () => ({ config: { provider: 'test', model: 'test' } }),
});

function memoryTable() {
  const map = new Map();

  return {
    entries: () => map.entries(),

    put: async (k, v) => {
      assert.match(k, /^[a-zA-Z0-9_-]+$/);

      map.set(k, structuredClone(v));
    },

    delete: async (k) => map.delete(k),
    map,
  };
}

const until = async (condition) => {
  for (let i = 0; i < 50; i++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw Error('Condition did not settle');
};

test('generateSummary sends tools-free metadata and rejects failed stream', async () => {
  let request;
  const llm = {
    async *stream(options) {
      request = options;
      yield {
        type: 'text-delta',
        text: '{"title":"Payment module","summary":"Likely adds Stripe payment handling."}',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };

  const result = await generateSummary(
    llm,
    { provider: 'p', model: 'm' },
    { files: ['payment.js'] },
    new AbortController().signal,
  );

  assert.equal(result.title, 'Payment module');
  assert.deepEqual(request.tools, []);
  assert.equal(request.sessionId, undefined);
  assert.equal(request.messages.length, 1);
  await assert.rejects(
    generateSummary(
      {
        async *stream() {
          yield { type: 'finish', reason: { kind: 'error' } };
        },
      },
      { provider: 'p', model: 'm' },
      {},
      undefined,
    ),
  );
});

test('one summary per finalized evidence fingerprint; persistence restores overlay', async () => {
  const table = memoryTable();
  let calls = 0;
  const coordinator = new ActivityCoordinator({
    table,

    summarize: async () => {
      calls++;

      return {
        title: 'Payment module',
        summary: 'Likely introduces Stripe payment handling.',
      };
    },
  });
  const s = state();

  coordinator.update(session('root'), s);
  await until(() => !coordinator.running);

  assert.equal(calls, 1);

  coordinator.update(session('root'), structuredClone(s));
  await until(() => !coordinator.running);

  assert.equal(calls, 1);
  assert.equal(
    coordinator.snapshot('root').sessions[0].cards[0].summaryStatus,
    'ready',
  );

  await coordinator.close();

  const restored = new ActivityCoordinator({
    table,
    summarize: async () => assert.fail('should use persisted summary'),
  });

  assert.equal(restored.snapshot('root').sessions[0].cached, true);
  assert.equal(
    restored.snapshot('root').sessions[0].cards[0].summaryStatus,
    'ready',
  );

  await restored.close();
});

test('watch wakes on change and cancellation removes listener', async () => {
  const c = new ActivityCoordinator({ enabled: false });
  const controller = new AbortController();
  const wait = c.watch('root', c.revision, controller.signal);

  assert.equal(c.listeners.size, 1);

  controller.abort();
  await wait;

  assert.equal(c.listeners.size, 0);

  const wait2 = c.watch('root', c.revision, new AbortController().signal);

  c.update(session('root'), state());

  const result = await wait2;

  assert.equal(result.sessions.length, 1);
  assert.equal(c.listeners.size, 0);

  await c.close();
});

test('aggregation follows explicit children but not forks or unrelated sessions', async () => {
  const c = new ActivityCoordinator({ enabled: false });

  c.update(session('root'), state());
  c.update(session('child'), state('child', 'root', 'subagent'));
  c.update(session('fork'), state('fork', 'root'));
  c.update(session('other'), state('other'));

  assert.deepEqual(
    c.snapshot('root').sessions.map((s) => s.sessionId),
    ['root', 'child'],
  );

  await c.close();
});

test('model failure retains factual cards and does not retry unchanged evidence', async () => {
  let calls = 0;
  const c = new ActivityCoordinator({
    summarize: async () => {
      calls++;

      throw Error('offline');
    },
  });
  const s = state();

  c.update(session('root'), s);
  await until(() => !c.running);

  assert.equal(
    c.snapshot('root').sessions[0].cards[0].summaryStatus,
    'unavailable',
  );

  c.update(session('root'), structuredClone(s));

  assert.equal(calls, 1);
  assert.equal(
    c.snapshot('root').sessions[0].cards[0].verification.status,
    'not-run',
  );

  await c.close();
});

test('explicit summary selection ignores chat route and policy switch cancels old work', async () => {
  let mode = 'large',
    started = [],
    aborted = false;

  const c = new ActivityCoordinator({
    selectionFor: () => ({ provider: 'p', model: mode }),

    summarize: async (selection, _input, signal) => {
      started.push(selection.model);
      if (selection.model === 'large')
        await new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(Error('aborted'));
            },
            { once: true },
          );
        });

      return {
        title: 'Payment changes',
        summary: 'Likely adds payment handling.',
      };
    },
  });

  c.update(session('root'), state());

  const other = state('child');

  other.cards[0].files = ['other.js'];
  c.update(session('child'), other);
  mode = 'small';
  c.policyChanged();
  await until(() => !c.running);

  assert.equal(aborted, true);
  assert.deepEqual(started, ['large']);
  assert.equal(c.queue.length, 0);

  const next = structuredClone(other);

  next.cards[0].files = ['new.js'];
  c.update(session('child'), next);
  await until(() => !c.running);

  assert.deepEqual(started, ['large', 'small']);

  await c.close();
});

test('summary request uses a supported low effort instead of inheriting max', async () => {
  let options;
  const llm = {
    resolveModelInfo: async () => ({
      reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] },
    }),

    async *stream(request) {
      options = request;
      yield {
        type: 'text-delta',
        text: '{"title":"Payment","summary":"Likely adds payment handling."}',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };

  await generateSummary(
    llm,
    { provider: 'p', model: 'small', reasoningEffort: 'max' },
    {},
    new AbortController().signal,
  );

  assert.equal(options.reasoningEffort, 'low');
  assert.equal(options.maxTokens, 800);
});

test('explicit regeneration retries one completed card without bulk backfill', async () => {
  let calls = 0;
  const c = new ActivityCoordinator({
    summarize: async () => {
      calls++;
      if (calls === 1) throw Error('temporary');

      return {
        title: 'Separate summary model',
        summary:
          'Added independent provider and model selection for activity summaries.',
      };
    },
  });
  const s = state();

  c.update(session('root'), s);
  await until(() => !c.running);

  assert.equal(
    c.snapshot('root').sessions[0].cards[0].summaryStatus,
    'unavailable',
  );
  assert.equal(c.requestSummary(session('root'), 'outcome:1').status, 'queued');

  await until(() => !c.running);

  assert.equal(calls, 2);
  assert.equal(c.snapshot('root').sessions[0].cards[0].summaryStatus, 'ready');
  assert.equal(
    c.requestSummary(session('root'), 'missing').status,
    'unavailable',
  );

  const active = structuredClone(s);

  active.cards[0]._finalized = false;
  c.sessions.set('root', { state: active });

  assert.equal(
    c.requestSummary(session('root'), 'outcome:1').status,
    'in_progress',
  );

  await c.close();
});

test('fingerprint changes after additional observed edits', () => {
  const first = state().cards[0];
  const second = { ...first, files: [...first.files, 'src/checkout.js'] };

  assert.notEqual(fingerprint(first), fingerprint(second));
});
