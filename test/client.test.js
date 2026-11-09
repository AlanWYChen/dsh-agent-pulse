import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function setup(rpc = () => new Promise(() => {}), locale) {
  let definition;
  const effects = [],
    registrations = [],
    types = [],
    opens = [],
    calls = [],
    stateWrites = [];
  let dictionaries;
  let stateIndex = 0,
    refIndex = 0;
  const states = [],
    refs = [];
  let hookScope = null;
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    Fragment: 'fragment',

    useState: (initial) => {
      const scope = hookScope;
      const values = scope ? scope.states : states;
      const index = scope ? scope.stateIndex++ : stateIndex++;
      if (!(index in values))
        values[index] = typeof initial === 'function' ? initial() : initial;

      return [
        values[index],
        (value) => {
          stateWrites.push({ index, value });
          values[index] =
            typeof value === 'function' ? value(values[index]) : value;
        },
      ];
    },

    useRef: (initial) => {
      const values = hookScope ? hookScope.refs : refs;
      const index = hookScope ? hookScope.refIndex++ : refIndex++;

      return (values[index] ||= { current: initial });
    },

    useEffect: (fn, deps) => {
      if (!hookScope) {
        effects.push(fn);

        return;
      }

      const scope = hookScope,
        index = scope.effectIndex++;
      const old = scope.effects[index];
      if (
        !old ||
        !deps ||
        deps.some((value, i) => !Object.is(value, old.deps[i]))
      ) {
        scope.pending.push(() => {
          old?.cleanup?.();
          scope.effects[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'),
    {
      window: {
        __ModuleLoader__: {
          load: (value) => {
            definition = value;
          },
        },
      },
      AbortController,
      URL,
    },
  );

  const plugin = definition.factory((name) => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { TextShimmer: 'DeepSeekTextShimmer' };
    }
    assert.equal(name, 'react');

    return React;
  });
  const disposers = [];
  const declaredSlots = new Set([
    'sidebar.right.tab.document',
    'sidebar.right.tab.document.actions',
  ]);
  const ctx = {
    effect: (fn) => {
      const cleanup = fn();
      if (cleanup) disposers.push(cleanup);
    },

    locale: {
      register: (_namespace, value) => {
        dictionaries = value;

        return () => {};
      },

      bind: () => (key) => dictionaries[locale]?.[key] || key,
    },
    sidebarRightTabs: {
      register: (value) => {
        types.push(value);

        return () => {};
      },
    },
    sidebarRight: {
      openTab: (kind) => opens.push(kind),
      openResource: (address, options) => opens.push({ address, options }),
    },
    slots: {
      inject: (_, fn) => fn(),

      register: (options, Component) => {
        for (const key of Object.keys(options.children || {})) {
          if (declaredSlots.has(key))
            throw new Error(`slot "${key}" is already declared`);
        }
        for (const key of Object.keys(options.children || {}))
          declaredSlots.add(key);
        if (options.inject !== undefined)
          assert.equal(
            typeof options.inject,
            'function',
            'Slot inject must be a factory, not a props object',
          );
        registrations.push({ options, Component });

        return () => {};
      },
    },
    connection: {
      rpc: {
        call: (...args) => {
          calls.push(args);

          return rpc(...args);
        },
      },
    },
  };
  plugin.apply(ctx);

  const body = registrations.find(
    (row) =>
      row.options.name === 'sidebar.right.pane.tab' &&
      row.options.key === '@local/dsh-agent-activity-intelligence',
  );

  const render = (overrides = {}) =>
    body.Component({
      sessionId: 'root',
      useProjection: () => ({ cards: [] }),
      useSessions: (selector) =>
        selector({ projectionsBySession: {}, byId: {} }),
      useTabInfo: () => ({ tab: { visible: true } }),
      ...body.options.inject('root', {}),
      t: (key) => key,
      ...overrides,
    });

  const settings = registrations.find(
    (row) =>
      row.options.name === 'settings.section' &&
      row.options.id === '@local/dsh-agent-activity-intelligence',
  );
  const renderSettings = (overrides = {}) =>
    settings.Component({
      ...settings.options.inject(),
      t: ctx.locale.bind(),
      ...overrides,
    });

  let picker;

  const renderPicker = (overrides = {}) => {
    // Settings children are rendered separately, just as React gives each component its own hooks.
    if (!picker) {
      picker = visit(
        renderSettings(),
        (node) => typeof node.type === 'function' && node.props.modelRpc,
      )[0];
      states.length = 0;
      refs.length = 0;
    }
    stateIndex = 0;
    refIndex = 0;
    effects.length = 0;

    return picker.type({ ...picker.props, ...overrides });
  };
  // Each Card instance owns hook state and dependency-aware effect cleanup. Rerender
  // explicitly after async updates, matching React's closure/state/ref contract.

  const mountCard = (card, overrides = {}) => {
    const element = visit(
      render({ useProjection: () => ({ cards: [card] }) }),
      (node) => typeof node.type === 'function' && node.props.card,
    )[0];
    return mountElement(element, overrides);
  };

  const mountElement = (element, overrides = {}) => {
    const scope = { states: [], refs: [], effects: [], pending: [] };
    let props = { ...element.props, ...overrides };

    return {
      render(next = {}) {
        props = { ...props, ...next };
        scope.stateIndex = scope.refIndex = scope.effectIndex = 0;
        hookScope = scope;

        let tree;
        try {
          tree = element.type(props);
        } finally {
          hookScope = null;
        }
        scope.pending.splice(0).forEach((effect) => effect());

        return tree;
      },

      unmount() {
        scope.effects.forEach((effect) => effect.cleanup?.());
      },
    };
  };

  const renderPanel = (overrides = {}) => {
    stateIndex = refIndex = 0;
    effects.length = 0;

    return render(overrides);
  };

  return {
    definition,
    slots: ctx.slots,
    plugin,
    registrations,
    types,
    opens,
    calls,
    effects,
    stateWrites,
    render,
    renderPanel,
    renderSettings,
    renderPicker,
    mountCard,
    dictionaries,
  };
}

function visit(node, predicate, result = []) {
  if (node == null || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((item) => visit(item, predicate, result));

    return result;
  }
  if (predicate(node)) result.push(node);
  visit(node.children, predicate, result);

  return result;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const modelValue = (selection = { mode: 'follow' }) => ({
  selection,
  scope: 'profile',
  summariesEnabled: true,
});

const catalog = [
  {
    id: 'configured',
    name: 'Configured provider',
    models: [{ id: 'small', name: 'Small model' }],
  },
];

const dropdown = (tree) => visit(tree, (node) => node.type === 'select')[0];

const text = (node) =>
  node == null || node === false
    ? ''
    : typeof node === 'object'
      ? (Array.isArray(node) ? node : node.children || []).map(text).join('')
      : String(node);

const fileButton = (tree, label) =>
  visit(tree, (node) => node.type === 'button' && text(node) === label)[0];

const diffCard = (overrides = {}) => ({
  id: 'card-edit',
  category: 'outcome',
  title: 'Preserves the selected model after failed saves',
  summary: 'Settings now retain the last acknowledged choice.',
  summaryStatus: 'ready',
  summarySource: 'changes',
  changeFiles: [
    { id: 'file-a', label: 'src/client.js' },
    { id: 'file-b', label: 'test/client.js' },
  ],
  files: ['src/client.js', 'legacy.js'],
  evidence: [{ seq: 1234, label: 'successful edit' }],
  ...overrides,
});

const diffValue = (overrides = {}) => ({
  ok: true,
  value: {
    status: 'available',
    file: 'src/client.js',
    kind: 'edit',
    lines: [
      { kind: 'context', text: 'unchanged' },
      { kind: 'remove', text: 'before <script>' },
      { kind: 'add', text: 'after & safe' },
    ],
    truncated: false,
    notice: '',
    ...overrides,
  },
});

test('working cards use DeepSeek TextShimmer for status text and ellipsis beside the whale tail', () => {
  const s = setup();
  const mounted = s.mountCard(
    diffCard({
      title: 'Agent still working',
      summaryStatus: 'in_progress',
      summarySource: 'unavailable',
    }),
  );
  const tree = mounted.render();
  const indicator = visit(
    tree,
    (node) => node.props.className === 'aai-working',
  )[0];

  assert.equal(indicator.props.role, 'status');
  assert.equal(indicator.props['aria-label'], 'agentWorking');
  assert.equal(
    visit(indicator, (node) => node.props.className === 'aai-whale-tail')
      .length,
    1,
  );
  assert.equal(
    visit(indicator, (node) => node.props.className === 'aai-working-dot')
      .length,
    0,
  );
  assert.equal(
    text(visit(tree, (node) => node.type === 'h3')),
    'agentWorking...',
  );
  assert.equal(
    text(
      visit(indicator, (node) => node.props.className === 'aai-working-label'),
    ),
    'agentWorking...',
  );
  const shimmer = visit(
    indicator,
    (node) => node.type === 'DeepSeekTextShimmer',
  );
  assert.equal(shimmer.length, 1);
  assert.equal(shimmer[0].props.active, true);
  assert.equal(shimmer[0].props.className, 'aai-working-label');
  assert.equal(
    visit(indicator, (node) => node.type === 'svg')[0].props['aria-hidden'],
    true,
  );

  const completed = mounted.render({
    card: diffCard({
      title: 'Added independent model selection',
      summaryStatus: 'ready',
    }),
  });

  assert.equal(
    visit(completed, (node) => node.props.className === 'aai-working').length,
    0,
  );
  assert.equal(
    text(visit(completed, (node) => node.type === 'h3')),
    'Added independent model selection',
  );
});

test('tail respects reduced motion and native shimmer replaces custom dot CSS', () => {
  const s = setup();
  const style = text(visit(s.renderPanel(), (node) => node.type === 'style'));

  assert.match(style, /@keyframes aai-tail-wiggle/);
  assert.doesNotMatch(style, /aai-dot-pulse|aai-working-dot/);
  assert.match(style, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(style, /\.aai-whale-tail\{animation:none\}/);
  assert.equal(s.dictionaries.en.agentWorking, 'Agent is still working');
  assert.equal(s.dictionaries.zh.agentWorking, '智能体正在工作');
});

const plain = (value) => JSON.parse(JSON.stringify(value));

test('file clicks resolve opaque IDs then open built-in Review without a modal', async () => {
  const s = setup(() =>
    Promise.resolve(
      diffValue({
        nativeReview: {
          sessionId: 'child /session',
          seq: 34,
          turn: 2,
          index: 5,
        },
      }),
    ),
  );
  const card = s.mountCard(diffCard(), { sessionId: 'child /session' });
  const tree = card.render();
  assert.equal(visit(tree, (node) => node.type === 'dialog').length, 0);
  await fileButton(tree, 'src/client.js').props.onClick();
  assert.equal(s.calls[0][0], '/api');
  assert.equal(s.calls[0][1], 'agentActivityIntelligence.diff');
  assert.deepEqual(plain(s.calls[0][2]), {
    sessionId: 'child /session',
    cardId: 'card-edit',
    fileId: 'file-a',
  });
  assert.deepEqual(plain(s.opens), [
    {
      address: 'dsh-resource://changes-review/session/child%20%2Fsession/34/2',
      options: { params: { index: 5 } },
    },
  ]);
  card.unmount();
});

test('malformed or cross-session Review pointers show explicit failure without fallback navigation', async () => {
  for (const nativeReview of [
    false,
    '',
    {},
    { sessionId: 'root', seq: -1, turn: 1, index: 0 },
    { sessionId: 'bad\0session', seq: 1, turn: 1, index: 0 },
    { sessionId: 'root', seq: 1, turn: 1, index: 0.5 },
    { sessionId: 'root', seq: '1', turn: 1, index: 0 },
    { sessionId: 'root', seq: 1, turn: NaN, index: 0 },
    { sessionId: 'root', seq: 1, turn: 1, index: Number.MAX_SAFE_INTEGER + 1 },
    { sessionId: 'other-session', seq: 1, turn: 1, index: 0 },
  ]) {
    const s = setup(() => Promise.resolve(diffValue({ nativeReview })));
    const card = s.mountCard(diffCard());
    await fileButton(card.render(), 'src/client.js').props.onClick();
    assert.equal(s.opens.length, 0, 'never open a custom fallback resource');
    assert.equal(
      text(visit(card.render(), (node) => node.props.role === 'alert')),
      'reviewUnavailable',
    );
    card.unmount();
  }
});

test('openDiff rejects unavailable recorded evidence instead of navigating to a custom address', async () => {
  const s = setup(() =>
    Promise.resolve(diffValue({ status: 'unavailable', lines: [] })),
  );
  const body = s.registrations.find(
    (row) =>
      row.options.key === s.definition.id &&
      row.options.name === 'sidebar.right.pane.tab',
  );
  const { openDiff } = body.options.inject();
  await assert.rejects(
    openDiff({
      sourceSessionId: 'root',
      cardId: 'card-edit',
      fileId: 'file-a',
      label: 'package.json',
    }),
    /reviewUnavailable/,
  );
  assert.equal(s.opens.length, 0);
});

test('custom activity diff viewer is not registered', () => {
  const s = setup();
  assert.equal(
    s.types.some((type) => type.kind === 'agent-activity-diff'),
    false,
  );
  assert.equal(
    s.types.some((type) => type.id === s.definition.id + '/diff'),
    false,
  );
});

test('debug details are off by default and expose only collapsed technical trace when explicitly enabled', () => {
  const s = setup();
  const overrides = { useProjection: () => ({ cards: [diffCard()] }) };
  let panel = s.renderPanel(overrides);
  const check = visit(
    panel,
    (node) => node.type === 'input' && node.props.type === 'checkbox',
  )[0];

  assert.equal(check.props.checked, false);
  assert.match(
    text(visit(panel, (node) => node.type === 'label')),
    /debugDetails/,
  );
  assert.equal(
    visit(
      panel,
      (node) => typeof node.type === 'function' && node.props.card,
    )[0].props.debug,
    false,
  );

  const card = s.mountCard(diffCard());

  assert.doesNotMatch(
    text(card.render()),
    /technicalTrace|#1234|successful edit/,
  );

  check.props.onChange({ target: { checked: true } });
  panel = s.renderPanel(overrides);

  assert.equal(
    visit(
      panel,
      (node) => typeof node.type === 'function' && node.props.card,
    )[0].props.debug,
    true,
  );

  const debug = card.render({ debug: true });
  const trace = visit(debug, (node) => node.props.className === 'aai-trace')[0];

  assert.ok(trace);
  assert.equal(trace.props.open, undefined);
  assert.match(text(trace), /technicalTrace \(1\).*#1234.*successful edit/);
  assert.doesNotMatch(
    text(card.render({ debug: false })),
    /technicalTrace|#1234|successful edit/,
  );
  assert.equal(s.calls.length, 0, 'debug toggle is local view state only');

  card.unmount();
});

test('new change and diff labels are localized and clarify AI summaries are based on recorded edits', () => {
  const { dictionaries } = setup();

  for (const key of [
    'changes',
    'technicalTrace',
    'changeBased',
    'metadataBased',
    'summaryFailed',
    'insufficient',
    'diffLoading',
    'diffError',
    'diffUnavailable',
    'reviewUnavailable',
    'diffRedacted',
    'before',
    'after',
    'context',
    'truncated',
    'noLines',
    'closeDiff',
    'unifiedDiff',
    'debugDetails',
    'generateSummary',
    'refreshSummary',
    'summaryUsage',
    'summaryRequestError',
    'summaryBusy',
    'summaryDisabled',
    'summaryReady',
  ]) {
    assert.ok(dictionaries.en[key]);
    assert.ok(dictionaries.zh[key]);
    assert.notEqual(dictionaries.en[key], dictionaries.zh[key]);
  }
  assert.match(dictionaries.en.changeBased, /AI.*recorded changes/);
  assert.equal(
    dictionaries.en.reviewUnavailable,
    'No recorded Review is available for this change',
  );
});

test('explicit summary action calls exact injected RPC once and waits for watched narrative, never auto-generates', async () => {
  let finish;
  const s = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const card = s.mountCard(
    diffCard({ summaryStatus: 'unavailable', summary: undefined }),
  );
  let tree = card.render();

  assert.equal(s.calls.length, 0);

  const button = fileButton(tree, 'generateSummary');

  assert.equal(button.props.title, 'summaryUsage');

  const first = button.props.onClick();

  button.props.onClick();

  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0], '/api');
  assert.equal(s.calls[0][1], 'agentActivityIntelligence.summarize');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0][2])), {
    sessionId: 'root',
    cardId: 'card-edit',
  });
  assert.equal(s.calls[0][3].aborted, false);
  assert.equal(
    fileButton(card.render(), 'generateSummary').props.disabled,
    true,
  );

  finish({ ok: true, value: { status: 'queued' } });
  await first;
  tree = card.render();

  assert.equal(fileButton(tree, 'generateSummary').props.disabled, true);
  assert.match(text(tree), /pending/);
  assert.doesNotMatch(text(tree), /Settings now retain/);

  tree = card.render({ card: diffCard() });

  assert.equal(fileButton(tree, 'refreshSummary').props.disabled, false);
  assert.match(text(tree), /Settings now retain/);

  card.unmount();
});

