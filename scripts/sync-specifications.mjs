// Refreshes what is particular to each Notion add-on: for every addons/<id>/addon.json it copies the
// DISL specification from `source` in a clone of etalii.adp, and the FBL binding from the repository
// and path the specification's `persistence.binding` names, byte for byte, and writes
// addons/<id>/PROVENANCE.md: the repository, the path, the commit and the SHA-256 of both copies
// (etalii.adp spec 012-notion-hype-cycle-addon, research D6, contracts/published-tree.md).
// Every file is read from a git object of a clone, never from a working tree or the network.
//
//   node scripts/sync-specifications.mjs [<repository>=<git ref> ...]
//   node scripts/sync-specifications.mjs --check
//
// A ref defaults to origin/develop, as in `etalii.adp=350ec4c etalii.adp.ide.standalone=70ac026`.
// A clone is the folder of its repository's name beside this repository's main checkout, or in the
// folder the environment variable ADP_CLONES names. With --check nothing is copied and no clone is
// read: both copies of every add-on are compared with their record, and the exit code is 1 when one
// differs. The Build workflow runs the check on every pull request.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const addons = readdirSync(join(root, 'addons'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, 'addons', entry.name, 'addon.json'))).map((entry) => entry.name).sort();
const addonOf = (id) => JSON.parse(readFileSync(join(root, 'addons', id, 'addon.json'), 'utf8'));

if (args.includes('--check')) {
  const problems = [];
  for (const id of addons) {
    const folder = `addons/${id}/`;
    const addon = addonOf(id);
    const record = new Map([...readFileSync(join(root, folder, 'PROVENANCE.md'), 'utf8').matchAll(/^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|\r?$/gm)].map((row) => [row[1], row[2]]));
    for (const file of [...new Set([...record.keys(), addon.specification, addon.binding])].sort()) {
      if (!record.has(file)) problems.push(`${folder}${file}: is not in ${folder}PROVENANCE.md`);
      else if (!existsSync(join(root, folder, file))) problems.push(`${folder}${file}: is in ${folder}PROVENANCE.md and is missing`);
      else if (sha256(readFileSync(join(root, folder, file))) !== record.get(file)) problems.push(`${folder}${file}: differs from the copy ${folder}PROVENANCE.md records`);
    }
  }
  for (const problem of problems) console.error(problem);
  if (problems.length === 0) console.log(`The specification and the binding of ${addons.length} add-on(s) are the copies their PROVENANCE.md records.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

// The clones sit side by side; a worktree of this repository sits deeper, so its main checkout is asked for.
const main = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim());
const clones = process.env.ADP_CLONES ?? resolve(main, '..');
const refs = Object.fromEntries(args.filter((arg) => arg.includes('=')).map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]));
const commits = new Map();
function read(repository, path) {
  const git = (...rest) => execFileSync('git', ['-C', join(clones, repository), ...rest], { maxBuffer: 1 << 28 });
  if (!commits.has(repository)) commits.set(repository, git('rev-parse', `${refs[repository] ?? 'origin/develop'}^{commit}`).toString().trim());
  return git('show', `${commits.get(repository)}:${path}`);
}

for (const id of addons) {
  const addon = addonOf(id);
  const specification = read('etalii.adp', addon.source);
  // The binding is named by its address on the develop branch; the same path is read from the clone at a commit.
  const address = JSON.parse(specification.toString('utf8')).persistence?.binding ?? '';
  const named = /^https:\/\/raw\.githubusercontent\.com\/etalii-adp\/([^/]+)\/[^/]+\/([^#]+)/.exec(address);
  if (!named) {
    console.error(`addons/${id}: the persistence.binding of ${addon.source}, '${address}', names no file of a repository of etalii-adp.`);
    process.exit(1);
  }
  const copies = [
    { file: addon.specification, repository: 'etalii.adp', path: addon.source, bytes: specification },
    { file: addon.binding, repository: named[1], path: named[2], bytes: read(named[1], named[2]) },
  ];
  for (const copy of copies) writeFileSync(join(root, 'addons', id, copy.file), copy.bytes);
  writeFileSync(join(root, 'addons', id, 'PROVENANCE.md'), `# Where the specification and the binding of this Notion add-on come from

They are copied unchanged, byte for byte, from repositories of [etalii-adp](https://github.com/etalii-adp), which are licensed under the Apache License 2.0, as this repository is: the DISL specification of the tool type from \`etalii.adp\`, and the FBL binding from the repository the specification's \`persistence.binding\` names. Do not edit either here: a correction goes to its repository and arrives with a newer copy.

- Refresh them with \`node scripts/sync-specifications.mjs [<repository>=<git ref> ...]\`.
- \`node scripts/sync-specifications.mjs --check\` compares both with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
${copies.map((copy) => `| \`${copy.file}\` | ${copy.repository} | \`${copy.path}\` | \`${commits.get(copy.repository)}\` | \`${sha256(copy.bytes)}\` |`).join('\n')}
`);
  console.log(`addons/${id}: copied ${copies.map((copy) => `${copy.file} from ${copy.repository} at ${commits.get(copy.repository)}`).join(' and ')}.`);
}
