#!/usr/bin/env node
/**
 * Bounded installed-host contract smoke, NOT a full DSH/browser E2E test.
 *
 * CI (run separately for 0.2.1-rc.2 and latest, with Node 24):
 *   npm ci
 *   npm install --prefix "$RUNNER_TEMP/dsh-host" --no-audit --no-fund \
 *     "@deepseek-ai/dsh@$DSH_VERSION"
 *   node scripts/check-dsh-compatibility.mjs "$RUNNER_TEMP/dsh-host"
 *
 * The argument is an npm install prefix (containing node_modules).
 * Alternatively set DSH_HOST_DIR. No host is silently
 * resolved from this candidate's dependencies. Nothing is installed or written.
 * Public host modules are imported, but no app/profile is booted, server started,
 * storage opened, client factory applied, or model called. Synthetic projection
 * events exercise the real Cordis registry with the candidate's pure reducer.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const hostArg = process.argv[2] || process.env.DSH_HOST_DIR;
if (!hostArg || process.argv.length > 3) {
  console.error(
    'Usage: node scripts/check-dsh-compatibility.mjs <DSH install directory>',
  );
  process.exit(2);
}

// A separate process bounds imports, top-level awaits, and lingering handles.
// The worker marker is private to this script, not an additional CLI argument.
if (process.env.DSH_COMPAT_WORKER !== script) {
  const child = spawnSync(process.execPath, [script, hostArg], {
    env: { ...process.env, DSH_COMPAT_WORKER: script },
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error)
    console.error(`DSH compatibility smoke failed: ${child.error.message}`);
  else if (child.signal)
    console.error(`DSH compatibility smoke terminated: ${child.signal}`);
  process.exit(child.error || child.signal ? 1 : (child.status ?? 1));
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Support the candidate's explicit >= minimum, including SemVer prereleases.
// Fail closed if its engine expression changes to a range we do not implement.
function parseVersion(value) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z.-]+))?(?:\+[\da-zA-Z.-]+)?$/.exec(
      value,
    );
  assert.ok(match, `Unsupported version: ${value}`);
  return { core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') };
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i]);
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

async function main() {
  const hostDir = realpathSync(resolve(hostArg));
  assert.ok(
    statSync(hostDir).isDirectory(),
    'Host argument must be a directory',
  );
  const hostRequire = createRequire(
    resolve(hostDir, '__dsh_compat_resolve__.cjs'),
  );
  const publicPath = (specifier) => {
    const path = realpathSync(hostRequire.resolve(specifier));
    const rel = relative(hostDir, path);
    assert.ok(
      rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
      `${specifier} resolved outside the supplied host install: ${path}`,
    );
    return path;
  };
  const hostImport = (name) => import(pathToFileURL(publicPath(name)).href);
  const candidate = json(resolve(root, 'package.json'));
  const host = json(publicPath('@deepseek-ai/dsh/package.json'));
  assert.equal(host.name, '@deepseek-ai/dsh');
  const minimum = /^>=(\S+)$/.exec(candidate.engines?.dsh ?? '');
  assert.ok(minimum, 'Expected one explicit >= minimum in engines.dsh');
  assert.ok(
    compareVersions(parseVersion(host.version), parseVersion(minimum[1])) >= 0,
    `DSH ${host.version} is older than required ${minimum[1]}`,
  );
  console.log(
    `DSH ${host.version}; candidate ${candidate.name}@${candidate.version}`,
  );

  const plugin = await import(
    pathToFileURL(resolve(root, candidate.exports['.'])).href
  );
  assert.equal(typeof plugin.apply, 'function');
  const config = plugin.Config.parse({ summaries: false });
  assert.equal(config.summaries, false);
  assert.deepEqual(plugin.inject, [
    'sessionProjections',
    'sessions',
    'storageDomain',
    'connection',
    'llm',
    'webServer',
  ]);

  // Import the installed public seams rather than private implementation paths.
  const surfaces = [
    ['@deepseek-ai/cordis', 'Context', []],
    [
      '@deepseek-ai/dsh-session-projection',
      'SessionProjectionRegistry',
      ['register', 'onChanged', 'stateOf', 'snapshot', 'restore'],
    ],
    ['@deepseek-ai/dsh-session', 'SessionStore', ['get', 'list']],
    ['@deepseek-ai/dsh-storage-domain', 'DomainFacility', ['open']],
    ['@deepseek-ai/dsh-api-gateway', 'TypertGatewayService', []],
    ['@deepseek-ai/dsh-llm', 'LlmRuntime', []],
    ['@deepseek-ai/dsh-host-webserver', 'WebServer', []],
    ['@deepseek-ai/dsh-tools', 'ToolRuntime', ['register']],
  ];
  const imported = new Map();
  for (const [name, symbol, methods] of surfaces) {
    const mod = await hostImport(name);
    imported.set(name, mod);
    assert.equal(
      typeof mod[symbol],
      'function',
      `${name} must export ${symbol}`,
    );
    for (const method of methods) {
      assert.equal(
        typeof mod[symbol].prototype[method],
        'function',
        `${symbol}.${method}`,
      );
    }
    console.log(`  public host surface: ${name}`);
  }

  // Use the real registry and Cordis lifecycle, not a mock host context.
  // This is only the projection seam, not plugin.apply() or session persistence.
  const { Context } = imported.get('@deepseek-ai/cordis');
  const { SessionProjectionRegistry } = imported.get(
    '@deepseek-ai/dsh-session-projection',
  );
  const { initState, reduceEvent, viewState, PROJECTION_KEY } = await import(
    pathToFileURL(resolve(root, 'engine.js')).href
  );
  const { z } = await import(
    pathToFileURL(createRequire(resolve(root, 'package.json')).resolve('zod'))
      .href
  );
  const ctx = new Context();
  try {
    const registry = new SessionProjectionRegistry(ctx);
    const unregister = registry.register({
      key: PROJECTION_KEY,
      stateVersion: 2,
      stateSchema: z.json(),
      init: initState,
      apply: (state, event) => reduceEvent(state, event, config),
      wire: { viewSchema: z.json(), view: viewState },
    });
    const events = [
      {
        type: 'tool/call',
        seq: 0,
        time: 1,
        data: {
          turn: 1,
          callId: 'compat-read',
          name: 'read',
          arguments: JSON.stringify({ file_path: '.env' }),
        },
      },
      {
        type: 'tool/result',
        seq: 1,
        time: 2,
        data: {
          turn: 1,
          message: {
            toolCallId: 'compat-read',
            content: [{ type: 'text', text: 'COMPAT_SECRET=not-for-client' }],
          },
        },
      },
    ];
    const restored = registry.restore({}, events, 0, { id: 'compat-smoke' }, 0);
    assert.equal(restored.snapshot.asOfSeq, 1);
    const view = restored.snapshot.values[PROJECTION_KEY];
    assert.ok(view.cards.some((card) => card.category === 'sensitive'));
    assert.equal(JSON.stringify(view).includes('COMPAT_SECRET'), false);
    const replay = registry.restore(
      restored.checkpoint,
      [],
      2,
      { id: 'compat-smoke' },
      0,
    );
    assert.deepEqual(replay.snapshot, restored.snapshot);
    await unregister();
    assert.equal(
      registry.restore({}, [], 0, { id: 'compat-smoke' }, 0).snapshot.values[
        PROJECTION_KEY
      ],
      undefined,
    );
    console.log(
      '  real Cordis projection registration, replay, checkpoint, and disposal: passed',
    );
  } finally {
    await ctx.fiber.dispose();
  }

  // Browser bundles are not Node modules: resolve their PUBLIC /client exports
  // and validate loader registration without fabricating browser services/React.
  assert.equal(candidate.dsh?.client?.platform, 'web');
  assert.equal(candidate.dsh.client.immediately, true);
  assert.ok(candidate.dsh.client.inject.length > 0);
  for (const name of candidate.dsh.client.inject) {
    const metadata = json(publicPath(`${name}/package.json`));
    assert.equal(metadata.name, name);
    assert.equal(
      metadata.dsh?.client?.platform,
      'web',
      `${name} must be a web client plugin`,
    );
    assert.ok(statSync(publicPath(`${name}/client`)).isFile());
    console.log(`  installed browser dependency /client: ${name}`);
  }
  let registration;
  const source = readFileSync(
    resolve(root, candidate.exports['./client']),
    'utf8',
  );
  new vm.Script(source, { filename: 'candidate-client.js' }).runInNewContext(
    {
      window: {
        __ModuleLoader__: {
          load(value) {
            assert.equal(
              registration,
              undefined,
              'Expected a single client registration',
            );
            registration = value;
          },
        },
      },
    },
    { timeout: 1000 },
  );
  assert.equal(registration?.id, candidate.name);
  assert.equal(typeof registration?.factory, 'function');
  console.log(
    '  candidate browser module registration: passed (factory not executed)',
  );
  console.log(
    'PASS: installed-host public-surface/projection and client metadata contract smoke.',
  );
  console.log(
    'NOT tested: full plugin lifecycle, storage/network/auth, model calls, DOM rendering, or browser service contracts.',
  );
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