test('summary action shows disabled/busy/unavailable reasons and errors and respects host pending state', async () => {
  for (const value of [
    { status: 'disabled', reason: 'Off for this profile' },
    { status: 'busy', reason: 'Queue full' },
    { status: 'unavailable', reason: 'No recorded changes' },
  ]) {
    const s = setup(() => Promise.resolve({ ok: true, value }));
    const card = s.mountCard(diffCard());

    await fileButton(card.render(), 'refreshSummary').props.onClick();

    assert.match(text(card.render()), new RegExp(value.reason));
    assert.equal(
      fileButton(card.render(), 'refreshSummary').props.disabled,
      false,
    );

    card.unmount();
  }
  for (const response of [
    () =>
      Promise.resolve({ ok: false, error: { message: 'Provider offline' } }),
    () => Promise.reject(new Error('Disconnected')),
    () => Promise.resolve({ ok: true }),
  ]) {
    const s = setup(response),
      card = s.mountCard(diffCard());

    await fileButton(card.render(), 'refreshSummary').props.onClick();

    assert.match(
      text(visit(card.render(), (node) => node.props.role === 'alert')),
      /summaryRequestError/,
    );

    card.unmount();
  }

  const s = setup(),
    card = s.mountCard(diffCard({ summaryStatus: 'pending' }));
  const button = fileButton(card.render(), 'generateSummary');

  assert.equal(button.props.disabled, true);

  await button.props.onClick();

  assert.equal(s.calls.length, 0);

  card.unmount();
});

