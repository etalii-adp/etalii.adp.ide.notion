// The shapes of a scene as SVG (DISL 6.7, 6.8): a built-in shape, a custom path, and a composite
// shape with its parts. A colour is the specification's own: a theme token is looked up in the
// appearance in use, so the same scene is drawn light or dark.

import { pathData } from './geometry';
import type { SceneNode, SceneShape } from './scene';
import { colourOf, type Style, type Theme } from '../disl/notation';

export const SVG_NS = 'http://www.w3.org/2000/svg';

type Attributes = Readonly<Record<string, string | number | undefined>>;

/** An SVG element with its attributes; one that is undefined is left out. */
export function svg<K extends keyof SVGElementTagNameMap>(document: Document, tag: K, attributes: Attributes = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

/** How a paint of the specification becomes a colour: by its theme, in one appearance. */
export interface Paints {
  readonly mode: string;
  /** Nothing for a paint that is absent, and for a token the theme does not hold. */
  colour(paint: unknown): string | undefined;
}

export const paintsOf = (theme: Theme, mode: string = theme.defaultMode ?? 'light'): Paints => ({ mode, colour: (paint) => colourOf(theme, paint, mode) });

const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The stroke of a style as SVG attributes. A line of no width is not drawn. */
export function strokeOf(stroke: Style['stroke'], paints: Paints, fallback?: string): Attributes {
  const width = number(stroke?.width) ?? 1;
  const colour = paints.colour(stroke?.color) ?? fallback;
  if (width <= 0 || colour === undefined) return { stroke: 'none' };
  const dash = Array.isArray(stroke?.dash) ? stroke.dash.join(' ') : typeof stroke?.dash === 'string' ? stroke.dash : undefined;
  return { stroke: colour, 'stroke-width': width, 'stroke-dasharray': dash };
}

/**
 * One shape with its style. A shape of the kind `none` draws nothing, and so does a style that is
 * not visible. A shape whose style gives neither a fill nor a line is outlined in the text colour
 * of the page, so that it can be seen.
 */
export function drawShape(document: Document, shape: SceneShape, style: Style, paints: Paints): SVGElement | undefined {
  if (shape.kind === 'none' || style.visible === false) return undefined;
  const fill = paints.colour(style.fill);
  const bare = fill === undefined && style.stroke === undefined;
  const look: Attributes = {
    fill: fill ?? 'none',
    'fill-opacity': number(style.fillOpacity),
    opacity: number(style.opacity),
    ...strokeOf(style.stroke, paints, bare ? 'currentColor' : undefined),
  };
  const { x, y, width, height } = shape.box;
  if (shape.kind === 'ellipse') return svg(document, 'ellipse', { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2, ...look });
  if (shape.kind === 'path') return svg(document, 'path', { d: pathData(shape.commands), 'fill-rule': shape.fillRule, ...look });
  const stated = number([style.cornerRadius ?? []].flat()[0]);
  const corner = shape.name === 'pill' ? Math.min(width, height) / 2 : stated ?? (shape.name === 'roundedRect' ? Math.min(8, width / 2, height / 2) : undefined);
  return svg(document, 'rect', { x, y, width, height, rx: corner, ...look });
}

/**
 * A node: its own shape, then the parts of a composite shape, the undermost first. Each part
 * carries `data-part`. The group carries `data-element` and `data-type`; its labels are the
 * canvas's to add.
 */
export function drawNode(document: Document, node: SceneNode, paints: Paints): SVGGElement {
  const group = svg(document, 'g', { 'data-element': node.id, 'data-type': node.type });
  if (node.tooltip) group.append(svg(document, 'title', {}, node.tooltip));
  const own = drawShape(document, node.shape, node.style, paints);
  if (own) group.append(own);
  for (const part of node.parts) {
    const drawn = drawShape(document, part.shape, part.style, paints);
    if (!drawn) continue;
    drawn.setAttribute('data-part', part.id);
    if (part.tooltip) drawn.append(svg(document, 'title', {}, part.tooltip));
    group.append(drawn);
  }
  return group;
}
