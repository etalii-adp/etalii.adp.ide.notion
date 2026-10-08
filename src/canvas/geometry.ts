// The geometry of a drawing, in canvas units with y downwards: points, boxes, paths, the outline
// an edge attaches to, and the cubic Bézier an edge is drawn as. Plain functions over plain data.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const sides: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** One step of a path, with its numbers worked out (DISL 6.8). */
export type PathCommand =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | { readonly op: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | { readonly op: 'C'; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly op: 'Z' };

/** What an edge attaches to and a pointer hits: an ellipse in its box, or a closed run of points. */
export type Outline =
  | { readonly kind: 'ellipse'; readonly box: Box }
  | { readonly kind: 'polygon'; readonly points: readonly Point[] };

/** A cubic Bézier: its start, its two control points and its end. */
export type Cubic = readonly [Point, Point, Point, Point];

/** One end of a line: where it is, and the unit vector it leaves its element along. */
export interface Direction {
  readonly point: Point;
  readonly normal: Point;
}

// ---- points and boxes ----

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const centreOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The point of a box at fractions of its width and height. */
export const pointIn = (box: Box, fx: number, fy: number): Point => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });

/** The point at a fraction along a side, from its left or its top end. */
export function pointOn(box: Box, side: Side, at: number): Point {
  switch (side) {
    case 'top': return pointIn(box, at, 0);
    case 'bottom': return pointIn(box, at, 1);
    case 'left': return pointIn(box, 0, at);
    default: return pointIn(box, 1, at);
  }
}

/** The unit vector that points away from a box through a side. */
export function normalOf(side: Side): Point {
  switch (side) {
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    default: return { x: 1, y: 0 };
  }
}

/** The side a point of a box, given as fractions, lies on or nearest to; a corner belongs to the top or the bottom. */
export function sideAt(fx: number, fy: number): Side {
  const near: readonly [number, Side][] = [[fy, 'top'], [1 - fy, 'bottom'], [1 - fx, 'right'], [fx, 'left']];
  return near.reduce((best, candidate) => (candidate[0] < best[0] ? candidate : best))[1];
}

export const moved = (box: Box, dx: number, dy: number): Box => ({ ...box, x: box.x + dx, y: box.y + dy });

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export const overlaps = (a: Box, b: Box): boolean =>
  a.x + a.width >= b.x && a.x <= b.x + b.width && a.y + a.height >= b.y && a.y <= b.y + b.height;

export const holds = (box: Box, point: Point): boolean =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

// ---- paths ----

/** A path moved by a distance. */
export function movedPath(commands: readonly PathCommand[], dx: number, dy: number): PathCommand[] {
  return commands.map((command): PathCommand => {
    switch (command.op) {
      case 'Z': return command;
      case 'Q': return { ...command, cx: command.cx + dx, cy: command.cy + dy, x: command.x + dx, y: command.y + dy };
      case 'C': return { ...command, c1x: command.c1x + dx, c1y: command.c1y + dy, c2x: command.c2x + dx, c2y: command.c2y + dy, x: command.x + dx, y: command.y + dy };
      default: return { ...command, x: command.x + dx, y: command.y + dy };
    }
  });
}

/** A path as the `d` of an SVG path. */
export function pathData(commands: readonly PathCommand[]): string {
  return commands.map((command) => {
    switch (command.op) {
      case 'Z': return 'Z';
      case 'Q': return `Q ${command.cx} ${command.cy}, ${command.x} ${command.y}`;
      case 'C': return `C ${command.c1x} ${command.c1y}, ${command.c2x} ${command.c2y}, ${command.x} ${command.y}`;
      default: return `${command.op} ${command.x} ${command.y}`;
    }
  }).join(' ');
}

const steps = 16;