test('summary requests abort on card change and unmount and ignore late responses', async () => {
  let finish;
  const s = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const card = s.mountCard(diffCard());
  const pending = fileButton(card.render(), 'refreshSummary').props.onClick();

  card.render({ card: diffCard({ id: 'new-card' }) });

  assert.equal(s.calls[0][3].aborted, true);

  const writes = s.stateWrites.length;

  finish({ ok: true, value: { status: 'queued' } });
  await pending;

  assert.equal(s.stateWrites.length, writes);

  const next = fileButton(card.render(), 'refreshSummary').props.onClick();

  card.unmount();

  assert.equal(s.calls[1][3].aborted, true);

  finish({ ok: true, value: { status: 'queued' } });
  await next;
});

test('Settings receives model RPC while Panel retains watch and diff without a model picker', async () => {
  const s = setup(() => Promise.resolve({ ok: true, value: modelValue() }));
  const body = s.registrations.find(
    (row) =>
      row.options.name === 'sidebar.right.pane.tab' &&
      row.options.key === '@local/dsh-agent-activity-intelligence',
  );

  assert.equal(typeof body.options.inject, 'function');

  const props = body.options.inject();

  assert.equal(typeof props.watch, 'function');
  assert.equal(props.modelRpc, undefined);
  assert.equal(typeof props.diffRpc, 'function');
  assert.equal(
    visit(
      s.renderPanel(),
      (node) => typeof node.type === 'function' && node.props.modelRpc,
    ).length,
    0,
  );

  const settings = s.registrations.find(
    (row) => row.options.name === 'settings.section',
  );
  assert.equal(typeof settings.options.inject, 'function');
  const settingsProps = settings.options.inject();
  assert.equal(typeof settingsProps.modelRpc, 'function');
  const picker = visit(
    s.renderSettings(),
    (node) => typeof node.type === 'function' && node.props.modelRpc,
  )[0];
  assert.equal(picker.props.modelRpc, settingsProps.modelRpc);
  assert.equal(picker.props.visible, true);

  const controller = new AbortController();

  for (const action of ['get', 'list', 'set'])
    await settingsProps.modelRpc({ action }, controller.signal);

  assert.deepEqual(
    s.calls.map((call) => [
      call[0],
      call[1],
      call[2].action,
      call[3] === controller.signal,
    ]),
    ['get', 'list', 'set'].map((action) => [
      '/api',
      'agentActivityIntelligence.model',
      action,
      true,
    ]),
  );
});

