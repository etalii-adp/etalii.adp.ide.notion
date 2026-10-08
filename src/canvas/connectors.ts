// The edges of a scene as SVG (DISL 6.10, 6.11): the line the scene worked out, between the two
// ends it gives, with the marker at each end turned along the line.

import { pathData, type PathCommand, type Point } from './geometry';
import type { SceneEdge } from './scene';
import { strokeOf, svg, type Paints } from './shapes';

// Every point a path names in its order, the control points among them.
function pointsAlong(path: readonly PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const step of path) {
    if (step.op === 'Z') continue;
    if (step.op === 'Q') points.push({ x: step.cx, y: step.cy });
    if (step.op === 'C') points.push({ x: step.c1x, y: step.c1y }, { x: step.c2x, y: step.c2y });
    points.push({ x: step.x, y: step.y });
  }
  return points;
}

/**
 * A marker of DISL 6.11 at the last of the points a line runs through, its tip on it: an arrow, a triangle, a diamond
 * or a circle, filled when its name says so. `none` draws nothing, and a name that is none of them
 * is drawn as an arrow.
 */
export function drawMarker(document: Document, name: string, points: readonly Point[], colour: string, width: number): SVGElement | undefined {
  const tip = points.at(-1);
  // A control point that lies on the end says nothing of the way the line arrives: the one before it does.
  const before = points.slice(0, -1).reverse().find((point) => point.x !== tip?.x || point.y !== tip?.y);
  if (name === 'none' || name === '' || !tip || !before) return undefined;
  const length = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const along = { x: (tip.x - before.x) / length, y: (tip.y - before.y) / length };
  const size = 6 + 2 * width;
  // A point `back` behind the tip and `aside` of the line.
  const at = (back: number, aside: number): string => `${tip.x - along.x * back - along.y * aside},${tip.y - along.y * back + along.x * aside}`;
  const kind = name.toLowerCase();
  const filled = kind.includes('filled');
  const look = { fill: filled ? colour : 'none', stroke: colour, 'stroke-width': width, 'stroke-linejoin': 'round', 'data-marker': name };
  if (kind.includes('circle')) return svg(document, 'circle', { cx: tip.x - along.x * size / 2, cy: tip.y - along.y * size / 2, r: size / 2, ...look });
  if (kind.includes('diamond')) return svg(document, 'polygon', { points: [at(0, 0), at(size / 2, size / 3), at(size, 0), at(size / 2, -size / 3)].join(' '), ...look });
  if (filled || kind.includes('triangle')) return svg(document, 'polygon', { points: [at(0, 0), at(size, size / 2.5), at(size, -size / 2.5)].join(' '), ...look });
  return svg(document, 'polyline', { points: [at(size, size / 2.5), at(0, 0), at(size, -size / 2.5)].join(' '), ...look });
}

/**
 * An edge: its line, then the marker at its source and the one at its target. Nothing for an edge
 * the scene hides. The group carries `data-element` and `data-type`; a line the specification
 * gives no colour is drawn in the text colour of the page.
 */
export function drawEdge(document: Document, edge: SceneEdge, paints: Paints): SVGGElement | undefined {
  if (edge.hidden !== undefined || edge.path.length === 0) return undefined;
  const stroke = strokeOf(edge.stroke, paints, 'currentColor');
  const colour = String(stroke.stroke);
  const width = Number(stroke['stroke-width'] ?? 1);
  const group = svg(document, 'g', { 'data-element': edge.id, 'data-type': edge.type });
  group.append(svg(document, 'path', { d: pathData(edge.path), fill: 'none', ...stroke }));
  if (colour === 'none') return group;
  const points = pointsAlong(edge.path);
  for (const marker of [drawMarker(document, edge.sourceMarker, [...points].reverse(), colour, width), drawMarker(document, edge.targetMarker, points, colour, width)]) {
    if (marker) group.append(marker);
  }
  return group;
}
