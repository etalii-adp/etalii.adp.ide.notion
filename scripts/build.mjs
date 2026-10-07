// Writes what this repository publishes at https://etalii.net/adp-notion: the add-on index and one folder
// per Notion add-on (etalii.adp spec 011-notion-repository, contracts/published-tree.md).
//
//   node scripts/build.mjs --out <dir>
//
// The Build workflow runs it on every pull request, and the deploy workflow of etalii.adp.site runs it to
// publish. It needs no npm install. Exit code 0 means the whole tree is written; anything else means the
// tree must not be published.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const root = resolve(import.meta.dirname, '..');

const flag = process.argv.indexOf('--out');
const out = flag < 0 ? undefined : process.argv[flag + 1];
if (!out) {
  console.error('Usage: node scripts/build.mjs --out <dir>');
  process.exit(2);
}

// Every folder directly under addons/ is one add-on, named by the id of its tool type. Files there are none.
const addons = join(root, 'addons');
const ids = existsSync(addons)
  ? readdirSync(addons, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];

const problems = [];
for (const id of ids) {
  if (!ID.test(id) || id === 'index') {
    problems.push(`addons/${id}: the folder name is not a valid add-on id (lowercase letters and digits with dashes, and not "index")`);
  } else if (!existsSync(join(addons, id, 'index.html'))) {
    problems.push(`addons/${id}: has no index.html`);
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

// The revision is this checkout's own, never the caller's: in the site's workflow the caller's is the site's.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const items = ids.map((id) => `      <li><a href="${id}/">${id}</a></li>\n`).join('');
const none = ids.length === 0 ? '    <p id="no-addons">No add-on is available yet.</p>\n' : '';
const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ADP Notion add-ons</title>
    <style>body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }</style>
  </head>
  <body>
    <h1>ADP Notion add-ons</h1>
    <p>A Notion add-on is a web page that shows one ADP tool inside a Notion page. Embed the address of an add-on in a Notion page to use it.</p>
    <ul id="addons">
${items}    </ul>
${none}    <p>Published from <a href="https://github.com/etalii-adp/etalii.adp.ide.notion">etalii.adp.ide.notion</a>, revision <code id="revision">${revision}</code>.</p>
  </body>
</html>
`;

const target = resolve(out);
mkdirSync(target, { recursive: true });
for (const id of ids) cpSync(join(addons, id), join(target, id), { recursive: true });
writeFileSync(join(target, 'index.html'), index);
console.log(`Wrote the add-on index and ${ids.length} add-on(s) to ${target}, revision ${revision}.`);
