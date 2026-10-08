// Writes what this repository publishes at https://etalii.net/adp-notion: the add-on index and one folder
// per Notion add-on (etalii.adp spec 012-notion-hype-cycle-addon, contracts/published-tree.md).
//
//   node scripts/build.mjs --out <dir>
//
// The Build workflow runs it on every pull request, and the deploy workflow of etalii.adp.site runs it to
// publish. It needs no npm install: it runs scripts/ensure-dependencies.mjs itself, and fetches nothing
// else. It compiles the shared parts under src/ once, into addon.js and addon.css, and writes both into
// every add-on's folder beside the folder's own files. Exit code 0 means the whole tree is written;
// anything else means the tree must not be published.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const root = resolve(import.meta.dirname, '..');

const flag = process.argv.indexOf('--out');
const out = flag < 0 ? undefined : process.argv[flag + 1];
if (!out) {
  console.error('Usage: node scripts/build.mjs --out <dir>');
  process.exit(2);
}

// The dependencies first, from package-lock.json: the only thing the build fetches.
const run = (script, ...args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' }).status === 0;
if (!run('ensure-dependencies.mjs')) process.exit(1);

// Every folder directly under addons/ is one add-on, named by the id of its tool type. Files there are none.
const addons = join(root, 'addons');
const ids = existsSync(addons)
  ? readdirSync(addons, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];

const problems = [];
function stop() {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

// What the contract refuses. An add-on is listed by the label its specification gives the tool type.
const labels = new Map();
for (const id of ids) {
  const has = (file) => typeof file === 'string' && existsSync(join(addons, id, file));
  if (!ID.test(id) || id === 'index') {
    problems.push(`addons/${id}: the folder name is not a valid add-on id (lowercase letters and digits with dashes, and not "index")`);
    continue;
  }
  for (const file of ['index.html', 'addon.json', 'PROVENANCE.md']) if (!has(file)) problems.push(`addons/${id}: has no ${file}`);
  for (const file of ['addon.js', 'addon.css']) if (has(file)) problems.push(`addons/${id}/${file}: that name is the build's, which writes the shared parts there`);
  if (!has('addon.json')) continue;
  try {
    const addon = JSON.parse(readFileSync(join(addons, id, 'addon.json'), 'utf8'));
    for (const key of ['specification', 'binding']) if (!has(addon[key])) problems.push(`addons/${id}/addon.json: its ${key}, '${addon[key]}', is no file of the folder`);
    if (!has(addon.specification)) continue;
    const label = JSON.parse(readFileSync(join(addons, id, addon.specification), 'utf8')).language?.label;
    if (typeof label === 'string' && label.trim()) labels.set(id, label);
    else problems.push(`addons/${id}/${addon.specification}: has no language.label to list the add-on by`);
  } catch (error) {
    problems.push(`addons/${id}: addon.json or the specification it names is not JSON: ${error.message}`);
  }
}
if (problems.length > 0) stop();

// Every copy is compared with the record of its PROVENANCE.md: the specifications and bindings, and the
// FBL library. Neither check reads another repository.
if (!run('sync-specifications.mjs', '--check') || !run('sync-fbl.mjs', '--check')) process.exit(1);

// The shared parts, compiled once. The entry is every module directly under src/frame/parts/, then the
// frame's start. A browser has no Node: the one module of it the copied FBL library asks for is replaced
// by a shim, and esbuild refuses any other.
const { build, transform } = await import('esbuild');
const modules = join(root, 'src/frame/parts');
const parts = existsSync(modules)
  ? readdirSync(modules, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')).map((entry) => entry.name).sort()
  : [];
const entry = [...parts.map((name) => `import './src/frame/parts/${name}';`), "import { start } from './src/frame/main.ts';", 'start();', ''].join('\n');
// The styles: Notion's look first, since every other stylesheet uses its properties.
const first = 'src/panels/notion.css';
const sheets = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort().sort((a, b) => (b === first) - (a === first));
let script;
let style;
try {
  const bundle = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'addon.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', write: false,
    alias: { 'node:crypto': join(root, 'src/shims/node-crypto.ts') }, logLevel: 'warning',
  });
  script = bundle.outputFiles[0].contents;
  style = (await transform(sheets.map((file) => readFileSync(join(root, file), 'utf8')).join('\n'), { loader: 'css', minify: true, legalComments: 'none' })).code;
} catch (error) {
  // esbuild has said what and where already; an error of another kind has not been said yet.
  if (!Array.isArray(error.errors)) console.error(error);
  problems.push('The shared parts under src/ could not be compiled into addon.js and addon.css.');
  stop();
}

// The revision is this checkout's own, never the caller's: in the site's workflow the caller's is the site's.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const escaped = (text) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
const items = ids.map((id) => `      <li><a href="${id}/">${escaped(labels.get(id))}</a></li>\n`).join('');
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
for (const id of ids) {
  cpSync(join(addons, id), join(target, id), { recursive: true });
  writeFileSync(join(target, id, 'addon.js'), script);
  writeFileSync(join(target, id, 'addon.css'), style);
  // A browser keeps addon.js and addon.css for a while. The page names them with the revision, so a new
  // publication is fetched as soon as the page itself is.
  const page = join(target, id, 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace(/"(addon\.(?:js|css))"/g, `"$1?v=${revision}"`));
}
writeFileSync(join(target, 'index.html'), index);
console.log(`Wrote the add-on index and ${ids.length} add-on(s) to ${target}, revision ${revision}: addon.js is ${script.length} bytes, addon.css ${Buffer.byteLength(style)} bytes.`);
