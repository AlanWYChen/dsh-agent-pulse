import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function setup(rpc = () => new Promise(() => {})) {
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
    readFileSync(new URL('./client.js', import.meta.url), 'utf8'),
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

      bind: () => (key) => key,
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

  let picker;

  const renderPicker = (overrides = {}) => {
    // Panel children are rendered separately, just as React gives each component its own hooks.
    if (!picker) {
      picker = visit(
        render(),
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
    renderPicker,
    mountCard,
    mountDiff: (tab, overrides = {}) => {
      const row = registrations.find(
        (entry) =>
          entry.options.key === '@local/dsh-agent-activity-intelligence/diff' &&
          entry.options.name === 'sidebar.right.pane.tab',
      );
      return mountElement({
        type: row.Component,
        props: {
          ...row.options.inject(),
          useTabInfo: () => ({ tab }),
          t: (key) => key,
          ...overrides,
        },
      });
    },
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

test('working cards show the chat whale tail, visible status text and three animated dots', () => {
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
    3,
  );
  assert.equal(
    text(visit(tree, (node) => node.type === 'h3')),
    'agentWorking...',
  );
  assert.equal(
    text(
      visit(indicator, (node) => node.props.className === 'aai-working-label'),
    ),
    'agentWorking',
  );
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

test('whale and dots respect reduced motion and keep localized accessible status labels', () => {
  const s = setup();
  const style = text(visit(s.renderPanel(), (node) => node.type === 'style'));

  assert.match(style, /@keyframes aai-tail-wiggle/);
  assert.match(style, /@keyframes aai-dot-pulse/);
  assert.match(style, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(style, /\.aai-whale-tail,\.aai-working-dot\{animation:none\}/);
  assert.equal(s.dictionaries.en.agentWorking, 'Agent is still working');
  assert.equal(s.dictionaries.zh.agentWorking, '智能体正在工作');
});

const ownAddress = (label = 'src/client.js', fileId = 'file-a') =>
  `dsh-resource://activity-diff/root/card-edit/${fileId}?label=${encodeURIComponent(label)}`;
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

test('missing, malformed or cross-session Review pointers show explicit failure without navigation', async () => {
  for (const nativeReview of [
    undefined,
    null,
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

test('openDiff rejects unavailable Review metadata instead of navigating to a custom address', async () => {
  const s = setup(() => Promise.resolve(diffValue()));
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

test('historical fallback owns no native children and renders only recorded rows', async () => {
  const s = setup(() =>
    Promise.resolve(diffValue({ editorPath: '/project/src/client.js' })),
  );
  const row = s.registrations.find(
    (entry) =>
      entry.options.key === s.definition.id + '/diff' &&
      entry.options.name === 'sidebar.right.pane.tab',
  );
  assert.equal(row.options.children, undefined);
  const tab = s.mountDiff(
    { contentId: ownAddress(), visible: true },
    { renderSlot: () => assert.fail('must not dispatch foreign native slots') },
  );
  tab.render();
  await flush();
  let tree = tab.render();
  const source = visit(
    tree,
    (node) => node.props.className === 'aai-recorded-text',
  );
  assert.deepEqual(source.map(text), [
    'unchanged',
    'before <script>',
    'after & safe',
  ]);
  assert.deepEqual(
    visit(tree, (node) => node.props.className === 'aai-recorded-sign').map(
      text,
    ),
    [' ', '-', '+'],
  );
  assert.equal(
    visit(
      tree,
      (node) => node.type === 'script' || node.props.dangerouslySetInnerHTML,
    ).length,
    0,
  );
  const styles = text(visit(tree, (node) => node.type === 'style'));
  assert.match(styles, /aai-recorded-add.*background/);
  assert.doesNotMatch(styles, /pre \.line|::before|data-activity-native-diff/);
  visit(tree, (node) => node.type === 'input')[0].props.onChange({
    target: { checked: true },
  });
  tree = tab.render();
  assert.equal(
    visit(tree, (node) => node.type === 'pre')[0].props.style.whiteSpace,
    'pre-wrap',
  );
  assert.equal(visit(tree, (node) => node.type === 'dialog').length, 0);
  fileButton(tree, 'codeView').props.onClick();
  assert.equal(
    s.opens[0].address,
    'dsh-resource://file/session/root//project/src/client.js',
  );
  assert.equal(
    s.calls.length,
    1,
    'historical renderer never reads current disk',
  );
  tab.unmount();
});

test('recorded full-file fallback removes synthetic hunks and keeps source text separate from gutters', async () => {
  const s = setup(() =>
    Promise.resolve(
      diffValue({
        coverage: 'recorded-full',
        lines: [
          { kind: 'hunk', text: '@@ recorded file @@' },
          { kind: 'add', text: 'const answer = 42;', newLine: 1 },
        ],
      }),
    ),
  );
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  await flush();
  const tree = tab.render();
  assert.deepEqual(
    visit(tree, (node) => node.props.className === 'aai-recorded-text').map(
      text,
    ),
    ['const answer = 42;'],
  );
  assert.doesNotMatch(text(tree), /@@ recorded file @@/);
  assert.deepEqual(
    visit(tree, (node) => node.props.className === 'aai-recorded-number').map(
      text,
    ),
    ['', '1'],
  );
  assert.equal(fileButton(tree, 'codeView').props.disabled, true);
  tab.unmount();
});

test('fake SlotCore rejects duplicate native child declarations before committing an entry', () => {
  const s = setup();
  const count = s.registrations.length;
  for (const key of [
    'sidebar.right.tab.document',
    'sidebar.right.tab.document.actions',
  ]) {
    assert.throws(
      () =>
        s.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: 'bad-child-owner',
            children: { [key]: { kind: 'keyed', scope: 'session' } },
          },
          () => null,
        ),
      /already declared/,
    );
  }
  assert.equal(s.registrations.length, count);
});

test('recorded Shiki tokens use escaped spans, validated theme colors and font flags', async () => {
  const lines = [
    {
      kind: 'add',
      text: 'const <script>',
      newLine: 12,
      tokens: [
        { text: 'const ', light: '#123', dark: '#abcdef', fontStyle: 1 },
        { text: '<script>', light: '#12345678', dark: '#defa', fontStyle: 6 },
      ],
    },
  ];
  const s = setup(() => Promise.resolve(diffValue({ lines })));
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  await flush();
  const tree = tab.render();
  const tokens = visit(
    tree,
    (node) => node.props.className === 'aai-recorded-token',
  );
  assert.equal(text(tokens), 'const <script>');
  assert.deepEqual(plain(tokens[0].props.style), {
    '--aai-token-light': '#123',
    '--aai-token-dark': '#abcdef',
    fontStyle: 'italic',
  });
  assert.deepEqual(plain(tokens[1].props.style), {
    '--aai-token-light': '#12345678',
    '--aai-token-dark': '#defa',
    fontWeight: 'bold',
    textDecoration: 'underline',
  });
  assert.equal(
    visit(
      tree,
      (node) => node.type === 'script' || node.props.dangerouslySetInnerHTML,
    ).length,
    0,
  );
  const styles = text(visit(tree, (node) => node.type === 'style'));
  assert.match(
    styles,
    /body\[data-ds-dark-theme\] \.aai-native-diff \.aai-recorded-token/,
  );
  assert.match(styles, /--aai-token-light/);
  assert.match(styles, /--aai-token-dark/);
  tab.unmount();
});

test('invalid colors never enter CSS and mismatched or malformed tokens render original text', async () => {
  const variants = [
    [
      {
        text: 'safe text',
        light: 'red;position:fixed',
        dark: '#fff',
        fontStyle: 7,
      },
    ],
    [{ text: 'safe text', light: '#ggg', dark: '#fff', fontStyle: -1 }],
    [{ text: 'wrong text', light: '#123', dark: '#fff', fontStyle: 0 }],
    [null],
    [{ text: 123 }],
    null,
  ];
  for (const tokens of variants) {
    const s = setup(() =>
      Promise.resolve(
        diffValue({ lines: [{ kind: 'context', text: 'safe text', tokens }] }),
      ),
    );
    const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
    tab.render();
    await flush();
    const tree = tab.render();
    assert.equal(
      text(visit(tree, (node) => node.props.className === 'aai-recorded-text')),
      'safe text',
    );
    for (const token of visit(
      tree,
      (node) => node.props.className === 'aai-recorded-token',
    )) {
      assert.equal(token.props.style['--aai-token-light'], undefined);
      assert.equal(token.props.style['--aai-token-dark'], undefined);
    }
    tab.unmount();
  }
});

test('redacted rows never render even when a payload includes syntax tokens', async () => {
  const s = setup(() =>
    Promise.resolve(
      diffValue({
        status: 'redacted',
        lines: [
          {
            kind: 'add',
            text: 'SECRET',
            tokens: [
              { text: 'SECRET', light: '#123', dark: '#fff', fontStyle: 0 },
            ],
          },
        ],
      }),
    ),
  );
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  await flush();
  const tree = tab.render();
  assert.equal(visit(tree, (node) => node.type === 'pre').length, 0);
  assert.equal(
    visit(tree, (node) => node.props.className === 'aai-recorded-token').length,
    0,
  );
  assert.doesNotMatch(text(tree), /SECRET/);
  tab.unmount();
});

test('fallback URI handlers validate string addresses and compute native titles', () => {
  const s = setup();
  const type = s.types.find((entry) => entry.kind === 'agent-activity-diff');
  assert.equal(type.canOpen(ownAddress('test/client.js')), true);
  assert.equal(
    type.title(ownAddress('test/client.js')),
    'test/client.js · diffView',
  );
  for (const address of [
    'file:///tmp/a',
    'dsh-resource://activity-diff/root/card',
    'dsh-resource://activity-diff/root/card/%ZZ?label=x',
    ownAddress() + '#bad',
    ownAddress().replace('file-a', '%00'),
  ])
    assert.equal(type.canOpen(address), false);
});

test('file races abort stale requests and card identity changes and unmount prevent late navigation', async () => {
  const pending = [];
  const s = setup(() => new Promise((resolve) => pending.push(resolve)));
  const card = s.mountCard(diffCard());
  const tree = card.render();
  const first = fileButton(tree, 'src/client.js').props.onClick();
  const second = fileButton(tree, 'test/client.js').props.onClick();
  assert.equal(s.calls[0][3].aborted, true);
  pending[0](
    diffValue({
      nativeReview: { sessionId: 'root', seq: 1, turn: 1, index: 0 },
    }),
  );
  await first;
  assert.equal(s.opens.length, 0);
  pending[1](
    diffValue({
      nativeReview: { sessionId: 'root', seq: 34, turn: 2, index: 1 },
    }),
  );
  await second;
  assert.deepEqual(plain(s.opens), [
    {
      address: 'dsh-resource://changes-review/session/root/34/2',
      options: { params: { index: 1 } },
    },
  ]);
  const third = fileButton(card.render(), 'src/client.js').props.onClick();
  card.render({ card: diffCard({ id: 'other-card' }) });
  assert.equal(s.calls[2][3].aborted, true);
  pending[2](
    diffValue({
      nativeReview: { sessionId: 'root', seq: 35, turn: 3, index: 0 },
    }),
  );
  await third;
  const fourth = fileButton(card.render(), 'src/client.js').props.onClick();
  card.unmount();
  assert.equal(s.calls[3][3].aborted, true);
  pending[3](
    diffValue({
      nativeReview: { sessionId: 'root', seq: 35, turn: 3, index: 0 },
    }),
  );
  await fourth;
  assert.equal(s.opens.length, 1);
});

test('diff address switches, visibility and tab abort ignore late responses', async () => {
  const pending = [];
  const s = setup(() => new Promise((resolve) => pending.push(resolve)));
  const controller = new AbortController();
  let info = {
    contentId: ownAddress(),
    visible: true,
    signal: controller.signal,
  };
  const tab = s.mountDiff(info, { useTabInfo: () => ({ tab: info }) });
  tab.render();
  info = { ...info, contentId: ownAddress('test/client.js', 'file-b') };
  tab.render();
  assert.equal(s.calls[0][3].aborted, true);
  const writes = s.stateWrites.length;
  pending[0](diffValue({ notice: 'STALE SNAPSHOT' }));
  await flush();
  assert.equal(s.stateWrites.length, writes);
  pending[1](diffValue({ notice: 'ACTIVE SNAPSHOT' }));
  await flush();
  assert.match(text(tab.render()), /ACTIVE SNAPSHOT/);
  info = { ...info, visible: false };
  tab.render();
  assert.equal(s.calls[1][3].aborted, true);
  assert.equal(s.calls.length, 2);
  info = { ...info, visible: true };
  tab.render();
  controller.abort();
  assert.equal(s.calls[2][3].aborted, true);
  const before = s.stateWrites.length;
  pending[2](diffValue({ notice: 'LATE SNAPSHOT' }));
  await flush();
  assert.equal(s.stateWrites.length, before);
  tab.unmount();
});

test('errors, unavailable and redacted diffs remain visible without dispatching content', async () => {
  for (const result of [
    { ok: false, error: { message: 'offline' } },
    diffValue({ status: 'unavailable' }),
    diffValue({ status: 'redacted' }),
  ]) {
    const calls = [];
    const s = setup(() => Promise.resolve(result));
    const tab = s.mountDiff(
      { contentId: ownAddress(), visible: true },
      {
        renderSlot: (...args) => {
          calls.push(args);
          return null;
        },
      },
    );
    tab.render();
    await flush();
    const tree = tab.render();
    assert.match(text(tree), /diffError|diffUnavailable|diffRedacted/);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(text(tree), /before <script>/);
    tab.unmount();
  }
  const s = setup(() => Promise.resolve({ ok: false, error: 'offline' }));
  const card = s.mountCard(diffCard());
  await fileButton(card.render(), 'src/client.js').props.onClick();
  assert.match(
    text(visit(card.render(), (node) => node.props.role === 'alert')),
    /offline/,
  );
  assert.equal(s.opens.length, 0);
  card.unmount();
});

test('hidden, already-aborted and invalid diff tabs never fetch; unmount aborts in-flight RPC', async () => {
  const aborted = new AbortController();
  aborted.abort();
  for (const info of [
    { contentId: ownAddress(), visible: false },
    { contentId: ownAddress(), visible: true, signal: aborted.signal },
    { contentId: 'not a resource', visible: true },
  ]) {
    const s = setup();
    const tab = s.mountDiff(info);
    tab.render();
    assert.equal(s.calls.length, 0);
    tab.unmount();
  }
  let finish;
  const s = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  tab.unmount();
  assert.equal(s.calls[0][3].aborted, true);
  const writes = s.stateWrites.length;
  finish(diffValue());
  await flush();
  assert.equal(s.stateWrites.length, writes);
});

test('empty and partial file metadata stay safe and reload refetches recorded IDs only', async () => {
  const s = setup(() =>
    Promise.resolve(
      diffValue({ lines: [], truncated: true, notice: 'Recorded subset' }),
    ),
  );
  const card = s.mountCard(
    diffCard({ changeFiles: [{ label: 'plain.js' }, { id: 'only-id' }] }),
  );
  const cardTree = card.render();
  assert.match(text(cardTree), /plain.js/);
  assert.equal(fileButton(cardTree, 'plain.js'), undefined);
  card.unmount();
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  await flush();
  const tree = tab.render();
  assert.match(text(tree), /noLines/);
  assert.match(text(tree), /truncated/);
  assert.match(text(tree), /Recorded subset/);
  assert.equal(fileButton(tree, 'codeView').props.disabled, true);
  fileButton(tree, 'reloadDiff').props.onClick();
  tab.render();
  await flush();
  assert.equal(s.calls.length, 2);
  assert.deepEqual(plain(s.calls[1][2]), {
    sessionId: 'root',
    cardId: 'card-edit',
    fileId: 'file-a',
  });
  tab.unmount();
});

test('Open current file preserves Windows drives and encodes path segments', async () => {
  const editorPath = 'C:\\project folder\\a#b.js';
  const s = setup(() => Promise.resolve(diffValue({ editorPath })));
  const tab = s.mountDiff({ contentId: ownAddress(), visible: true });
  tab.render();
  await flush();
  fileButton(tab.render(), 'codeView').props.onClick();
  assert.equal(
    s.opens[0].address,
    'dsh-resource://file/session/root/C:/project%20folder/a%23b.js',
  );
  tab.unmount();
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

test('model RPC is injected by a callable factory alongside unchanged watch', async () => {
  const s = setup(() => Promise.resolve({ ok: true, value: modelValue() }));
  const body = s.registrations.find(
    (row) =>
      row.options.name === 'sidebar.right.pane.tab' &&
      row.options.key === '@local/dsh-agent-activity-intelligence',
  );

  assert.equal(typeof body.options.inject, 'function');

  const props = body.options.inject();

  assert.equal(typeof props.watch, 'function');
  assert.equal(typeof props.modelRpc, 'function');
  assert.equal(typeof props.diffRpc, 'function');

  const controller = new AbortController();

  for (const action of ['get', 'list', 'set'])
    await props.modelRpc({ action }, controller.signal);

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
