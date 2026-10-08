// The labels of a scene as SVG text (DISL 6.5, 6.12). A text is measured by the notation's text
// metric, never by the browser, so that a label breaks and ends at the same place on every host.

import type { SceneLabel } from './scene';
import { svg, type Paints } from './shapes';
import { lineHeight, textWidth, type Font, type Notation } from '../disl/notation';

export interface TextMeasure {
  width(text: string, fontSize: number): number;
  lineHeight(fontSize: number, font?: Font): number;
}

/** The measure of a notation; `host` answers for a specification whose text metric is the host's. */
export const measureOf = (notation: Pick<Notation, 'textMetric'>, host?: (text: string, fontSize: number) => number): TextMeasure => ({
  width: (text, fontSize) => textWidth(notation.textMetric, text, fontSize, host),
  lineHeight: (fontSize, font) => lineHeight(notation.textMetric, fontSize, font),
});

// A width worked out twice may differ in its last digit.
const slack = 0.01;
const ellipsis = '…';

/** A text as lines no wider than `width`. A line break in the text is kept; a word wider than the width stays whole. */
export function wrapText(text: string, width: number, wrap: SceneLabel['wrap'], widthOf: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (wrap === 'none' || widthOf(paragraph) <= width + slack) {
      lines.push(paragraph);
      continue;
    }
    const pieces = wrap === 'char' ? [...paragraph] : paragraph.split(/(?<=\s)/);
    let line = '';
    for (const piece of pieces) {
      if (line !== '' && widthOf((line + piece).trimEnd()) > width + slack) {
        lines.push(line.trimEnd());
        line = piece.trimStart();
      } else {
        line += piece;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The longest start of a text that fits a width with the sign of omission behind it. */
function shortened(text: string, width: number, widthOf: (text: string) => number): string {
  const characters = [...text];
  while (characters.length > 0 && widthOf(characters.join('') + ellipsis) > width + slack) characters.pop();
  return characters.join('').trimEnd() + ellipsis;
}

export interface LaidLabel {
  readonly lines: readonly string[];
  readonly fontSize: number;
  readonly lineHeight: number;
  /** The text is cut off at the edge of its box when it is drawn. */
  readonly clip: boolean;
}

/** The lines a label is drawn as: wrapped as it asks, and made to fit its box as its `overflow` says. */
export function layoutLabel(label: SceneLabel, measure: TextMeasure): LaidLabel {
  const { box, style } = label;
  const wrapped = (fontSize: number): string[] => wrapText(label.text, box.width, label.wrap, (text) => measure.width(text, fontSize));
  let fontSize = label.fontSize;
  let lines = wrapped(fontSize);
  const high = (): number => measure.lineHeight(fontSize, style.font);
  if (label.overflow === 'shrink') {
    // Smaller by a tenth at a time, down to half the size: below that a text is not read.
    const fits = (): boolean => lines.length * high() <= box.height + slack && lines.every((line) => measure.width(line, fontSize) <= box.width + slack);
    while (!fits() && fontSize > label.fontSize / 2) {
      fontSize = Math.max(label.fontSize / 2, fontSize - label.fontSize / 10);
      lines = wrapped(fontSize);
    }
  } else if (label.overflow === 'ellipsis') {
    const most = Math.max(1, Math.floor((box.height + slack) / high()));
    const widthOf = (text: string): number => measure.width(text, fontSize);
    const cut = lines.length > most;
    lines = lines.slice(0, most).map((line, index) => ((cut && index === most - 1) || widthOf(line) > box.width + slack ? shortened(line, box.width, widthOf) : line));
  }
  return { lines, fontSize, lineHeight: high(), clip: label.overflow === 'clip' };
}

let clips = 0;

/**
 * A label as SVG text, one `tspan` a line, held in its box as its alignment says. A text the
 * specification gives no colour is drawn in the text colour of the page.
 */
export function drawLabel(document: Document, label: SceneLabel, measure: TextMeasure, paints: Paints): SVGElement {
  const laid = layoutLabel(label, measure);
  const { box, style } = label;
  const x = label.align === 'start' ? box.x : label.align === 'end' ? box.x + box.width : box.x + box.width / 2;
  const words = typeof label.position === 'string' ? label.position.split('-') : [];
  const inside = typeof label.position === 'string' && words[0] !== 'outside';
  const held = typeof style.verticalAlign === 'string' ? style.verticalAlign : inside && words.includes('top') ? 'top' : inside && words.includes('bottom') ? 'bottom' : 'middle';
  const height = laid.lines.length * laid.lineHeight;
  const top = held === 'top' ? box.y : held === 'bottom' ? box.y + box.height - height : box.y + (box.height - height) / 2;
  const text = svg(document, 'text', {
    'data-label': label.id,
    'text-anchor': label.align === 'center' ? 'middle' : label.align,
    'font-size': laid.fontSize,
    'font-family': typeof style.font?.family === 'string' ? style.font.family : undefined,
    'font-weight': style.font?.weight,
    fill: paints.colour(style.font?.color) ?? 'currentColor',
  });
  laid.lines.forEach((line, index) => {
    text.append(svg(document, 'tspan', { x, y: top + (index + 0.5) * laid.lineHeight, 'dominant-baseline': 'central' }, line));
  });
  if (!laid.clip) return text;
  const id = `adp-clip-${++clips}`;
  text.setAttribute('clip-path', `url(#${id})`);
  return svg(document, 'g', {}, svg(document, 'clipPath', { id }, svg(document, 'rect', { x: box.x, y: box.y, width: box.width, height: box.height })), text);
}
