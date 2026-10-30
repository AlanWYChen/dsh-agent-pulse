import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initState,
  reduceEvent,
  viewState,
  summaryInput,
  applySummary,
  PROJECTION_KEY,
} from './engine.js';

function fixture(header = {}, inherited = 0, config = {}) {
  let state = initState({ id: 'session-a', ...header }, inherited),
    seq = inherited,
    call = 0;

  return {
    get state() {
      return state;
    },

    event(type, data, n = seq++) {
      state = reduceEvent(
        state,
        { type, seq: n, time: 1000 + n, data },
        config,
      );

      return state;
    },

    invoke(name, args, text = '', options = {}) {
      const id = options.callId || `call-${call++}`;
      this.event('tool/call', {
        turn: options.turn ?? 1,
        step: 1,
        callId: id,
        name,
        arguments: JSON.stringify(args),
      });

      return this.event('tool/result', {
        turn: options.turn ?? 1,
        step: 1,
        message: {
          toolCallId: id,
          isError: options.isError,
          content: [{ type: 'text', text }],
        },
        ...(options.error ? { error: options.error } : {}),
      });
    },
  };
}

const edit = (f, path = '/workspace/engine.js', options) =>
  f.invoke(
    'edit',
    {
      file_path: path,
      old_string: 'RAW_OLD_DO_NOT_RETAIN',
      new_string: 'RAW_NEW_DO_NOT_RETAIN',
    },
    'Edited',
    options,
  );

const tap = '# tests 3\n# pass 3\n# fail 0\n[exit code: 0]';

const run = (f, command = 'node --test', output = tap, options) =>
  f.invoke('bash', { command }, output, options);

const outcome = (f) => f.state.cards.find((x) => x.category === 'outcome');

test('API and JSON state; fifteen reads/searches remain completely quiet', () => {
  assert.equal(PROJECTION_KEY, 'agentActivityIntelligence');

  const f = fixture(),
    initial = f.state;

  for (let n = 0; n < 15; n++)
    f.invoke(
      n % 2 ? 'grep' : 'read',
      { file_path: `/app/ordinary-${n}.js`, pattern: 'private' },
      'RAW READ CONTENT',
    );

  assert.equal(f.state, initial);

  f.event('assistant/message', {
    turn: 1,
    step: 2,
    message: { content: 'RAW ASSISTANT TEXT' },
  });
  f.event('turn/start', { turn: 1, reason: { kind: 'user' } });

  assert.equal(f.state, initial);
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), initial);
});

test('sensitive env variants, ssh, credentials; examples and exclusions remain quiet', () => {
  const f = fixture({}, 0, {
    sensitivePatterns: ['[bad', 'custom-secret'],
    excludedPatterns: ['safe-custom-secret'],
  });

  for (const path of [
    '/app/.env',
    '/app/.env.production.local',
    '/home/u/.ssh/id_ed25519',
    '/home/u/.aws/credentials',
    '/app/custom-secret',
  ])
    f.invoke('read', { file_path: path }, 'DO_NOT_RETAIN_SECRET');

  assert.equal(f.state.cards.length, 5);

  for (const path of [
    '/app/.env.example',
    '/app/.env.sample',
    '/app/.env.template.local',
    '/app/safe-custom-secret',
  ])
    f.invoke('read', { file_path: path }, 'DO_NOT_RETAIN_SECRET');

  assert.equal(f.state.cards.length, 5);
  assert.ok(f.state.cards.every((x) => x.status === 'observed'));
  assert.ok(!JSON.stringify(f.state).includes('DO_NOT_RETAIN_SECRET'));
  assert.equal(summaryInput(f.state.cards[0]), null);
});