/** The points of a path's first sub-path, its curves cut into straight pieces. */
export function pointsOf(commands: readonly PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const command of commands) {
    const last = points[points.length - 1] ?? { x: 0, y: 0 };
    if (command.op === 'Z' || (command.op === 'M' && points.length > 0)) break;
    if (command.op === 'Q') {
      const control = { x: command.cx, y: command.cy };
      // A quadratic curve is the cubic whose control points lie two thirds of the way to its own.
      const cubic: Cubic = [last, between(last, control, 2 / 3), between(command, control, 2 / 3), command];
      points.push(...cubicPoints(cubic).slice(1));
    } else if (command.op === 'C') {
      points.push(...cubicPoints([last, { x: command.c1x, y: command.c1y }, { x: command.c2x, y: command.c2y }, command]).slice(1));
    } else {
      points.push({ x: command.x, y: command.y });
    }
  }
  return points;
}

const between = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// ---- outlines ----

export const boxOutline = (box: Box): Outline => ({ kind: 'polygon', points: [pointIn(box, 0, 0), pointIn(box, 1, 0), pointIn(box, 1, 1), pointIn(box, 0, 1)] });

export const pathOutline = (commands: readonly PathCommand[]): Outline => ({ kind: 'polygon', points: pointsOf(commands) });

export function boundsOf(outline: Outline): Box {
  if (outline.kind === 'ellipse') return outline.box;
  const xs = outline.points.map((point) => point.x);
  const ys = outline.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Whether a point lies inside an outline, or on it. */
export function inside(outline: Outline, point: Point): boolean {
  if (outline.kind === 'ellipse') {
    const { x, y } = unit(outline.box, point);
    return x * x + y * y <= 1;
  }
  let within = false;
  const { points } = outline;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within || points.some((a, index) => distanceToLine(point, a, points[(index + 1) % points.length]) < 1e-9);
}

// A point in the coordinates in which an ellipse is the unit circle.
const unit = (box: Box, point: Point): Point => ({
  x: (point.x - box.x - box.width / 2) / (box.width / 2 || 1),
  y: (point.y - box.y - box.height / 2) / (box.height / 2 || 1),
});

/** Where the line from `a` to `b` meets an outline, as fractions of the way, nearest `a` first. */
export function meetings(outline: Outline, a: Point, b: Point): number[] {
  const found: number[] = [];
  if (outline.kind === 'ellipse') {
    const p = unit(outline.box, a);
    const q = unit(outline.box, b);
    const d = { x: q.x - p.x, y: q.y - p.y };
    const A = d.x * d.x + d.y * d.y;
    const B = 2 * (p.x * d.x + p.y * d.y);
    const C = p.x * p.x + p.y * p.y - 1;
    const root = B * B - 4 * A * C;
    if (A > 0 && root >= 0) found.push((-B - Math.sqrt(root)) / (2 * A), (-B + Math.sqrt(root)) / (2 * A));
  } else {
    const { points } = outline;
    const d = { x: b.x - a.x, y: b.y - a.y };
    for (let index = 0; index < points.length; index++) {
      const c = points[index];
      const e = { x: points[(index + 1) % points.length].x - c.x, y: points[(index + 1) % points.length].y - c.y };
      const cross = d.x * e.y - d.y * e.x;
      if (Math.abs(cross) < 1e-12) continue;
      const t = ((c.x - a.x) * e.y - (c.y - a.y) * e.x) / cross;
      const s = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / cross;
      if (s >= -1e-9 && s <= 1 + 1e-9) found.push(t);
    }
  }
  return found.filter((t) => t >= -1e-9 && t <= 1 + 1e-9).sort((first, second) => first - second);
}

/**
 * Where the line from a point inside an outline towards another point leaves the outline: the
 * last place it meets it, however far the other point is.
 */
export function leaving(outline: Outline, from: Point, towards: Point): Point | undefined {
  const length = distance(from, towards);
  if (length === 0) return undefined;
  const bounds = boundsOf(outline);
  // Far enough to be outside whatever the outline is, from wherever in it the line starts.
  const reach = (bounds.width + bounds.height + distance(from, centreOf(bounds))) / length + 1;
  const far = between(from, towards, reach);
  const met = meetings(outline, from, far);
  return met.length === 0 ? undefined : between(from, far, met[met.length - 1]);
}

/** Where a run of straight pieces first meets an outline, from its start. */
export function meeting(outline: Outline, points: readonly Point[]): Point | undefined {
  for (let index = 0; index + 1 < points.length; index++) {
    const met = meetings(outline, points[index], points[index + 1]);
    if (met.length > 0) return between(points[index], points[index + 1], met[0]);
  }
  return undefined;
}

/** The unit vector pointing out of an outline at the place of it nearest a point. */
export function normalAt(outline: Outline, point: Point): Point {
  if (outline.kind === 'ellipse') {
    const { x, y } = unit(outline.box, point);
    return unitVector({ x: x / (outline.box.width / 2 || 1), y: y / (outline.box.height / 2 || 1) });
  }
  const { points } = outline;
  let best = 0;
  for (let index = 1; index < points.length; index++) {
    if (distanceToLine(point, points[index], points[(index + 1) % points.length]) < distanceToLine(point, points[best], points[(best + 1) % points.length])) best = index;
  }
  const a = points[best];
  const b = points[(best + 1) % points.length];
  // A clockwise outline, as seen with y downwards, has its outside on the left of each piece.
  const clockwise = points.reduce((sum, p, index) => sum + (points[(index + 1) % points.length].x - p.x) * (points[(index + 1) % points.length].y + p.y), 0) < 0;
  const normal = unitVector({ x: b.y - a.y, y: a.x - b.x });
  return clockwise ? normal : { x: -normal.x || 0, y: -normal.y || 0 };
}

function unitVector(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? { x: 0, y: -1 } : { x: vector.x / length, y: vector.y / length };
}

function distanceToLine(point: Point, a: Point, b: Point): number {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length));
  return distance(point, between(a, b, t));
}

