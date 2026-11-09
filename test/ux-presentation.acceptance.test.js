import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent static React renderer copied from the existing acceptance harness.
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
  return (cards, children = [], actions = {}) =>
    expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => ({ cards }),
        useSessions: (selector) =>
          selector({
            projectionsBySession: Object.fromEntries(
              children.map((child) => [
                child.sessionId,
                {
                  values: { agentActivityIntelligence: { cards: child.cards } },
                },
              ]),
            ),
            byId: Object.fromEntries(
              children.map((child) => [
                child.sessionId,
                { id: child.sessionId, parentId: 'root' },
              ]),
            ),
          }),
        useTabInfo: () => ({ tab: { visible: true } }),
        ...actions,
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
      ? (Array.isArray(node) ? node : node.children || []).map(text).join('')
      : String(node);
const card = (id, title, extra = {}) => ({
  id,
  title,
  category: 'outcome',
  summary: title + ' summary',
  summaryStatus: 'ready',
  status: 'completed',
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});

test('test run heading uses the command label instead of an opaque execution id', () => {
  const tree = harness()([
    card('p', 'Owner', {
      testRuns: [
        {
          id: 'call_9ac7a60a10844adf993c864e0affc334|fc_0a1e0465764dc710016af137b09f8c87d1a69eaaf435b0bbe9',
          label: 'pytest',
          executionStatus: 'completed',
          resultStatus: 'passed',
          exitCode: 0,
          counts: { passed: 13, failed: 0, skipped: 0 },
        },
      ],
    }),
  ]);
  const body = text(tree);
  assert.match(body, /pytest/);
  assert.doesNotMatch(body, /call_9ac7|fc_0a1e/);
});

test('unlinked assignments are grouped with an explanation instead of empty expandable cards', () => {
  const tasks = ['Delegated follow-up', 'Delegated follow-up'].map(
    (label, index) => ({
      id: `unlinked-${index}`,
      label,
      sessionId: 'worker',
      cards: [],
      status: 'unavailable',
      attribution: 'unavailable',
    }),
  );
  const tree = harness()([card('p', 'Owner', { subtasks: tasks })]);
  const details = walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(
        text(node.children.find((child) => child?.type === 'summary')),
      ).includes('unlinkedDelegations'),
  );
  assert.equal(
    details.length,
    1,
    'unlinked follow-ups must not create one empty disclosure each',
  );
  assert.match(text(details[0]), /unlinkedDelegations/);
  assert.match(text(details[0]), /unlinkedDelegationsHint/);
  const emptyAssignments = walk(
    tree,
    (node) =>
      node.type === 'details' &&
      node.props.className === 'aai-assignment' &&
      !text(node).match(/unlinkedDelegations/),
  );
  assert.equal(emptyAssignments.length, 0);
});

test('legacy session captions summarize outcomes instead of repeating observed statuses', () => {
  const child = {
    sessionId: 'worker',
    parentSession: 'root',
    cards: [
      card('c1', 'First', { status: 'observed' }),
      card('c2', 'Second', { status: 'observed' }),
    ],
  };
  const tree = harness()([card('p', 'Owner')], [child]);
  const groups = walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes('aai-session-group'),
  );
  assert.equal(groups.length, 1);
  const caption = text(
    groups[0].children.find((child) => child?.type === 'summary'),
  );
  assert.doesNotMatch(caption, /observed\s*·\s*observed/);
  assert.match(caption, /2/);
  assert.match(caption, /worker/);
});
