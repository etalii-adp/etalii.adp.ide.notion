// Installs the build's dependencies when they are not there, or are older than package-lock.json,
// so that `node scripts/build.mjs --out <dir>` works from a fresh checkout with no step before it:
// that command line is the whole contract with the deploy workflow of etalii.adp.site. It uses
// nothing but Node itself, since it runs before anything is installed.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const installed = join(root, 'node_modules', '.package-lock.json');
const lock = join(root, 'package-lock.json');
const upToDate = existsSync(installed) && statSync(installed).mtimeMs >= statSync(lock).mtimeMs;
if (!upToDate) {
  console.log(existsSync(join(root, 'node_modules')) ? 'The dependencies are older than package-lock.json; installing them again.' : 'The dependencies are not installed yet; installing them.');
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error('The dependencies could not be installed. Run `npm ci` in this folder to see why.');
    process.exit(result.status ?? 1);
  }
}
