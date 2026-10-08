// The contrast of what the panels draw, computed from the values of src/panels/notion.css with the
// WCAG 2 formula. test/styles.test.ts holds every pair to its minimum and docs/styling.md to these
// numbers, so the list of pairs is here once.
import { readFileSync } from 'node:fs';

export type Appearance = 'light' | 'dark';
type Rgba = readonly [number, number, number, number];

/** The custom properties of `notion.css` in one appearance: the dark set over the light one. */
export function notionValues(appearance: Appearance, path = 'src/panels/notion.css'): Map<string, string> {
  const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const values = new Map<string, string>();
  for (const block of code.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]*)\}/g)) {
    if (block[1] !== ':root' && appearance !== 'dark') continue;
    for (const property of block[2].matchAll(/(--notion-[\w-]+)\s*:\s*([^;]+);/g)) values.set(property[1], property[2].trim());
  }
  return values;
}

function colour(text: string): Rgba {
  const found = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(text);
  if (!found) throw new Error(`No colour in '${text}'.`);
  return [Number(found[1]), Number(found[2]), Number(found[3]), found[4] === undefined ? 1 : Number(found[4])];
}

const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((channel) => top[channel] * top[3] + under[channel] * (1 - top[3])).concat(1) as unknown as Rgba;

function luminance(of: Rgba): number {
  const [r, g, b] = [of[0], of[1], of[2]].map((channel) => {
    const part = channel / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface Pair {
  /** What is drawn, in words. */
  readonly what: string;
  /** The property of what is drawn. */
  readonly foreground: string;
  /** The surface it is drawn on, from the bottom layer up: a translucent one is laid over those before it. */
  readonly surface: readonly string[];
  /** 4.5 for text, 3 for the edge of a control, an icon and the focus ring. */
  readonly minimum: 4.5 | 3;
}

const panel = ['--notion-background-panel'];
const menu = ['--notion-background-menu'];
const text = (what: string, foreground: string, ...surface: string[]): Pair => ({ what, foreground, surface, minimum: 4.5 });
const edge = (what: string, foreground: string, ...surface: string[]): Pair => ({ what, foreground, surface, minimum: 3 });

/** Every pair of a foreground and a surface that `src/panels/panels.css` draws. */
export const pairs: readonly Pair[] = [
  text('A label, a tool, a value on the panel', '--notion-text', ...panel),
  text('The same under the pointer, and a tag', '--notion-text', ...panel, '--notion-background-hover'),
  text('The same while pressed', '--notion-text', ...panel, '--notion-background-active'),
  text('A value in a control', '--notion-text', ...panel, '--notion-background-input'),
  text('A heading, a description, a field\'s label on the panel', '--notion-text-secondary', ...panel),
  text('A description under the pointer', '--notion-text-secondary', ...panel, '--notion-background-hover'),
  text('A description while pressed', '--notion-text-secondary', ...panel, '--notion-background-active'),
  text('A placeholder in a control', '--notion-text-secondary', ...panel, '--notion-background-input'),
  text('The chosen one of a few choices', '--notion-accent-text', ...panel, '--notion-background-selected'),
  text('A refusal beside its control', '--notion-error-text', '--notion-error-background'),
  text('An entry of a menu', '--notion-text', ...menu),
  text('An entry of a menu under the pointer or the focus', '--notion-text', ...menu, '--notion-background-hover'),
  text('An entry of a menu while pressed', '--notion-text', ...menu, '--notion-background-active'),
  text('A shortcut in a menu', '--notion-text-secondary', ...menu),
  text('A shortcut in a menu under the pointer or the focus', '--notion-text-secondary', ...menu, '--notion-background-hover'),
  text('A shortcut in a menu while pressed', '--notion-text-secondary', ...menu, '--notion-background-active'),
  edge('An icon on the panel', '--notion-icon', ...panel),
  edge('An icon under the pointer, and the mark that removes a tag', '--notion-icon', ...panel, '--notion-background-hover'),
  edge('An icon while pressed', '--notion-icon', ...panel, '--notion-background-active'),
  edge('An icon in a menu', '--notion-icon', ...menu),
  edge('An icon in a menu under the pointer or the focus', '--notion-icon', ...menu, '--notion-background-hover'),
  edge('The edge of a control against the panel', '--notion-border-control', ...panel),
  edge('The edge of a control against its own background', '--notion-border-control', ...panel, '--notion-background-input'),
  edge('The edge of the chosen one of a few choices, a ticked box, a slider', '--notion-accent', ...panel),
  edge('The focus ring on the panel', '--notion-focus-ring', ...panel),
  edge('The focus ring on a control', '--notion-focus-ring', ...panel, '--notion-background-input'),
  edge('The focus ring on a menu', '--notion-focus-ring', ...menu),
];

/** The contrast of a pair in one appearance, by WCAG 2: (lighter + 0.05) / (darker + 0.05). */
export function contrast(pair: Pair, appearance: Appearance): number {
  const values = notionValues(appearance);
  const value = (name: string): Rgba => {
    const stated = values.get(name);
    if (stated === undefined) throw new Error(`notion.css does not state ${name}.`);
    return colour(stated);
  };
  const surface = pair.surface.map(value).reduce((under, top) => over(top, under));
  const [a, b] = [luminance(over(value(pair.foreground), surface)), luminance(surface)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A ratio as the documentation writes it, rounded down so that it never claims more than there is. */
export const ratio = (value: number): string => `${(Math.floor(value * 100) / 100).toFixed(2)}:1`;

/** The rows of the table of docs/styling.md. */
export const contrastRows = (): string[] => pairs.map((pair) =>
  `| ${pair.what} | \`${pair.foreground}\` | ${pair.surface.map((name) => `\`${name}\``).join(' under ')} | ${pair.minimum}:1 | ${ratio(contrast(pair, 'light'))} | ${ratio(contrast(pair, 'dark'))} |`);
