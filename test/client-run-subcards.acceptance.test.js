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
const listOf = (node) => walk(node, (item) => item.type === 'ol')[0];
const itemsOf = (node) => walk(node, (item) => item.type === 'li');
const cssOf = (tree) =>
  walk(tree, (node) => node.type === 'style')
    .map(text)
    .join('\n');
const hasClass = (node, name) =>
  String(node?.props?.className || '')
    .split(/\s+/)
    .includes(name);
const titleOf = (run) =>
  walk(run, (node) => node.type === 'h3' && hasClass(node, 'aai-run-title'))[0];
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
const startedAt = Date.UTC(2023, 10, 14, 20, 34, 56);
const stamp = new Date(startedAt).toLocaleString();
const testRun = (extra = {}) => ({
  id: 'call_00_abcdef1234567890',
  label: 'npm test',
  executionStatus: 'completed',
  resultStatus: 'passed',
  counts: { passed: 2, failed: 0, skipped: 0 },
  exitCode: null,
  startedAt,
  output: 'stdout',
  sessionId: 'root',
  callSeq: 1,
  ...extra,
});
const checkRun = (extra = {}) => ({
  id: 'call_01_abcdef1234567890',
  label: 'npm run check',
  executionStatus: 'completed',
  resultStatus: 'unknown',
  exitCode: 0,
  startedAt,
  output: 'stdout',
  sessionId: 'root',
  callSeq: 1,
  ...extra,
});

test('test run sub-cards show timestamp, command, status, counts, and output in order', () => {
  const tree = harness()([card({ testRuns: [testRun()] })]);
  const tests = section(tree, 'aai-test-history');
  assert.ok(tests, 'Test runs disclosure must render');

  const list = listOf(tests);
  assert.ok(list, 'Test runs must keep an ordered list');
  assert.ok(
    hasClass(list, 'aai-run-list'),
    'the run list must use aai-run-list',
  );

  const items = itemsOf(tests);
  assert.equal(items.length, 1);
  const run = items[0];
  assert.ok(hasClass(run, 'aai-run-card'), 'each run must be an aai-run-card');
  assert.ok(hasClass(run, 'aai-test-run'), 'test runs must use aai-test-run');

  const title = titleOf(run);
  assert.ok(title, 'test runs must render an aai-run-title heading');
  assert.equal(text(title), 'npm test');

  const body = text(run);
  const meta = `${stamp} - passed`;
  assert.ok(body.includes(meta), `expected meta "${meta}" in "${body}"`);
  assert.ok(
    body.indexOf('npm test') < body.indexOf(meta),
    'the command title must precede the meta line',
  );
  assert.doesNotMatch(body, /npm test\s+-\s+passed/);

  const counts = body.match(/2 passed\s+0 failed\s+0 skipped/);
  assert.ok(counts, `expected ordered counts in "${body}"`);
  assert.ok(
    body.indexOf(meta) < counts.index,
    'counts must follow the meta line',
  );

  const button = walk(
    run,
    (node) => node.type === 'button' && text(node) === 'viewOutput',
  )[0];
  assert.ok(button, 'View output must be available');
  assert.ok(
    body.indexOf('viewOutput') > counts.index + counts[0].length,
    'View output must follow the counts',
  );

  assert.doesNotMatch(body, /call_00_abcdef1234567890/);
  assert.doesNotMatch(body, /sourceSession/);
});

