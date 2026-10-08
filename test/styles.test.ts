import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { contrast, contrastRows, notionValues, pairs } from './panels/contrast';

// The styling of the shared parts is a part of them (etalii.adp spec 012, NFR-005, NFR-007, User
// Story 5 scenario 5): one stylesheet states Notion's values, every other one uses them, every class
// is the shared parts' own, and an add-on's page brings no style.

const root = fileURLToPath(new URL('..', import.meta.url));
const notion = 'src/panels/notion.css';

const filesUnder = (folder: string, ...extensions: string[]): string[] =>
  readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => relative(root, join(root, folder, file)).replaceAll('\\', '/')).sort();

const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

interface Declaration { readonly property: string; readonly value: string; readonly line: number; }

function declarations(css: string): Declaration[] {
  const code = uncommented(css);
  return [...code.matchAll(/([\w-]+)\s*:\s*([^;{}]+)[;}]/g)].flatMap((match) => {
    // A selector such as `a:hover {` is no declaration: what follows it is a brace.
    const before = code.slice(0, match.index);
    return before.lastIndexOf('{') > before.lastIndexOf('}') ? [{ property: match[1], value: match[2].trim(), line: before.split('\n').length }] : [];
  });
}

// The colours CSS names, as far as a stylesheet is likely to write one.
const named = ['black', 'white', 'gray', 'grey', 'silver', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown', 'navy', 'teal', 'aqua', 'cyan', 'magenta', 'fuchsia',
  'lime', 'maroon', 'olive', 'gold', 'beige', 'ivory', 'khaki', 'coral', 'crimson', 'indigo', 'violet', 'tan', 'tomato', 'salmon', 'orchid', 'plum', 'snow', 'linen', 'lavender',
  'whitesmoke', 'gainsboro', 'lightgray', 'lightgrey', 'darkgray', 'darkgrey', 'dimgray', 'dimgrey', 'slategray', 'slategrey', 'royalblue', 'steelblue', 'skyblue', 'dodgerblue', 'firebrick', 'darkred'];
const literalColour = new RegExp(`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\\(|\\b(?:${named.join('|')})\\b`, 'i');
// A length that states a size of its own. A share of the room (`%`, `vw`, `fr`) is proportion, and a time is no size.
const literalLength = /(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:px|pt|pc|cm|mm|in|q|em|rem|ex|ch|lh|rlh)\b/i;
const outsideVar = (value: string): string => value.replace(/var\(--notion-[\w-]+\)/g, ' ');
// What must be a property of notion.css wherever it is set at all.
const stated = /^(?:font-size|font-family|font-weight|line-height|border-radius|border-[\w-]+-radius|color|background-color|box-shadow)$/;
const keyword = /^(?:inherit|initial|unset|none|transparent|currentcolor|normal|0)$/i;

