import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness() {
  let definition;
  const registrations = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    Fragment: 'fragment',
    useState: (initial) => [
      typeof initial === 'function' ? initial() : initial,
      () => {},
    ],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
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
  const plugin = definition.factory((name) =>
    name === 'react' ? React : { TextShimmer: 'TextShimmer' },
  );
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {}, openResource: () => {} },
    slots: {
      inject: (_, fn) => fn(),
      register: (options, Component) => {
        registrations.push({ options, Component });
        return () => {};
      },
    },
    connection: { rpc: { call: () => new Promise(() => {}) } },
  });
  const body = registrations.find(
    (row) =>
      row.options.name === 'sidebar.right.pane.tab' &&
      row.options.key === '@local/dsh-agent-activity-intelligence',
  );
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function')
      return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  return (cards) =>
    expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => ({ cards }),
        useSessions: (selector) =>
          selector({ projectionsBySession: {}, byId: {} }),
        useTabInfo: () => ({ tab: { visible: true } }),
      }),
    );
}
function walk(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, predicate, result));
    return result;
  }
  if (predicate(node)) result.push(node);
  walk(node.children, predicate, result);
  return result;
}
const card = (changesReady) => ({
  id: 'p',
  title: 'Owner',
  category: 'outcome',
  summary: 'Owner summary',
  summaryStatus: 'ready',
  status: 'observed',
  verification: { status: 'not-run' },
  files: ['src/a.js'],
  testRuns: [],
  changesReady,
  changeFiles: [{ id: 'file-id', label: 'src/a.js' }],
});

test('changes and file links stay hidden until the turn stops', () => {
  const running = harness()([card(false)]);
  assert.equal(
    walk(
      running,
      (node) =>
        node.type === 'details' &&
        String(node.props.className || '').includes('aai-changes'),
    ).length,
    0,
  );
  assert.equal(
    walk(
      running,
      (node) =>
        node.type === 'button' &&
        node.props?.['aria-label'] === 'changes: src/a.js',
    ).length,
    0,
  );

  const stopped = harness()([card(true)]);
  assert.equal(
    walk(
      stopped,
      (node) =>
        node.type === 'details' &&
        String(node.props.className || '').includes('aai-changes'),
    ).length,
    1,
  );
  assert.equal(
    walk(
      stopped,
      (node) =>
        node.type === 'button' &&
        node.props?.['aria-label'] === 'changes: src/a.js',
    ).length,
    1,
  );
});