test('check run sub-cards show timestamp, command, status, exit code, and output in order', () => {
  const tree = harness()([card({ checkRuns: [checkRun()] })]);
  const checks = section(tree, 'aai-check-history');
  assert.ok(checks, 'Checks disclosure must render');

  const list = listOf(checks);
  assert.ok(list, 'Checks must keep an ordered list');
  assert.ok(
    hasClass(list, 'aai-run-list'),
    'the run list must use aai-run-list',
  );

  const items = itemsOf(checks);
  assert.equal(items.length, 1);
  const run = items[0];
  assert.ok(hasClass(run, 'aai-run-card'), 'each run must be an aai-run-card');
  assert.ok(hasClass(run, 'aai-check-run'), 'checks must use aai-check-run');

  const title = titleOf(run);
  assert.ok(title, 'checks must render an aai-run-title heading');
  assert.equal(text(title), 'npm run check');

  const body = text(run);
  const meta = `${stamp} - passed`;
  assert.ok(body.includes(meta), `expected meta "${meta}" in "${body}"`);
  assert.ok(
    body.indexOf('npm run check') < body.indexOf(meta),
    'the check title must precede the meta line',
  );
  assert.doesNotMatch(body, /npm run check\s+-\s+passed/);

  const exitCode = body.match(/exitCode:\s*0/);
  assert.ok(exitCode, `expected the known exit code in "${body}"`);
  assert.ok(
    body.indexOf(meta) < exitCode.index,
    'exit code must follow the meta line',
  );

  const button = walk(
    run,
    (node) => node.type === 'button' && text(node) === 'viewOutput',
  )[0];
  assert.ok(button, 'View output must be available');
  assert.ok(
    body.indexOf('viewOutput') > exitCode.index + exitCode[0].length,
    'View output must follow the exit code',
  );

  assert.doesNotMatch(body, /\d+\s+failed/);
  assert.doesNotMatch(body, /skipped/);
  assert.doesNotMatch(body, /call_01_abcdef1234567890/);
  assert.doesNotMatch(body, /sourceSession/);
});

test('emitted CSS removes run-list numbering and borders run sub-cards', () => {
  const css = cssOf(harness()([card({ testRuns: [testRun()] })]));
  assert.ok(css.includes('.aai-run-list'), 'aai-run-list must be styled');
  assert.ok(css.includes('.aai-run-card'), 'aai-run-card must be styled');

  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
    selector: match[1],
    body: match[2],
  }));
  const unnumbered = rules.filter((rule) =>
    /list-style(?:-type)?\s*:\s*none/.test(rule.body),
  );
  assert.ok(
    unnumbered.some((rule) =>
      /aai-run-(?:list|card|test-run|check-run)/.test(rule.selector),
    ),
    'a run selector must remove list numbering',
  );
  assert.ok(
    rules.some(
      (rule) =>
        /\.aai-run-card/.test(rule.selector) && /border/.test(rule.body),
    ),
    'run sub-cards must be bordered',
  );
});

test('the first subtask card gets a small top gap in emitted CSS', () => {
  const css = cssOf(harness()([card()]));
  assert.match(
    css,
    /\.aai-subtasks\s*>\s*\.aai-subtask:first-of-type\s*\{[^}]*(?:margin|padding)(?:-top)?\s*:\s*8px/,
  );
});

test('test and check disclosures keep one ordered list and one item per run', () => {
  const tree = harness()([
    card({
      testRuns: [testRun(), testRun({ id: 'second-test', callSeq: 2 })],
      checkRuns: [checkRun(), checkRun({ id: 'second-check', callSeq: 2 })],
    }),
  ]);
  for (const [className, count] of [
    ['aai-test-history', 2],
    ['aai-check-history', 2],
  ]) {
    const disclosure = section(tree, className);
    assert.ok(disclosure, className);
    assert.equal(disclosure.type, 'details');
    assert.notEqual(
      disclosure.props.open,
      true,
      `${className} must stay collapsed`,
    );
    const lists = walk(disclosure, (node) => node.type === 'ol');
    assert.equal(lists.length, 1, className);
    assert.equal(walk(lists[0], (node) => node.type === 'li').length, count);
  }
});

