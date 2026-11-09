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
const assignment = (id, parentCardId) => ({
  id,
  parentSessionId: 'root',
  parentCardId,
  parentTurn: 1,
  callSeq: 1,
  childSessionId: 'worker',
  label: 'Delegated follow-up',
  kind: 'message',
  status: 'accepted',
});

test('follow-up cards use assignment parent cards instead of the child session start', () => {
  const render = harness();
  const firstChild = card('child-first', 'First result', 1100);
  const secondChild = card('child-second', 'Second result', 2100);
  const thirdChild = card('child-third', 'Third result', 3100);
  const first = card('owner-first', 'Owner first', 1000, {
    subtasks: [
      task('Research SDK', [firstChild]),
      task('Delegated follow-up', [], {
        status: 'running',
        attribution: 'pending',
        reason: 'Delivered, awaiting child evidence.',
      }),
    ],
  });
  const second = card('owner-second', 'Owner second', 2000, {
    subtasks: [
      task('Delegated follow-up', [], {
        status: 'running',
        attribution: 'pending',
        reason: 'Delivered, awaiting child evidence.',
      }),
    ],
  });
  const third = card('owner-third', 'Owner third', 3000, {
    subtasks: [
      task('Delegated follow-up', [], {
        status: 'running',
        attribution: 'pending',
        reason: 'Delivered, awaiting child evidence.',
      }),
    ],
  });
  const tree = render({
    root: {
      cards: [first, second, third],
      assignments: [
        assignment('spawn', 'owner-first'),
        assignment('follow-second', 'owner-second'),
        assignment('follow-third', 'owner-third'),
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

  assert.ok(article(article(tree, 'Owner first'), 'First result'));
  assert.ok(
    article(article(tree, 'Owner second'), 'Second result'),
    'the second follow-up card must stay under the second parent card',
  );
  assert.ok(
    article(article(tree, 'Owner third'), 'Third result'),
    'the third follow-up card must stay under the third parent card',
  );
  assert.equal(
    article(article(tree, 'Owner first'), 'Second result'),
    undefined,
  );
  assert.equal(
    article(article(tree, 'Owner second'), 'Third result'),
    undefined,
  );
  const pendingFollowups = detailsWithCaption(tree, (caption) =>
    caption.includes('Delegated follow-up'),
  ).filter(
    (node) => !String(node.props.className || '').includes('aai-inferred'),
  );
  assert.equal(
    pendingFollowups.length,
    0,
    'covered pending follow-ups must not remain as separate rows',
  );
  assert.equal(unlinkedGroups(tree).length, 0);
});
