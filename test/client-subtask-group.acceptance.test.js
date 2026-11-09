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
  return ({ cards, sessions = [] }) =>
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
const detailsOf = (tree, className) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes(className),
  );
const summaryText = (details) =>
  text((details.children || []).find((node) => node?.type === 'summary'));
const inferredGroups = (tree) => detailsOf(tree, 'aai-inferred');
const legacyGroups = (tree) =>
  detailsOf(tree, 'aai-session-group').filter(
    (node) => !String(node.props.className || '').includes('aai-inferred'),
  );

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
const worker = (cards) => ({
  sessionId: 'worker',
  parentSession: 'root',
  cards,
});

test('subtasks are wrapped in one collapsed group between test history and changes', () => {
  const exact = card('exact', 'Exact result', 1100);
  const leftover = card('leftover', 'Leftover result', 1200);
  const owner = card('owner', 'Owner', 1000, {
    files: ['x.js'],
    subtasks: [task('Research SDK', [exact])],
  });
  const tree = harness()({
    cards: [owner],
    sessions: [worker([exact, leftover])],
  });

  const groups = detailsOf(tree, 'aai-subtasks');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].props.open, false, 'subtasks must start collapsed');
  assert.match(summaryText(groups[0]), /subtasks/);
  assert.match(summaryText(groups[0]), /2/);
  assert.ok(article(groups[0], 'Exact result'));
  assert.ok(article(groups[0], 'Leftover result'));

  const ownerArticle = article(tree, 'Owner');
  const order = walk(ownerArticle, () => true);
  const history = detailsOf(ownerArticle, 'aai-test-history')[0];
  const changes = detailsOf(ownerArticle, 'aai-changes')[0];
  assert.ok(order.indexOf(history) < order.indexOf(groups[0]));
  assert.ok(order.indexOf(groups[0]) < order.indexOf(changes));
});

test('a completed inferred group shows completed instead of attribution and counts', () => {
  const exact = card('exact', 'Exact result', 1100);
  const leftover = card('leftover', 'Leftover result', 1200);
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [task('Research SDK', [exact])],
  });
  const tree = harness()({
    cards: [owner],
    sessions: [worker([exact, leftover])],
  });

  const group = inferredGroups(tree)[0];
  const caption = summaryText(group);
  assert.match(caption, /Research SDK/);
  assert.match(caption, /completed/);
  assert.doesNotMatch(caption, /inferredAttribution/);
  assert.doesNotMatch(caption, /outcomes?/);
});

test('unfinished inferred groups keep status and use singular outcome counts', () => {
  const running = card('running', 'Running result', 1200, {
    status: 'running',
    summaryStatus: 'in_progress',
  });
  const owner = card('owner', 'Owner', 1000);
  const tree = harness()({
    cards: [owner],
    sessions: [worker([running])],
  });

  const caption = summaryText(inferredGroups(tree)[0]);
  assert.match(caption, /running/);
  assert.match(caption, /inferredAttribution/);
  assert.match(caption, /1\s+outcome\b/);
  assert.doesNotMatch(caption, /1\s+outcomes/);
});

test('legacy session captions pluralize one outcome', () => {
  const child = card('child', 'Untimed result', undefined);
  const tree = harness()({
    cards: [card('owner', 'Owner', 1000)],
    sessions: [worker([child])],
  });

  const group = legacyGroups(tree)[0];
  assert.ok(group);
  assert.match(summaryText(group), /1\s+outcome\b/);
  assert.doesNotMatch(summaryText(group), /1\s+outcomes/);
});