test('denied and failed reads distinguish access status, even without isError', () => {
  const f = fixture();

  f.invoke(
    'read',
    { file_path: '.env' },
    '[sandbox: file access denied under read-only mode]',
  );
  f.invoke(
    'read_image',
    { file_path: '/private/cert.key' },
    'Error: ENOENT no such file',
  );
  f.invoke('read', { file_path: '.env.local' }, 'RAW_SECRET', {
    isError: true,
  });

  assert.deepEqual(
    f.state.cards.map((x) => x.status),
    ['denied', 'failed', 'failed'],
  );
  assert.ok(!f.state.cards.some((x) => x.title === 'Sensitive file read'));
});

test('successful edits aggregate by turn with safe filenames, not raw contents or shell output', () => {
  const f = fixture();

  edit(f);
  edit(f, '/workspace/view.js');
  run(f, 'echo unknown', 'RAW_SHELL_OUTPUT');

  assert.equal(f.state.cards.length, 1);
  assert.deepEqual(outcome(f).files, ['engine.js', 'view.js']);
  assert.equal(outcome(f)._modifications, 2);
  assert.match(outcome(f).title, /awaiting summary/);
  assert.ok(!/implemented|feature complete/i.test(outcome(f).summary));
  assert.ok(!outcome(f).summary.includes('engine.js'));
  assert.ok(!/RAW_|workspace/.test(JSON.stringify(f.state)));

  const view = viewState(f.state);

  assert.deepEqual(Object.keys(view).sort(), [
    'cards',
    'parentSession',
    'sessionId',
  ]);
  assert.ok(!JSON.stringify(view).includes('_turn'));
  assert.ok(!JSON.stringify(view).includes('semanticHints'));

  view.cards[0].files.push('mutated');

  assert.ok(!outcome(f).files.includes('mutated'));
});

test('failed edit produces attention without a changed claim', () => {
  const f = fixture();

  f.invoke(
    'edit',
    { file_path: 'engine.js', new_string: 'RAW_EDIT' },
    'Error: old string not found',
    { isError: true },
  );

  assert.equal(outcome(f), undefined);
  assert.equal(f.state.cards[0].category, 'attention');
  assert.match(f.state.cards[0].summary, /no successful change/);
});

test('foreground success requires numeric real summary and DSH completed-zero renderer contract', () => {
  const cases = [
    [tap, 'passed'],
    ['# tests 3\n# pass 3\n# fail 0', 'passed'],
    ['All tests passed!\n[exit code: 0]', 'unknown'],
    ['# tests 0\n# pass 0\n# fail 0\n[exit code: 0]', 'unknown'],
    ['Tests passed: 3\n[exit code: 0]', 'unknown'],
    ['# tests 3\n# pass 3\n# fail 0\n[exit code: 1]', 'failed'],
    ['# tests 3\n# pass 2\n# fail 1\n[exit code: 0]', 'failed'],
    ['Running in background; job id: job-1', 'pending'],
    ['The output said "# pass 99"\n[exit code: 0]', 'unknown'],
    ['# pass 3\n[exit code: 0]', 'unknown'],
  ];

  for (const [output, expected] of cases) {
    const f = fixture();

    edit(f);
    run(f, 'node --test', output);

    assert.equal(outcome(f).verification.status, expected, output);
  }
});

test('TAP, pytest, vitest, jest numeric summaries accept mixed counts conservatively', () => {
  const cases = [
    [
      'pytest',
      '=== 4 passed, 1 skipped in 0.12s ===\n[exit code: 0]',
      'passed',
    ],
    [
      'python3 -m pytest',
      '=== 1 failed, 2 passed in 0.12s ===\n[exit code: 1]',
      'failed',
    ],
    ['vitest run', ' Tests  3 passed (3)\n[exit code: 0]', 'passed'],
    [
      'npx vitest run',
      ' Tests  1 failed | 2 passed (3)\n[exit code: 0]',
      'failed',
    ],
    ['jest', 'Tests: 2 passed, 2 total\n[exit code: 0]', 'passed'],
    ['jest', 'Tests: 1 failed, 2 passed, 3 total\n[exit code: 1]', 'failed'],
    [
      'node --test',
      '# tests 2\n# pass 2\n# fail 0\n# tests 3\n# pass 2\n# fail 1\n[exit code: 0]',
      'failed',
    ],
    ['pytest', 'I think 3 passed\n[exit code: 0]', 'unknown'],
    ['vitest run', 'Test Files  3 passed (3)\n[exit code: 0]', 'unknown'],
  ];

  for (const [command, output, expected] of cases) {
    const f = fixture();

    edit(f);
    run(f, command, output);

    assert.equal(outcome(f).verification.status, expected, command + output);
  }
});

