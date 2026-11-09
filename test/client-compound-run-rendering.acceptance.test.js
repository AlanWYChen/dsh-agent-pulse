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
const section = (tree, className) =>
  walk(
    tree,
    (node) =>
      node.type === 'details' &&
      String(node.props.className || '').includes(className),
  )[0];
const card = (extra = {}) => ({
  id: 'owner',
  category: 'outcome',
  title: 'Owner',
  summary: 'Owner summary',
  status: 'completed',
  summaryStatus: 'ready',
  time: 1000,
  verification: { status: 'not-run' },
  files: [],
  testRuns: [],
  ...extra,
});
const compoundRun = (extra = {}) => ({
  id: 'call-compound',
  label: 'npm test',
  executionStatus: 'completed',
  resultStatus: 'unknown',
  counts: null,
  exitCode: null,
  compound: true,
  piped: true,
  sessionId: 'root',
  callSeq: 1,
  ...extra,
});

test('a card with compound runs renders non-empty Test runs (1) and Checks (2) sections', () => {
  const tree = harness()([
    card({
      testRuns: [compoundRun()],
      checkRuns: [
        compoundRun({
          id: 'check-compound',
          label: 'npm run check',
          callSeq: 2,
        }),
        compoundRun({
          id: 'format-compound',
          label: 'npm run format:check',
          callSeq: 3,
        }),
      ],
    }),
  ]);

  const tests = section(tree, 'aai-test-history');
  assert.ok(tests, 'compound test runs must render a Test runs section');
  const testsText = text(tests);
  assert.match(testsText, /testHistory \(1\)/);
  assert.match(testsText, /npm test/);
  assert.equal(
    walk(tests, (node) => node.type === 'li').length,
    1,
    'Test runs (1) must list exactly one compound run',
  );
  assert.match(testsText, /compoundResult/);
  assert.doesNotMatch(testsText, /testIncomplete|testCommandFailed/);

  const checks = section(tree, 'aai-check-history');
  assert.ok(checks, 'compound check runs must render a Checks section');
  const checksText = text(checks);
  assert.match(checksText, /checks \(2\)/);
  assert.match(checksText, /npm run check/);
  assert.match(checksText, /npm run format:check/);
  assert.equal(
    walk(checks, (node) => node.type === 'li').length,
    2,
    'Checks (2) must list exactly two compound runs',
  );
  assert.match(checksText, /compoundResult/);
  assert.doesNotMatch(checksText, /testIncomplete|testCommandFailed/);
});

test('compound status copy is distinguishable from incomplete and failed runs', () => {
  const statusFor = (kind, run) => {
    const tree = harness()([card({ [kind]: [run] })]);
    const className =
      kind === 'testRuns' ? 'aai-test-history' : 'aai-check-history';
    return text(section(tree, className));
  };

  for (const kind of ['testRuns', 'checkRuns']) {
    const compound = statusFor(kind, compoundRun());
    const incomplete = statusFor(
      kind,
      compoundRun({
        compound: false,
        piped: false,
        executionStatus: 'incomplete',
      }),
    );
    const failed = statusFor(
      kind,
      compoundRun({
        compound: false,
        piped: false,
        executionStatus: 'command-failed',
      }),
    );

    assert.match(compound, /compoundResult/, kind);
    assert.match(incomplete, /testIncomplete/, kind);
    assert.match(failed, /testCommandFailed/, kind);
    assert.doesNotMatch(compound, /testIncomplete|testCommandFailed/, kind);
    assert.notEqual(compound, incomplete, kind);
    assert.notEqual(compound, failed, kind);
  }
});
