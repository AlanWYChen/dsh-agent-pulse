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
  return ({ root, sessions = [] }) =>
    expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => root,
        useSessions: (selector) =>
          selector({
            projectionsBySession: Object.fromEntries(
              sessions.map((session) => [
                session.sessionId,
                {
                  values: {
                    agentActivityIntelligence: {
                      sessionId: session.sessionId,
                      parentSession: session.parentSession,
                      cards: session.cards,
                    },
                  },
                },
              ]),
            ),
            byId: Object.fromEntries(
              sessions.map((session) => [
                session.sessionId,
                { id: session.sessionId, parentId: session.parentSession },
              ]),
            ),
          }),
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
const ownTitle = (node) =>
  text((node.children || []).find((child) => child?.type === 'h3'));
const article = (tree, title) =>
  walk(tree, (node) => node.type === 'article' && ownTitle(node) === title)[0];
const inferredGroups = (tree) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes('aai-inferred'),
  );
const caption = (group) =>
  text((group.children || []).find((node) => node?.type === 'summary'));

const card = (id, title, time, extra = {}) => ({
  id,
  category: 'outcome',
  title,
  summary: title + ' summary',
  status: 'completed',
  summaryStatus: 'ready',
  time,
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});
const task = (label, cards, extra = {}) => ({
  id: `task-${label}`,
  label,
  sessionId: 'worker',
  cards,
  status: 'completed',
  attribution: 'linked',
  ...extra,
});
const assignment = (id, parentCardId, label, kind = 'message') => ({
  id,
  parentSessionId: 'root',
  parentCardId,
  parentTurn: 1,
  callSeq: 1,
  childSessionId: 'worker',
  label,
  kind,
  status: 'accepted',
});

function treeWith(labels) {
  const firstChild = card('child-first', 'First result', 1100);
  const secondChild = card('child-second', 'Second result', 2100);
  const thirdChild = card('child-third', 'Third result', 3100);
  const first = card('owner-first', 'Owner first', 1000, {
    subtasks: [task('Implement client inference', [firstChild])],
  });
  const pending = (label) =>
    task(label, [], {
      status: 'running',
      attribution: 'pending',
      reason: 'Delivered, awaiting child evidence.',
    });
  const second = card('owner-second', 'Owner second', 2000, {
    subtasks: [pending(labels.second)],
  });
  const third = card('owner-third', 'Owner third', 3000, {
    subtasks: [pending(labels.third)],
  });
  return harness()({
    root: {
      cards: [first, second, third],
      assignments: [
        assignment(
          'spawn',
          'owner-first',
          'Implement client inference',
          'spawn',
        ),
        assignment('follow-second', 'owner-second', labels.second),
        assignment('follow-third', 'owner-third', labels.third),
      ],
    },
    sessions: [
      {
        sessionId: 'worker',
        parentSession: 'root',
        cards: [firstChild, secondChild, thirdChild],
      },
    ],
  });
}

test('later inferred tasks use the spawn session label, not the generic follow-up label', () => {
  const tree = treeWith({
    second: 'Delegated follow-up',
    third: 'Delegated follow-up',
  });
  const groups = inferredGroups(tree);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    assert.match(caption(group), /Implement client inference/);
    assert.doesNotMatch(caption(group), /Delegated follow-up/);
  }
  assert.ok(article(article(tree, 'Owner second'), 'Second result'));
  assert.ok(article(article(tree, 'Owner third'), 'Third result'));
});

test('a specific follow-up assignment label still wins over the spawn label', () => {
  const tree = treeWith({
    second: 'Review payments',
    third: 'Review payments',
  });
  const groups = inferredGroups(tree);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    assert.match(caption(group), /Review payments/);
    assert.doesNotMatch(caption(group), /Implement client inference/);
  }
});
