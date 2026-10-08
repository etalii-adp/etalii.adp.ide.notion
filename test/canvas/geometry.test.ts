import { describe, expect, it } from 'vitest';
import {
  boundsOf, boxOutline, centreOf, cubicAt, cubicBetween, cubicMeeting, cubicPath, cubicPoints, distance, distanceTo, holds, inside, leaving, meeting, meetings, moved, movedPath,
  normalAt, normalOf, overlaps, pathData, pathOutline, pointIn, pointOn, pointsOf, sideAt, sides, union,
  type Outline, type PathCommand, type Point,
} from '../../src/canvas/geometry';

const box = { x: 10, y: 20, width: 100, height: 40 };
const near = (point: Point | undefined, x: number, y: number): void => {
  expect(point?.x).toBeCloseTo(x, 6);
  expect(point?.y).toBeCloseTo(y, 6);
};

describe('points and boxes', () => {
  it('give the centre of a box and a point at fractions of it', () => {
    expect(centreOf(box)).toEqual({ x: 60, y: 40 });
    expect(pointIn(box, 0.25, 1)).toEqual({ x: 35, y: 60 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('give the point at a fraction along a side, from its left or its top end, and the way out of it', () => {
    expect(sides.map((side) => pointOn(box, side, 0.25))).toEqual([{ x: 35, y: 20 }, { x: 110, y: 30 }, { x: 35, y: 60 }, { x: 10, y: 30 }]);
    expect(sides.map(normalOf)).toEqual([{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]);
  });

  it('say which side a point of a box lies on', () => {
    expect([sideAt(0.5, 0), sideAt(1, 0.5), sideAt(0.5, 1), sideAt(0, 0.5)]).toEqual(['top', 'right', 'bottom', 'left']);
    expect([sideAt(0, 0), sideAt(1, 1), sideAt(0.9, 0.5)]).toEqual(['top', 'bottom', 'right']);
  });

  it('move, join and compare boxes', () => {
    expect(moved(box, 5, -5)).toEqual({ x: 15, y: 15, width: 100, height: 40 });
    expect(union(box, { x: 0, y: 50, width: 20, height: 30 })).toEqual({ x: 0, y: 20, width: 110, height: 60 });
    expect(overlaps(box, { x: 110, y: 60, width: 5, height: 5 })).toBe(true);
    expect(overlaps(box, { x: 111, y: 20, width: 5, height: 5 })).toBe(false);
    expect([holds(box, { x: 10, y: 60 }), holds(box, { x: 9, y: 30 })]).toEqual([true, false]);
  });
});

describe('paths', () => {
  const path: PathCommand[] = [{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 10, y: 0 }, { op: 'Q', cx: 20, cy: 0, x: 20, y: 10 }, { op: 'C', c1x: 20, c1y: 20, c2x: 10, c2y: 20, x: 0, y: 20 }, { op: 'Z' }];

  it('are moved, and written as the `d` of an SVG path', () => {
    expect(pathData(movedPath(path, 1, 2))).toBe('M 1 2 L 11 2 Q 21 2, 21 12 C 21 22, 11 22, 1 22 Z');
  });

  it('are cut into points, a curve into straight pieces that start and end where it does', () => {
    const points = pointsOf(path);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points).toHaveLength(2 + 16 + 16);
    near(points[17], 20, 10);
    near(points[points.length - 1], 0, 20);
    // The middle of the quadratic curve.
    near(points[9], 17.5, 2.5);
    expect(pointsOf([...path, { op: 'M', x: 50, y: 50 }, { op: 'L', x: 60, y: 60 }])).toHaveLength(points.length);
  });
});

describe('outlines', () => {
  const rect = boxOutline(box);
  const ellipse: Outline = { kind: 'ellipse', box };
  // A banner that points right: the outline of a shape with a path.
  const banner = pathOutline([{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 80, y: 0 }, { op: 'L', x: 100, y: 20 }, { op: 'L', x: 80, y: 40 }, { op: 'L', x: 0, y: 40 }, { op: 'Z' }]);

  it('have bounds', () => {
    expect(boundsOf(rect)).toEqual(box);
    expect(boundsOf(ellipse)).toEqual(box);
    expect(boundsOf(banner)).toEqual({ x: 0, y: 0, width: 100, height: 40 });
  });

  it('hold the points inside them and on them', () => {
    expect([inside(rect, { x: 60, y: 40 }), inside(rect, { x: 10, y: 20 }), inside(rect, { x: 9, y: 40 })]).toEqual([true, true, false]);
    expect([inside(ellipse, { x: 60, y: 40 }), inside(ellipse, { x: 110, y: 40 }), inside(ellipse, { x: 12, y: 22 })]).toEqual([true, true, false]);
    expect([inside(banner, { x: 95, y: 20 }), inside(banner, { x: 95, y: 5 })]).toEqual([true, false]);
  });

  it('are met by a line where it crosses them, the nearest first', () => {
    expect(meetings(rect, { x: 0, y: 40 }, { x: 120, y: 40 }).map((t) => t * 120)).toEqual([10, 110]);
    expect(meetings(ellipse, { x: 0, y: 40 }, { x: 120, y: 40 }).map((t) => Math.round(t * 120))).toEqual([10, 110]);
    expect(meetings(ellipse, { x: 0, y: 0 }, { x: 120, y: 0 })).toEqual([]);
    expect(meetings(rect, { x: 60, y: 40 }, { x: 60, y: 45 })).toEqual([]);
  });

  it('say where a line from inside leaves them, however near the point it runs towards', () => {
    near(leaving(rect, centreOf(box), { x: 1000, y: 40 }), 110, 40);
    near(leaving(rect, centreOf(box), { x: 61, y: 40 }), 110, 40);
    near(leaving(rect, centreOf(box), { x: 60, y: -500 }), 60, 20);
    const circle: Outline = { kind: 'ellipse', box: { x: -8, y: -8, width: 16, height: 16 } };
    near(leaving(circle, { x: 0, y: 0 }, { x: 30, y: 40 }), 4.8, 6.4);
    near(leaving(banner, { x: 50, y: 20 }, { x: 500, y: 20 }), 100, 20);
    expect(leaving(rect, centreOf(box), centreOf(box))).toBeUndefined();
  });

  it('say where a run of straight pieces first meets them', () => {
    near(meeting(rect, [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 200, y: 40 }]), 10, 40);
    expect(meeting(rect, [{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBeUndefined();
  });

  it('point out of themselves at any place of them', () => {
    near(normalAt(rect, { x: 60, y: 20 }), 0, -1);
    near(normalAt(rect, { x: 110, y: 30 }), 1, 0);
    near(normalAt(rect, { x: 60, y: 60 }), 0, 1);
    near(normalAt(rect, { x: 10, y: 30 }), -1, 0);
    near(normalAt(banner, { x: 90, y: 10 }), Math.SQRT1_2, -Math.SQRT1_2);
    // The same outline run the other way round points out the same way.
    near(normalAt({ kind: 'polygon', points: [{ x: 10, y: 60 }, { x: 110, y: 60 }, { x: 110, y: 20 }, { x: 10, y: 20 }] }, { x: 60, y: 20 }), 0, -1);
    const circle: Outline = { kind: 'ellipse', box: { x: -8, y: -8, width: 16, height: 16 } };
    near(normalAt(circle, { x: 4.8, y: 6.4 }), 0.6, 0.8);
    near(normalAt(ellipse, { x: 60, y: 20 }), 0, -1);
  });
});

describe('Bézier curves', () => {
  const from = { point: { x: 0, y: 0 }, normal: { x: 0, y: 1 } };
  const to = { point: { x: 300, y: 400 }, normal: { x: 0, y: -1 } };

  it('leave and enter along the directions of their ends, as far as half the way between them', () => {
    expect(cubicBetween(from, to)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 300, y: 280 }, { x: 300, y: 400 }]);
    // Never nearer than 24 and never farther than 120, as the Visual Studio Code host draws them.
    expect(cubicBetween(from, { ...to, point: { x: 6, y: 8 } })[1]).toEqual({ x: 0, y: 24 });
    expect(cubicBetween(from, { ...to, point: { x: 60, y: 80 } })[1]).toEqual({ x: 0, y: 50 });
    expect(cubicBetween(from, to, 10)[2]).toEqual({ x: 300, y: 390 });
  });

  it('are cut into points and written as a path', () => {
    const curve = cubicBetween(from, to);
    expect(cubicAt(curve, 0)).toEqual(curve[0]);
    expect(cubicAt(curve, 1)).toEqual(curve[3]);
    near(cubicAt(curve, 0.5), 150, 200);
    expect(cubicPoints(curve, 4)).toHaveLength(5);
    expect(pathData(cubicPath(curve))).toBe('M 0 0 C 0 120, 300 280, 300 400');
  });

  it('say where they meet an outline, and how far a point is from them', () => {
    const curve = cubicBetween(from, to);
    const met = cubicMeeting(boxOutline({ x: 100, y: 150, width: 100, height: 100 }), curve);
    expect(met!.x).toBeGreaterThan(99.9);
    expect(met!.y).toBeGreaterThan(149.9);
    expect(Math.min(Math.abs(met!.x - 100), Math.abs(met!.y - 150))).toBeLessThan(1e-6);
    expect(cubicMeeting(boxOutline({ x: 500, y: 0, width: 10, height: 10 }), curve)).toBeUndefined();
    expect(distanceTo(cubicPoints(curve, 64), { x: 150, y: 200 })).toBeLessThan(0.5);
    expect(distanceTo([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 3 })).toBe(3);
    expect(distanceTo([{ x: 0, y: 0 }], { x: 3, y: 4 })).toBe(5);
  });
});