// ---- Bézier curves ----

/**
 * The curve between two ends that leaves and enters along their directions (DISL 6.10). Its
 * control points lie `reach` from each end; without one, half the distance between the ends, and
 * never under 24 or over 120, as the Visual Studio Code host draws it.
 */
export function cubicBetween(from: Direction, to: Direction, reach?: number): Cubic {
  const length = reach ?? Math.min(120, Math.max(24, distance(from.point, to.point) / 2));
  return [
    from.point,
    { x: from.point.x + from.normal.x * length, y: from.point.y + from.normal.y * length },
    { x: to.point.x + to.normal.x * length, y: to.point.y + to.normal.y * length },
    to.point,
  ];
}

export function cubicAt(curve: Cubic, t: number): Point {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x,
    y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y,
  };
}

/** A curve cut into straight pieces: its start, the points between and its end. */
export const cubicPoints = (curve: Cubic, pieces = steps): Point[] => Array.from({ length: pieces + 1 }, (_, index) => cubicAt(curve, index / pieces));

export const cubicPath = (curve: Cubic): PathCommand[] => [
  { op: 'M', x: curve[0].x, y: curve[0].y },
  { op: 'C', c1x: curve[1].x, c1y: curve[1].y, c2x: curve[2].x, c2y: curve[2].y, x: curve[3].x, y: curve[3].y },
];

/** Where a curve first meets an outline, from its start. */
export const cubicMeeting = (outline: Outline, curve: Cubic): Point | undefined => meeting(outline, cubicPoints(curve, steps * 4));

/** How far a point is from a run of straight pieces, for a pointer near a line. */
export function distanceTo(points: readonly Point[], point: Point): number {
  let least = points.length === 1 ? distance(points[0], point) : Infinity;
  for (let index = 0; index + 1 < points.length; index++) least = Math.min(least, distanceToLine(point, points[index], points[index + 1]));
  return least;
}