test('native Settings navigation label is localized and Panel has no model or effort controls', () => {
  for (const [locale, label, navLabel] of [
    ['en', 'Activity summaries', 'Summaries'],
    ['zh', '动态摘要', '摘要'],
  ]) {
    const s = setup(undefined, locale);
    const settings = s.registrations.find(
      (row) => row.options.name === 'settings.section',
    );
    assert.equal(settings.options.id, '@local/dsh-agent-activity-intelligence');
    assert.equal(settings.options.locale, 'agentActivityIntelligence');
    assert.equal(typeof settings.options.label, 'function');
    assert.equal(settings.options.label(), navLabel);
    const tree = s.renderSettings();
    assert.equal(tree.props['aria-label'], label);
    assert.equal(text(visit(tree, (node) => node.type === 'h2')[0]), label);

    const panel = s.renderPanel({
      t: (key) => s.dictionaries[locale][key] || key,
    });
    assert.equal(
      visit(
        panel,
        (node) =>
          node.type === 'select' ||
          (typeof node.type === 'function' && node.type.name === 'ModelPicker'),
      ).length,
      0,
    );
    assert.doesNotMatch(
      text(panel),
      /summaryModel|effort|Summary model|Effort|摘要模型|推理强度/,
    );
    assert.equal(s.calls.length, 0);
  }
});

