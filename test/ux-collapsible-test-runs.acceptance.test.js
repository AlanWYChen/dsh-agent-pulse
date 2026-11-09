import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness() {
  let definition;
  const registrations = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  };
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (value) => { definition = value; } } },
    AbortController, URL,
  });
  const plugin = definition.factory((name) => name === 'react' ? React : { TextShimmer: 'TextShimmer' });
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {}, openResource: () => {} },
    slots: { inject: (_, fn) => fn(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
    connection: { rpc: { call: () => new Promise(() => {}) } },
  });
  const body = registrations.find((row) => row.options.name === 'sidebar.right.pane.tab' && row.options.key === '@local/dsh-agent-activity-intelligence');
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  return (cards) => expand(body.Component({
    ...body.options.inject('root', {}),
    sessionId: 'root', t: (key) => key,
    useProjection: () => ({ cards }),
    useSessions: (selector) => selector({ projectionsBySession: {}, byId: {} }),
    useTabInfo: () => ({ tab: { visible: true } }),
  }));
}
function walk(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  walk(node.children, predicate, result);
  return result;
}
const text = (node) => node == null || node === false ? '' : typeof node === 'object' ? (Array.isArray(node) ? node : node.children || []).map(text).join('') : String(node);
const card = (runs) => ({
  id: 'p', title: 'Owner', category: 'outcome', summary: 'Owner summary',
  summaryStatus: 'ready', status: 'completed', verification: { status: 'not-run' },
  files: [], testRuns: runs,
});
const run = (id, extra = {}) => ({
  id, label: 'pytest', executionStatus: 'completed', resultStatus: 'passed',
  exitCode: 0, counts: { passed: 1, failed: 0, skipped: 0 }, ...extra,
});

test('test runs render as a collapsible disclosure with a count summary', () => {
  const tree = harness()([card([run('a'), run('b')])]);
  const details = walk(tree, (node) => node.type === 'details' && String(node.props.className || '').includes('aai-test-history'));
  assert.equal(details.length, 1);
  const summary = details[0].children.find((child) => child?.type === 'summary');
  assert.match(text(summary), /testHistory/);
  assert.match(text(summary), /2/);
  assert.equal(walk(details[0], (node) => node.type === 'ol').length, 1);
});

test('every run history starts collapsed, including failed and running runs', () => {
  for (const value of [
    run('a'),
    run('b', { executionStatus: 'command-failed', resultStatus: 'failed', exitCode: 1 }),
    run('c', { executionStatus: 'running', resultStatus: 'unknown' }),
  ]) {
    const tree = harness()([card([value])]);
    const details = walk(tree, (node) => node.type === 'details' && String(node.props.className || '').includes('aai-test-history'))[0];
    assert.equal(details.props.open, false);
  }
});

test('no test runs means no empty disclosure', () => {
  const tree = harness()([card([])]);
  assert.equal(walk(tree, (node) => node.type === 'details' && String(node.props.className || '').includes('aai-test-history')).length, 0);
});