test('run headings preserve compound, piped, incomplete, and command-failed keys', () => {
  const cases = [
    [
      'compoundResult',
      {
        executionStatus: 'completed',
        resultStatus: 'unknown',
        compound: true,
        piped: true,
      },
    ],
    [
      'pipedResult',
      { executionStatus: 'completed', resultStatus: 'unknown', piped: true },
    ],
    [
      'testIncomplete',
      { executionStatus: 'incomplete', resultStatus: 'unknown' },
    ],
    [
      'testCommandFailed',
      { executionStatus: 'command-failed', resultStatus: 'unknown' },
    ],
  ];
  for (const [key, extra] of cases) {
    const testTree = harness()([
      card({
        testRuns: [testRun({ id: `run-${key}`, counts: null, ...extra })],
      }),
    ]);
    const testNode = itemsOf(section(testTree, 'aai-test-history'))[0];
    const title = titleOf(testNode);
    assert.ok(title, `test run ${key} must have an aai-run-title heading`);
    assert.equal(text(title), 'npm test');
    const testBody = text(testNode);
    assert.ok(
      testBody.includes(`${stamp} - ${key}`),
      `test run meta must carry ${key}: ${testBody}`,
    );
    assert.doesNotMatch(
      testBody,
      new RegExp(`npm test\\s+-\\s+${key}`),
      `test run must not combine command and status in one heading: ${testBody}`,
    );

    const checkTree = harness()([
      card({
        checkRuns: [checkRun({ id: `run-${key}`, exitCode: null, ...extra })],
      }),
    ]);
    const checkNode = itemsOf(section(checkTree, 'aai-check-history'))[0];
    const checkTitle = titleOf(checkNode);
    assert.ok(
      checkTitle,
      `check run ${key} must have an aai-run-title heading`,
    );
    assert.equal(text(checkTitle), 'npm run check');
    const checkBody = text(checkNode);
    assert.ok(
      checkBody.includes(`${stamp} - ${key}`),
      `check run meta must carry ${key}: ${checkBody}`,
    );
    assert.doesNotMatch(
      checkBody,
      new RegExp(`npm run check\\s+-\\s+${key}`),
      `check run must not combine command and status in one heading: ${checkBody}`,
    );
  }
});

test('missing timestamps and counts are omitted cleanly', () => {
  const tree = harness()([
    card({
      testRuns: [
        testRun({ id: 'run-no-time', startedAt: undefined, counts: null }),
      ],
      checkRuns: [
        checkRun({ id: 'check-no-time', startedAt: undefined, exitCode: null }),
      ],
    }),
  ]);

  const testNode = itemsOf(section(tree, 'aai-test-history'))[0];
  const testTitle = titleOf(testNode);
  assert.ok(testTitle, 'test runs must keep an aai-run-title heading');
  assert.equal(text(testTitle), 'npm test');
  const testBody = text(testNode).trim();
  assert.ok(
    testBody.startsWith('npm test'),
    `expected the command title first in "${testBody}"`,
  );
  assert.match(testBody, /(?:^|\s)passed(?:\s|$)/);
  assert.doesNotMatch(testBody, /^\s*-\s/);
  assert.doesNotMatch(testBody, /npm test\s+-\s+passed/);
  assert.doesNotMatch(testBody, /\d+\s+(?:passed|failed|skipped)/);

  const checkNode = itemsOf(section(tree, 'aai-check-history'))[0];
  const checkTitle = titleOf(checkNode);
  assert.ok(checkTitle, 'checks must keep an aai-run-title heading');
  assert.equal(text(checkTitle), 'npm run check');
  const checkBody = text(checkNode).trim();
  assert.ok(
    checkBody.startsWith('npm run check'),
    `expected the command title first in "${checkBody}"`,
  );
  assert.match(checkBody, /(?:^|\s)testIncomplete(?:\s|$)/);
  assert.doesNotMatch(checkBody, /^\s*-\s/);
  assert.doesNotMatch(checkBody, /npm run check\s+-\s+testIncomplete/);
  assert.doesNotMatch(checkBody, /exitCode/);
  assert.doesNotMatch(checkBody, /skipped/);
});