test('summary Settings uses a scoped card layout, aligned controls and responsive rows', () => {
  const s = setup();
  const tree = s.renderSettings();
  const card = visit(
    tree,
    (node) => node.props.className === 'aai-settings-card',
  )[0];
  assert.ok(card);
  assert.equal(
    text(visit(card, (node) => node.type === 'h3')[0]),
    'summaryGeneration',
  );
  const style = text(visit(tree, (node) => node.type === 'style')[0]);
  assert.match(
    style,
    /grid-template-columns:minmax\(0,1fr\) minmax\(180px,270px\)/,
  );
  assert.match(style, /@media\(max-width:640px\)/);
  assert.match(style, /:focus-visible/);
  assert.doesNotMatch(style, /\.aai-root|\.aai-header/);
  const picker = s.renderPicker();
  const row = visit(
    picker,
    (node) => node.props.className === 'aai-setting-row',
  )[0];
  assert.equal(row.type, 'label');
  assert.equal(
    visit(row, (node) => node.props.className === 'aai-setting-copy').length,
    1,
  );
  assert.equal(
    visit(row, (node) => node.props.className === 'aai-setting-description')
      .length,
    1,
  );
  assert.equal(
    visit(row, (node) => node.type === 'select')[0].props['aria-label'],
    'summaryModel',
  );
});

