import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const integration = new Set([
  'behavior.test.js',
  'client.test.js',
  'full-diff-host.test.js',
  'host.test.js',
  'native-review.test.js',
]);
const group = process.argv[2] ?? 'all';
if (!['all', 'unit', 'integration'].includes(group)) {
  throw new Error(`Unknown test group: ${group}`);
}
const files = readdirSync(root)
  .filter((file) => file.endsWith('.test.js'))
  .filter(
    (file) =>
      group === 'all' || integration.has(file) === (group === 'integration'),
  )
  .sort();
if (!files.length) throw new Error(`No tests found for ${group}`);
console.log(`Running ${group} tests (${files.length} files).`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
