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
    useState: (initial) => [initial, () => {}],
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
  definition
    .factory((name) =>
      name === 'react' ? React : { TextShimmer: 'TextShimmer' },
    )
    .apply({
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
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function')
      return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  };
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
const text = (node) =>
  node == null || node === false
    ? ''
    : typeof node === 'object'
      ? (Array.isArray(node) ? node : node.children || []).map(text).join(' ')
      : String(node);
const checks = (tree) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes('aai-check-history'),
  );
const card = (extra = {}) => ({
  id: 'owner',
  category: 'outcome',
  title: 'Owner',
  summary: 'Owner summary',
  status: 'completed',
  summaryStatus: 'ready',
  time: 1000,
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});

test('check runs render in a separate collapsible Checks section', () => {
  const tree = harness()([
    card({
      checkRuns: [
        {
          id: 'check-1',
          label: 'npm run check',
          executionStatus: 'completed',
          resultStatus: 'unknown',
          exitCode: 0,
          sessionId: 'root',
          callSeq: 1,
        },
      ],
    }),
  ]);
  const section = checks(tree);
  assert.equal(section.length, 1);
  const caption = text(
    section[0].children.find((node) => node?.type === 'summary'),
  );
  assert.match(caption, /checks/);
  assert.match(caption, /1/);
  const body = text(section[0]);
  assert.match(body, /npm run check/);
  assert.match(body, /passed/);
  assert.match(body, /exitCode/);
});

test('no check runs means no empty Checks section', () => {
  assert.equal(checks(harness()([card()])).length, 0);
});