describe('the stylesheets of the shared parts', () => {
  const sheets = filesUnder('src', '.css');

  it('are notion.css, the panels\' own, and those of the other parts', () => {
    expect(sheets).toContain(notion);
    expect(sheets).toContain('src/panels/panels.css');
  });

  it('state no colour, type size, spacing or corner of their own: notion.css alone does', () => {
    const violations: string[] = [];
    for (const sheet of sheets.filter((file) => file !== notion)) {
      for (const { property, value, line } of declarations(read(sheet))) {
        const rest = outsideVar(value);
        const literal = literalColour.test(rest) || literalLength.test(rest)
          || (stated.test(property) && !rest.trim().split(/[\s,/]+/).filter(Boolean).every((word) => keyword.test(word)));
        if (literal) violations.push(`${sheet}:${line} ${property}: ${value}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('use only properties that notion.css states', () => {
    const known = notionValues('light');
    const unknown = sheets.filter((file) => file !== notion).flatMap((sheet) =>
      [...uncommented(read(sheet)).matchAll(/var\((--[\w-]+)/g)].filter((use) => !known.has(use[1])).map((use) => `${sheet} ${use[1]}`));
    expect(unknown).toEqual([]);
  });

  it('find in notion.css nothing but properties whose names begin with --notion-, each in a light set and the colours in a dark set too', () => {
    const code = uncommented(read(notion));
    expect([...code.matchAll(/([^{}]+)\{/g)].map((rule) => rule[1].trim())).toEqual([':root', ':root[data-theme="dark"]']);
    expect(declarations(read(notion)).filter(({ property }) => !property.startsWith('--notion-')).map(({ property }) => property)).toEqual([]);
    const light = notionValues('light');
    const colours = [...light].filter(([, value]) => /rgba?\(/.test(value)).map(([name]) => name);
    expect(colours.length).toBeGreaterThan(20);
    const darkOnly = uncommented(read(notion)).split(':root[data-theme="dark"]')[1];
    expect(colours.filter((name) => !darkOnly.includes(`${name}:`))).toEqual([]);
  });

  it('write no class that does not begin with adp-', () => {
    const classes = sheets.flatMap((sheet) => {
      const code = uncommented(read(sheet));
      const selectors = [...code.matchAll(/([^{}]+)\{/g)].map((rule) => rule[1].replace(/\[[^\]]*\]/g, ' '));
      return selectors.flatMap((selector) => [...selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((match) => `${sheet} .${match[1]}`));
    });
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.filter((name) => !/ \.adp-/.test(name))).toEqual([]);
  });
});

describe('the classes the shared parts write from code', () => {
  // A class is written by `className`, by `classList` and by the attribute `class`; `src/fbl` draws nothing.
  const written = (file: string): string[] => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const texts = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) found.push(node.text);
      // The parts of a template between its expressions: an expression inside a name is taken as a letter.
      else if (ts.isTemplateExpression(node)) found.push(node.head.text + node.templateSpans.map((span) => `x${span.literal.text}`).join(''));
      else ts.forEachChild(node, texts);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'className') texts(node.right);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression;
        if (ts.isPropertyAccessExpression(target) && target.name.text === 'classList') node.arguments.forEach(texts);
        const [name, value] = node.arguments;
        if (node.expression.name.text === 'setAttribute' && name && ts.isStringLiteralLike(name) && name.text === 'class' && value) texts(value);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found.flatMap((text) => text.split(/\s+/).filter(Boolean)).map((name) => `${file} ${name}`);
  };

  it('all begin with adp-', () => {
    const classes = filesUnder('src', '.ts').filter((file) => !file.startsWith('src/fbl/')).flatMap(written);
    expect(classes.length).toBeGreaterThan(10);
    expect(classes.filter((name) => !/ adp-/.test(name))).toEqual([]);
  });
});

describe('the page of an add-on', () => {
  const pages = readdirSync(join(root, 'addons'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `addons/${entry.name}/index.html`);

  it('is there for every add-on', () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((file) => !existsSync(join(root, file)))).toEqual([]);
  });

  it.each(pages)('%s has no style and no class of its own, and the one stylesheet of the shared parts', (file) => {
    const html = read(file);
    expect(/<style\b/i.test(html)).toBe(false);
    expect(/\sstyle\s*=/i.test(html)).toBe(false);
    expect(/\sclass\s*=/i.test(html)).toBe(false);
    expect([...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map((link) => /href="([^"]*)"/.exec(link[0])?.[1])).toEqual(['addon.css']);
    expect(filesUnder(file.replace('/index.html', ''), '.css')).toEqual([]);
  });
});

describe('the contrast of what the panels draw', () => {
  it.each(['light', 'dark'] as const)('keeps 4.5:1 for text and 3:1 for the edge of a control, an icon and the focus ring, in the %s appearance', (appearance) => {
    expect(pairs.length).toBeGreaterThan(20);
    const below = pairs.filter((pair) => contrast(pair, appearance) < pair.minimum).map((pair) => `${pair.what}: ${contrast(pair, appearance).toFixed(2)} < ${pair.minimum}`);
    expect(below).toEqual([]);
  });

  it('is computed for every colour panels.css draws with', () => {
    // A colour that panels.css uses and no pair holds would be a contrast nobody computed.
    const used = new Set([...uncommented(read('src/panels/panels.css')).matchAll(/var\((--notion-[\w-]+)\)/g)].map((use) => use[1]));
    const colours = [...notionValues('light')].filter(([, value]) => /rgba?\(/.test(value)).map(([name]) => name).filter((name) => used.has(name));
    const computed = new Set(pairs.flatMap((pair) => [pair.foreground, ...pair.surface]));
    // Decoration, which no reader has to tell apart: a line between groups, the edge of a refusal, and a shadow.
    const decoration = ['--notion-border', '--notion-border-strong', '--notion-error-border', '--notion-shadow-menu', '--notion-shadow-card'];
    expect(colours.filter((name) => !computed.has(name) && !decoration.includes(name))).toEqual([]);
  });

  it('is written in docs/styling.md as it is computed', () => {
    const document = read('docs/styling.md');
    expect(contrastRows().filter((line) => !document.includes(line))).toEqual([]);
  });
});
