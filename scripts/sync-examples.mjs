// Refreshes the test documents of every Notion add-on's tool type, byte for byte, from git objects of
// the clones (etalii.adp spec 012-notion-hype-cycle-addon, research D14 and D15):
//
// - test/examples/<id>/: the examples of the tool type, from etalii.adp.ide.vscode;
// - test/fixtures/<id>/: the fixtures the standalone host's tests of the tool type read, from etalii.adp.ide.standalone;
// - test/fixtures/mindmap.dis: the specification of another tool type, from etalii.adp, for the tests of reuse.
// - test/fixtures/disl.schema.json: DISL's JSON Schema, from etalii.adp, which the tests walk a specification beside.
//
// It writes test/examples/PROVENANCE.md and test/fixtures/PROVENANCE.md (repository, path, commit and
// SHA-256 per file) and, beside each example document, `<name>.places.json`: the places the Visual
// Studio Code host computes for it, which the interpreter here must compute too (contracts/shared-parts.md).
// For those it takes that host's `src/core` and `src/webview` at the same commit into a temporary
// folder, unchanged, bundles the tool type's view and the library's anchors with esbuild, and runs them.
//
//   node scripts/sync-examples.mjs [<repository>=<git ref> ...]
//   node scripts/sync-examples.mjs --check
//
// A ref defaults to origin/develop, as in `etalii.adp.ide.vscode=271a92c`. A clone is the folder of its
// repository's name beside this repository's main checkout, or in the folder the environment variable
// ADP_CLONES names. With --check nothing is copied or computed and no clone is read: every copied
// file is compared with its record, and the exit code is 1 when one differs.
//
// A places file, every number in the canvas's unit at zoom 1, with y downwards:
//
//   {
//     "example": "<folder>/<document>",
//     "host": { "repository", "commit", "view": the module that was run },
//     "parameters": { "compact": false, "viewport": null, "filterTags": [], "zoom": 1 },
//     "unit": the time unit the document is drawn in,
//     "nodes": [ { "id", "type", "label": the name an edit in place opens with, "text": the text drawn,
//                  "box": { "x", "y", "width", "height" },
//                  "parts": [ { "id": the part's name, "box" } ] } ],     only for a composite shape
//     "edges": [ { "id", "type",
//                  "from": { "node", "part", "at", "side", "x", "y" },    part and at only where the end is stored
//                  "to": the same } ]                                     on a part; "hidden": true and no points
//   }                                                                     for an edge the host does not draw
//
// The parameters are the default viewpoint: not compact, no viewport, so nothing is culled, and no
// tag filter. That viewpoint measures no text, so no text measurer is involved. A part's box is the
// stretch of the node's top and bottom edge that belongs to it, at the node's full height, which is
// the box the specification gives the part of that name. A side is the edge an end sits on: top,
// right, bottom or left. Two places are equal when no number differs by 0.5 or more.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Per add-on, where the Visual Studio Code host keeps the tool type: its examples, the module and name
// of its diagram type, and the module and name of what the diagram library draws it from.
const hosts = {
  'gartner-hype-cycle-graph': {
    examples: 'examples/gartner-hypecycle-graph/',
    type: ['src/core/gartner-hypecycle-graph/index', 'gartnerHypecycleGraph'],
    view: 'src/core/gartner-hypecycle-graph/view.ts',
    definition: ['src/webview/gartner-hypecycle-graph/definition', 'gartnerHypecycleGraphDefinition'],
  },
};
const vscode = 'etalii.adp.ide.vscode';
const standalone = 'etalii.adp.ide.standalone';
const parameters = { compact: false, viewport: null, filterTags: [], zoom: 1 };

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (args.includes('--check')) {
  const problems = [];
  let count = 0;
  for (const folder of ['test/examples/', 'test/fixtures/']) {
    const record = new Map([...readFileSync(join(root, folder, 'PROVENANCE.md'), 'utf8').matchAll(/^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|\r?$/gm)].map((row) => [row[1], row[2]]));
    const found = readdirSync(join(root, folder), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      .map((entry) => relative(join(root, folder), join(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter((file) => file !== 'PROVENANCE.md' && !file.endsWith('.places.json'));
    for (const file of [...new Set([...record.keys(), ...found])].sort()) {
      if (!record.has(file)) problems.push(`${folder}${file}: is not in ${folder}PROVENANCE.md`);
      else if (!existsSync(join(root, folder, file))) problems.push(`${folder}${file}: is in ${folder}PROVENANCE.md and is missing`);
      else if (sha256(readFileSync(join(root, folder, file))) !== record.get(file)) problems.push(`${folder}${file}: differs from the copy ${folder}PROVENANCE.md records`);
    }
    count += record.size;
  }
  for (const problem of problems) console.error(problem);
  if (problems.length === 0) console.log(`The ${count} files under test/examples/ and test/fixtures/ are the copies their PROVENANCE.md records.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

// The clones sit side by side; a worktree of this repository sits deeper, so its main checkout is asked for.
const main = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim());
const clones = process.env.ADP_CLONES ?? resolve(main, '..');
const refs = Object.fromEntries(args.filter((arg) => arg.includes('=')).map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]));
const git = (repository, ...rest) => execFileSync('git', ['-C', join(clones, repository), ...rest], { maxBuffer: 1 << 28 });
const commits = Object.fromEntries([vscode, standalone, 'etalii.adp'].map((repository) => [repository, git(repository, 'rev-parse', `${refs[repository] ?? 'origin/develop'}^{commit}`).toString().trim()]));
const list = (repository, folder) => git(repository, 'ls-tree', '-r', '-z', '--name-only', commits[repository], '--', folder).toString().split('\0').filter(Boolean).sort();
const read = (repository, path) => git(repository, 'show', `${commits[repository]}:${path}`);

// One copy: written under `folder` as `file`, and returned as its row of that folder's PROVENANCE.md.
function copy(folder, file, repository, path) {
  const bytes = read(repository, path);
  mkdirSync(dirname(join(root, folder, file)), { recursive: true });
  writeFileSync(join(root, folder, file), bytes);
  return `| \`${file}\` | ${repository} | \`${path}\` | \`${commits[repository]}\` | \`${sha256(bytes)}\` |`;
}

const ids = readdirSync(join(root, 'addons'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, 'addons', entry.name, 'addon.json'))).map((entry) => entry.name).sort();
const missing = ids.filter((id) => !hosts[id]);
if (missing.length > 0) {
  console.error(`scripts/sync-examples.mjs does not say where the Visual Studio Code host keeps the tool type of: ${missing.join(', ')}.`);
  process.exit(1);
}

const examples = [];
const fixtures = [];
for (const id of ids) {
  rmSync(join(root, 'test/examples', id), { recursive: true, force: true });
  rmSync(join(root, 'test/fixtures', id), { recursive: true, force: true });
  for (const path of list(vscode, hosts[id].examples)) examples.push(copy('test/examples/', `${id}/${path.slice(hosts[id].examples.length)}`, vscode, path));
  // The fixtures of the tool type's tests, and the scale fixture every host of it shares.
  const shared = list(standalone, `src/diagrams/${id}/`).filter((path) => path.includes('/Fixtures/') || path.endsWith('/scale-fixture.json'));
  for (const path of shared) fixtures.push(copy('test/fixtures/', `${id}/${path.slice(path.lastIndexOf('/') + 1)}`, standalone, path));
}
fixtures.push(copy('test/fixtures/', 'mindmap.dis', 'etalii.adp', 'definitions/diagrams/mindmap.dis'));
fixtures.push(copy('test/fixtures/', 'disl.schema.json', 'etalii.adp', 'specifications/disl/disl.schema.json'));

// ---- the places: the Visual Studio Code host's own modules, unchanged, run on every example ----

const work = mkdtempSync(join(tmpdir(), 'adp-places-'));
for (const path of [...list(vscode, 'src/core/'), ...list(vscode, 'src/webview/')]) {
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), read(vscode, path));
}
const { build } = await import('esbuild');
// The icons of the toolbox are no part of a place, and that host's dependencies are not installed here.
const noIcons = {
  name: 'no-icons',
  setup(setup) {
    setup.onResolve({ filter: /^@mdi\/js$/ }, () => ({ path: 'icons', namespace: 'none' }));
    setup.onLoad({ filter: /.*/, namespace: 'none' }, () => ({ contents: 'module.exports = {};' }));
  },
};

const sideOf = (normal) => (normal.y < 0 ? 'top' : normal.y > 0 ? 'bottom' : normal.x > 0 ? 'right' : 'left');
const boxOf = ({ x, y, width, height }) => ({ x, y, width, height });

function placesOf(host, text) {
  const view = host.type.view({ text }, { compact: parameters.compact, filterTags: parameters.filterTags });
  const elements = new Map(view.elements.map((element) => [element.id, element]));
  const typeOf = (id) => host.elementTypeOf(host.definition, elements.get(id));
  const nodes = view.elements.map((element) => {
    const type = typeOf(element.id);
    const banner = host.bannerOfElement(type, element);
    const shown = type.labels?.[0]?.text;
    return {
      id: element.id, type: element.type, label: element.label, text: String((shown === undefined ? undefined : element.data[shown]) ?? element.label), box: boxOf(element),
      ...(banner ? { parts: banner.segments.map((segment) => ({ id: type.segments.names[segment.index], box: { x: segment.from, y: element.y, width: segment.to - segment.from, height: element.height } })) } : {}),
    };
  });
  const edges = view.relations.map((relation) => {
    const ends = relation.data.hidden === true ? undefined : host.relationEnds(host.definition, relation, elements);
    if (!ends) return { id: relation.id, type: relation.type, from: { node: relation.from }, to: { node: relation.to }, hidden: true };
    const end = (node, stored, placed) => ({
      node, ...(stored ? { part: typeOf(node).segments.names[stored.region], at: stored.at } : {}), side: sideOf(placed.normal), x: placed.point.x, y: placed.point.y,
    });
    return { id: relation.id, type: relation.type, from: end(relation.from, relation.data.source, ends.from), to: end(relation.to, relation.data.target, ends.to) };
  });
  return { unit: view.chrome.unit, nodes, edges };
}

let documents = 0;
for (const id of ids) {
  const { type, definition, view } = hosts[id];
  writeFileSync(join(work, `${id}.ts`), [
    `export { ${type[1]} as type } from './${type[0]}';`,
    `export { ${definition[1]} as definition } from './${definition[0]}';`,
    "export { bannerOfElement } from './src/webview/diagram/elements';",
    "export { elementTypeOf, relationEnds } from './src/webview/diagram/relations';",
  ].join('\n'));
  await build({
    entryPoints: [join(work, `${id}.ts`)], outfile: join(work, `${id}.cjs`), bundle: true, format: 'cjs', platform: 'node',
    nodePaths: [join(root, 'node_modules')], loader: { '.css': 'empty' }, plugins: [noIcons], logLevel: 'warning',
  });
  const host = (await import(pathToFileURL(join(work, `${id}.cjs`)).href)).default;
  const isDocument = (path) => host.type.extensions.some((extension) => path.endsWith(`.${extension}`));
  for (const path of list(vscode, hosts[id].examples).filter(isDocument)) {
    const example = path.slice(hosts[id].examples.length);
    const places = placesOf(host, read(vscode, path).toString('utf8'));
    const rows = (items) => (items.length === 0 ? '[]' : `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`);
    writeFileSync(join(root, 'test/examples', id, `${example.slice(0, example.lastIndexOf('.'))}.places.json`), `{
  "example": ${JSON.stringify(example)},
  "host": ${JSON.stringify({ repository: vscode, commit: commits[vscode], view })},
  "parameters": ${JSON.stringify(parameters)},
  "unit": ${JSON.stringify(places.unit)},
  "nodes": ${rows(places.nodes)},
  "edges": ${rows(places.edges)}
}
`);
    documents++;
  }
}
rmSync(work, { recursive: true, force: true });

// ---- the provenance, last ----

const provenance = (title, text, rows) => `# ${title}

${text} They are copied unchanged, byte for byte, from repositories of [etalii-adp](https://github.com/etalii-adp), which are licensed under the Apache License 2.0, as this repository is. Do not edit one here: a correction goes to its repository and arrives with a newer copy.

- Refresh them with \`node scripts/sync-examples.mjs [<repository>=<git ref> ...]\`.
- \`node scripts/sync-examples.mjs --check\` compares every copied file with the SHA-256 below.

| File | Repository | Path | Commit | SHA-256 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
writeFileSync(join(root, 'test/examples/PROVENANCE.md'), provenance('Where the files under test/examples/ come from',
  `The examples of every Notion add-on's tool type, one folder per add-on. Beside each example document, \`<name>.places.json\` is no copy: the same script computes it by running the Visual Studio Code host's view of the tool type at the commit below, and its shape is described at the top of \`scripts/sync-examples.mjs\`.`, examples));
writeFileSync(join(root, 'test/fixtures/PROVENANCE.md'), provenance('Where the files under test/fixtures/ come from',
  'The fixtures the standalone host\'s tests of every Notion add-on\'s tool type read, one folder per add-on, `mindmap.dis`, the specification of a tool type that has no add-on, which the tests of reuse give the shared parts, and `disl.schema.json`, the JSON Schema of DISL, which the tests walk a specification beside.', fixtures));
console.log(`Copied ${examples.length} example files and ${fixtures.length} fixtures, and wrote the places of ${documents} examples.`);
