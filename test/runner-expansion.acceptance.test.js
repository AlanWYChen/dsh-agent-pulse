import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent, viewState } from '../src/engine.js';
import { RecordedTestOutputs } from '../src/test-output.js';

const dotnet =
  'Passed!  - Failed:     0, Passed:     3, Skipped:     1, Total:     4, Duration: 123 ms - App.Tests.dll (net8.0)';
const maven = '[INFO] Tests run: 4, Failures: 1, Errors: 0, Skipped: 1';
function execute(command, output, exitCode = 0) {
  let state = initState({ id: 'runner-session' });
  state = reduceEvent(state, {
    type: 'tool/call',
    seq: 0,
    time: 1,
    data: {
      turn: 1,
      callId: 'run',
      name: 'bash',
      arguments: JSON.stringify({ command }),
    },
  });
  state = reduceEvent(state, {
    type: 'tool/result',
    seq: 1,
    time: 2,
    data: {
      turn: 1,
      message: {
        toolCallId: 'run',
        content: [
          { type: 'text', text: `${output}\n[exit code: ${exitCode}]` },
        ],
      },
    },
  });
  return viewState(state).cards.flatMap((c) => c.testRuns || []);
}
for (const [command, output, exit, result, counts] of [
  ['dotnet test', dotnet, 0, 'passed', { passed: 3, failed: 0, skipped: 1 }],
  [
    'dotnet test App.sln --no-build',
    'Failed! - Failed: 1, Passed: 2, Skipped: 1, Total: 4, Duration: 10 ms',
    1,
    'failed',
    { passed: 2, failed: 1, skipped: 1 },
  ],
  ['mvn test', maven, 1, 'failed', { passed: 2, failed: 1, skipped: 1 }],
  [
    'mvn verify',
    '[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 1',
    0,
    'passed',
    { passed: 3, failed: 0, skipped: 1 },
  ],
  [
    'gradle test',
    'BUILD SUCCESSFUL in 2s\n3 actionable tasks: 3 executed',
    0,
    'unknown',
    null,
  ],
  ['./gradlew test', 'BUILD SUCCESSFUL in 2s', 0, 'unknown', null],
])
  test(`recognizes ${command} with deterministic counts or honest execution-only status`, () => {
    const runs = execute(command, output, exit);
    assert.equal(
      runs.length,
      1,
      'direct test invocation must create one public test run',
    );
    assert.equal(
      runs[0].executionStatus,
      exit === 0 ? 'completed' : 'command-failed',
    );
    assert.equal(runs[0].resultStatus, result);
    assert.deepEqual(runs[0].counts, counts);
    assert.equal(runs[0].exitCode, exit);
  });

test('Maven per-suite summaries plus aggregate do not double count and Errors count as failed tests', () => {
  const output =
    '[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s -- in ATest\n[INFO] Tests run: 3, Failures: 1, Errors: 1, Skipped: 1, Time elapsed: 0.1 s -- in BTest\n[INFO] Results:\n[INFO] Tests run: 5, Failures: 1, Errors: 1, Skipped: 1';
  const runs = execute('mvn test', output, 1);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].counts, { passed: 2, failed: 2, skipped: 1 });
  assert.equal(runs[0].resultStatus, 'failed');
});

test('new command recognition cannot convert compiler errors or build success into assertion counts', () => {
  for (const [command, output, exit] of [
    ['dotnet test', 'error CS1002: ; expected', 1],
    ['mvn verify', '[INFO] Tests are skipped.\n[INFO] BUILD SUCCESS', 0],
  ]) {
    const runs = execute(command, output, exit);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].resultStatus, 'unknown');
    assert.equal(runs[0].counts, null);
  }
  assert.deepEqual(execute('echo "dotnet test"', dotnet), []);
  assert.deepEqual(execute('mvn compile', maven), []);
});

for (const command of [
  'dotnet test',
  'mvn test',
  'mvn verify',
  'gradle test',
  './gradlew test',
])
  test(`canonical output capture recognizes the same direct invocation: ${command}`, async () => {
    const map = new Map();
    const capture = new RecordedTestOutputs({
      table: {
        entries: () => map.entries(),
        put: async (k, v) => map.set(k, structuredClone(v)),
        delete: async (k) => map.delete(k),
      },
    });
    try {
      const output = command.startsWith('dotnet') ? dotnet : maven;
      capture.observe(
        {
          name: 'bash',
          callId: 'capture',
          rootCallId: 'capture',
          agent: { id: 'runner-session' },
          arguments: { command },
        },
        {
          isError: false,
          value: {
            kind: 'foreground',
            cwd: '/project',
            exitCode: 0,
            signal: null,
            timedOut: false,
            aborted: false,
            stdout: { text: output, truncated: false },
            stderr: { text: '', truncated: false },
          },
        },
      );
      const artifact = capture.get('runner-session', 'capture');
      assert.ok(
        artifact,
        'recognized test command must retain canonical output',
      );
      assert.equal(artifact.stdout, output);
      assert.equal(artifact.complete, true);
    } finally {
      await capture.close();
    }
  });
