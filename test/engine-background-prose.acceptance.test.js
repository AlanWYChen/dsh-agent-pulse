import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyResult,
  initState,
  reduceEvent,
  viewState,
} from '../src/engine.js';

// Passing test names are prose, not execution-control markers. Only an explicit
// background/still-running signal may classify a run as running.
const PASS_SUMMARY = 'ℹ tests 2\nℹ pass 2\nℹ fail 0';
const PASS_COUNTS = { passed: 2, failed: 0, skipped: 0 };

function project(text) {
  let state = initState({ id: 'session-background-prose' });
  let seq = 0;
  const emit = (type, data) => {
    state = reduceEvent(
      state,
      { type, seq: seq++, time: 1000 + seq, data },
      {},
    );
  };
  emit('tool/call', {
    turn: 1,
    step: 1,
    callId: 'edit-1',
    name: 'edit',
    arguments: JSON.stringify({
      file_path: '/app/engine.js',
      old_string: 'old',
      new_string: 'new',
    }),
  });
  emit('tool/result', {
    turn: 1,
    step: 1,
    message: {
      toolCallId: 'edit-1',
      content: [{ type: 'text', text: 'Edited' }],
    },
  });
  emit('tool/call', {
    turn: 1,
    step: 1,
    callId: 'test-1',
    name: 'bash',
    arguments: JSON.stringify({ command: 'npm test' }),
  });
  emit('tool/result', {
    turn: 1,
    step: 1,
    message: {
      toolCallId: 'test-1',
      content: [{ type: 'text', text }],
    },
  });
  return viewState(state).cards.find((card) => card.category === 'outcome');
}

test('a passing test name mentioning a background job is completed history, not running', () => {
  const text = `✔ background job ownership\n${PASS_SUMMARY}`;

  const result = historyResult({}, text, {});

  assert.equal(result.executionStatus, 'completed');
  assert.equal(result.resultStatus, 'passed');
  assert.deepEqual(result.counts, PASS_COUNTS);
});

test('a passing test name mentioning a job id is completed history, not running', () => {
  const text = `✔ job_id is validated\n${PASS_SUMMARY}`;

  const result = historyResult({}, text, {});

  assert.equal(result.executionStatus, 'completed');
  assert.equal(result.resultStatus, 'passed');
  assert.deepEqual(result.counts, PASS_COUNTS);
});

test('a background start message without a numeric summary stays running', () => {
  const result = historyResult({}, 'Background job started: job-123', {});

  assert.equal(result.executionStatus, 'running');
  assert.equal(result.resultStatus, 'unknown');
});

test('an explicit still-running marker wins over a numeric summary', () => {
  const result = historyResult(
    {},
    `[still running: job-1]\n${PASS_SUMMARY}`,
    {},
  );

  assert.equal(result.executionStatus, 'running');
  assert.equal(result.resultStatus, 'unknown');
});

test('engine verification passes for a run whose test names mention a background job', () => {
  const card = project(`✔ background job ownership\n${PASS_SUMMARY}`);

  assert.ok(card, 'the turn 1 test run must create an outcome card');
  assert.equal(card.verification.status, 'passed');
});
