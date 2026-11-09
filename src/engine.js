import { redactText } from './change-context.js';
import { createHash } from 'node:crypto';

const assignmentDigest = (sender, target, text) =>
  createHash('sha256')
    .update(JSON.stringify([sender, target, text]))
    .digest('hex');

// Deterministic, JSON-only projection. Raw arguments and tool output never enter state.
// Subagent labels and assistant reports enter only as bounded, redacted previews.
export const PROJECTION_KEY = 'agentActivityIntelligence';
const MAX_EVIDENCE = 30;
const MAX_DEDUPE = 512;
const MAX_PENDING = 256;

const basename = (p) =>
  String(p).replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '';

const cleanName = (p) =>
  basename(p)
    .replace(/[^\p{L}\p{N}._@+ -]/gu, '')
    .slice(0, 120);

const toolName = (name) =>
  String(name || '')
    .split('.')
    .at(-1);

const evidence = (event, label) => ({ seq: event.seq, label });
const failureText =
  /(?:permission denied|access denied|operation not permitted|not found|no such file|EACCES|ENOENT|\[sandbox:|\b(?:error|failed|failure)\s*:|(?:^|\n)\s*(?:error|failed)\b)/i;

const safePattern = (pattern, value) => {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
};

export function initState(header = {}, inheritedEventCount = 0) {
  return {
    version: 6,
    agentId: String(header.agentId ?? header.id ?? header.sessionId ?? 'agent'),
    sessionId: String(header.sessionId ?? header.id ?? 'agent'),
    origin: typeof header.origin === 'string' ? header.origin : null,
    parentSession:
      header.origin === 'subagent' ? (header.parentSession ?? null) : null,
    inheritedEventCount:
      Number.isSafeInteger(inheritedEventCount) && inheritedEventCount > 0
        ? inheritedEventCount
        : 0,
    cards: [],
    assignments: [],
    inputs: [],
    pending: {},
    completed: [],
    seen: [],
    watermark: -1,
    lastOutcomeId: null,
    lastTest: null,
    lastWorkspaceChange: null,
    lastTurnEnd: null,
  };
}

function sensitivePath(path, config) {
  const p = String(path).replaceAll('\\', '/');

  if ((config.excludedPatterns || []).some((x) => safePattern(x, p)))
    return false;

  const name = basename(p);
  const env =
    /^\.env(?:\.|$)/i.test(name) &&
    !/(?:^|[._-])(?:example|sample|template)(?:[._-]|$)/i.test(name);
  const ssh =
    /(?:^|\/)\.ssh\//i.test(p) &&
    /^(?:id_[\w-]+(?:\.pub)?|authorized_keys|known_hosts|config)$/i.test(name);
  const credentials =
    /^(?:credentials(?:\.[\w-]+)?|\.netrc|\.npmrc|\.pypirc|secrets?\.(?:json|ya?ml|toml)|service[-_]?account(?:[._-].*)?\.json|.*\.(?:pem|p12|pfx|key))$/i.test(
      name,
    );

  return (
    env ||
    ssh ||
    credentials ||
    (config.sensitivePatterns || []).some((x) => safePattern(x, p))
  );
}

function parseArgs(value) {
  try {
    const a = JSON.parse(value);
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
}

// Only direct known test/check invocations are eligible, never echoed strings or
// arbitrary scripts. A trailing top-level && chain may end in a pipeline; the
// first pipeline component is the command candidate.
function captureCommand(command) {
  if (typeof command !== 'string' || /[;`\n]|\$\(/.test(command)) return null;

  const segments = [];
  let segment = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === '&') return null;
      segment += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      segment += char;
      continue;
    }
    if (char === '&') {
      // A trailing stderr redirect is tolerated on the command candidate.
      if (
        command[i - 2] === '2' &&
        command[i - 1] === '>' &&
        command[i + 1] === '1'
      ) {
        segment += char;
        continue;
      }
      if (command[i + 1] !== '&' || command[i + 2] === '&') return null;
      segments.push(segment);
      segment = '';
      i++;
      continue;
    }
    segment += char;
  }
  segments.push(segment);
  if (segments.some((value) => !value.trim())) return null;

  // Only the final top-level segment may carry a pipeline or redirection.
  if (segments.slice(0, -1).some((value) => /[<>|]/.test(value))) return null;

  const parts = [];
  let part = '';
  quote = null;
  for (const char of segments[segments.length - 1]) {
    if (quote) {
      part += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      part += char;
      continue;
    }
    if (char === '|') {
      parts.push(part);
      part = '';
      continue;
    }
    part += char;
  }
  parts.push(part);
  if (parts.some((value) => !value.trim())) return null;
  if (parts.slice(1).some((value) => /[<>]/.test(value))) return null;

  const candidate = parts[0]
    .trim()
    .replace(/\s*2>&1\s*$/, '')
    .trim();
  if (!candidate || /[<>]/.test(candidate)) return null;
  return { final: candidate, piped: parts.length > 1 };
}

function commandWords(command) {
  return (
    command
      .match(/(?:"[^"]*"|'[^']*'|\S+)/g)
      ?.map((x) => x.replace(/^(['"])(.*)\1$/, '$2')) || []
  );
}

export function testCommand(command, args = {}) {
  const capture = captureCommand(command);
  if (!capture) return null;
  const words = commandWords(capture.final);
  let rest, label;

  if (/^(?:node|nodejs)$/.test(words[0]) && words[1] === '--test') {
    rest = words.slice(2);
    label = 'node --test';
  } else if (words[0] === 'pytest') {
    rest = words.slice(1);
    label = 'pytest';
  } else if (
    /^python(?:3(?:\.\d+)?)?$/.test(words[0]) &&
    words[1] === '-m' &&
    words[2] === 'pytest'
  ) {
    rest = words.slice(3);
    label = 'pytest';
  } else if (/^(?:vitest|jest)$/.test(words[0])) {
    rest = words.slice(1);
    label = words[0];
  } else if (/^(?:npm|pnpm|yarn|bun)$/.test(words[0]) && words[1] === 'test') {
    rest = words.slice(2);
    label = `${words[0]} test`;
  } else if (
    /^(?:npm|pnpm|yarn|bun)$/.test(words[0]) &&
    words[1] === 'run' &&
    words[2] === 'test'
  ) {
    rest = words.slice(3);
    label = `${words[0]} test`;
  } else if (
    /^(?:npx|pnpm|bunx)$/.test(words[0]) &&
    /^(?:vitest|jest)$/.test(words[1])
  ) {
    rest = words.slice(2);
    label = words[1];
  } else if (
    words[0] === 'pnpm' &&
    words[1] === 'exec' &&
    /^(?:vitest|jest)$/.test(words[2])
  ) {
    rest = words.slice(3);
    label = words[2];
  } else if (words[0] === 'dotnet' && words[1] === 'test') {
    rest = words.slice(2);
    label = 'dotnet test';
  } else if (
    /^(?:mvn|mvnw|\.\/mvnw)$/.test(words[0]) &&
    /^(?:test|verify)$/.test(words[1])
  ) {
    rest = words.slice(2);
    label = `mvn ${words[1]}`;
  } else if (
    /^(?:gradle|gradlew|\.\/gradlew)$/.test(words[0]) &&
    words[1] === 'test'
  ) {
    rest = words.slice(2);
    label = 'gradle test';
  } else return null;

  if (rest.some((x) => /^(?:--watch|-w|--watchAll)(?:=|$)/.test(x)))
    return null;

  // Unknown switches and positional filters constrain scope rather than implying a full suite.
  const ignored = new Set([
    '--',
    '--run',
    'run',
    '--runInBand',
    '--silent',
    '-q',
    '-v',
    '--verbose',
    '--no-watch',
  ]);
  const targets = rest.filter(
    (x, i) =>
      !ignored.has(x) &&
      !/^--test-reporter=(?:tap|spec|dot)$/.test(x) &&
      x !== '--test-reporter' &&
      !(rest[i - 1] === '--test-reporter' && /^(?:tap|spec|dot)$/.test(x)),
  );

  return {
    targets: targets.map(cleanName).filter(Boolean),
    all: targets.length === 0,
    label,
    ...(capture.piped ? { piped: true } : {}),
  };
}

// Direct check invocations are separate from tests: no test counts, no verification.
export function checkCommand(command, args = {}) {
  const capture = captureCommand(command);
  if (!capture) return null;
  const words = commandWords(capture.final);
  const targetsFrom = (start) =>
    words
      .slice(start)
      .filter((word) => !word.startsWith('-'))
      .map(cleanName)
      .filter(Boolean);
  let label, targets;

  const pm = words[0];
  if (
    /^(?:npm|pnpm|yarn|bun)$/.test(pm) &&
    words[1] === 'run' &&
    /^(?:check|lint|typecheck|format:check)$/.test(words[2])
  ) {
    label = `${pm} run ${words[2]}`;
    targets = targetsFrom(3);
  } else if (
    /^(?:npx|pnpm|bunx)$/.test(words[0]) &&
    words[1] === 'prettier' &&
    words[2] === '--check'
  ) {
    label = 'prettier --check';
    targets = targetsFrom(3);
  } else if (
    (/^(?:npx|pnpm|bunx)$/.test(words[0]) &&
      words[1] === 'tsc' &&
      words[2] === '--noEmit') ||
    (words[0] === 'tsc' && words[1] === '--noEmit')
  ) {
    label = 'tsc --noEmit';
    targets = [];
  } else if (
    words[0] === 'eslint' ||
    (/^(?:npx|pnpm|bunx)$/.test(words[0]) && words[1] === 'eslint')
  ) {
    label = 'eslint';
    targets = targetsFrom(words[0] === 'eslint' ? 1 : 2);
  } else if (/^(?:node|nodejs)$/.test(words[0]) && words[1] === '--check') {
    label = 'node --check';
    targets = targetsFrom(2);
  } else return null;

  return {
    label,
    targets,
    all: targets.length === 0,
    ...(capture.piped ? { piped: true } : {}),
  };
}

function semanticHints(source) {
  if (typeof source !== 'string') return [];

  const hints = [];

  // Mask comments and literals before looking for declarations; never mine string values.
  let masked = '',
    cursor = 0;
  const literals =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

  for (const match of source.matchAll(literals)) {
    masked += source.slice(cursor, match.index);
    if (/^['"]/.test(match[0]) && /\b(?:from|import)\s*$/.test(masked)) {
      const module = match[0].slice(1, -1);
      if (
        /^@?[a-zA-Z][\w.-]*(?:\/[\w.-]+)?$/.test(module) &&
        module.length <= 80
      )
        hints.push({ kind: 'package', name: module });
    }
    masked += ' '.repeat(match[0].length);
    cursor = match.index + match[0].length;
  }

  masked += source.slice(cursor);

  for (const match of masked.matchAll(
    /\b(?:function|class|interface)\s+([A-Za-z_$][\w$]{0,63})|\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]{0,63})/g,
  )) {
    const name = match[1] || match[2];
    if (!/(?:secret|password|token|credential|privatekey)/i.test(name))
      hints.push({ kind: 'symbol', name });
  }

  return hints
    .filter(
      (hint, i, all) =>
        all.findIndex((x) => x.kind === hint.kind && x.name === hint.name) ===
        i,
    )
    .slice(0, 20);
}

function callMetadata(event, config, state) {
  const d = event.data || {},
    a = parseArgs(d.arguments),
    name = toolName(d.name);

  const paths = [a.file_path, a.path, a.filename].filter(
    (x) => typeof x === 'string',
  );
  const files = [...new Set(paths.map(cleanName).filter(Boolean))];

  if (['read', 'read_image'].includes(name)) {
    if (!paths.some((p) => sensitivePath(p, config))) return null;
    return { kind: 'sensitive', turn: d.turn ?? null, files };
  }

  if (['edit', 'write'].includes(name))
    return {
      kind: 'edit',
      turn: d.turn ?? null,
      files,
      hints: paths.some((p) => sensitivePath(p, config))
        ? []
        : semanticHints(a.new_string ?? a.content),
    };

  if (['subagent', 'subagent_fork', 'send_message'].includes(name))
    return {
      kind: 'delegation',
      turn: d.turn ?? null,
      files: [],
      delegationKind: name === 'send_message' ? 'message' : 'spawn',
      childSessionId: typeof a.agent_id === 'string' ? a.agent_id : null,
      ...(name === 'send_message' &&
      typeof a.message === 'string' &&
      typeof a.agent_id === 'string'
        ? {
            messageDigest: assignmentDigest(
              state.sessionId,
              a.agent_id,
              a.message,
            ),
          }
        : {}),
      label:
        name === 'send_message'
          ? 'Delegated follow-up'
          : nativePreview(a.description, 100) || 'Delegated task',
    };

  if (name === 'bash') {
    const test = testCommand(a.command, a);
    if (test)
      return {
        kind: 'test',
        turn: d.turn ?? null,
        files: [],
        test,
        label: test.label,
        piped: Boolean(test.piped),
        background: Boolean(a.run_in_background),
      };
    const check = checkCommand(a.command, a);
    if (check)
      return {
        kind: 'check',
        turn: d.turn ?? null,
        files: [],
        check,
        label: check.label,
        piped: Boolean(check.piped),
      };
  }

  return null;
}

function textOf(result) {
  return (result.message?.content || [])
    .filter((x) => x?.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text)
    .join('\n');
}

function toolFailed(result, text) {
  if (result.message?.isError || result.error) return true;

  // A successful DSH file-read envelope can contain arbitrary error-looking file text.
  // Inspect its header, not its contents, when classifying the operation outcome.
  if (/^<path>[^\n]*<\/path>\s*\n<type>file<\/type>\s*\n<content>/.test(text))
    return false;

  return failureText.test(text);
}

function addEvidence(card, event, label) {
  if (!card.evidence.some((x) => x.seq === event.seq))
    card.evidence = [...card.evidence, evidence(event, label)].slice(
      -MAX_EVIDENCE,
    );
}

function baseCard(state, event, id, category, files) {
  return {
    id,
    category,
    title: '',
    summary: '',
    status: 'observed',
    time: event.time ?? null,
    agentId: state.agentId,
    evidence: [],
    files,
    ...((state.inputs || []).some((input) => input.turn === event.data?.turn)
      ? {
          inputMessageIds: state.inputs
            .filter((input) => input.turn === event.data?.turn)
            .map((input) => input.id),
        }
      : {}),
    verification: {
      status: 'not-run',
      label: 'No supported test result observed',
    },
    _turn: event.data?.turn ?? null,
    _finalized: false,
  };
}

function platformCounts(text) {
  const dotnet = [
    ...text.matchAll(
      /^\s*(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)(?:,.*)?$/gm,
    ),
  ];
  if (dotnet.length) {
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const m of dotnet) {
      const [failed, passed, skipped, total] = m.slice(1).map(Number);
      if (failed + passed + skipped !== total) return null;
      counts.passed += passed;
      counts.failed += failed;
      counts.skipped += skipped;
    }
    return counts;
  }
  const maven = [
    ...text.matchAll(
      /^\s*(?:\[(?:INFO|WARNING|ERROR)\]\s*)?Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)([^\n]*)$/gm,
    ),
  ];
  if (!maven.length) return null;
  // Surefire prints each suite followed by an aggregate without a suite suffix.
  const aggregate = maven.filter((m) => !/Time elapsed:|-- in\b/.test(m[5]));
  const chosen = aggregate.length ? [aggregate.at(-1)] : maven;
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const m of chosen) {
    const [total, failures, errors, skipped] = m.slice(1, 5).map(Number);
    const failed = failures + errors;
    if (failed + skipped > total) return null;
    counts.passed += total - failed - skipped;
    counts.failed += failed;
    counts.skipped += skipped;
  }
  return counts;
}

function countsFrom(text) {
  const platform = platformCounts(text);
  if (platform)
    return { pass: platform.passed, fail: platform.failed, found: true };
  let pass = 0,
    fail = 0,
    found = false;
  const tap = { tests: [], pass: [], fail: [] };

  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/^\s*(?:#|ℹ\uFE0F?) (tests|pass|fail)\s+(\d+)\s*$/);
    if (m) {
      tap[m[1]].push(Number(m[2]));
      continue;
    }

    // pytest's summary line, not arbitrary prose mentioning a test count.
    m = line.match(
      /^\s*=+\s+((?:\d+ (?:passed|failed|skipped|xfailed|xpassed|errors?)(?:, )?)+)(?:\s+in\s+\d+(?:\.\d+)?s(?:\s+\([^)]*\))?)?\s*=+\s*$/,
    );
    if (m) {
      for (const hit of m[1].matchAll(/(\d+) (passed|failed|errors?)/g)) {
        found = true;
        if (hit[2] === 'passed') pass += Number(hit[1]);
        else fail += Number(hit[1]);
      }
      continue;
    }

    m = line.match(
      /^\s*Tests\s+((?:\d+ (?:passed|failed|skipped|todo)(?:\s*\|\s*|, )?)+)\s*\(\d+\)\s*$/,
    );
    // Jest uses "Tests: 2 passed, 2 total".
    if (!m)
      m = line.match(
        /^\s*Tests:\s+((?:\d+ (?:passed|failed|skipped|todo|total)(?:, )?)+)\s*$/,
      );
    if (m)
      for (const hit of m[1].matchAll(/(\d+) (passed|failed)/g)) {
        found = true;
        if (hit[2] === 'passed') pass += Number(hit[1]);
        else fail += Number(hit[1]);
      }
  }

  if (
    tap.tests.length &&
    tap.tests.length === tap.pass.length &&
    tap.pass.length === tap.fail.length
  ) {
    const tests = tap.tests.reduce((a, b) => a + b, 0),
      p = tap.pass.reduce((a, b) => a + b, 0),
      f = tap.fail.reduce((a, b) => a + b, 0);
    if (p + f <= tests) {
      found = true;
      pass += p;
      fail += f;
    }
  }

  return { pass, fail, found };
}

function testResult(result, text) {
  const exits = [...text.matchAll(/^\s*\[exit code: (-?\d+)\]\s*$/gm)];
  const counts = countsFrom(text);

  if (
    result.message?.isError ||
    result.error ||
    exits.some((m) => Number(m[1]) !== 0) ||
    counts.fail > 0
  )
    return {
      status: 'failed',
      label: `Tests failed${counts.found ? ` (${counts.pass} passed, ${counts.fail} failed)` : ''}`,
    };

  if (
    /(?:running in (?:the )?background|background job|job[_ ]id|\[still running)/i.test(
      text,
    )
  )
    return {
      status: 'pending',
      label: 'Background test started; no foreground result',
    };

  if (
    /\[(?:timed out|stopped:|killed by signal:|sandbox:|output truncated\b)|\(Output capped\./i.test(
      text,
    )
  )
    return {
      status: 'unknown',
      label: 'Test output is incomplete or execution did not finish',
    };

  // DSH bash renderResult emits [exit code: N] only for nonzero exits. A completed,
  // non-error foreground result with no stop/background/truncation marker implies zero.
  // Explicit zero markers remain supported for imported event logs.
  if (exits.length <= 1 && counts.found && counts.pass > 0)
    return {
      status: 'passed',
      label: `Tests passed (${counts.pass} passed, 0 failed)`,
    };

  return { status: 'unknown', label: 'No conclusive foreground test result' };
}

// Execution history is independent of whether a run verifies the changed files.
export function historyResult(
  data,
  text,
  { completed = false, piped = false } = {},
) {
  if (
    !completed &&
    /(?:running in (?:the )?background|background job|job[_ ]id|\[still running)/i.test(
      text,
    )
  )
    return {
      executionStatus: 'running',
      resultStatus: 'unknown',
      counts: null,
      exitCode: null,
      ...(piped ? { piped: true } : {}),
    };
  if (
    /\[(?:timed out|stopped:|killed by signal:|sandbox:|output truncated\b)|\(Output capped\./i.test(
      text,
    )
  )
    return {
      executionStatus: 'incomplete',
      resultStatus: 'unknown',
      counts: null,
      exitCode: null,
      ...(piped ? { piped: true } : {}),
    };
  const exits = [...text.matchAll(/^\s*\[exit code: (-?\d+)\]\s*$/gm)];
  const exitCode = exits.length
    ? Number(exits.at(-1)[1])
    : data.message?.isError || data.error
      ? null
      : 0;
  const numeric = countsFrom(text);
  let skipped = 0,
    skipFound = false;
  for (const line of text.split(/\r?\n/)) {
    const tap = line.match(/^\s*(?:#|ℹ\uFE0F?) (?:skipped|skip)\s+(\d+)\s*$/);
    if (tap) {
      skipped += Number(tap[1]);
      skipFound = true;
    }
    if (/^\s*=+\s+.*\s*=+\s*$/.test(line) || /^\s*Tests\s*:?[\s]/.test(line)) {
      for (const hit of line.matchAll(/(\d+) (?:skipped|todo)\b/g)) {
        skipped += Number(hit[1]);
        skipFound = true;
      }
    }
  }
  const counts =
    platformCounts(text) ??
    (numeric.found || skipFound
      ? { passed: numeric.pass, failed: numeric.fail, skipped }
      : null);
  if (piped)
    return {
      executionStatus: 'completed',
      resultStatus:
        numeric.fail > 0 ? 'failed' : numeric.pass > 0 ? 'passed' : 'unknown',
      counts,
      exitCode: null,
      piped: true,
    };
  return {
    executionStatus:
      (exitCode !== null && exitCode !== 0) ||
      data.message?.isError ||
      data.error
        ? 'command-failed'
        : 'completed',
    resultStatus:
      numeric.fail > 0
        ? 'failed'
        : numeric.pass > 0 && exitCode === 0
          ? 'passed'
          : 'unknown',
    counts,
    exitCode,
  };
}

function historyCard(state, event, turn, kind = 'test') {
  let card =
    state.cards.find((c) => c.id === `outcome:${String(turn ?? 'unknown')}`) ||
    state.cards.find((c) => c.id === state.lastOutcomeId);
  if (!card) {
    card = baseCard(
      state,
      event,
      `outcome:${String(turn ?? 'unknown')}`,
      'outcome',
      [],
    );
    if (kind === 'check') {
      card.title = 'Checks';
      card.summary =
        'Observed check runs; checks do not establish change coverage.';
    } else {
      card.title = 'Test execution';
      card.summary =
        'Observed test runs; results do not establish change coverage.';
    }
    card._turn = turn;
    state.cards.push(card);
  }
  return card;
}

function scopeSupports(test, files) {
  if (test.all) return true;
  if (!files.length) return false;

  return files.every((file) =>
    test.targets.some(
      (target) =>
        target === file ||
        target.replace(/\.(?:test|spec)(?=\.)/g, '') === file ||
        (file.startsWith('test_') && target === file),
    ),
  );
}

// Native task labels and closing reports are previews, never verification. Redact before
// bounding so a clipped credential/private-key block cannot escape detection.
function nativePreview(value, limit) {
  return typeof value === 'string'
    ? redactText(value)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit)
    : '';
}

export function reportedSummary(card, state) {
  const report = card._reportedResult;
  const task = state.taskLabel;
  if (!report && !task) return null;
  return {
    title: task || 'Subagent reported result',
    summary: report
      ? `Agent report (unverified): ${report}`
      : `Task: ${task}. No closing result has been observed yet.`,
    summarySource: 'agent-report',
  };
}

export function reduceEvent(state, event, config = {}) {
  // Durable session events arrive in seq order; the accepted-event watermark blocks
  // replay even after bounded diagnostic/deduplication windows have rolled over.
  if (
    !event ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < state.inheritedEventCount ||
    event.seq <= (state.watermark ?? -1) ||
    state.seen.includes(event.seq)
  )
    return state;

  if (state.origin === 'subagent' && event.type === 'user/message') {
    const message = event.data?.message;
    if (
      typeof message?.id !== 'string' ||
      message.id.length > 200 ||
      !['user', 'agent-message'].includes(message.source?.kind)
    )
      return state;
    const input = {
      id: message.id,
      turn: event.data?.turn ?? null,
      seq: event.seq,
      source: {
        kind: message.source.kind,
        ...(typeof message.source.senderSessionId === 'string'
          ? { senderSessionId: message.source.senderSessionId }
          : {}),
      },
    };
    const inputs = [
      ...(state.inputs || []).filter((item) => item.id !== input.id),
      input,
    ].slice(-MAX_DEDUPE);
    let digests = state._inputMessageDigests;
    const blocks = message.content;
    if (
      message.source.kind === 'agent-message' &&
      message.source.form === 'relay' &&
      typeof message.source.senderSessionId === 'string' &&
      Array.isArray(blocks) &&
      blocks.length === 2 &&
      blocks[0]?.type === 'text' &&
      blocks[0].text ===
        `Agent ${message.source.senderSessionId} sent a message: ` &&
      blocks[1]?.type === 'text' &&
      typeof blocks[1].text === 'string'
    ) {
      digests = {
        ...(digests || {}),
        [message.id]: assignmentDigest(
          message.source.senderSessionId,
          state.sessionId,
          blocks[1].text,
        ),
      };
      const retained = new Set(inputs.map((item) => item.id));
      digests = Object.fromEntries(
        Object.entries(digests).filter(([id]) => retained.has(id)),
      );
    }
    return {
      ...state,
      inputs,
      ...(digests ? { _inputMessageDigests: digests } : {}),
      cards: state.cards.map((card) =>
        card._turn === input.turn
          ? {
              ...card,
              inputMessageIds: [
                ...new Set([...(card.inputMessageIds || []), input.id]),
              ],
            }
          : card,
      ),
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  if (state.origin === 'subagent' && event.type === 'subagent/descriptor') {
    return {
      ...state,
      taskLabel: nativePreview(event.data?.label, 100),
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  if (
    state.origin === 'subagent' &&
    state.taskLabel &&
    event.type === 'turn/start'
  ) {
    const id = `outcome:${String(event.data?.turn ?? 'unknown')}`;
    if (state.cards.some((card) => card.id === id)) return state;
    return {
      ...state,
      cards: [
        ...state.cards,
        {
          ...baseCard(state, event, id, 'outcome', []),
          _nativeActivity: true,
        },
      ].slice(
        -(Number.isSafeInteger(config.maxCards) && config.maxCards > 0
          ? config.maxCards
          : 100),
      ),
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  if (
    event.type === 'assistant/message' &&
    (state.origin === 'subagent' ||
      state.cards.some(
        (card) => card._turn === event.data?.turn && card._delegatedActivity,
      ))
  ) {
    const content = event.data?.message?.content ?? event.data?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter(
                (part) =>
                  part?.type === 'text' && typeof part.text === 'string',
              )
              .at(-1)?.text || ''
          : '';
    const report = nativePreview(text, 600);
    if (!report) return state;
    const id = `outcome:${String(event.data?.turn ?? 'unknown')}`;
    const previous = state.cards.find((card) => card.id === id);
    const card = {
      ...(previous || baseCard(state, event, id, 'outcome', [])),
      _reportedResult: report,
      _nativeActivity: true,
    };
    addEvidence(card, event, 'Subagent self-report (unverified)');
    return {
      ...state,
      cards: [...state.cards.filter((item) => item.id !== id), card].slice(
        -(Number.isSafeInteger(config.maxCards) && config.maxCards > 0
          ? config.maxCards
          : 100),
      ),
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  if (event.type === 'workspace/changes') {
    return {
      ...state,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
      lastWorkspaceChange: {
        seq: event.seq,
        turn: event.data?.turn ?? null,
        time: event.time ?? null,
      },
    };
  }

  if (event.type === 'turn/end') {
    const cards = state.cards.filter(
      (card) => card._turn === event.data?.turn && !card._finalized,
    );
    const reason =
      typeof event.data?.reason?.kind === 'string' &&
      /^[a-z_-]{1,40}$/i.test(event.data.reason.kind)
        ? event.data.reason.kind
        : null;

    return {
      ...state,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
      lastTurnEnd: {
        seq: event.seq,
        turn: event.data?.turn ?? null,
        time: event.time ?? null,
        reason,
      },
      cards: state.cards.map((card) =>
        cards.includes(card)
          ? {
              ...card,
              _finalized: true,
              status: ['error', 'failed'].includes(reason)
                ? 'failed'
                : ['interrupted', 'cancelled', 'aborted'].includes(reason)
                  ? 'interrupted'
                  : card.status,
            }
          : card,
      ),
    };
  }

  if (!['tool/call', 'tool/result'].includes(event.type)) return state;

  const data = event.data || {};

  if (event.type === 'tool/call') {
    const metadata = callMetadata(event, config, state);
    if (!metadata || typeof data.callId !== 'string') return state;

    const key = data.callId;
    if (state.pending[key] || state.completed.includes(key)) return state;

    const pending = {
      ...state.pending,
      [key]: { ...metadata, callSeq: event.seq },
    };

    for (const stale of Object.keys(pending).slice(
      0,
      Math.max(0, Object.keys(pending).length - MAX_PENDING),
    ))
      delete pending[stale];

    const cards = structuredClone(state.cards);
    if (metadata.kind === 'test') {
      const card = historyCard({ ...state, cards }, event, metadata.turn);
      card._testStartedAt = {
        ...(card._testStartedAt || {}),
        [key]: event.time ?? null,
      };
      if (metadata.label)
        card._testLabels = {
          ...(card._testLabels || {}),
          [key]: metadata.label,
        };
      card.testRuns = [
        {
          id: key,
          callSeq: event.seq,
          resultSeq: null,
          executionStatus: 'running',
          resultStatus: 'unknown',
          counts: null,
          exitCode: null,
          agentId: state.agentId,
          sessionId: state.sessionId,
          ...(metadata.piped ? { piped: true } : {}),
        },
        ...(card.testRuns || []),
      ];
    } else if (metadata.kind === 'check') {
      const card = historyCard(
        { ...state, cards },
        event,
        metadata.turn,
        'check',
      );
      card._checkStartedAt = {
        ...(card._checkStartedAt || {}),
        [key]: event.time ?? null,
      };
      card.checkRuns = [
        {
          id: key,
          callSeq: event.seq,
          resultSeq: null,
          executionStatus: 'running',
          resultStatus: 'unknown',
          exitCode: null,
          agentId: state.agentId,
          sessionId: state.sessionId,
          label: metadata.label,
          ...(metadata.piped ? { piped: true } : {}),
        },
        ...(card.checkRuns || []),
      ];
    }
    return {
      ...state,
      cards,
      pending,
      watermark: event.seq,
      seen: [...state.seen, event.seq].slice(-MAX_DEDUPE),
    };
  }

  const key = data.message?.toolCallId;
  const call = state.pending[key];
  if (!call) return state;

  const next = JSON.parse(JSON.stringify(state));
  delete next.pending[key];
  next.completed = [...next.completed, key].slice(-MAX_DEDUPE);
  next.seen = [...next.seen, event.seq].slice(-MAX_DEDUPE);
  next.watermark = event.seq;

  const text = textOf(data),
    failed = toolFailed(data, text);

  if (call.kind === 'delegation') {
    const ack = text
      .trim()
      .match(
        call.delegationKind === 'spawn'
          ? /^started subagent ([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/
          : /^message delivered to agent ([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/,
      );
    if (
      !failed &&
      ack &&
      (call.delegationKind === 'spawn' || ack[1] === call.childSessionId)
    ) {
      const parentCardId = `outcome:${String(call.turn ?? 'unknown')}`;
      const assignment = {
        id: key,
        parentSessionId: next.sessionId,
        parentCardId,
        parentTurn: call.turn,
        callSeq: call.callSeq,
        childSessionId: ack[1],
        label: call.label,
        kind: call.delegationKind,
        status: 'accepted',
      };
      if ((next.assignments || []).length >= MAX_PENDING)
        next._assignmentsTruncated = true;
      next.assignments = [...(next.assignments || []), assignment].slice(
        -MAX_PENDING,
      );
      if (call.messageDigest) {
        next._assignmentMessageDigests = {
          ...(next._assignmentMessageDigests || {}),
          [key]: call.messageDigest,
        };
        const retained = new Set(next.assignments.map((item) => item.id));
        next._assignmentMessageDigests = Object.fromEntries(
          Object.entries(next._assignmentMessageDigests).filter(([id]) =>
            retained.has(id),
          ),
        );
      }
      let card = next.cards.find((item) => item.id === parentCardId);
      if (!card) {
        card = baseCard(next, event, parentCardId, 'outcome', []);
        card._turn = call.turn;
        card.title = 'Delegated work';
        card.summary =
          'Delegated task results will appear here as they become available.';
        next.cards.push(card);
      }
      card._delegatedActivity = true;
      addEvidence(card, event, 'Delegated assignment accepted');
    }
  } else if (call.kind === 'sensitive') {
    const card = baseCard(
      next,
      event,
      `sensitive:${call.callSeq}`,
      'sensitive',
      call.files,
    );
    const denied = /denied|not permitted|EACCES|\[sandbox:/i.test(text);

    card.status = failed ? (denied ? 'denied' : 'failed') : 'observed';
    card.title = failed
      ? denied
        ? 'Sensitive read denied'
        : 'Sensitive read failed'
      : 'Sensitive file read';
    card.summary = failed
      ? 'A sensitive file read was attempted but did not succeed.'
      : 'A sensitive file read succeeded. File contents are not retained.';
    card.verification = {
      status: 'not-applicable',
      label: 'Sensitive access observation',
    };

    addEvidence(card, { seq: call.callSeq }, 'Sensitive read requested');
    addEvidence(card, event, failed ? 'Read unsuccessful' : 'Read succeeded');
    next.cards.push(card);
  } else if (call.kind === 'edit') {
    if (failed) {
      const card = baseCard(
        next,
        event,
        `attention:${call.callSeq}`,
        'attention',
        call.files,
      );

      card.status = 'failed';
      card.title = 'File modification failed';
      card.summary =
        'A file modification was attempted; no successful change was observed.';

      addEvidence(card, event, 'Modification unsuccessful');
      next.cards.push(card);
    } else {
      const id = `outcome:${String(call.turn ?? 'unknown')}`;
      let card = next.cards.find((x) => x.id === id);

      if (!card) {
        card = baseCard(next, event, id, 'outcome', []);
        card._turn = call.turn ?? null;
        next.cards.push(card);
      }

      card.files = [...new Set([...card.files, ...call.files])];
      card.semanticHints = [
        ...(card.semanticHints || []),
        ...(call.hints || []),
      ]
        .filter(
          (hint, i, all) =>
            all.findIndex(
              (x) => x.kind === hint.kind && x.name === hint.name,
            ) === i,
        )
        .slice(0, 20);

      card.title = 'Changes awaiting summary';
      card.summary =
        'The behavior-level summary will be generated from the recorded changes when this turn ends.';
      card._changes = [
        ...(card._changes || []),
        { callSeq: call.callSeq, resultSeq: event.seq },
      ].slice(-100);

      if (
        card.verification.status !== 'not-run' ||
        (next.lastTest && scopeSupports(next.lastTest.test, card.files))
      )
        card.verification = {
          status: 'stale',
          label: 'Files changed after the observed test result',
        };

      card._editSeq = event.seq;
      card._modifications = (card._modifications || 0) + 1;
      card._finalized = false;
      card.time = event.time ?? card.time;

      addEvidence(card, event, 'Successful file modification');
      next.lastOutcomeId = id;

      // Any older outcome verification is no longer current after a subsequent write.
      for (const previous of next.cards)
        if (
          previous.category === 'outcome' &&
          previous.id !== id &&
          ['passed', 'partial'].includes(previous.verification.status)
        )
          previous.verification = {
            status: 'stale',
            label: 'Files changed after the observed test result',
          };
    }
  } else if (call.kind === 'test') {
    const owner = next.cards.find((c) => c.testRuns?.some((r) => r.id === key));
    if (owner)
      owner.testRuns = owner.testRuns.map((run) =>
        run.id === key
          ? {
              ...run,
              resultSeq: event.seq,
              ...historyResult(data, text, { piped: call.piped }),
            }
          : run,
      );
    // Piped output hides the producer exit code; never certify changes from it.
    if (call.piped) return next;
    // Explicit background calls never supply foreground change verification.
    if (call.background) return next;
    const verification = testResult(data, text);
    next.lastTest = { seq: event.seq, test: call.test };
    const card =
      next.cards.find(
        (x) => x.id === `outcome:${String(call.turn ?? 'unknown')}`,
      ) || next.cards.find((x) => x.id === next.lastOutcomeId);

    if (card && scopeSupports(call.test, card.files)) {
      // A test started before the last write cannot verify that write.
      card.verification =
        call.callSeq < card._editSeq
          ? { status: 'stale', label: 'Files changed after this test started' }
          : verification;
      addEvidence(
        card,
        event,
        verification.status === 'passed'
          ? 'Numeric foreground test result'
          : 'Test execution observed',
      );
    } else if (card && verification.status === 'passed') {
      card.verification =
        call.callSeq < card._editSeq
          ? { status: 'stale', label: 'Files changed after this test started' }
          : {
              status: 'partial',
              label: `${countsFrom(text).pass} selected tests passed; scope not mapped to all changed files`,
            };
      addEvidence(
        card,
        event,
        'Numeric selected-test result; scope not mapped',
      );
    } else if (verification.status === 'failed') {
      const attention = baseCard(
        next,
        event,
        `attention:${call.callSeq}`,
        'attention',
        [],
      );

      attention.title = 'Test execution failed';
      attention.summary = 'A supported test command reported a failure.';
      attention.status = 'failed';
      attention.verification = verification;

      addEvidence(attention, event, 'Test failure observed');
      next.cards.push(attention);
    }
  } else if (call.kind === 'check') {
    const owner = next.cards.find((c) =>
      c.checkRuns?.some((run) => run.id === key),
    );
    if (owner)
      owner.checkRuns = owner.checkRuns.map((run) =>
        run.id === key
          ? {
              ...run,
              resultSeq: event.seq,
              ...historyResult(data, text, { piped: call.piped }),
            }
          : run,
      );
  }

  const maxCards =
    Number.isSafeInteger(config.maxCards) && config.maxCards > 0
      ? config.maxCards
      : 100;
  next.cards = next.cards.slice(-maxCards);

  return next;
}

export function viewState(state) {
  return {
    sessionId: state.sessionId,
    parentSession: structuredClone(state.parentSession),
    ...(state.assignments?.length
      ? { assignments: structuredClone(state.assignments) }
      : {}),
    cards: state.cards.map((card) => ({
      ...Object.fromEntries(
        [
          'id',
          'category',
          'title',
          'summary',
          'status',
          'time',
          'agentId',
          'evidence',
          'files',
          'verification',
        ].map((key) => [key, structuredClone(card[key])]),
      ),
      ...(Array.isArray(card.inputMessageIds)
        ? { inputMessageIds: structuredClone(card.inputMessageIds) }
        : {}),
      ...(Array.isArray(card.testRuns)
        ? {
            testRuns: card.testRuns.map((run) => {
              const value = structuredClone(run);
              const label = card._testLabels?.[run.id];
              if (label)
                Object.defineProperty(value, 'label', {
                  value: label,
                  enumerable: false,
                });
              return value;
            }),
          }
        : {}),
      ...(Array.isArray(card.checkRuns)
        ? { checkRuns: structuredClone(card.checkRuns) }
        : {}),
      ...(Array.isArray(card.changeFiles)
        ? { changeFiles: structuredClone(card.changeFiles) }
        : {}),
    })),
  };
}

export function summaryInput(card) {
  if (!card || card.category !== 'outcome') return null;

  return {
    id: card.id,
    category: card.category,
    mutationSeq: card._editSeq ?? null,
    modificationCount: card._modifications ?? 0,
    files: card.files.map(cleanName),
    changes: structuredClone(card._changes || []),
    semanticHints: {
      status: 'metadata-only',
      items: structuredClone(card.semanticHints || []),
    },
  };
}

function safeModelText(value, max) {
  if (typeof value !== 'string') return null;

  let text = value
    .replace(/`/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove unsupported execution claims without discarding an otherwise useful
  // feature description. Verification always comes from the deterministic field.
  const executionClaim =
    /(?:\b(?:all |every )?tests?\s+(?:passed|pass|failed|succeeded|are green)\b|\b\d+\s+(?:tests?\s+)?(?:passed|failed)\b|\b(?:verified working|production.ready|deployed to production)\b|测试.{0,8}(?:通过|成功|失败)|\d+\s*(?:项|个)?测试)/i;
  text = text
    .split(/(?<=[.!?。！？])\s+/u)
    .filter((sentence) => !executionClaim.test(sentence))
    .join(' ')
    .trim();

  if (
    !text ||
    /(?:<script\b|BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*\S+)/i.test(
      text,
    )
  )
    return null;
  if (
    /(?:observed file modifications|related file modifications|expand evidence for affected files)/i.test(
      text,
    )
  )
    return null;

  return redactText(text).slice(0, max);
}

export function summaryValidationIssue(card, parsed, options = {}) {
  if (
    !card ||
    card.category !== 'outcome' ||
    !parsed ||
    typeof parsed !== 'object'
  )
    return 'invalid-output-shape';
  if (parsed.insufficientContext === true)
    return 'model-reported-insufficient-context';

  const title = safeModelText(parsed.title, 100),
    summary = safeModelText(parsed.summary, 600);
  if (!title) return 'missing-or-unsupported-title';

  if (
    !summary ||
    summary.length <
      (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(summary)
        ? 10
        : 24) ||
    summary.toLowerCase() === title.toLowerCase()
  )
    return 'missing-or-unsupported-description';

  if (options.changeIds) {
    const references = parsed.supportingChangeIds;
    if (!Array.isArray(references) || !references.length)
      return 'missing-supporting-change-references';
    if (!references.every((id) => options.changeIds.includes(id)))
      return 'unknown-supporting-change-reference';
  }

  return null;
}

export function applySummary(card, parsed, options = {}) {
  // Atomic acceptance: a vague title must never replace a useful pending/error state.
  if (summaryValidationIssue(card, parsed, options)) return card;

  const title = safeModelText(parsed.title, 100),
    summary = safeModelText(parsed.summary, 600);

  return {
    ...card,
    title,
    summary,
    _summarySource: options.changeIds ? 'changes' : 'metadata',
    verification: card.verification,
  };
}
