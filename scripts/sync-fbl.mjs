// Refreshes src/fbl/, the FBL library every Notion add-on shares, from `src/core/fbl` of a clone of
// etalii.adp.ide.vscode, byte for byte, and writes src/fbl/PROVENANCE.md: the repository, the path,
// the commit and the SHA-256 of every file (etalii.adp spec 012-notion-hype-cycle-addon, research D4).
// Every file is read from a git object, never from a working tree, so no line ending is converted.
//
//   node scripts/sync-fbl.mjs [etalii.adp.ide.vscode=<git ref>]
//   node scripts/sync-fbl.mjs --check
//
// The ref defaults to origin/develop. The clone is the folder of that name beside this repository's
// main checkout, or in the folder the environment variable ADP_CLONES names. With --check nothing is
// copied and no clone is read: every file under src/fbl/ is compared with its record, and the exit
// code is 1 when one differs. The Build workflow runs the check on every pull request.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const repository = 'etalii.adp.ide.vscode';
const from = 'src/core/fbl/';
const to = 'src/fbl/';
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (args.includes('--check')) {
  const record = new Map([...readFileSync(join(root, to, 'PROVENANCE.md'), 'utf8').matchAll(/^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|\r?$/gm)].map((row) => [row[1], row[2]]));
  const found = readdirSync(join(root, to), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => relative(join(root, to), join(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter((file) => file !== 'PROVENANCE.md');
  const problems = [];
  for (const file of [...new Set([...record.keys(), ...found])].sort()) {
    if (!record.has(file)) problems.push(`${to}${file}: is not in ${to}PROVENANCE.md`);
    else if (!existsSync(join(root, to, file))) problems.push(`${to}${file}: is in ${to}PROVENANCE.md and is missing`);
    else if (sha256(readFileSync(join(root, to, file))) !== record.get(file)) problems.push(`${to}${file}: differs from the copy ${to}PROVENANCE.md records`);
  }
  for (const problem of problems) console.error(problem);
  if (problems.length === 0) console.log(`The ${record.size} files under ${to} are the copies ${to}PROVENANCE.md records.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

// The clones sit side by side; a worktree of this repository sits deeper, so its main checkout is asked for.
const main = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim());
const clone = join(process.env.ADP_CLONES ?? resolve(main, '..'), repository);
const ref = args.find((arg) => arg.startsWith(`${repository}=`))?.slice(repository.length + 1) ?? 'origin/develop';
const git = (...rest) => execFileSync('git', ['-C', clone, ...rest], { maxBuffer: 1 << 28 });
const commit = git('rev-parse', `${ref}^{commit}`).toString().trim();
const files = git('ls-tree', '-r', '-z', '--name-only', commit, '--', from).toString().split('\0').filter(Boolean).sort();
if (files.length === 0) {
  console.error(`${repository} has no file under ${from} at ${commit}.`);
  process.exit(1);
}

rmSync(join(root, to), { recursive: true, force: true });
const rows = files.map((file) => {
  const bytes = git('show', `${commit}:${file}`);
  const target = join(root, to, file.slice(from.length));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return `| \`${file.slice(from.length)}\` | ${repository} | \`${file}\` | \`${commit}\` | \`${sha256(bytes)}\` |`;
});

writeFileSync(join(root, to, 'PROVENANCE.md'), `# Where the files under src/fbl/ come from

They are the FBL library of the Visual Studio Code host, copied unchanged, byte for byte, from \`${from}\` of [etalii-adp/${repository}](https://github.com/etalii-adp/${repository}), which is licensed under the Apache License 2.0, as this repository is. Do not edit a file here: a correction goes to that repository and arrives with a newer copy.

- Refresh them with \`node scripts/sync-fbl.mjs [${repository}=<git ref>]\`.
- \`node scripts/sync-fbl.mjs --check\` compares every file with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`);
console.log(`Copied ${files.length} files from ${repository} at ${commit}.`);
