import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Independent VM harness; no imports or modifications of frozen test files.
function renderRuns(testRuns) {
  let definition;
  let dictionaries;
  const t = (key) =>
    dictionaries?.['en-US']?.[key] || dictionaries?.en?.[key] || key;
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
    useEffect() {},
  };
  vm.runInNewContext(
    readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'),
    {
      window: {
        __ModuleLoader__: {
          load: (v) => {
            definition = v;
          },
        },
      },
      AbortController,
      URL,
    },
  );
  const plugin = definition.factory((name) =>
    name === 'react' ? React : { TextShimmer: 'shimmer' },
  );
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
  const tree = body.Component({
    ...body.options.inject('root', {}),
    sessionId: 'root',
    t,
    useProjection: () => ({
      sessionId: 'root',
      cards: [
        {
          id: 'outcome:1',
          category: 'outcome',
          title: 'Root',
          summary: 'Root work',
          status: 'observed',
          summaryStatus: 'ready',
          files: [],
          evidence: [],
          verification: {
            status: 'not-run',
            label: 'No supported test result observed',
          },
          testRuns,
        },
      ],
    }),
    useSessions: (selector) => selector({ projectionsBySession: {}, byId: {} }),
    useTabInfo: () => ({ tab: { visible: true } }),
  });
  const expand = (n) => {
    if (n == null || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(expand);
    if (typeof n.type === 'function')
      return expand(n.type({ ...n.props, children: n.children }));
    return { ...n, children: expand(n.children) };
  };
  const text = (n) =>
    n == null || n === false
      ? ''
      : typeof n === 'object'
        ? (Array.isArray(n) ? n : n.children || []).map(text).join(' ')
        : String(n);
  return text(expand(tree));
}
const run = (id, sessionId, callSeq, startedAt) => ({
  id,
  sessionId,
  agentId: sessionId,
  callSeq,
  resultSeq: callSeq + 1,
  executionStatus: 'completed',
  resultStatus: 'unknown',
  counts: null,
  exitCode: 0,
  ...(startedAt === undefined ? {} : { startedAt }),
});

test('aggregate display sorts cross-session runs by startedAt rather than incomparable local callSeq', () => {
  const runs = [
    run('chronologically-old', 'child-a', 999, 1000),
    run('chronologically-new', 'child-b', 1, 3000),
    run('chronologically-middle', 'root', 100, 2000),
  ];
  const before = structuredClone(runs);
  const content = renderRuns(runs);
  for (const r of runs)
    assert.ok(content.includes(r.id), `visible run ${r.id}`);
  assert.ok(
    content.indexOf('chronologically-new') <
      content.indexOf('chronologically-middle'),
  );
  assert.ok(
    content.indexOf('chronologically-middle') <
      content.indexOf('chronologically-old'),
  );
  assert.deepEqual(
    runs,
    before,
    'render sorting must not mutate watched snapshot',
  );
});

test('observed background result is distinguished from unestablished change coverage', () => {
  const content = renderRuns([
    {
      ...run('background-passed', 'root', 1),
      resultStatus: 'passed',
      counts: { passed: 3, failed: 0, skipped: 0 },
    },
  ]);
  assert.ok(content.includes('background-passed'));
  assert.match(content, /3\s+passed/i);
  assert.doesNotMatch(content, /No supported test result observed/i);
  assert.match(
    content,
    /(?:coverage.{0,30}not established|coverage.{0,30}unverified|not.{0,30}verified.{0,30}changes)/i,
  );
});

test('absence of any runs is explicitly described as no test run observed', () => {
  const content = renderRuns([]);
  assert.match(content, /No test run observed/i);
});

test('local history without timestamps retains newest callSeq fallback', () => {
  const content = renderRuns([
    run('local-old', 'root', 2),
    run('local-new', 'root', 9),
  ]);
  assert.ok(content.includes('local-new'));
  assert.ok(content.includes('local-old'));
  assert.ok(content.indexOf('local-new') < content.indexOf('local-old'));
});
