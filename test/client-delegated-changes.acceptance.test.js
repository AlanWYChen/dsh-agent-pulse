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
  return ({ cards, sessions = [], actions = {} }) =>
    expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => ({ cards }),
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
      ? (Array.isArray(node) ? node : node.children || []).map(text).join(' ')
      : String(node);
const ownTitle = (node) =>
  text((node.children || []).find((child) => child?.type === 'h3'));
const article = (tree, title) =>
  walk(tree, (node) => node.type === 'article' && ownTitle(node) === title)[0];
const details = (tree, className) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes(className),
  );
const button = (tree, label) =>
  walk(tree, (node) => node.type === 'button' && text(node) === label)[0];

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
const task = (label, cards, sessionId = 'worker') => ({
  id: `task-${label}`,
  label,
  sessionId,
  cards,
  status: 'completed',
  attribution: 'linked',
});
const childSession = (cards) => ({
  sessionId: 'worker',
  parentSession: 'root',
  cards,
});

test('parent fallback changes resolve to an exact child card review entry', async () => {
  const child = card('child', 'Child result', 1200, {
    changeFiles: [{ id: 'child-file', label: 'client.js' }],
  });
  const parent = card('owner', 'Owner', 1000, {
    files: ['client.js'],
    subtasks: [task('Research', [child])],
  });
  const diffs = [];
  const tree = harness()({
    cards: [parent],
    sessions: [childSession([child])],
    actions: {
      openDiff: async (coords) => {
        diffs.push(coords);
      },
    },
  });
  const parentChanges = details(article(tree, 'Owner'), 'aai-changes').at(-1);
  assert.ok(parentChanges);
  const link = button(parentChanges, 'client.js');
  assert.ok(link, 'the parent file label must become a review button');
  await link.props.onClick();
  assert.equal(diffs[0].sourceSessionId, 'worker');
  assert.equal(diffs[0].cardId, 'child');
  assert.equal(diffs[0].fileId, 'child-file');
  assert.equal(diffs[0].label, 'client.js');
});

test('parent fallback changes resolve to an inferred child card review entry', async () => {
  const child = card('child', 'Child result', 1200, {
    changeFiles: [{ id: 'inferred-file', label: 'README.md' }],
  });
  const parent = card('owner', 'Owner', 1000, {
    files: ['README.md'],
  });
  const diffs = [];
  const tree = harness()({
    cards: [parent],
    sessions: [childSession([child])],
    actions: {
      openDiff: async (coords) => {
        diffs.push(coords);
      },
    },
  });
  const parentChanges = details(article(tree, 'Owner'), 'aai-changes').at(-1);
  assert.ok(parentChanges);
  const link = button(parentChanges, 'README.md');
  assert.ok(
    link,
    'an inferred child review entry must be clickable from the parent',
  );
  await link.props.onClick();
  assert.equal(diffs[0].sourceSessionId, 'worker');
  assert.equal(diffs[0].cardId, 'child');
  assert.equal(diffs[0].fileId, 'inferred-file');
});

test('a changed card with no captured test run shows an explicit zero-run gap', () => {
  const tree = harness()({
    cards: [
      card('owner', 'Owner', 1000, {
        files: ['src/app.js'],
      }),
    ],
  });
  const history = details(tree, 'aai-test-history');
  assert.equal(history.length, 1);
  const caption = text(
    history[0].children.find((node) => node?.type === 'summary'),
  );
  assert.match(caption, /testHistory/);
  assert.match(caption, /0/);
  assert.match(text(history[0]), /noTestRun/);
});

test('a card without changes or runs keeps no empty test history', () => {
  const tree = harness()({ cards: [card('owner', 'Owner', 1000)] });
  assert.equal(details(tree, 'aai-test-history').length, 0);
});
