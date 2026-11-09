import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function setup() {
  let definition,
    stateIndex = 0;
  const states = [],
    registrations = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    Fragment: 'fragment',
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
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
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function')
      return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  return (parents, children) => {
    stateIndex = 0;
    return expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => ({ cards: parents }),
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
      }),
    );
  };
}
function walk(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, predicate, result));
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
const title = (node) =>
  text(node.children?.find((child) => child?.type === 'h3'));
const articles = (tree, label) =>
  walk(tree, (node) => node.type === 'article' && title(node) === label);
const groups = (tree) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes('aai-session-group'),
  );
const card = (id, name, extra = {}) => ({
  id,
  title: name,
  summary: name + ' summary',
  category: 'outcome',
  summaryStatus: 'ready',
  status: 'completed',
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});
const task = (cards, attribution = 'linked') => ({
  id: 'task',
  label: 'Assigned investigation',
  sessionId: 'worker',
  status: 'completed',
  attribution,
  cards,
});
const parent = (tasks) => card('owner', 'Owner outcome', { subtasks: tasks });

function assertFallback(tree, name) {
  assert.equal(
    articles(tree, name).length,
    1,
    'unconsumed source outcome is visible exactly once',
  );
  const fallback = groups(tree).find(
    (group) => articles(group, name).length === 1,
  );
  assert.ok(
    fallback,
    'unconsumed source outcome remains in a legacy/unattributed fallback disclosure',
  );
  const caption = text(
    fallback.children.find((node) => node?.type === 'summary'),
  );
  assert.match(
    caption,
    /legacy|unattributed/i,
    'fallback is explicitly qualified, not presented as assigned evidence',
  );
}

test('unavailable assignment with zero linked cards never hides child evidence', () => {
  const source = card('unknown-input', 'Unbound child result');
  const tree = setup()(
    [parent([task([], 'unavailable')])],
    [{ sessionId: 'worker', cards: [source] }],
  );
  assertFallback(tree, 'Unbound child result');
  assert.equal(
    articles(articles(tree, 'Owner outcome')[0], 'Unbound child result').length,
    0,
    'unbound result is not falsely attributed to parent',
  );
});

test('mixed reused-child evidence consumes exact source/card pair only and preserves unmatched outcomes', () => {
  const linked = card('linked', 'Assigned parser result');
  const unrelated = card('later-unbound', 'Independent later result');
  const tree = setup()(
    [parent([task([linked])])],
    [{ sessionId: 'worker', cards: [linked, unrelated] }],
  );
  assert.equal(articles(tree, 'Assigned parser result').length, 1);
  assert.equal(
    articles(articles(tree, 'Owner outcome')[0], 'Assigned parser result')
      .length,
    1,
  );
  assertFallback(tree, 'Independent later result');
  assert.equal(
    groups(tree).some(
      (group) => articles(group, 'Assigned parser result').length > 0,
    ),
    false,
    'linked card is not duplicated in fallback',
  );
});

test('same card id from a different source session is not consumed by another assignment', () => {
  const linked = card('outcome:1', 'Assigned source result');
  const other = card('outcome:1', 'Different source result');
  const tree = setup()(
    [parent([task([linked])])],
    [
      { sessionId: 'worker', cards: [linked] },
      { sessionId: 'other-worker', cards: [other] },
    ],
  );
  assert.equal(articles(tree, 'Assigned source result').length, 1);
  assert.equal(
    articles(tree, 'Different source result').length,
    1,
    'consumption identity includes source session, not only outcome id',
  );
});

test('attention filter preserves child failure when its outcome parent is filtered away', () => {
  const render = setup();
  const failed = card('failure', 'Child failure', {
    category: 'attention',
    status: 'failed',
    verification: { status: 'failed' },
  });
  const parents = [parent([task([failed])])],
    children = [{ sessionId: 'worker', cards: [failed] }];
  const initial = render(parents, children);
  const filter = walk(
    initial,
    (node) => node.type === 'button' && text(node) === 'attention',
  )[0];
  assert.ok(filter, 'attention filter control exists');
  filter.props.onClick();
  const filtered = render(parents, children);
  assert.equal(
    articles(filtered, 'Owner outcome').length,
    0,
    'outcome parent is filtered out',
  );
  assert.equal(
    articles(filtered, 'Child failure').length,
    1,
    'filtering owner never makes qualifying child error disappear',
  );
});
