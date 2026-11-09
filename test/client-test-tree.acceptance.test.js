import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Same VM/module-loader boundary as client.test.js. Effects are deliberately idle:
// these tests exercise catalog fallback rendering, not asynchronous watch transport.
function render(sessions) {
  let definition;
  let dictionaries;
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
  const plugin = definition.factory((name) => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives')
      return { TextShimmer: 'shimmer' };
    assert.equal(name, 'react');
    return React;
  });
  const t = (key) =>
    dictionaries?.['en-US']?.[key] || dictionaries?.en?.[key] || key;
  plugin.apply({
    effect: (fn) => fn(),
    locale: {
      register: (_, value) => {
        dictionaries = value;
        return () => {};
      },
      bind: () => t,
    },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab() {}, openResource() {} },
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
    (r) =>
      r.options.name === 'sidebar.right.pane.tab' &&
      r.options.key === '@local/dsh-agent-activity-intelligence',
  );
  const catalog = {
    projectionsBySession: Object.fromEntries(
      sessions.map((s) => [
        s.sessionId,
        { values: { agentActivityIntelligence: s } },
      ]),
    ),
    byId: Object.fromEntries(
      sessions.map((s) => [
        s.sessionId,
        { id: s.sessionId, parentId: s.parentSession },
      ]),
    ),
  };
  const tree = body.Component({
    ...body.options.inject('root', {}),
    sessionId: 'root',
    t,
    useProjection: () => sessions.find((s) => s.sessionId === 'root'),
    useSessions: (selector) => selector(catalog),
    useTabInfo: () => ({ tab: { visible: true } }),
  });
  const expand = (node) => {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function')
      return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: expand(node.children) };
  };
  return expand(tree);
}
const text = (node) =>
  node == null || node === false
    ? ''
    : typeof node === 'object'
      ? (Array.isArray(node) ? node : node.children || []).map(text).join(' ')
      : String(node);
function visit(node, predicate, rows = []) {
  if (!node || typeof node !== 'object') return rows;
  if (Array.isArray(node)) {
    node.forEach((n) => visit(n, predicate, rows));
    return rows;
  }
  if (predicate(node)) rows.push(node);
  visit(node.children, predicate, rows);
  return rows;
}
const group = (tree, id) =>
  visit(
    tree,
    (n) =>
      n.type === 'details' &&
      n.children
        .flat(Infinity)
        .some((s) => s?.type === 'summary' && text(s).includes(id)),
  )[0];
const run = (
  id,
  executionStatus = 'completed',
  resultStatus = 'passed',
  counts = { passed: 13, failed: 0, skipped: 2 },
) => ({
  id,
  sessionId: 'child',
  agentId: 'child',
  callSeq: id === 'newest-run' ? 20 : 1,
  resultSeq: 21,
  executionStatus,
  resultStatus,
  counts,
  exitCode:
    executionStatus === 'command-failed'
      ? 127
      : executionStatus === 'completed'
        ? 0
        : null,
});
function session(id, parentSession, options = {}) {
  return {
    sessionId: id,
    parentSession: parentSession || null,
    cards: [
      {
        id: `outcome:${id}`,
        category: 'outcome',
        title: `${id} summary`,
        summary: `${id} behavior`,
        status: options.status || 'observed',
        summaryStatus: options.summaryStatus || 'ready',
        time: id === 'root' ? 1 : id === 'child' ? 2 : 3,
        files: [],
        evidence: [],
        verification: { status: 'not-run', label: 'No test verification' },
        testRuns: options.testRuns || [],
      },
    ],
  };
}

test('descendant summaries are nested under immediate parent, never flat root siblings', () => {
  const tree = render([
    session('root'),
    session('child', 'root'),
    session('grandchild', 'child'),
  ]);
  const child = group(tree, 'child');
  assert.ok(child, 'child must have a semantic disclosure group');
  const grandchild = group(child, 'grandchild');
  assert.ok(grandchild, 'grandchild must be inside child disclosure');
  assert.notEqual(child, grandchild);
  assert.equal(
    Boolean(child.props.open),
    true,
    'inner subtask disclosures stay open; the outer Subtasks group collapses',
  );
  assert.equal(Boolean(grandchild.props.open), true);
  assert.match(text(child), /child summary/);
  assert.match(text(grandchild), /grandchild summary/);
  assert.match(text(tree), /root summary/);
});

for (const [label, options] of [
  ['running agent', { summaryStatus: 'in_progress' }],
  ['failed agent', { status: 'failed' }],
  ['running test', { testRuns: [run('running', 'running', 'unknown', null)] }],
  [
    'failed test',
    {
      testRuns: [
        run('failed', 'command-failed', 'failed', {
          passed: 1,
          failed: 2,
          skipped: 0,
        }),
      ],
    },
  ],
])
  test(`descendant disclosure opens automatically for ${label}`, () => {
    const tree = render([session('root'), session('child', 'root', options)]);
    const child = group(tree, 'child');
    assert.ok(child, 'child disclosure must exist');
    assert.equal(Boolean(child.props.open), true);
  });

test('every test run is rendered newest first with counts and honest non-assertion failure status', () => {
  const tree = render([
    session('root', null, {
      testRuns: [
        { ...run('oldest-run'), sessionId: 'root' },
        {
          ...run('newest-run', 'command-failed', 'unknown', null),
          sessionId: 'root',
        },
      ],
    }),
  ]);
  const content = text(tree);
  assert.ok(
    content.includes('newest-run'),
    'each run needs a visible identity',
  );
  assert.ok(content.includes('oldest-run'));
  assert.ok(content.indexOf('newest-run') < content.indexOf('oldest-run'));
  assert.match(content, /13\s+passed/i);
  assert.match(content, /2\s+skipped/i);
  assert.match(content, /command.failed|exit\s*(?:code\s*)?127/i);
  assert.doesNotMatch(content, /127\s+(?:tests?\s+)?failed/i);
});