test('only supported exact commands; unknown shell text cannot create verification', () => {
  for (const command of [
    'echo "node --test"',
    'curl example.com',
    'some-test-runner',
    'node app.js',
    'node --test; echo done',
    'node --test | tee out',
    'node --test && echo done',
  ]) {
    const f = fixture();

    edit(f);

    const before = f.state;

    run(f, command);

    assert.equal(outcome(f).verification.status, 'not-run', command);
    assert.equal(f.state, before, command);
  }

  const f = fixture();

  edit(f);
  f.invoke('bash', { command: 'node --test', run_in_background: true }, tap);

  assert.equal(outcome(f).verification.status, 'not-run');
});

test('test-only follow-up records partial counts unless exact scope maps to all changed files', () => {
  const f = fixture();

  edit(f);
  run(f, 'node --test other.test.js', tap, { turn: 2 });

  assert.equal(outcome(f).verification.status, 'partial');
  assert.match(outcome(f).verification.label, /3 selected tests passed/);

  run(f, 'node --test engine.test.js', tap, { turn: 3 });

  assert.equal(outcome(f).verification.status, 'passed');

  edit(f, 'view.js', { turn: 4 });

  const latest = f.state.cards.at(-1);

  run(f, 'node --test engine.test.js', tap, { turn: 5 });

  assert.notEqual(latest.id, outcome(f).id);
  assert.equal(f.state.cards.at(-1).verification.status, 'partial');
});

test('later writes stale earlier tests, including tests before first write', () => {
  const f = fixture();

  edit(f);
  run(f);
  edit(f);

  assert.equal(outcome(f).verification.status, 'stale');

  run(f, 'node --test engine.test.js');

  assert.equal(outcome(f).verification.status, 'passed');

  edit(f, 'other.js', { turn: 2 });

  assert.equal(outcome(f).verification.status, 'stale');

  const g = fixture();

  run(g);
  edit(g);

  assert.equal(outcome(g).verification.status, 'stale');
});

test('tests begun before writes do not verify later changes', () => {
  const f = fixture();

  f.event('tool/call', {
    turn: 1,
    step: 1,
    callId: 'test',
    name: 'bash',
    arguments: JSON.stringify({ command: 'node --test' }),
  });
  edit(f);
  f.event('tool/result', {
    turn: 1,
    message: { toolCallId: 'test', content: [{ type: 'text', text: tap }] },
  });

  assert.equal(outcome(f).verification.status, 'stale');
});

test('duplicates, replay, update, and inherited fork exclusion are deterministic', () => {
  const f = fixture();

  edit(f);

  const before = f.state;

  f.event('tool/result', {
    turn: 1,
    message: {
      toolCallId: 'call-0',
      content: [{ type: 'text', text: 'Edited' }],
    },
  });

  assert.equal(f.state, before);

  f.event('tool/call', {
    turn: 1,
    callId: 'call-0',
    name: 'edit',
    arguments: '{"file_path":"x"}',
  });

  assert.equal(f.state, before);
  assert.equal(
    reduceEvent(before, {
      type: 'tool/call',
      seq: 0,
      data: { callId: 'different', name: 'edit', arguments: '{}' },
    }),
    before,
  );

  const fork = initState(
    { id: 'fork', origin: 'fork', parentSession: 'parent' },
    10,
  );

  assert.equal(
    reduceEvent(fork, {
      type: 'tool/call',
      seq: 9,
      data: { callId: 'old', name: 'read', arguments: '{"file_path":".env"}' },
    }),
    fork,
  );
  assert.equal(viewState(fork).parentSession, null);
  assert.equal(
    viewState(
      initState({ id: 'child', origin: 'subagent', parentSession: 'parent' }),
    ).parentSession,
    'parent',
  );
});