test('model picker gets selection then lists live models and aborts on cleanup', async () => {
  const s = setup((_path, _method, payload) =>
    Promise.resolve({
      ok: true,
      value: {
        ...modelValue(),
        ...(payload.action === 'list' ? { providers: catalog } : {}),
      },
    }),
  );
  let tree = s.renderPicker();

  assert.equal(dropdown(tree).props['aria-label'], 'summaryModel');
  assert.equal(dropdown(tree).props.disabled, true);

  const cleanup = s.effects[0]();

  await flush();
  tree = s.renderPicker();

  assert.deepEqual(
    s.calls.map((call) => call[2].action),
    ['get', 'list'],
  );
  assert.equal(dropdown(tree).props.disabled, false);
  assert.equal(
    visit(tree, (node) => node.type === 'optgroup')[0].props.label,
    'Configured provider',
  );

  cleanup();

  assert.ok(s.calls.every((call) => call[3].aborted));
});

test('model selection saves once immediately and preserves catalog with omitted providers', async () => {
  let finish;
  const s = setup((_path, _method, payload) =>
    payload.action === 'set'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({
          ok: true,
          value: { ...modelValue(), providers: catalog },
        }),
  );

  s.renderPicker();
  s.effects[0]();
  await flush();

  const select = dropdown(s.renderPicker());
  const key = JSON.stringify(['configured', 'small']);
  const saving = select.props.onChange({ target: { value: key } });

  select.props.onChange({ target: { value: 'off' } });

  assert.equal(s.calls.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[2][2])), {
    action: 'set',
    mode: 'model',
    provider: 'configured',
    model: 'small',
  });
  assert.equal(dropdown(s.renderPicker()).props.disabled, true);

  finish({
    ok: true,
    value: modelValue({
      mode: 'model',
      provider: 'configured',
      model: 'small',
    }),
  });
  await saving;

  const tree = s.renderPicker();

  assert.equal(dropdown(tree).props.value, key);
  assert.equal(visit(tree, (node) => node.type === 'optgroup').length, 1);
  assert.ok(
    visit(tree, (node) => node.props.role === 'status').some((node) =>
      node.children.includes('modelSaved'),
    ),
  );
});

test('summary effort picker offers only capability choices plus auto and model default', async () => {
  const s = setup(() =>
    Promise.resolve({
      ok: true,
      value: {
        ...modelValue({
          mode: 'model',
          provider: 'configured',
          model: 'small',
        }),
        providers: catalog,
        reasoning: {
          efforts: [
            { id: 'minimal', name: 'Minimal reasoning' },
            { id: 'high' },
          ],
        },
      },
    }),
  );
  s.renderPicker();
  const cleanup = s.effects[0]();
  await flush();

  const effort = visit(
    s.renderPicker(),
    (node) => node.type === 'select' && node.props['aria-label'] === 'effort',
  )[0];

  assert.equal(effort.props.disabled, false);
  assert.equal(effort.props.value, JSON.stringify({ effortPolicy: 'auto' }));
  assert.deepEqual(
    visit(effort, (node) => node.type === 'option').map((node) => ({
      value: JSON.parse(node.props.value),
      label: text(node),
    })),
    [
      { value: { effortPolicy: 'auto' }, label: 'effortAuto' },
      { value: { effortPolicy: 'default' }, label: 'effortDefault' },
      { value: { reasoningEffort: 'minimal' }, label: 'Minimal reasoning' },
      { value: { reasoningEffort: 'high' }, label: 'high' },
    ],
  );
  cleanup();
});

