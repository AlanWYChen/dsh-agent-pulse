import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:package.');
const temp = mkdtempSync(join(tmpdir(), 'dsh-activity-package-'));
const destination = process.argv[2] ? resolve(process.argv[2]) : temp;
mkdirSync(destination, { recursive: true });
function npm(args, cwd = root) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}
const [packed] = JSON.parse(
  npm([
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    destination,
  ]),
);
const paths = new Set(packed.files.map((file) => file.path));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patch = readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8');
const patchNames = [
  ...patch.matchAll(/^\s*name:\s*(['"]?)([^'"\s]+)\1\s*$/gm),
].map((match) => match[2]);
assert.ok(
  patchNames.includes(manifest.name),
  'Bundle patch must reference the package name',
);
for (const file of [
  'package.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'THIRD-PARTY-NOTICES.md',
  'docs/PRIVACY.md',
  'docs/DEVELOPMENT.md',
  'docs/CI.md',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
]) {
  assert.ok(paths.has(file), `Missing package file: ${file}`);
}
for (const file of paths) {
  assert.ok(
    !/(^|\/)(node_modules|\.github|\.npm-cache|scripts)(\/|$)|\.test\.js$|\.tgz$/.test(
      file,
    ),
    `Unexpected package file: ${file}`,
  );
}
assert.equal(manifest.license, 'MIT');
const consumer = join(temp, 'consumer');
mkdirSync(consumer);
const tarball = join(destination, packed.filename);
npm([
  'install',
  '--prefix',
  consumer,
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--package-lock=false',
  tarball,
]);
const installed = join(consumer, 'node_modules', ...manifest.name.split('/'));
const plugin = await import(pathToFileURL(join(installed, 'index.js')).href);
assert.equal(typeof plugin.apply, 'function');
assert.equal(plugin.Config.parse({}).maxCards, 100);
assert.deepEqual(plugin.Config.parse({}), {
  summaries: true,
  maxCards: 100,
  summaryTimeoutMs: 45000,
  sensitivePatterns: [],
  excludedPatterns: [],
});
for (const entry of Object.values(manifest.exports)) {
  if (entry.includes('*')) continue;
  assert.ok(paths.has(entry.replace(/^\.\//, '')), `Missing export: ${entry}`);
}
console.log(
  `Verified clean consumer installation: ${manifest.name}@${manifest.version}`,
);
console.log(`Candidate: ${tarball}`);