test('turn/end finalizes once; maxCards bounds cards', () => {
  const f = fixture({}, 0, { maxCards: 2 });

  edit(f);

  assert.equal(outcome(f)._finalized, false);

  f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });

  assert.equal(outcome(f)._finalized, true);

  const before = f.state;

  f.event(
    'turn/end',
    { turn: 1, reason: { kind: 'completed' } },
    before.lastTurnEnd.seq,
  );

  assert.equal(f.state, before);

  edit(f, 'second.js', { turn: 2 });
  edit(f, 'third.js', { turn: 3 });

  assert.equal(f.state.cards.length, 2);
});

test('summaryInput has only filenames, numeric evidence, allowlisted inferred names', () => {
  const f = fixture();

  f.invoke(
    'write',
    {
      file_path: '/private/app/payments.js',
      content: `import Stripe from 'stripe';\nexport function createCheckout() {}\nconst raw = 'RAW_SECRET';\nconst bait = 'function FakeSymbol()';\n// class CommentSymbol\nexport const billing = 'RAW_VALUE';`,
    },
    'RAW_TOOL_OUTPUT',
  );

  const input = summaryInput(outcome(f));

  assert.deepEqual(input.files, ['payments.js']);
  assert.deepEqual(input.semanticHints.items.map((x) => x.name).sort(), [
    'billing',
    'createCheckout',
    'stripe',
  ]);
  assert.equal(input.semanticHints.status, 'metadata-only');
  assert.deepEqual(input.changes, [{ callSeq: 0, resultSeq: 1 }]);
  assert.ok(
    !/RAW_|FakeSymbol|CommentSymbol|private/.test(JSON.stringify(f.state)),
  );
  assert.ok(!JSON.stringify(input).includes('verification'));

  f.invoke(
    'write',
    { file_path: '.env', content: 'export function SecretFeature() {}' },
    'Edited',
  );

  assert.ok(!JSON.stringify(f.state).includes('SecretFeature'));
});

test('behavior summaries require complete concrete descriptions and preserve deterministic verification', () => {
  const f = fixture();

  edit(f);
  run(f);

  const card = outcome(f),
    verification = card.verification;

  for (const summary of [
    'All tests passed',
    'Tests passed after implementation of the new behavior.',
    'api_key=SECRET',
    '<script>bad</script>',
    'Related file modifications observed; expand evidence for affected files.',
  ]) {
    assert.equal(
      applySummary(card, { title: 'Model settings', summary }),
      card,
      summary,
    );
  }
  assert.equal(
    applySummary(card, { title: 'Model settings' }),
    card,
    'No title-only partial acceptance',
  );

  const narrative = {
    title: 'Independent summary-model selection',
    summary:
      'Implemented a persistent summary-model dropdown so activity summaries can use a separate model from the main chat, including failure handling for unavailable models.',
    supportingChangeIds: ['change-a'],
  };
  const updated = applySummary(
    card,
    { ...narrative, verification: { status: 'fake' } },
    { changeIds: ['change-a'] },
  );

  assert.equal(updated.summary, narrative.summary);
  assert.equal(updated._summarySource, 'changes');
  assert.equal(updated.verification, verification);
  assert.equal(
    applySummary(
      card,
      { ...narrative, supportingChangeIds: ['invented'] },
      { changeIds: ['change-a'] },
    ),
    card,
  );
  assert.equal(applySummary(card, narrative, { changeIds: [] }), card);

  const long = applySummary(card, {
    title: 'Independent model choice '.repeat(30),
    summary:
      'Added a separate model selector for generated activity summaries. '.repeat(
        100,
      ),
  });

  assert.equal(long.title.length, 100);
  assert.equal(long.summary.length, 600);
  assert.equal(
    applySummary({ ...card, category: 'sensitive' }, narrative).title,
    card.title,
  );
});

