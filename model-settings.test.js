import test from 'node:test';
import assert from 'node:assert/strict';
import { SummaryModelSettings, modelToolDefinition } from './model-settings.js';

const signal = () => new AbortController().signal;

function setup(overrides = {}) {
  const values = new Map();
  const table = {
    get: (k) => values.get(k),

    put: async (k, v) => {
      assert.match(k, /^[a-zA-Z0-9_-]+$/);

      values.set(k, structuredClone(v));
    },
  };
  const llm = {
    listProviders: () => [{ id: 'p', name: 'Provider' }],
    listModels: async () => [
      { id: 'small', name: 'Small model' },
      { id: 'large', name: 'Large model' },
    ],
  };
  let changed = 0;
  const settings = new SummaryModelSettings({
    table,
    llm,
    config: { summaries: true },
    onChanged: () => changed++,
    ...overrides,
  });

  return { settings, table, llm, values, changed: () => changed };
}

test('explicit follow mode preserves existing default; configured override is separate', () => {
  const { settings } = setup();

  assert.deepEqual(settings.get().selection, { mode: 'follow' });
  assert.deepEqual(
    settings.resolve({
      provider: 'chat',
      model: 'big',
      reasoningEffort: 'max',
    }),
    { provider: 'chat', model: 'big' },
  );

  const custom = setup({
    config: { summaries: true, summaryProvider: 'p', summaryModel: 'small' },
  }).settings;

  assert.deepEqual(custom.resolve({ provider: 'chat', model: 'big' }), {
    provider: 'p',
    model: 'small',
  });
});

test('list enumerates actual catalog without making inference requests', async () => {
  const { settings } = setup();

  const result = await settings.execute({ action: 'list' }, signal());

  assert.equal(result.scope, 'profile');
  assert.equal(result.providers[0].models[0].id, 'small');
});

test('tool and UI share one validated persisted selection operation', async () => {
  const { settings, table, llm, changed } = setup();
  const tool = modelToolDefinition(settings);

  const saved = await tool.execute(
    { action: 'set', mode: 'model', provider: 'p', model: 'small' },
    { signal: signal() },
  );

  assert.equal(saved.selection.model, 'small');
  assert.equal(changed(), 1);
  assert.deepEqual(
    (await settings.execute({ action: 'get' }, signal())).selection,
    saved.selection,
  );
  assert.deepEqual(
    new SummaryModelSettings({ table, llm, config: { summaries: true } }).get()
      .selection,
    saved.selection,
  );
  assert.deepEqual(settings.resolve({ provider: 'chat', model: 'big' }), {
    provider: 'p',
    model: 'small',
  });
});

test('unavailable explicit routes are rejected without silently following chat', async () => {
  const { settings, llm } = setup();

  await settings.execute(
    { action: 'set', mode: 'model', provider: 'p', model: 'small' },
    signal(),
  );

  await assert.rejects(
    settings.execute(
      { action: 'set', mode: 'model', provider: 'missing', model: 'small' },
      signal(),
    ),
  );
  await assert.rejects(
    settings.execute(
      { action: 'set', mode: 'model', provider: 'p', model: 'missing' },
      signal(),
    ),
  );

  llm.listProviders = () => [];

  assert.deepEqual(settings.resolve({ provider: 'chat', model: 'big' }), {
    provider: 'p',
    model: 'small',
  });
});

test('off disables model calls but not factual evidence; plugin config cannot be bypassed', async () => {
  const { settings } = setup();

  await settings.execute({ action: 'set', mode: 'off' }, signal());

  assert.equal(settings.resolve({ provider: 'p', model: 'large' }), null);
  assert.equal(
    setup({
      config: { summaries: false, summaryProvider: 'p', summaryModel: 'small' },
    }).settings.resolve({ provider: 'chat', model: 'big' }),
    null,
  );
});

test('invalid pairing and failed persistence preserve previous setting', async () => {
  const { settings, table } = setup();

  await assert.rejects(
    settings.execute(
      { action: 'set', mode: 'model', model: 'small' },
      signal(),
    ),
  );
  await assert.rejects(
    settings.execute(
      { action: 'set', mode: 'follow', provider: 'p', model: 'small' },
      signal(),
    ),
  );

  table.put = async () => {
    throw new Error('Disk unavailable');
  };

  await assert.rejects(
    settings.execute({ action: 'set', mode: 'off' }, signal()),
  );
  assert.equal(settings.get().selection.mode, 'follow');
});

test('concurrent changes serialize and cancelled selections do not commit', async () => {
  const { settings } = setup();

  await Promise.all([
    settings.execute(
      { action: 'set', mode: 'model', provider: 'p', model: 'small' },
      signal(),
    ),
    settings.execute({ action: 'set', mode: 'off' }, signal()),
  ]);

  assert.equal(settings.get().selection.mode, 'off');

  const controller = new AbortController();

  controller.abort();

  await assert.rejects(
    settings.execute({ action: 'set', mode: 'follow' }, controller.signal),
  );
  assert.equal(settings.get().selection.mode, 'off');
});

test('provider failures produce concise errors rather than leaked provider diagnostics', async () => {
  const { settings, llm } = setup();

  llm.listModels = async () => {
    throw new Error('private provider stack');
  };

  assert.equal(
    JSON.stringify(
      await settings.execute({ action: 'list' }, signal()),
    ).includes('private provider stack'),
    false,
  );
  await assert.rejects(
    settings.execute(
      { action: 'set', mode: 'model', provider: 'p', model: 'small' },
      signal(),
    ),
    /catalog is unavailable/,
  );
});
