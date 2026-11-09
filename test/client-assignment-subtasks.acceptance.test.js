import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Independent static React renderer: function components get independent hook calls;
// effects deliberately do not run, so these tests exercise snapshot rendering/actions.
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
  const plugin = definition.factory((name) =>
    name === 'react' ? React : { TextShimmer: 'TextShimmer' },
  );
  plugin.apply({
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
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function')
      return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  return (cards, children = [], actions = {}) =>
    expand(
      body.Component({
        ...body.options.inject('root', {}),
        sessionId: 'root',
        t: (key) => key,
        useProjection: () => ({ cards }),
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
      ? (Array.isArray(node) ? node : node.children || []).map(text).join('')
      : String(node);
const ownTitle = (node) =>
  text((node.children || []).find((child) => child?.type === 'h3'));
const article = (tree, title) =>
  walk(tree, (node) => node.type === 'article' && ownTitle(node) === title)[0];
const button = (tree, label) =>
  walk(tree, (node) => node.type === 'button' && text(node) === label)[0];
const card = (id, title, extra = {}) => ({
  id,
  title,
  category: 'outcome',
  summary: title + ' summary',
  summaryStatus: 'ready',
  status: 'completed',
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});
const task = (id, label, cards, extra = {}) => ({
  id,
  label,
  sessionId: 'worker',
  cards,
  status: 'completed',
  attribution: 'linked',
  ...extra,
});
const taskDetails = (tree, label) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      node.children.some(
        (child) => child?.type === 'summary' && text(child).includes(label),
      ),
  )[0];

function reused() {
  const first = card('child-1', 'Parser assignment result');
  const later = card('child-2', 'Renderer assignment result');
  return {
    first,
    later,
    parents: [
      card('parent-1', 'Parent earlier turn', {
        subtasks: [task('assignment-1', 'Investigate parser', [first])],
      }),
      card('parent-2', 'Parent later turn', {
        subtasks: [task('assignment-2', 'Investigate renderer', [later])],
      }),
    ],
  };
}

test('each reused-child assignment lives inside its specific parent article after Refresh summary', () => {
  const { parents } = reused();
  const tree = harness()(parents);
  for (const [parentTitle, label, childTitle] of [
    ['Parent earlier turn', 'Investigate parser', 'Parser assignment result'],
    ['Parent later turn', 'Investigate renderer', 'Renderer assignment result'],
  ]) {
    const owner = article(tree, parentTitle);
    const details = taskDetails(owner, label);
    assert.ok(
      details,
      'assignment details must be a descendant of its owning parent article',
    );
    assert.ok(
      article(details, childTitle),
      'assignment must contain its matched child outcome',
    );
    const order = walk(owner, () => true);
    assert.ok(
      order.indexOf(button(owner, 'refreshSummary')) < order.indexOf(details),
      'Refresh summary precedes delegated subcards',
    );
    assert.equal(
      details.props.open,
      true,
      'inner subtask disclosures stay open; only the Subtasks group collapses',
    );
  }
  assert.equal(
    article(article(tree, 'Parent earlier turn'), 'Renderer assignment result'),
    undefined,
  );
  assert.equal(
    article(article(tree, 'Parent later turn'), 'Parser assignment result'),
    undefined,
  );
});

test('assignment labels identify tasks and running/failed assignments expand with explicit attribution', () => {
  const tree = harness()([
    card('p', 'Owner', {
      subtasks: [
        task('running', 'Run parser investigation', [], {
          status: 'running',
          attribution: 'shared',
        }),
        task('failed', 'Inspect failed build', [], {
          status: 'failed',
          attribution: 'unavailable',
        }),
      ],
    }),
  ]);
  const owner = article(tree, 'Owner');
  for (const label of ['Run parser investigation', 'Inspect failed build']) {
    const details = taskDetails(owner, label);
    assert.ok(details, 'task label is present in semantic disclosure caption');
    assert.equal(details.props.open, true);
  }
  assert.match(text(taskDetails(owner, 'Run parser investigation')), /shared/i);
  assert.match(
    text(taskDetails(owner, 'Inspect failed build')),
    /unavailable/i,
  );
});

test('nested child actions preserve source-session file, output, and summary coordinates', async () => {
  const diffs = [],
    outputs = [],
    summaries = [];
  const child = card('source-outcome', 'Source result', {
    changeFiles: [{ id: 'source-file', label: 'src/parser.js' }],
    testRuns: [
      {
        id: 'test-call',
        output: true,
        executionStatus: 'completed',
        resultStatus: 'passed',
      },
    ],
  });
  const tree = harness()(
    [
      card('p', 'Owner', {
        subtasks: [
          task('job', 'Review parser', [child], {
            sessionId: 'actual-source-child',
          }),
        ],
      }),
    ],
    [],
    {
      openDiff: async (coords) => {
        diffs.push(coords);
      },
      openResource: (address) => outputs.push(address),
      summaryRpc: async (coords) => {
        summaries.push(coords);
        return { ok: true, value: {} };
      },
    },
  );
  const nested = article(article(tree, 'Owner'), 'Source result');
  assert.ok(nested, 'nested source card must exist before action checks');
  await button(nested, 'src/parser.js').props.onClick();
  assert.equal(diffs[0].sourceSessionId, 'actual-source-child');
  assert.equal(diffs[0].cardId, 'source-outcome');
  assert.equal(diffs[0].fileId, 'source-file');
  button(nested, 'viewOutput').props.onClick();
  assert.equal(
    outputs[0],
    'dsh-resource://activity-test-output/actual-source-child/test-call',
  );
  await button(nested, 'refreshSummary').props.onClick();
  assert.equal(summaries[0].sessionId, 'actual-source-child');
  assert.equal(summaries[0].cardId, 'source-outcome');
});

test('consumed child outcomes render once under assignments, never again as global agent groups', () => {
  const { parents, first, later } = reused();
  const tree = harness()(parents, [
    { sessionId: 'worker', cards: [first, later] },
  ]);
  assert.equal(
    walk(
      tree,
      (node) =>
        node.type === 'article' &&
        ownTitle(node) === 'Parser assignment result',
    ).length,
    1,
  );
  assert.equal(
    walk(
      tree,
      (node) =>
        node.type === 'article' &&
        ownTitle(node) === 'Renderer assignment result',
    ).length,
    1,
  );
  assert.ok(
    article(article(tree, 'Parent earlier turn'), 'Parser assignment result'),
    'only nested source survives deduplication',
  );
  assert.equal(
    walk(
      tree,
      (node) =>
        node.type === 'details' &&
        String(node.props.className || '').includes('aai-session-group'),
    ).length,
    0,
  );
});

test('no-assignment snapshots retain legacy child session fallback instead of hiding evidence', () => {
  const tree = harness()(
    [card('parent', 'Legacy parent')],
    [
      {
        sessionId: 'worker',
        cards: [card('legacy-child', 'Legacy child evidence')],
      },
    ],
  );
  const groups = walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes('aai-session-group'),
  );
  assert.equal(groups.length, 1);
  assert.ok(article(groups[0], 'Legacy child evidence'));
});

test('recursive assignment hierarchy stays inside owners without accumulating visual indentation', () => {
  const leaf = card('leaf', 'Leaf outcome');
  const middle = card('middle', 'Middle outcome', {
    subtasks: [task('deep', 'Deep task', [leaf], { sessionId: 'grandchild' })],
  });
  const tree = harness()([
    card('top', 'Top outcome', {
      subtasks: [task('first', 'First task', [middle])],
    }),
  ]);
  const first = taskDetails(article(tree, 'Top outcome'), 'First task');
  assert.ok(first, 'first delegated assignment must render');
  const deep = taskDetails(article(first, 'Middle outcome'), 'Deep task');
  assert.ok(deep, 'recursive delegation stays inside the middle outcome');
  assert.ok(article(deep, 'Leaf outcome'));
  const caption = text(
    deep.children.find((child) => child?.type === 'summary'),
  );
  assert.ok(
    caption.includes('First task') && caption.includes('Deep task'),
    'deep caption includes task breadcrumb',
  );
  const bounded = walk(
    tree,
    (node) =>
      node.props?.['data-depth'] !== undefined ||
      node.props?.['data-visual-depth'] !== undefined,
  );
  // Any exposed visual depth must remain bounded; logical nesting is asserted above.
  for (const node of bounded) {
    const depth = node.props['data-visual-depth'] ?? node.props['data-depth'];
    assert.ok(
      Number(depth) <= 1,
      'visual depth may not grow with recursive assignment depth',
    );
  }
  const indents = walk(
    deep,
    (node) =>
      Number.parseFloat(node.props?.style?.marginLeft || 0) > 0 ||
      Number.parseFloat(node.props?.style?.paddingLeft || 0) > 0,
  );
  assert.equal(
    indents.length,
    0,
    'deep assignment content must not add another inline indentation level',
  );
});
