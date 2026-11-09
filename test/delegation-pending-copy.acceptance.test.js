import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityCoordinator } from '../src/coordinator.js';
import { initState } from '../src/engine.js';

const card = (sessionId, turn, extra = {}) => ({
  id: `outcome:${turn}`,
  category: 'outcome',
  title: `Outcome ${turn}`,
  summary: `Outcome ${turn}`,
  status: 'observed',
  time: turn,
  agentId: sessionId,
  evidence: [],
  files: [],
  testRuns: [],
  verification: { status: 'not-run', label: 'No test evidence' },
  _turn: turn,
  _finalized: true,
  ...extra,
});

const assignment = {
  id: 'follow-up',
  parentSessionId: 'root',
  parentCardId: 'outcome:1',
  parentTurn: 1,
  callSeq: 4,
  childSessionId: 'child',
  label: 'Delegated follow-up',
  kind: 'message',
  status: 'accepted',
};

test('a delivered follow-up without matched child evidence is pending, not historical', async () => {
  const c = new ActivityCoordinator({
    enabled: false,
    assignmentBindingFor: () => ({ messageId: 'receipt' }),
  });
  try {
    c.update(
      { id: 'root' },
      {
        ...initState({ id: 'root' }),
        cards: [{ ...card('root', 1), _delegatedActivity: true }],
        assignments: [assignment],
      },
    );
    c.update(
      { id: 'child' },
      {
        ...initState({
          id: 'child',
          origin: 'subagent',
          parentSession: 'root',
        }),
        cards: [],
        inputs: [],
      },
    );
    const task = c
      .snapshot('root')
      .sessions.find((session) => session.sessionId === 'root').cards[0]
      .subtasks[0];
    assert.equal(task.status, 'running');
    assert.equal(task.attribution, 'pending');
    assert.equal(task.cards.length, 0);
    assert.match(task.reason, /delivered|child outcome/i);
    assert.doesNotMatch(task.reason, /historical delegation/i);
  } finally {
    await c.close();
  }
});

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
const taskDetails = (tree, label) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      text(
        (node.children || []).find((child) => child?.type === 'summary'),
      ).includes(label),
  )[0];
const task = (attribution, status, reason) => ({
  id: 'follow-up',
  label: 'Delegated follow-up',
  sessionId: 'worker',
  cards: [],
  status,
  attribution,
  reason,
});

test('pending attribution renders an awaiting-evidence caption, not historical unavailable copy', () => {
  const reason =
    'The follow-up was delivered, but no matching child outcome has been linked yet.';
  const tree = harness()([
    card('root', 1, {
      subtasks: [task('pending', 'running', reason)],
    }),
  ]);
  const details = taskDetails(tree, 'Delegated follow-up');
  assert.ok(details);
  const caption = text(
    details.children.find((node) => node?.type === 'summary'),
  );
  assert.match(caption, /pendingAttribution/);
  assert.doesNotMatch(caption, /unavailableAttribution/);
  assert.match(text(details), /follow-up was delivered/);
});
