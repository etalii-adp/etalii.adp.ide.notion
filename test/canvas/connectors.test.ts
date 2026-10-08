import { describe, expect, it } from 'vitest';
import { drawEdge, drawMarker } from '../../src/canvas/connectors';
import { pathData } from '../../src/canvas/geometry';
import { createScene, type SceneEdge } from '../../src/canvas/scene';
import { paintsOf } from '../../src/canvas/shapes';
import { tokensOf } from '../../src/disl/notation';
import { canvasTool } from './tool';

const made = canvasTool();
const paints = paintsOf(made.notation.theme, 'light');
const scene = createScene(made.sceneTool, made.fixture('triggers-and-notes').value);
const numbers = (text: string | null) => (text ?? '').split(/[ ,]/).map(Number);

describe('an edge of the scene', () => {
  const edge = scene.edges.find((candidate) => candidate.from?.part !== undefined && candidate.to?.part !== undefined)!;

  it('is the path the scene worked out, from a part of one shape to a part of another', () => {
    const group = drawEdge(document, edge, paints)!;
    expect(group.getAttribute('data-element')).toBe(edge.id);
    expect(group.getAttribute('data-type')).toBe(edge.type);
    const line = group.querySelector('path')!;
    expect(edge.curve).toBeDefined();
    expect(line.getAttribute('d')).toBe(pathData(edge.path));
    expect(line.getAttribute('d')).toMatch(/^M.*C/);
    expect(line.getAttribute('fill')).toBe('none');
  });

  it('is stroked as the notation asks, in the colour of the theme', () => {
    const line = drawEdge(document, edge, paints)!.querySelector('path')!;
    const token = (edge.stroke.color as { token: string }).token;
    expect(line.getAttribute('stroke')).toBe(tokensOf(made.notation.theme, 'light')[token]);
    expect(line.getAttribute('stroke-width')).toBe(String(edge.stroke.width));
    const dark = drawEdge(document, edge, paintsOf(made.notation.theme, 'dark'))!.querySelector('path')!;
    expect(dark.getAttribute('stroke')).toBe(tokensOf(made.notation.theme, 'dark')[token]);
  });

  it('has the marker of each end, with its tip on the end', () => {
    const group = drawEdge(document, edge, paints)!;
    const markers = [...group.querySelectorAll('[data-marker]')];
    expect(markers.map((marker) => marker.getAttribute('data-marker'))).toEqual([edge.sourceMarker, edge.targetMarker].filter((name) => name !== 'none'));
    const tip = numbers(markers.at(-1)!.getAttribute('points')).slice(0, 2);
    expect(tip[0]).toBeCloseTo(edge.to!.x);
    expect(tip[1]).toBeCloseTo(edge.to!.y);
    expect(markers.at(-1)!.getAttribute('fill')).toBe(group.querySelector('path')!.getAttribute('stroke'));
  });

  it('is not drawn when the scene hides it', () => {
    expect(drawEdge(document, { ...edge, hidden: 'part', path: [] }, paints)).toBeUndefined();
    expect(drawEdge(document, { ...edge, hidden: 'filter' }, paints)).toBeUndefined();
  });

  it('is drawn in the text colour of the page when the notation gives its line no colour', () => {
    const plain: SceneEdge = { ...edge, stroke: {} };
    expect(drawEdge(document, plain, paints)!.querySelector('path')!.getAttribute('stroke')).toBe('currentColor');
  });
});

describe('a marker', () => {
  const along = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it('points the way the line arrives', () => {
    const arrow = drawMarker(document, 'arrowFilled', along, '#000000', 1)!;
    const points = numbers(arrow.getAttribute('points'));
    expect(points.slice(0, 2)).toEqual([10, 0]);
    expect(points[2]).toBeLessThan(10);
    expect(points[3]).toBeCloseTo(-points[5]);
    const down = numbers(drawMarker(document, 'arrowFilled', [{ x: 0, y: 0 }, { x: 0, y: 10 }], '#000000', 1)!.getAttribute('points'));
    expect(down[3]).toBeLessThan(10);
    expect(down[2]).toBeCloseTo(-down[4]);
  });

  it('reads the way from the point before a control point that lies on the end', () => {
    const arrow = drawMarker(document, 'arrowFilled', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }], '#000000', 1)!;
    expect(numbers(arrow.getAttribute('points'))[2]).toBeLessThan(10);
  });

  it('is open, filled, a diamond or a circle as its name says, and nothing for none', () => {
    expect(drawMarker(document, 'none', along, '#000000', 1)).toBeUndefined();
    expect(drawMarker(document, 'arrow', along, '#000000', 1)!.tagName).toBe('polyline');
    expect(drawMarker(document, 'arrow', along, '#000000', 1)!.getAttribute('fill')).toBe('none');
    expect(drawMarker(document, 'triangle', along, '#000000', 1)!.getAttribute('fill')).toBe('none');
    expect(drawMarker(document, 'diamondFilled', along, '#111111', 1)!.getAttribute('fill')).toBe('#111111');
    expect(drawMarker(document, 'circle', along, '#000000', 1)!.tagName).toBe('circle');
    expect(drawMarker(document, 'arrow', [{ x: 1, y: 1 }], '#000000', 1)).toBeUndefined();
  });
});
