import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent static React renderer: function components are expanded manually,
// effects stay idle, and hooks are replayed so filter interactions work.
function setup() {
  let definition;
  let stateIndex = 0;
  const states = [];
  const registrations = [];
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

  return ({ root, sessions = [], actions = {} }) => {
    stateIndex = 0;
    return expand(
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
                      ...(session.assignments
                        ? { assignments: session.assignments }
                        : {}),
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
  };
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
const articles = (tree, title) =>
  walk(tree, (node) => node.type === 'article' && ownTitle(node) === title);
const detailsWithCaption = (tree, predicate) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      predicate(
        text((node.children || []).find((child) => child?.type === 'summary')),
      ),
  );
const inferredGroups = (tree) =>
  detailsWithCaption(tree, () => true).filter((node) =>
    String(node.props.className || '').includes('aai-inferred'),
  );
const legacyGroups = (tree) =>
  detailsWithCaption(tree, () => true).filter(
    (node) =>
      String(node.props.className || '').includes('aai-session-group') &&
      !String(node.props.className || '').includes('aai-inferred'),
  );
const filterButton = (tree, label) =>
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
const session = (sessionId, parentSession, cards, assignments) => ({
  sessionId,
  parentSession,
  cards,
  ...(assignments ? { assignments } : {}),
});
const task = (label, cards, extra = {}) => ({
  id: 'task',
  label,
  sessionId: 'worker',
  cards,
  status: 'completed',
  attribution: 'linked',
  ...extra,
});

test('unlinked child session nests inside the nearest parent outcome article', () => {
  const render = setup();
  const early = card('owner-early', 'Owner early', 1000);
  const late = card('owner-late', 'Owner late', 5000);
  const child = card('child-result', 'Research result', 1500);
  const tree = render({
    root: { cards: [early, late] },
    sessions: [session('worker', 'root', [child])],
  });

  const owner = article(tree, 'Owner early');
  assert.ok(owner, 'the nearest parent outcome card must render');
  assert.ok(
    article(owner, 'Research result'),
    'the child article must be nested inside the parent article',
  );
  assert.equal(articles(tree, 'Research result').length, 1);
  assert.equal(inferredGroups(tree).length, 1);
  assert.equal(legacyGroups(tree).length, 0);

  const group = inferredGroups(tree)[0];
  const caption = text(
    (group.children || []).find((node) => node?.type === 'summary'),
  );
  assert.match(caption, /delegatedWork/);
  assert.match(caption, /agent: worker/);
  assert.match(caption, /completed/);
  assert.doesNotMatch(caption, /inferredAttribution/);
  assert.doesNotMatch(caption, /outcomes?/);
  assert.equal(group.props.open, true);
});

test('one inferred disclosure contains every card for a child session', () => {
  const render = setup();
  const early = card('owner-early', 'Owner early', 1000);
  const late = card('owner-late', 'Owner late', 5000);
  const first = card('child-first', 'First research result', 1200);
  const second = card('child-second', 'Second research result', 2600);
  const tree = render({
    root: { cards: [early, late] },
    sessions: [session('worker', 'root', [first, second])],
  });

  const group = inferredGroups(tree)[0];
  assert.ok(group);
  assert.equal(inferredGroups(tree).length, 1);
  assert.ok(article(group, 'First research result'));
  assert.ok(article(group, 'Second research result'));
  assert.equal(articles(tree, 'First research result').length, 1);
  assert.equal(articles(tree, 'Second research result').length, 1);
  assert.equal(legacyGroups(tree).length, 0);
  const caption = text(group.children.find((node) => node?.type === 'summary'));
  assert.match(caption, /completed/);
  assert.doesNotMatch(caption, /outcomes?/);
});

test('nearest parent card wins, including ties and later summaries', () => {
  const render = setup();
  const first = card('owner-first', 'Owner first', 1000);
  const second = card('owner-second', 'Owner second', 3000);

  const laterTree = render({
    root: { cards: [first, second] },
    sessions: [session('worker', 'root', [card('later', 'Later child', 3100)])],
  });
  assert.ok(
    article(article(laterTree, 'Owner second'), 'Later child'),
    'a child after the second card must use the second card',
  );
  assert.equal(
    article(article(laterTree, 'Owner first'), 'Later child'),
    undefined,
  );

  const tieTree = render({
    root: { cards: [first, second] },
    sessions: [session('worker', 'root', [card('tie', 'Tie child', 2000)])],
  });
  assert.ok(
    article(article(tieTree, 'Owner first'), 'Tie child'),
    'an equidistant child must use the earlier parent card',
  );
  assert.equal(
    article(article(tieTree, 'Owner second'), 'Tie child'),
    undefined,
  );
});

test('earliest child card chooses one owner for all of its outcomes', () => {
  const render = setup();
  const first = card('owner-first', 'Owner first', 1000);
  const second = card('owner-second', 'Owner second', 1500);
  const earlyChild = card('child-early', 'Early child', 1200);
  const laterChild = card('child-later', 'Later child', 2000);
  const tree = render({
    root: { cards: [first, second] },
    sessions: [session('worker', 'root', [earlyChild, laterChild])],
  });

  const group = inferredGroups(tree)[0];
  assert.ok(group);
  assert.ok(article(article(tree, 'Owner first'), 'Early child'));
  assert.ok(
    article(article(tree, 'Owner first'), 'Later child'),
    'later child cards stay with the session-chosen owner',
  );
  assert.equal(
    article(article(tree, 'Owner second'), 'Later child'),
    undefined,
  );
  assert.equal(legacyGroups(tree).length, 0);
});

test('exact assignment stays put while a leftover card nests as inferred', () => {
  const render = setup();
  const exact = card('exact-result', 'Exact task result', 1000);
  const leftover = card('leftover-result', 'Leftover result', 2000);
  const first = card('owner-first', 'Owner first', 900, {
    subtasks: [task('Research SDK', [exact])],
  });
  const second = card('owner-second', 'Owner second', 1500);
  const tree = render({
    root: { cards: [first, second] },
    sessions: [session('worker', 'root', [exact, leftover])],
  });

  const owner = article(tree, 'Owner first');
  const assignment = detailsWithCaption(owner, (caption) =>
    caption.includes('Research SDK'),
  )[0];
  assert.ok(assignment, 'the exact task disclosure must render');
  assert.ok(article(assignment, 'Exact task result'));
  const inferred = inferredGroups(owner);
  assert.equal(inferred.length, 1);
  assert.ok(article(inferred[0], 'Leftover result'));
  assert.equal(article(inferred[0], 'Exact task result'), undefined);
  assert.equal(articles(tree, 'Exact task result').length, 1);
  assert.equal(articles(tree, 'Leftover result').length, 1);
  assert.equal(legacyGroups(tree).length, 0);
});

test('known task label is used for the inferred disclosure caption', () => {
  const render = setup();
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Research SDK', [], {
        status: 'unavailable',
        attribution: 'unavailable',
      }),
    ],
  });
  const tree = render({
    root: { cards: [owner] },
    sessions: [
      session('worker', 'root', [card('child', 'Research result', 1200)]),
    ],
  });

  const group = inferredGroups(tree)[0];
  assert.ok(group, 'inferred disclosure must exist');
  const caption = text(group.children.find((node) => node?.type === 'summary'));
  assert.match(caption, /Research SDK/);
  assert.match(caption, /completed/);
  assert.doesNotMatch(caption, /inferredAttribution/);
  assert.doesNotMatch(caption, /delegatedWork/);
});

