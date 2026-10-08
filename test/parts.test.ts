import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The rules between the shared parts (etalii.adp spec 012, contracts/shared-parts.md, "The parts";
// FR-004, FR-010, FR-027, FR-028), read from the imports of every file under src/.
//
// An import of types alone counts as an import: a part is to be built without the parts below it,
// and a type that is imported needs the other part's source to be checked. A violation by such an
// import is marked `(types only)`, so that it is seen for what it is.

/** The parts in the order of the contract's table: a part imports only the parts before it. */
const parts = ['fbl', 'disl', 'history', 'store', 'canvas', 'panels', 'frame'];
/** What the build puts in the place of a module of Node; no source asks for it by its path. */
const SHIMS = 'shims';

const root = 'src';
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => relative('.', join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort();
const partOf = (file: string): string => file.split('/')[1];

interface Import {
  readonly file: string;
  /** The file or folder under src/ a relative import names, without its extension. */
  readonly to: string;
  readonly typesOnly: boolean;
}

interface Read {
  readonly imports: Import[];
  /** Every string literal and every piece of a template literal. */
  readonly literals: string[];
}

function read(file: string): Read {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const imports: Import[] = [];
  const literals: string[] = [];
  const add = (specifier: ts.Node | undefined, typesOnly: boolean): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier) || !specifier.text.startsWith('.')) return;
    imports.push({ file, to: posix.join(dirname(file), specifier.text), typesOnly });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
      // `import type { A }`, or `import { type A, type B }` and nothing else.
      const typesOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== undefined && named.length > 0 && named.every((element) => element.isTypeOnly)));
      add(node.moduleSpecifier, typesOnly);
    } else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, node.isTypeOnly);
    else if (ts.isImportTypeNode(node)) add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, true);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], false);
    else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, literals };
}

const sources = new Map(files.map((file) => [file, read(file)]));
const imports = [...sources.values()].flatMap((source) => source.imports);
const told = ({ file, to, typesOnly }: Import): string => `${file} imports ${to}${typesOnly ? ' (types only)' : ''}`;
const breaking = (breaks: (from: string, to: string) => boolean): string[] =>
  imports.filter((each) => each.to.startsWith(`${root}/`) && partOf(each.file) !== partOf(each.to) && breaks(partOf(each.file), partOf(each.to))).map(told);

describe('the shared parts', () => {
  it('are the folders of src/, with the shims beside them', () => {
    expect([...new Set(files.map(partOf))].sort()).toEqual([...parts, SHIMS].sort());
  });

  it('are read whole: every file has its imports found', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(imports.length).toBeGreaterThan(100);
    expect(imports.filter((each) => !each.to.startsWith(`${root}/`)).map(told)).toEqual([]);
  });

  it('import only parts above them in the table', () => {
    expect(breaking((from, to) => parts.includes(from) && parts.includes(to) && parts.indexOf(to) > parts.indexOf(from))).toEqual([]);
  });

  it('the history imports no other part', () => {
    expect(breaking((from) => from === 'history')).toEqual([]);
  });

  it('the panels import neither the store nor the canvas', () => {
    expect(breaking((from, to) => from === 'panels' && (to === 'store' || to === 'canvas'))).toEqual([]);
  });

  it('the shims are imported by nothing: the build puts them in', () => {
    expect(breaking((_from, to) => to === SHIMS)).toEqual([]);
    expect(breaking((from) => from === SHIMS)).toEqual([]);
  });
});

describe('the service and the token', () => {
  const holding = (wanted: (literal: string) => boolean, allowed: readonly string[]): string[] =>
    [...sources].flatMap(([file, source]) => (allowed.includes(file) ? [] : source.literals.filter(wanted).map((literal) => `${file} holds ${JSON.stringify(literal)}`)));

  it('are known to src/store/session.ts and src/store/notion.ts alone', () => {
    // The paths of the service, the key the token is kept under, and the header it is sent in.
    const words = ['/authorize', '/callback', '/refresh', '/notion/', 'adp-notion.token', 'Authorization'];
    expect(holding((literal) => words.some((word) => literal.includes(word)), ['src/store/session.ts', 'src/store/notion.ts'])).toEqual([]);
  });

  it('have their address in src/frame/config.ts alone', () => {
    // An address in a literal is one a page could call. The names of XML namespaces are no address of a service.
    const address = (literal: string): boolean => /https?:\/\//.test(literal.replaceAll(/http:\/\/www\.w3\.org\/[0-9A-Za-z/]+/g, ''));
    expect(holding(address, ['src/frame/config.ts'])).toEqual([]);
    expect(sources.get('src/frame/config.ts')?.literals.some(address)).toBe(true);
  });
});
