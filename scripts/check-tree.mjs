// Checks a tree that scripts/build.mjs wrote, as "Check in Build" of contracts/published-tree.md of
// etalii.adp spec 012-notion-hype-cycle-addon asks:
//
// - every add-on's folder holds index.html, addon.json, the two files it names, PROVENANCE.md, addon.js and addon.css;
// - no addon.js holds a name that the specifications and bindings under addons/ declare, the names of
//   test/words.exempt.json apart, so that nothing of a tool type is compiled into the shared parts;
// - no file holds a string that reads as a Notion token or a client secret.
//
//   node scripts/check-tree.mjs <dir>
//
// It needs no dependency. Exit code 0 means the tree passes, 1 that it does not, 2 that no folder was given.
// The names are the ones test/words.test.ts collects: the paths below are that file's, line for line,
// and test/check-tree.test.ts fails when the two differ.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Usage: node scripts/check-tree.mjs <dir>');
  process.exit(2);
}
const tree = resolve(dir);
const problems = [];

// ---- the files of every add-on's folder ----

const ids = readdirSync(tree, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const id of ids) {
  const has = (file) => typeof file === 'string' && existsSync(join(tree, id, file));
  for (const file of ['index.html', 'addon.json', 'PROVENANCE.md', 'addon.js', 'addon.css']) if (!has(file)) problems.push(`${id}/: has no ${file}`);
  if (!has('addon.json')) continue;
  const addon = JSON.parse(readFileSync(join(tree, id, 'addon.json'), 'utf8'));
  for (const key of ['specification', 'binding']) if (!has(addon[key])) problems.push(`${id}/addon.json: its ${key}, '${addon[key]}', is no file of the folder`);
}

// ---- the names of a tool type ----

// A name whatever its spelling: `peak-end`, `peakEnd` and `PEAK_END` are all `peak end`.
const words = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/).filter(Boolean).join(' ').toLowerCase();

// The strings at a path of a document: `*` is every child, `**` every descendant, `#` the keys.
function pick(node, path) {
  if (node === null || node === undefined) return [];
  const [step, ...rest] = path;
  if (step === undefined) return typeof node === 'string' ? [node] : Array.isArray(node) ? node.filter((item) => typeof item === 'string') : [];
  if (typeof node !== 'object') return [];
  if (step === '#') return Array.isArray(node) ? pick(node, []) : Object.keys(node);
  if (step === '*') return Object.values(node).flatMap((child) => pick(child, rest));
  if (step === '**') return [...pick(node, rest), ...Object.values(node).flatMap((child) => pick(child, path))];
  return pick(node[step], rest);
}

// ---- the paths of test/words.test.ts ----
const specificationNames = [
  'language.id', 'language.fileExtension', 'language.origin', 'functions.#',
  'metamodel.diagram.attributes.#', 'metamodel.dataTypes.#', 'metamodel.dataTypes.*.fields.#',
  'metamodel.enums.#', 'metamodel.enums.*.values.#',
  'metamodel.types.#', 'metamodel.types.*.attributes.#', 'metamodel.types.*.ports.#',
  'metamodel.relations.#', 'metamodel.relations.*.attributes.#',
  'coordinates.axes.#', 'coordinates.systems.#', 'coordinates.snapProfiles.#',
  'notation.theme.tokens.#', 'notation.styles.#', 'notation.markers.#', 'notation.icons.#',
  'notation.shapes.#', 'notation.shapes.*.params.#', 'notation.shapes.*.parts.*.id', 'notation.canvas.filters.#',
  'toolbox.tools.#', 'toolbox.templates.#', 'toolbox.groups.*.id', 'toolbox.groups.*.tools.*.id',
  'forms.#', 'forms.**.id',
  'constraints.groups.#', 'constraints.rules.*.id', 'constraints.rules.*.code', 'constraints.builtIn.*.code',
  'behavior.operations.#', 'behavior.placements.#', 'behavior.reasons.#', 'behavior.messages.#', 'behavior.hooks.*.id',
  'layout.algorithms.#', 'viewpoints.#',
];
const rule = ['name', 'type', 'attributes.#', 'attributes.*.key', 'insert.keys'];
const bindingNames = [
  'bindings.#', 'bindings.*.claims.extensions', 'bindings.*.claims.origins', 'bindings.*.header.key',
  ...['blocks', 'elements', 'relations'].flatMap((rules) => rule.map((path) => `bindings.*.${rules}.*.${path}`)),
];
// A selector names the keys of the file it reads, one in each step.
const bindingSelectors = ['elements', 'relations'].flatMap((rules) => [`bindings.*.${rules}.*.at`, `bindings.*.${rules}.*.insert.container`]);
// ---- the end of those paths ----

const filesUnder = (folder) => readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();

const names = new Map();
for (const file of filesUnder(join(root, 'addons')).filter((path) => path.endsWith('.dis') || path.endsWith('.fbl'))) {
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const at = (paths) => paths.flatMap((path) => pick(document, path.split('.')));
  const found = file.endsWith('.dis') ? at(specificationNames) : [...at(bindingNames), ...at(bindingSelectors).flatMap((selector) => selector.split('/'))];
  for (const name of found) if (/[A-Za-z]/.test(name) && !names.has(words(name))) names.set(words(name), name);
}
// In the bundle the copied FBL library is one with the rest, so a name exempt there is exempt everywhere.
for (const entry of JSON.parse(readFileSync(join(root, 'test/words.exempt.json'), 'utf8')).exempt) names.delete(words(entry.name));
const longest = Math.max(0, ...[...names.keys()].map((name) => name.split(' ').length));

// The names in a text whose words are parted by `-`, `.` or `_`: every run of whole words is tried.
// A minified bundle is searched as text: its strings and its property names are what is left of a word.
for (const id of ids.filter((folder) => existsSync(join(tree, folder, 'addon.js')))) {
  const text = readFileSync(join(tree, id, 'addon.js'), 'utf8');
  const held = new Map();
  for (const run of text.matchAll(/[A-Za-z0-9]+(?:[-._][A-Za-z0-9]+)*/g)) {
    const parts = [...run[0].matchAll(/[A-Za-z0-9]+/g)].map((part) => words(part[0]));
    for (let first = 0; first < parts.length; first++) {
      for (let last = first; last < parts.length && last - first < longest; last++) {
        const name = parts.slice(first, last + 1).join(' ');
        if (names.has(name) && !held.has(name)) held.set(name, text.slice(Math.max(0, run.index - 30), run.index + run[0].length + 30));
      }
    }
  }
  for (const [name, around] of held) problems.push(`${id}/addon.js: holds '${names.get(name)}', a name of a tool type, in: ${around}`);
}

// ---- what reads as a secret ----

// A Notion token starts with `secret_` or `ntn_`; a client secret is found by the value it is given.
const secrets = [
  ['a Notion token', /\b(?:secret|ntn)_[A-Za-z0-9]{24,}/],
  ['a client secret', /client[_-]?secret["'`]?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i],
];
for (const file of filesUnder(tree)) {
  const text = readFileSync(file, 'latin1');
  for (const [what, pattern] of secrets) {
    if (pattern.test(text)) problems.push(`${relative(tree, file).replaceAll('\\', '/')}: holds what reads as ${what}`);
  }
}

for (const problem of problems) console.error(problem);
if (problems.length === 0) console.log(`The ${ids.length} add-on folder(s) of ${tree} are whole, no addon.js holds one of the ${names.size} names of a tool type, and no file holds what reads as a secret.`);
process.exit(problems.length === 0 ? 0 : 1);
