import test from 'node:test';
import assert from 'node:assert/strict';
import { testCommand } from '../src/engine.js';

test('recognizes a direct test command at the end of a top-level && chain', () => {
  assert.deepEqual(
    testCommand(
      'npx prettier --write client.js && node --check client.js && node --test client.test.js',
    ),
    { targets: ['client.test.js'], all: false, label: 'node --test' },
  );
  assert.deepEqual(testCommand('cd packages/app && npm test'), {
    targets: [],
    all: true,
    label: 'npm test',
  });
});

test('does not attribute a test command that is followed by another command', () => {
  assert.equal(testCommand('node --test client.test.js && echo done'), null);
  assert.equal(testCommand('npm test && node --check client.js'), null);
});

test('compound forms with other shell operators remain unsupported', () => {
  assert.equal(testCommand('npm test; echo done'), null);
  assert.equal(testCommand('npm test > out.txt'), null);
  assert.equal(testCommand('echo "npm test"'), null);
  assert.equal(testCommand('node --test $(ls)'), null);
});

test('a quoted && argument is not treated as a command separator', () => {
  assert.equal(testCommand('node --test --test-name-pattern="a && b"'), null);
});
