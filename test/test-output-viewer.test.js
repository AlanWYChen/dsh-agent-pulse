import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const address = (sessionId, callId) =>
  `dsh-resource://activity-test-output/${encodeURIComponent(sessionId)}/${encodeURIComponent(callId)}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));
function visit(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((value) => visit(value, predicate, result));
    return result;
  }
  if (predicate(node)) result.push(node);
  visit(node.children, predicate, result);
  return result;
}
const text = (node) =>
  node == null || node === false
    ? ''
    : typeof node === 'object'
      ? (Array.isArray(node) ? node : node.children || []).map(text).join('')
      : String(node);

function setup(rpc = () => new Promise(() => {})) {
  let definition, active;
  const registrations = [],
    types = [],
    opens = [],
    calls = [];
  let dictionaries = {};
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    Fragment: 'fragment',
    useState(initial) {
      const scope = active,
        index = scope.stateIndex++;
      if (!(index in scope.states))
        scope.states[index] =
          typeof initial === 'function' ? initial() : initial;
      return [
        scope.states[index],
        (value) => {
          scope.states[index] =
            typeof value === 'function' ? value(scope.states[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = active.refIndex++;
      return (active.refs[index] ||= { current: initial });
    },
    useEffect(fn, deps) {
      const scope = active,
        index = scope.effectIndex++,
        old = scope.effects[index];
      if (
        !old ||
        !deps ||
        deps.some((value, i) => !Object.is(value, old.deps[i]))
      )
        scope.pending.push(() => {
          old?.cleanup?.();
          scope.effects[index] = { deps, cleanup: fn() };
        });
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
  };
  vm.runInNewContext(
    readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'),
    {
      window: {
        __ModuleLoader__: {
          load(value) {
            definition = value;
          },
        },
      },
      AbortController,
      URL,
    },
  );
  const plugin = definition.factory((name) => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives')
      return { TextShimmer: 'DeepSeekTextShimmer' };
    assert.equal(name, 'react');
    return React;
  });
  plugin.apply({
    effect: (fn) => fn(),
    locale: {
      register(_namespace, value) {
        dictionaries = value;
        return () => {};
      },
      bind: () => (key) => dictionaries.en?.[key] || key,
    },
    sidebarRightTabs: {
      register(value) {
        types.push(value);
        return () => {};
      },
    },
    sidebarRight: {
      openTab() {},
      openResource(value) {
        opens.push(value);
      },
    },
    slots: {
      inject: (_name, fn) => fn(),
      register(options, Component) {
        registrations.push({ options, Component });
        return () => {};
      },
    },
    connection: {
      rpc: {
        call(...args) {
          calls.push(args);
          return rpc(...args);
        },
      },
    },
  });
  function mount(Component, initialProps) {
    const scope = { states: [], refs: [], effects: [], pending: [] };
    let props = initialProps;
    return {
      render(next = {}) {
        props = { ...props, ...next };
        scope.stateIndex = scope.refIndex = scope.effectIndex = 0;
        const previous = active;
        active = scope;
        let tree;
        try {
          tree = Component(props);
        } finally {
          active = previous;
        }
        scope.pending.splice(0).forEach((effect) => effect());
        return tree;
      },
      unmount() {
        scope.effects.forEach((effect) => effect.cleanup?.());
      },
    };
  }
  function viewer(initialAddress) {
    const type = types.find((value) =>
      value.patterns?.some((pattern) =>
        pattern.startsWith('dsh-resource://activity-test-output/'),
      ),
    );
    assert.ok(
      type,
      'captured output requires a registered in-app virtual resource tab',
    );
    assert.equal(type.canOpen(initialAddress), true);
    const row = registrations.find(
      (value) =>
        value.options.name === 'sidebar.right.pane.tab' &&
        value.options.key === type.id,
    );
    assert.ok(row, 'virtual output tab requires its own viewer body');
    return {
      type,
      component: mount(row.Component, {
        ...row.options.inject?.(),
        useTabInfo: () => ({
          tab: { contentId: initialAddress, visible: true },
        }),
        t: (key) => dictionaries.en?.[key] || key,
      }),
    };
  }
  function renderCard(card, sessionId, catalog = {}) {
    const row = registrations.find(
      (value) =>
        value.options.name === 'sidebar.right.pane.tab' &&
        value.options.key === '@local/dsh-agent-activity-intelligence',
    );
    const panel = mount(row.Component, {
      ...row.options.inject?.(sessionId, {}),
      sessionId,
      useProjection: () => ({ sessionId, cards: [card] }),
      useSessions: (selector) =>
        selector({ projectionsBySession: {}, byId: {}, ...catalog }),
      useTabInfo: () => ({ tab: { visible: false } }),
      t: (key) => dictionaries.en?.[key] || key,
    });
    function expand(node) {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(expand);
      if (typeof node.type === 'function')
        return expand(mount(node.type, node.props).render());
      return { ...node, children: expand(node.children) };
    }
    return expand(panel.render());
  }
  return { calls, opens, viewer, renderCard };
}

const available = (
  stdout = 'safe output <script>alert(1)</script>\n',
  extra = {},
) => ({
  ok: true,
  value: {
    status: 'available',
    artifact: {
      version: 1,
      sessionId: 'child / encoded',
      callId: 'test/#1',
      name: 'test-result.out',
      command: 'node --test',
      stdout,
      stderr: 'stderr diagnostic & details\n',
      status: 'completed',
      exitCode: 0,
      complete: true,
      truncated: false,
      ...extra,
    },
  },
});

test('View output opens exact source-session virtual .out resource rather than a path or external application', async () => {
  const ui = setup();
  const tree = ui.renderCard(
    {
      id: 'outcome:1',
      category: 'outcome',
      title: 'Tests',
      summary: '',
      files: [],
      evidence: [],
      verification: { status: 'unknown', label: 'Unknown' },
      testRuns: [
        {
          id: 'test/#1',
          sessionId: 'child / encoded',
          agentId: 'child',
          executionStatus: 'completed',
          resultStatus: 'unknown',
          counts: null,
          exitCode: 0,
          output: { name: 'test-result.out' },
        },
      ],
    },
    'child / encoded',
  );
  const button = visit(
    tree,
    (node) => node.type === 'button' && /view output/i.test(text(node)),
  )[0];
  assert.ok(button, 'a captured test run must expose a View output gesture');
  await button.props.onClick();
  assert.deepEqual(ui.opens, [address('child / encoded', 'test/#1')]);
});

test('output viewer fetches exact identity and renders stdout/stderr only as safe preformatted text with incomplete label', async () => {
  const ui = setup(async () =>
    available(undefined, { complete: false, truncated: true }),
  );
  const { component, type } = ui.viewer(address('child / encoded', 'test/#1'));
  assert.equal(
    type.canOpen('dsh-resource://activity-test-output/only-one-segment'),
    false,
  );
  component.render();
  await flush();
  const tree = component.render();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0][0], '/api');
  assert.equal(ui.calls[0][1], 'agentActivityIntelligence.testOutput');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[0][2])), {
    sessionId: 'child / encoded',
    callId: 'test/#1',
  });
  assert.ok(ui.calls[0][3] instanceof AbortSignal);
  const pres = visit(tree, (node) => node.type === 'pre');
  assert.ok(pres.length > 0, 'stdout/stderr are preformatted evidence');
  assert.match(
    pres.map(text).join('\n'),
    /safe output <script>alert\(1\)<\/script>/,
  );
  assert.match(pres.map(text).join('\n'), /stderr diagnostic & details/);
  assert.equal(
    visit(tree, (node) => node.props?.dangerouslySetInnerHTML).length,
    0,
  );
  assert.equal(visit(tree, (node) => node.type === 'script').length, 0);
  assert.match(text(tree), /incomplete|truncated|partial/i);
  component.unmount();
});

test('output viewer explains unavailable and RPC failure without pretending empty output is successful', async () => {
  for (const response of [
    { ok: true, value: { status: 'unavailable' } },
    { ok: false, error: { message: 'output unavailable' } },
  ]) {
    const ui = setup(async () => response);
    const { component } = ui.viewer(address('root', 'test-1'));
    component.render();
    await flush();
    const tree = component.render();
    assert.match(text(tree), /unavailable|not available|failed|error/i);
    assert.equal(visit(tree, (node) => node.type === 'pre').length, 0);
    component.unmount();
  }
});

test('output viewer aborts stale identities and prevents late responses from replacing a newer artifact', async () => {
  const requests = [];
  const ui = setup(
    (_channel, _method, payload, signal) =>
      new Promise((resolve) => requests.push({ payload, signal, resolve })),
  );
  const { component } = ui.viewer(address('root', 'old-test'));
  component.render();
  await flush();
  assert.equal(requests.length, 1);
  component.render({
    useTabInfo: () => ({
      tab: { contentId: address('root', 'new-test'), visible: true },
    }),
  });
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve(
    available('NEW artifact evidence\n', {
      sessionId: 'root',
      callId: 'new-test',
    }),
  );
  await flush();
  requests[0].resolve(
    available('OLD stale evidence\n', {
      sessionId: 'root',
      callId: 'old-test',
    }),
  );
  await flush();
  const tree = component.render();
  assert.match(text(tree), /NEW artifact evidence/);
  assert.doesNotMatch(text(tree), /OLD stale evidence/);
  component.unmount();
  assert.equal(requests[1].signal.aborted, true);
});

test('collapsed descendant summary exposes source identity, execution status and numeric test results', () => {
  const ui = setup();
  const rootCard = {
    id: 'root-card',
    category: 'outcome',
    title: 'Root',
    summary: '',
    files: [],
    evidence: [],
    verification: { status: 'not-run', label: 'No test run observed' },
  };
  const childCard = {
    ...rootCard,
    id: 'child-card',
    title: 'Backend result',
    summaryStatus: 'ready',
    testRuns: [
      {
        id: 'backend-tests',
        sessionId: 'backend',
        agentId: 'backend',
        executionStatus: 'completed',
        resultStatus: 'failed',
        counts: { passed: 60, failed: 3, skipped: 0 },
        exitCode: 1,
      },
    ],
  };
  const tree = ui.renderCard(rootCard, 'root', {
    byId: { backend: { parentId: 'root' } },
    projectionsBySession: {
      backend: {
        values: {
          agentActivityIntelligence: {
            sessionId: 'backend',
            parentSession: 'root',
            cards: [childCard],
          },
        },
      },
    },
  });
  const summary = visit(
    tree,
    (node) => node.type === 'summary' && /backend/.test(text(node)),
  )[0];
  assert.ok(summary, 'descendant must have its own expandable summary');
  assert.match(
    text(summary),
    /completed|failed/i,
    'execution state is visible without expanding the card',
  );
  assert.match(
    text(summary),
    /60/,
    'passing test count remains visible in compact summary',
  );
  assert.match(
    text(summary),
    /3/,
    'failing test count remains visible in compact summary',
  );
});