test('summary effort picker saves explicit effort without the previous policy', async () => {
  const selection = {
    mode: 'model',
    provider: 'configured',
    model: 'small',
    effortPolicy: 'default',
  };
  const reasoning = { efforts: [{ id: 'high', name: 'High' }] };
  let finish;
  const s = setup((_path, _method, payload) =>
    payload.action === 'set'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({
          ok: true,
          value: { ...modelValue(selection), providers: catalog, reasoning },
        }),
  );
  s.renderPicker();
  const cleanup = s.effects[0]();
  await flush();

  const effortSelect = (tree) =>
    visit(
      tree,
      (node) => node.type === 'select' && node.props['aria-label'] === 'effort',
    )[0];
  const effort = effortSelect(s.renderPicker());
  assert.equal(effort.props.value, JSON.stringify({ effortPolicy: 'default' }));
  const event = {
    target: { value: JSON.stringify({ reasoningEffort: 'high' }) },
  };
  const saving = effort.props.onChange(event);
  await effort.props.onChange(event);

  assert.equal(
    s.calls.length,
    3,
    'duplicate changes must not save while pending',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[2][2])), {
    action: 'set',
    mode: 'model',
    provider: 'configured',
    model: 'small',
    reasoningEffort: 'high',
  });
  assert.ok(
    visit(s.renderPicker(), (node) => node.type === 'select').every(
      (node) => node.props.disabled,
    ),
  );

  const { effortPolicy: _, ...route } = selection;
  finish({
    ok: true,
    value: { ...modelValue({ ...route, reasoningEffort: 'high' }), reasoning },
  });
  await saving;
  const saved = effortSelect(s.renderPicker());
  assert.equal(saved.props.value, event.target.value);
  assert.equal(saved.props.disabled, false);
  cleanup();
});

test('switching summary models clears explicit effort and effort policy', async () => {
  for (const effort of [
    { reasoningEffort: 'high' },
    { effortPolicy: 'default' },
  ]) {
    const s = setup((_path, _method, payload) =>
      Promise.resolve({
        ok: true,
        value: {
          ...modelValue(
            payload.action === 'set'
              ? {
                  mode: payload.mode,
                  provider: payload.provider,
                  model: payload.model,
                }
              : {
                  mode: 'model',
                  provider: 'configured',
                  model: 'old',
                  ...effort,
                },
          ),
          providers: catalog,
          reasoning: { efforts: [{ id: 'high' }] },
        },
      }),
    );
    s.renderPicker();
    const cleanup = s.effects[0]();
    await flush();
    await dropdown(s.renderPicker()).props.onChange({
      target: { value: JSON.stringify(['configured', 'small']) },
    });

    assert.deepEqual(JSON.parse(JSON.stringify(s.calls[2][2])), {
      action: 'set',
      mode: 'model',
      provider: 'configured',
      model: 'small',
    });
    const tree = s.renderPicker();
    assert.equal(
      dropdown(tree).props.value,
      JSON.stringify(['configured', 'small']),
    );
    assert.equal(
      visit(
        tree,
        (node) =>
          node.type === 'select' && node.props['aria-label'] === 'effort',
      )[0].props.value,
      JSON.stringify({ effortPolicy: 'auto' }),
    );
    cleanup();
  }
});

test('unsupported summary controls disable effort without inventing speed settings', async () => {
  for (const reasoning of [undefined, { efforts: [] }]) {
    const s = setup(() =>
      Promise.resolve({
        ok: true,
        value: {
          ...modelValue({
            mode: 'model',
            provider: 'configured',
            model: 'small',
          }),
          providers: catalog,
          ...(reasoning ? { reasoning } : {}),
        },
      }),
    );
    s.renderPicker();
    const cleanup = s.effects[0]();
    await flush();
    const tree = s.renderPicker();
    const selects = visit(tree, (node) => node.type === 'select');

    assert.deepEqual(
      selects.map((node) => node.props['aria-label']),
      ['summaryModel', 'effort'],
    );
    assert.equal(selects[1].props.disabled, true);
    assert.deepEqual(
      visit(selects[1], (node) => node.type === 'option').map((node) =>
        JSON.parse(node.props.value),
      ),
      [{ effortPolicy: 'auto' }, { effortPolicy: 'default' }],
    );
    assert.match(text(tree), /effortUnavailable/);
    assert.doesNotMatch(text(tree), /speed|speedUnsupported/);
    assert.equal(
      visit(tree, (node) => ['input', 'button'].includes(node.type)).length,
      0,
    );
    assert.equal(s.calls.filter((call) => call[2].action === 'set').length, 0);
    cleanup();
  }
});

test('follow and off summary modes expose no effort or speed picker', async () => {
  for (const mode of ['follow', 'off']) {
    const s = setup(() =>
      Promise.resolve({
        ok: true,
        value: { ...modelValue({ mode }), providers: catalog },
      }),
    );
    s.renderPicker();
    const cleanup = s.effects[0]();
    await flush();
    const tree = s.renderPicker();
    assert.deepEqual(
      visit(tree, (node) => node.type === 'select').map(
        (node) => node.props['aria-label'],
      ),
      ['summaryModel'],
    );
    assert.doesNotMatch(text(tree), /speed|speedUnsupported/);
    if (mode === 'follow') {
      assert.match(text(tree), /effortFollow/);
    } else {
      assert.doesNotMatch(text(tree), /effortFollow/);
    }
    cleanup();
  }
});

