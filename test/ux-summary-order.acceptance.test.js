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
        summaryRpc: async () => ({ ok: true, value: { status: 'reported' } }),
        useProjection: () => ({ cards }),
        useSessions: (selector) =>
          selector({ projectionsBySession: {}, byId: {} }),
        useTabInfo: () => ({ tab: { visible: true } }),
      }),
    );
}
function walk(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, result));
    return result;
  }
  result.push(node);
  walk(node.children, result);
  return result;
}
const text = (node) =>
  node == null || node === false
    ? ''
    : typeof node === 'object'
      ? (Array.isArray(node) ? node : node.children || []).map(text).join('')
      : String(node);

test('Refresh summary sits under verification and above the test-run separator', () => {
  const tree = harness()([
    {
      id: 'p',
      title: 'Owner',
      category: 'outcome',
      summary: 'Owner summary',
      summaryStatus: 'ready',
      status: 'completed',
      verification: { status: 'not-run' },
      files: [],
      testRuns: [
        {
          id: 'run-1',
          label: 'pytest',
          executionStatus: 'completed',
          resultStatus: 'passed',
          exitCode: 0,
          counts: { passed: 1, failed: 0, skipped: 0 },
        },
      ],
    },
  ]);
  const nodes = walk(tree);
  const verification = nodes.findIndex(
    (node) => node.type === 'p' && text(node).startsWith('verification:'),
  );
  const refresh = nodes.findIndex(
    (node) => node.type === 'button' && text(node) === 'refreshSummary',
  );
  const testRuns = nodes.findIndex(
    (node) =>
      node.type === 'details' &&
      String(node.props?.className || '').includes('aai-test-history'),
  );
  assert.ok(verification >= 0 && refresh >= 0 && testRuns >= 0);
  assert.ok(verification < refresh, 'Refresh summary must follow verification');
  assert.ok(
    refresh < testRuns,
    'Refresh summary must precede test runs and their separator',
  );
});
