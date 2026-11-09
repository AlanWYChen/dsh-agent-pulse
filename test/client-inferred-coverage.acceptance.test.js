import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Static renderer for the assignment/coverage layer. Effects stay idle.
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
const unlinkedGroups = (tree) =>
  detailsWithCaption(tree, () => true).filter((node) =>
    String(node.props.className || '').includes('aai-unlinked'),
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
const session = (sessionId, parentSession, cards) => ({
  sessionId,
  parentSession,
  cards,
});

test('represented child sessions do not duplicate empty spawn/follow-up assignments', () => {
  const render = harness();
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Research SDK', [], {
        status: 'unavailable',
        attribution: 'unavailable',
      }),
      task('Delegated follow-up', [], {
        status: 'running',
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

  assert.equal(inferredGroups(tree).length, 1);
  assert.ok(article(article(tree, 'Owner'), 'Research result'));
  assert.equal(
    unlinkedGroups(tree).length,
    0,
    'covered empty spawn rows must not duplicate the inferred disclosure',
  );
  assert.equal(
    detailsWithCaption(tree, (caption) =>
      caption.includes('Delegated follow-up'),
    ).length,
    0,
    'covered empty follow-up rows must not render as running placeholders',
  );
  assert.match(text(article(tree, 'Owner')), /Research SDK/);
});

test('exact task coverage also hides an empty follow-up for the same child', () => {
  const render = harness();
  const exact = card('exact', 'Exact result', 1100);
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Research SDK', [exact]),
      task('Delegated follow-up', [], {
        status: 'running',
        attribution: 'unavailable',
      }),
    ],
  });
  const tree = render({
    root: { cards: [owner] },
    sessions: [session('worker', 'root', [exact])],
  });

  assert.equal(inferredGroups(tree).length, 0);
  assert.ok(article(tree, 'Exact result'));
  assert.equal(
    detailsWithCaption(tree, (caption) =>
      caption.includes('Delegated follow-up'),
    ).length,
    0,
    'an empty follow-up must not remain beside an exact linked task',
  );
  assert.equal(unlinkedGroups(tree).length, 0);
});

test('uncovered empty follow-ups remain visible and use a provenance label', () => {
  const render = harness();
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Delegated follow-up', [], {
        status: 'running',
        attribution: 'unavailable',
      }),
    ],
  });
  const tree = render({ root: { cards: [owner] } });

  const followup = detailsWithCaption(tree, (caption) =>
    caption.includes('Delegated follow-up'),
  )[0];
  assert.ok(
    followup,
    'an unresolved follow-up without child evidence must stay visible',
  );
  const caption = text(
    followup.children.find((node) => node?.type === 'summary'),
  );
  assert.match(caption, /unavailableAttribution/);
  assert.doesNotMatch(caption, /\bunavailable\b(?!Attribution)/);
});

test('uncovered empty unlinked assignments remain in the fallback list', () => {
  const render = harness();
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Historical research', [], {
        status: 'unavailable',
        attribution: 'unavailable',
      }),
    ],
  });
  const tree = render({ root: { cards: [owner] } });

  const groups = unlinkedGroups(tree);
  assert.equal(groups.length, 1);
  assert.match(text(groups[0]), /Historical research/);
});

test('mixed covered and uncovered children keep only the uncovered fallback', () => {
  const render = harness();
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Research SDK', [], {
        status: 'unavailable',
        attribution: 'unavailable',
      }),
      task('Elsewhere research', [], {
        status: 'unavailable',
        attribution: 'unavailable',
        sessionId: 'other-worker',
      }),
    ],
  });
  const tree = render({
    root: { cards: [owner] },
    sessions: [
      session('worker', 'root', [card('child', 'Research result', 1200)]),
    ],
  });

  const groups = unlinkedGroups(tree);
  assert.equal(groups.length, 1);
  assert.match(text(groups[0]), /Elsewhere research/);
  assert.doesNotMatch(text(groups[0]), /Research SDK/);
  assert.equal(inferredGroups(tree).length, 1);
});