test('failed save retains unavailable selected model rather than following chat', async () => {
  const selection = { mode: 'model', provider: 'missing', model: 'old' };
  const s = setup((_path, _method, payload) =>
    Promise.resolve(
      payload.action === 'set'
        ? { ok: false, error: { message: 'Cannot persist' } }
        : {
            ok: true,
            value: {
              ...modelValue(selection),
              providers: catalog,
              errors: [{ provider: 'missing', message: 'Catalog offline' }],
            },
          },
    ),
  );

  s.renderPicker();
  s.effects[0]();
  await flush();

  let tree = s.renderPicker();
  const key = JSON.stringify(['missing', 'old']);

  assert.equal(dropdown(tree).props.value, key);
  assert.equal(
    visit(tree, (node) => node.type === 'option' && node.props.value === key)[0]
      .props.disabled,
    true,
  );
  assert.match(
    visit(tree, (node) => node.props.role === 'alert')[0].children.join(''),
    /Catalog offline/,
  );

  await dropdown(tree).props.onChange({ target: { value: 'off' } });
  tree = s.renderPicker();

  assert.equal(dropdown(tree).props.value, key);
  assert.equal(dropdown(tree).props.disabled, false);
  assert.match(
    visit(tree, (node) => node.props.role === 'alert')[0].children.join(''),
    /Cannot persist/,
  );
});

test('hidden model picker does not fetch settings or catalog', () => {
  const s = setup();

  s.renderPicker({ visible: false });

  assert.equal(s.effects[0](), undefined);
  assert.equal(s.calls.length, 0);
});

test('unmounted picker ignores late settings and does not start a catalog request', async () => {
  let finish;
  const s = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );

  s.renderPicker();

  const cleanup = s.effects[0]();

  cleanup();

  const writes = s.stateWrites.length;

  finish({ ok: true, value: modelValue() });
  await flush();

  assert.equal(s.stateWrites.length, writes);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][3].aborted, true);
});

test('model labels warn about cost and identify profile scope in both locales', () => {
  const { dictionaries } = setup();

  assert.equal(dictionaries.en.summaryModel, 'Summary model');
  assert.equal(dictionaries.zh.summaryModel, '摘要模型');
  assert.match(dictionaries.en.follow, /expensive/);
  assert.match(dictionaries.zh.follow, /费用/);
  assert.match(
    dictionaries.en.modelScope,
    /Profile-wide.*main chat.*future summaries/,
  );
  assert.match(dictionaries.zh.modelScope, /配置档案.*主聊天.*之后/);
});

test('lazy factory registers native page body and localized guide entry', () => {
  const s = setup();

  assert.equal(s.definition.id, '@local/dsh-agent-activity-intelligence');
  assert.equal(s.types[0].kind, 'agent-activity-intelligence');
  assert.equal(s.types[0].guide[0].title(), 'title');
  assert.ok(s.registrations.some((row) => row.options.key === s.definition.id));
});

test('header trigger opens native sidebar kind without writing app data', () => {
  const s = setup();
  const trigger = s.registrations.find(
    (row) => row.options.name === 'conversation.session.header.actions',
  );

  trigger.options.inject('root', {}).open();

  assert.deepEqual(s.opens, ['agent-activity-intelligence']);
});

test('watch uses generic authenticated RPC and aborts on cleanup', () => {
  const s = setup();

  s.render();

  const cleanup = s.effects[0]();

  assert.equal(s.calls[0][0], '/api');
  assert.equal(s.calls[0][1], 'agentActivityIntelligence.watch');
  assert.equal(s.calls[0][2].sessionId, 'root');
  assert.equal(s.calls[0][3].aborted, false);

  cleanup();

  assert.equal(s.calls[0][3].aborted, true);
});

test('hidden tabs do not start long polling', () => {
  const s = setup();

  s.render({ useTabInfo: () => ({ tab: { visible: false } }) });

  assert.equal(s.effects[0](), undefined);
  assert.equal(s.calls.length, 0);
});

test('fallback includes descendants but never unrelated sessions', () => {
  const s = setup();
  const tree = s.render({
    useProjection: () => ({ cards: [{ id: 'root-card' }] }),
    useSessions: (selector) =>
      selector({
        byId: {
          child: { parentId: 'root' },
          grandchild: { parentId: 'child' },
          other: {},
        },
        projectionsBySession: Object.fromEntries(
          ['child', 'grandchild', 'other'].map((id) => [
            id,
            { values: { agentActivityIntelligence: { cards: [{ id }] } } },
          ]),
        ),
      }),
  });
  const cards = visit(
    tree,
    (node) => typeof node.type === 'function' && node.props.card,
  );

  assert.deepEqual(cards.map((node) => node.props.card.id).sort(), [
    'child',
    'grandchild',
    'root-card',
  ]);
});
