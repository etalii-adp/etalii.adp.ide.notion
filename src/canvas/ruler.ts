// The ruler of an axis as SVG (DISL 5.13), for what the canvas shows: the ticks and labels of
// `rulerRows`, which follow the zoom. A ruler stays at its edge of the view, so it is drawn in the
// pixels of the screen and not in canvas units; its look is the page's, from canvas.css.

import { svg } from './shapes';
import { rulerRows, type Axis, type RulerRow } from '../disl/coordinates';
import type { Attributes } from '../disl/model';

export interface RulerView {
  /** The canvas positions at the two ends of what is shown along the axis. */
  readonly from: number;
  readonly to: number;
  readonly zoom: number;
}

export interface RulerOptions {
  /** How many rows are drawn, the finest first. One when absent, as the other hosts draw it. */
  readonly levels?: number;
  /** The breadth of the view across the axis, in pixels: where a ruler at the far edge stands. */
  readonly across?: number;
  readonly locale?: string;
}

/** The breadth of one row of a ruler that states no size. */
export const rulerSize = 24;

/** The rows a ruler draws at a zoom: the finest that have room, as many as asked for. */
export const shownRows = (axis: Axis, diagram: Attributes, view: RulerView, options: RulerOptions = {}): RulerRow[] =>
  rulerRows(axis, diagram, view, options.locale).slice(0, options.levels ?? 1);

/**
 * The ruler of an axis, or nothing when the axis has none to show. It lies along x for a ruler at
 * the top or the bottom and along y for one at a side, with its first row nearest the drawing.
 */
export function drawRuler(document: Document, axis: Axis, diagram: Attributes, view: RulerView, options: RulerOptions = {}): SVGGElement | undefined {
  const rows = shownRows(axis, diagram, view, options);
  if (rows.length === 0) return undefined;
  const position = axis.ruler?.position ?? 'bottom';
  const upright = position === 'left' || position === 'right';
  const far = position === 'bottom' || position === 'right';
  const size = axis.ruler?.size ?? rulerSize;
  const breadth = size * rows.length;
  const length = Math.abs(view.to - view.from) * view.zoom;
  const start = far ? Math.max(0, (options.across ?? breadth) - breadth) : 0;
  const group = svg(document, 'g', { class: 'adp-ruler', 'data-axis': axis.name, 'data-position': position, 'aria-hidden': 'true', transform: upright ? `translate(${start},0)` : `translate(0,${start})` });
  group.append(svg(document, 'rect', { class: 'adp-ruler-band', x: 0, y: 0, width: upright ? breadth : length, height: upright ? length : breadth }));
  const low = Math.min(view.from, view.to);
  rows.forEach((row, index) => {
    // Counted from the drawing outwards.
    const near = (far ? index : rows.length - 1 - index) * size;
    const line = svg(document, 'g', { class: 'adp-ruler-row', 'data-unit': row.unit });
    for (const tick of row.ticks) {
      const at = (tick.at - low) * view.zoom;
      line.append(
        svg(document, 'line', { class: 'adp-ruler-tick', ...(upright ? { x1: near, x2: near + size, y1: at, y2: at } : { x1: at, x2: at, y1: near, y2: near + size }) }),
        svg(document, 'text', { class: 'adp-ruler-label', 'dominant-baseline': 'central', ...(upright ? { x: near + 4, y: at + size / 2 } : { x: at + 4, y: near + size / 2 }) }, tick.label),
      );
    }
    group.append(line);
  });
  return group;
}
