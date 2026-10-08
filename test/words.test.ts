import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// No file under src/ names what only a tool type has (etalii.adp spec 012-notion-hype-cycle-addon,
// contracts/shared-parts.md). The names come from every specification and binding under addons/.

const root = fileURLToPath(new URL('..', import.meta.url));
const uses = ['disl', 'fbl', 'typescript', 'web', 'library'];
// The copy of the FBL library is another repository's code: its own words are exempt there only.
const library = 'src/fbl/';

interface Exempt {
  readonly name: string;
  readonly use: string;
  readonly reason: string;
  readonly in?: string;
}

// A name whatever its spelling: `peak-end`, `peakEnd` and `PEAK_END` are all `peak end`.
const words = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/).filter(Boolean).join(' ').toLowerCase();

const filesUnder = (folder: string, ...extensions: string[]): string[] =>
  readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => join(root, folder, file)).sort();

// The strings at a path of a document: `*` is every child, `**` every descendant, `#` the keys.
function pick(node: unknown, path: readonly string[]): string[] {
  if (node === null || node === undefined) return [];
  const [step, ...rest] = path;
  if (step === undefined) return typeof node === 'string' ? [node] : Array.isArray(node) ? node.filter((item) => typeof item === 'string') : [];
  if (typeof node !== 'object') return [];
  if (step === '#') return Array.isArray(node) ? pick(node, []) : Object.keys(node);
  if (step === '*') return Object.values(node).flatMap((child) => pick(child, rest));
  if (step === '**') return [...pick(node, rest), ...Object.values(node).flatMap((child) => pick(child, path))];
  return pick((node as Record<string, unknown>)[step], rest);
}

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

function declaredNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of filesUnder('addons', '.dis', '.fbl')) {
    const document: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const at = (paths: string[]) => paths.flatMap((path) => pick(document, path.split('.')));
    const found = file.endsWith('.dis') ? at(specificationNames) : [...at(bindingNames), ...at(bindingSelectors).flatMap((selector) => selector.split('/'))];
    for (const name of found) if (/[A-Za-z]/.test(name) && !names.has(words(name))) names.set(words(name), name);
  }
  return names;
}

interface Held {
  readonly name: string;
  readonly at: number;
}

// The names in a text whose words are parted by `-`, `.` or `_`: every run of whole words is tried.
function heldInText(text: string, names: ReadonlyMap<string, string>): Held[] {
  const held: Held[] = [];
  for (const run of text.matchAll(/[A-Za-z0-9]+(?:[-._][A-Za-z0-9]+)*/g)) {
    const parts = [...run[0].matchAll(/[A-Za-z0-9]+/g)];
    for (let first = 0; first < parts.length; first++) {
      for (let last = first; last < parts.length; last++) {
        const name = parts.slice(first, last + 1).map((part) => words(part[0])).join(' ');
        if (names.has(name)) held.push({ name, at: run.index + parts[first].index });
      }
    }
  }
  return held;
}

function heldInTypeScript(source: string, names: ReadonlyMap<string, string>): Held[] {
  const file = ts.createSourceFile('file.ts', source, ts.ScriptTarget.Latest, true);
  const held: Held[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (names.has(words(node.text))) held.push({ name: words(node.text), at: node.getStart() });
    } else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const found of heldInText(node.text, names)) held.push({ name: found.name, at: node.getStart() + 1 + found.at });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return held;
}

// Class names, custom property names and string values; a comment is blanked first.
function heldInCss(source: string, names: ReadonlyMap<string, string>): Held[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  return [...code.matchAll(/\.-?[A-Za-z_][\w-]*|--[\w-]+|"[^"\n]*"|'[^'\n]*'/g)]
    .flatMap((match) => heldInText(match[0], names).map((found) => ({ name: found.name, at: match.index + found.at })));
}

describe('the words of a tool type', () => {
  const names = declaredNames();
  const exempt = (JSON.parse(readFileSync(join(root, 'test/words.exempt.json'), 'utf8')) as { exempt: Exempt[] }).exempt;
  const exemptNames = new Set(exempt.filter((entry) => entry.in === undefined).map((entry) => words(entry.name)));

  it('are declared by the specifications and bindings under addons/', () => {
    expect(names.size).toBeGreaterThan(0);
  });

  it('are exempt only for a use that DISL, FBL, TypeScript, the web platform or the copied FBL library makes of them', () => {
    expect(exempt.filter((entry) => !uses.includes(entry.use) || !entry.reason?.trim()).map((entry) => entry.name)).toEqual([]);
    expect(exempt.filter((entry) => entry.use === 'library' && entry.in !== library).map((entry) => entry.name)).toEqual([]);
    expect(exempt.filter((entry, index) => exempt.findIndex((other) => words(other.name) === words(entry.name)) !== index).map((entry) => entry.name)).toEqual([]);
  });

  it('are the only names the exempt list holds', () => {
    expect(exempt.filter((entry) => !names.has(words(entry.name))).map((entry) => entry.name)).toEqual([]);
  });

  it('are not all exempt', () => {
    expect([...names.keys()].filter((name) => !exemptNames.has(name)).length).toBeGreaterThan(names.size / 2);
  });

  it('are in no file under src/', () => {
    const violations: string[] = [];
    for (const file of filesUnder('src', '.ts', '.css')) {
      const path = relative(root, file).replaceAll('\\', '/');
      const open = new Map([...names].filter(([name]) => !exempt.some((entry) => words(entry.name) === name && path.startsWith(entry.in ?? ''))));
      const source = readFileSync(file, 'utf8');
      const held = file.endsWith('.css') ? heldInCss(source, open) : heldInTypeScript(source, open);
      for (const { name, at } of held) {
        const line = source.slice(0, at).split('\n').length;
        violations.push(`${path}:${line} ${open.get(name)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
