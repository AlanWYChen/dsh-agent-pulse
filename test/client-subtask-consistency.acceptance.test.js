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
const detailsOf = (tree, className) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes(className),
  );
const summaryText = (details) =>
  text((details.children || []).find((node) => node?.type === 'summary'));

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

test('exact and inferred subtask summaries use the same label-agent-status convention', () => {
  const exact = card('exact', 'Exact result', 1100);
  const leftover = card('leftover', 'Leftover result', 1200);
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Author RED nesting tests', [exact], { attribution: 'legacy' }),
    ],
  });
  const tree = harness()({
    cards: [owner],
    sessions: [
      {
        sessionId: 'worker',
        parentSession: 'root',
        cards: [exact, leftover],
      },
    ],
  });

  const exactDetails = detailsOf(tree, 'aai-assignment').find((node) =>
    summaryText(node).includes('Author RED nesting tests'),
  );
  const inferred = detailsOf(tree, 'aai-inferred')[0];
  assert.ok(exactDetails);
  assert.ok(inferred);
  assert.match(
    summaryText(exactDetails),
    /Author RED nesting tests\s+·\s+agent: worker\s+·\s+completed\s+·\s+legacyInference/,
  );
  assert.match(
    summaryText(inferred),
    /Author RED nesting tests\s+·\s+agent: worker\s+·\s+completed/,
  );
  assert.doesNotMatch(summaryText(inferred), /inferredAttribution|outcomes?/);
});

test('all direct subtask disclosures opt into the same indent treatment', () => {
  const exact = card('exact', 'Exact result', 1100);
  const owner = card('owner', 'Owner', 1000, {
    subtasks: [
      task('Linked task', [exact]),
      task('Unlinked task', [], {
        sessionId: 'other-worker',
        status: 'unavailable',
        attribution: 'unavailable',
      }),
    ],
  });
  const tree = harness()({
    cards: [owner],
    sessions: [
      {
        sessionId: 'worker',
        parentSession: 'root',
        cards: [exact, card('leftover', 'Leftover', 1200)],
      },
    ],
  });

  const exactDetails = detailsOf(tree, 'aai-assignment').find((node) =>
    summaryText(node).includes('Linked task'),
  );
  const unlinked = detailsOf(tree, 'aai-unlinked')[0];
  const inferred = detailsOf(tree, 'aai-inferred')[0];
  assert.ok(inferred);
  for (const details of [exactDetails, inferred, unlinked]) {
    assert.match(String(details.props.className), /\baai-subtask\b/);
    assert.equal(
      details.props.open,
      true,
      'inner subtasks have no individual toggle',
    );
  }

  const style = walk(tree, (node) => node.type === 'style')
    .map(text)
    .join(' ');
  assert.match(style, /\.aai-subtasks\s*>\s*\.aai-subtask/);
  assert.match(style, /\.aai-subtask\s*>\s*summary\s*\{\s*display\s*:\s*none/);
  assert.doesNotMatch(style, /\.aai-inferred\{[^}]*border-left/);
});
