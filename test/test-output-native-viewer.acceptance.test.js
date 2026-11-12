import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordedTestOutputs } from '../src/test-output.js';

function table() {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    entries: () => map.entries(),
    put: async (key, value) => map.set(key, structuredClone(value)),
    delete: async (key) => map.delete(key),
  };
}
const execution = (
  callId = 'test-1',
  command = 'node --test',
  owner = 'session-1',
) => ({
  name: 'bash',
  callId,
  rootCallId: callId,
  agent: { id: owner },
  arguments: { command },
});
const foreground = (
  stdout = 'unrecognized runner report\n',
  stderr = '',
  extra = {},
) => ({
  isError: false,
  value: {
    kind: 'foreground',
    cwd: '/project',
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
    ...extra,
  },
  content: [{ type: 'text', text: 'rendered output is not canonical' }],
});
const withTempDir = async (fn) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-native-output-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('outputDir persists a real 0600 .out file with redacted command, metadata, and output', async () => {
  await withTempDir(async (dir) => {
    const capture = new RecordedTestOutputs({ table: table(), outputDir: dir });
    capture.observe(
      execution('native-1', 'npm test --password=command-private-value'),
      foreground(
        'API_KEY=stdout-private-value\nrunner says something novel\n',
        'password=stderr-private-value\ndiagnostic\n',
      ),
    );
    const artifact = capture.get('session-1', 'native-1');
    assert.ok(artifact);
    assert.equal(
      typeof artifact.path,
      'string',
      'outputDir must attach a path',
    );
    assert.equal(path.isAbsolute(artifact.path), true);
    assert.equal(path.dirname(artifact.path), dir);
    assert.match(path.basename(artifact.path), /\.out$/);

    capture.observe(
      execution('native-empty', 'node --test'),
      foreground('plain output\n', ''),
    );
    const empty = capture.get('session-1', 'native-empty');
    assert.ok(empty);
    assert.ok(empty.path);

    await capture.close();

    const content = await readFile(artifact.path, 'utf8');
    assert.match(content, /npm test/);
    assert.doesNotMatch(content, /private-value/);
    assert.match(content, /completed/);
    assert.match(content, /exit(?:Code|\s*code)?\s*[:=]\s*0/);
    assert.match(content, /runner says something novel/);
    assert.match(content, /diagnostic/);
    assert.match(content, /stderr/i);
    const mode = (await stat(artifact.path)).mode & 0o777;
    if (process.platform === 'win32') {
      // Windows synthesizes permission bits and cannot represent POSIX 0o600;
      // the file must at least remain writable (not read-only).
      assert.equal(mode & 0o200, 0o200, 'artifact must be writable on Windows');
    } else {
      assert.equal(mode, 0o600);
    }

    const emptyContent = await readFile(empty.path, 'utf8');
    assert.match(emptyContent, /plain output/);
    assert.doesNotMatch(
      emptyContent,
      /stderr/i,
      'an empty stderr section must be omitted',
    );
  });
});

test('evicting a captured artifact removes its .out file and keeps the newest file', async () => {
  await withTempDir(async (dir) => {
    const capture = new RecordedTestOutputs({
      table: table(),
      outputDir: dir,
      maxRecords: 1,
      maxTotalChars: 10000,
    });
    capture.observe(execution('old'), foreground('old output\n', ''));
    const old = capture.get('session-1', 'old');
    assert.ok(old);
    assert.ok(old.path);

    capture.observe(execution('new'), foreground('new output\n', ''));
    const current = capture.get('session-1', 'new');
    assert.ok(current);
    assert.ok(current.path);
    assert.equal(capture.get('session-1', 'old'), undefined);

    await capture.close();

    await assert.rejects(
      readFile(old.path),
      (error) => error?.code === 'ENOENT',
      'evicted artifact files must be removed',
    );
    assert.match(await readFile(current.path, 'utf8'), /new output/);
  });
});

test('without outputDir no path or file is recorded', async () => {
  const capture = new RecordedTestOutputs({ table: table() });
  capture.observe(execution('memory-only'), foreground('memory output\n', ''));
  const artifact = capture.get('session-1', 'memory-only');
  assert.ok(artifact);
  assert.equal(artifact.path, undefined);
  assert.equal(JSON.stringify(artifact).includes('"path"'), false);
  await capture.close();
});

const nativeAddress = (session, filePath) =>
  `dsh-resource://file/session/${encodeURIComponent(session)}/${filePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

function harness() {
  const opens = [];
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
      sidebarRight: {
        openTab: () => {},
        openResource: (address, options) => opens.push({ address, options }),
      },
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
  const walk = (node, predicate, result = []) => {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, predicate, result));
      return result;
    }
    if (predicate(node)) result.push(node);
    walk(node.children, predicate, result);
    return result;
  };
  const text = (node) =>
    node == null || node === false
      ? ''
      : typeof node === 'object'
        ? (Array.isArray(node) ? node : node.children || []).map(text).join(' ')
        : String(node);
  return {
    opens,
    async view(output) {
      const tree = expand(
        body.Component({
          ...body.options.inject('root', {}),
          sessionId: 'root',
          t: (key) => key,
          useProjection: () => ({
            cards: [
              {
                id: 'outcome:1',
                category: 'outcome',
                title: 'Tests',
                summary: '',
                status: 'completed',
                summaryStatus: 'ready',
                time: 1000,
                verification: { status: 'not-run' },
                files: [],
                testRuns: [
                  {
                    id: 'test-1',
                    sessionId: 'root',
                    label: 'npm test',
                    executionStatus: 'completed',
                    resultStatus: 'passed',
                    counts: null,
                    exitCode: 0,
                    callSeq: 1,
                    output,
                  },
                ],
              },
            ],
          }),
          useSessions: (selector) =>
            selector({ projectionsBySession: {}, byId: {} }),
          useTabInfo: () => ({ tab: { visible: true } }),
        }),
      );
      const button = walk(
        tree,
        (node) => node.type === 'button' && text(node) === 'viewOutput',
      )[0];
      assert.ok(button, 'View output must be available');
      await button.props.onClick();
    },
  };
}

test('View output opens the native file address when the run has an output path', async () => {
  const ui = harness();
  await ui.view({ name: 'test-1234567890.out', path: '/tmp/a b/test.out' });
  assert.deepEqual(
    ui.opens.map((entry) => entry.address),
    [nativeAddress('root', '/tmp/a b/test.out')],
  );
  assert.equal(
    ui.opens[0].address,
    'dsh-resource://file/session/root//tmp/a%20b/test.out',
  );
  const prefix = 'dsh-resource://file/session/';
  const rest = ui.opens[0].address.slice(prefix.length);
  const separator = rest.indexOf('/');
  assert.equal(decodeURIComponent(rest.slice(0, separator)), 'root');
  const encodedPath = rest.slice(separator + 1);
  assert.ok(
    encodedPath.startsWith('/'),
    'an absolute path must keep its leading slash after the session id',
  );
  assert.equal(
    encodedPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/'),
    '/tmp/a b/test.out',
  );
  assert.doesNotMatch(ui.opens[0].address, /activity-test-output/);
});

test('View output keeps the virtual activity address when the run has no path', async () => {
  const ui = harness();
  await ui.view({ name: 'test-1234567890.out' });
  assert.deepEqual(
    ui.opens.map((entry) => entry.address),
    ['dsh-resource://activity-test-output/root/test-1'],
  );
  assert.doesNotMatch(ui.opens[0].address, /^dsh-resource:\/\/file\//);
});