test('known task label can come from parent session assignments', () => {
  const render = setup();
  const owner = card('owner', 'Owner', 1000);
  const tree = render({
    root: {
      cards: [owner],
      assignments: [
        {
          id: 'assignment',
          parentSessionId: 'root',
          parentCardId: 'owner',
          parentTurn: 1,
          callSeq: 1,
          childSessionId: 'worker',
          label: 'Research SDK',
          kind: 'spawn',
          status: 'accepted',
        },
      ],
    },
    sessions: [
      session('worker', 'root', [card('child', 'Research result', 1200)]),
    ],
  });

  const group = inferredGroups(tree)[0];
  assert.ok(group, 'inferred disclosure must exist');
  const caption = text(group.children.find((node) => node?.type === 'summary'));
  assert.match(caption, /Research SDK/);
});

test('grandchild inference stays inside the inferred child card', () => {
  const render = setup();
  const rootCard = card('owner', 'Owner', 1000);
  const childCard = card('child', 'Child result', 1500);
  const grandchildCard = card('grandchild', 'Grandchild result', 2000);
  const tree = render({
    root: { cards: [rootCard] },
    sessions: [
      session('worker', 'root', [childCard]),
      session('grandworker', 'worker', [grandchildCard]),
    ],
  });

  const child = article(article(tree, 'Owner'), 'Child result');
  assert.ok(child);
  assert.ok(article(child, 'Grandchild result'));
  assert.equal(articles(tree, 'Grandchild result').length, 1);
  assert.equal(inferredGroups(tree).length, 2);
  assert.equal(legacyGroups(tree).length, 0);
});

test('attention filter keeps a failed child visible when its owner is filtered away', () => {
  const render = setup();
  const owner = card('owner', 'Owner outcome', 1000);
  const failure = card('failure', 'Child failure', 1200, {
    category: 'attention',
    status: 'failed',
    verification: { status: 'failed' },
  });
  const tree = render({
    root: { cards: [owner] },
    sessions: [session('worker', 'root', [failure])],
  });

  assert.ok(article(article(tree, 'Owner outcome'), 'Child failure'));
  const filter = filterButton(tree, 'attention');
  assert.ok(filter, 'attention filter control exists');
  filter.props.onClick();

  const filtered = render({
    root: { cards: [owner] },
    sessions: [session('worker', 'root', [failure])],
  });
  assert.equal(article(filtered, 'Owner outcome'), undefined);
  assert.equal(articles(filtered, 'Child failure').length, 1);
  assert.ok(
    legacyGroups(filtered).some((group) => article(group, 'Child failure')),
    'filtered-away owners must not hide the child failure',
  );
  assert.equal(inferredGroups(filtered).length, 0);
});

test('a child without timestamps stays in the qualified bottom fallback', () => {
  const render = setup();
  const owner = card('owner', 'Owner outcome', 1000);
  const child = card('child', 'Untimed child result', undefined);
  const tree = render({
    root: { cards: [owner] },
    sessions: [session('worker', 'root', [child])],
  });

  assert.equal(inferredGroups(tree).length, 0);
  assert.equal(
    article(article(tree, 'Owner outcome'), 'Untimed child result'),
    undefined,
  );
  assert.equal(articles(tree, 'Untimed child result').length, 1);
  assert.ok(
    legacyGroups(tree).some((group) => article(group, 'Untimed child result')),
    'unplaceable evidence must remain visible in the fallback',
  );
});