test('real DSH zero-exit output has no exit marker; Node default numeric reporter works', () => {
  for (const command of [
    'node --test',
    'node --test --test-reporter=tap',
    'node --test --test-reporter tap',
  ]) {
    const f = fixture();

    edit(f);
    run(
      f,
      command,
      '✔ checks pass (1ms)\nℹ tests 29\nℹ suites 0\nℹ pass 29\nℹ fail 0\nℹ duration_ms 100',
    );

    assert.equal(outcome(f).verification.status, 'passed', command);
    assert.match(outcome(f).verification.label, /29 passed/);
  }

  const selected = fixture();

  edit(selected);
  run(
    selected,
    'node --test unrelated.test.js',
    '# tests 29\n# pass 29\n# fail 0',
  );

  assert.equal(outcome(selected).verification.status, 'partial');
  assert.match(
    outcome(selected).verification.label,
    /29 selected tests passed; scope not mapped/,
  );
});

test('a passing test name mentioning truncation does not mark actual test output incomplete', () => {
  const f = fixture();

  edit(f);
  run(
    f,
    'npm test',
    '✔ rejects truncated files and restores failed saves\nℹ tests 123\nℹ pass 123\nℹ fail 0',
  );

  assert.equal(outcome(f).verification.status, 'passed');
  assert.match(outcome(f).verification.label, /123 passed/);
});

test('DSH unfinished, stopped, sandbox and truncated results cannot imply zero success', () => {
  const numeric = '# tests 3\n# pass 3\n# fail 0\n';

  for (const marker of [
    '[still running: job-1]',
    '[timed out after 1000ms]',
    '[stopped: cancelled]',
    '[killed by signal: SIGTERM]',
    '[sandbox: blocked]',
    '[output truncated]',
  ]) {
    const f = fixture();

    edit(f);
    run(f, 'node --test', numeric + marker);

    assert.notEqual(outcome(f).verification.status, 'passed', marker);
  }
  for (const options of [{ isError: true }, { error: 'execution error' }]) {
    const f = fixture();

    edit(f);
    run(f, 'node --test', numeric, options);

    assert.equal(outcome(f).verification.status, 'failed');
  }
});

test('dedupe windows and pending calls are bounded, replay stays blocked after rollover', () => {
  const f = fixture({}, 0, { maxCards: 2 });

  for (let i = 0; i < 530; i++) edit(f, 'module.js');

  assert.ok(f.state.seen.length <= 512);
  assert.ok(f.state.completed.length <= 512);

  const before = f.state;

  f.event(
    'tool/call',
    {
      turn: 1,
      callId: 'ancient',
      name: 'write',
      arguments: '{"file_path":"x"}',
    },
    0,
  );

  assert.equal(f.state, before);

  for (let i = 0; i < 270; i++)
    f.event('tool/call', {
      turn: 2,
      callId: `pending-${i}`,
      name: 'edit',
      arguments: '{"file_path":"x"}',
    });

  assert.equal(Object.keys(f.state.pending).length, 256);
});

test('workspace and turn metadata retain refs only, never event payloads', () => {
  const f = fixture();

  f.event('workspace/changes', {
    turn: 4,
    changes: [{ patch: 'RAW_PATCH' }],
    raw: 'RAW_WORKSPACE',
  });

  assert.deepEqual(f.state.lastWorkspaceChange, {
    seq: 0,
    turn: 4,
    time: 1000,
  });

  f.event('turn/end', {
    turn: 4,
    reason: { kind: 'completed', message: 'RAW_REASON' },
  });

  assert.deepEqual(f.state.lastTurnEnd, {
    seq: 1,
    turn: 4,
    time: 1001,
    reason: 'completed',
  });
  assert.ok(!JSON.stringify(f.state).includes('RAW_'));
  assert.ok(!JSON.stringify(viewState(f.state)).includes('lastTurnEnd'));
});
