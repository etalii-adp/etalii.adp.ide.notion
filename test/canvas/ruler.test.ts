import { describe, expect, it } from 'vitest';
import { drawRuler, rulerSize, shownRows } from '../../src/canvas/ruler';
import { rulerRows, scaleOf } from '../../src/disl/coordinates';
import { canvasTool } from './tool';

const made = canvasTool();
const system = made.coordinates.systems[made.coordinates.default];
const timed = system.x;
const diagram = { unit: 'month' };
const scale = scaleOf(timed, diagram);
// From a hundred years after the axis's origin, 800 pixels wide at each zoom.
const from = scale.toCanvas(100 * 12 + timed.origin);
const view = (zoom: number) => ({ from, to: from + 800 / zoom, zoom });
const labels = (ruler: SVGGElement | undefined) => [...(ruler?.querySelectorAll('text') ?? [])].map((text) => text.textContent);
const places = (ruler: SVGGElement | undefined) => [...(ruler?.querySelectorAll('line') ?? [])].map((line) => Number(line.getAttribute('x1')));

describe('the ruler of an axis', () => {
  it('draws the ticks and labels of rulerRows for what the canvas shows', () => {
    const ruler = drawRuler(document, timed, diagram, view(1))!;
    const row = rulerRows(timed, diagram, view(1))[0];
    expect(ruler.getAttribute('data-axis')).toBe(timed.name);
    expect(ruler.querySelector('g')!.getAttribute('data-unit')).toBe(row.unit);
    expect(labels(ruler)).toEqual(row.ticks.map((tick) => tick.label));
    expect(places(ruler)).toEqual(row.ticks.map((tick) => tick.at - from));
    expect(places(ruler).every((at) => at >= 0 && at <= 800)).toBe(true);
  });

  it('follows the zoom: a finer unit when zoomed in, a coarser one when zoomed out', () => {
    const units = [16, 1, 0.1, 0.01].map((zoom) => drawRuler(document, timed, diagram, view(zoom))!.querySelector('g')!.getAttribute('data-unit'));
    expect(new Set(units).size).toBeGreaterThan(2);
    expect(units[0]).toBe('month');
    for (const zoom of [16, 1, 0.1, 0.01]) {
      const at = places(drawRuler(document, timed, diagram, view(zoom)));
      expect(at.length).toBeGreaterThan(1);
      // Labels on screen keep the room the ruler's levels ask for.
      expect(at[1] - at[0]).toBeGreaterThanOrEqual(64);
    }
  });

  it('places a tick in the pixels of the screen, not in canvas units', () => {
    const two = places(drawRuler(document, timed, diagram, view(2)));
    const first = rulerRows(timed, diagram, view(2))[0].ticks[0];
    expect(two[0]).toBeCloseTo((first.at - from) * 2);
  });

  it('never shows a level finer than the unit of the diagram', () => {
    const inYears = { unit: 'year' };
    const start = scaleOf(timed, inYears).toCanvas(100 * 12 + timed.origin);
    const ruler = drawRuler(document, timed, inYears, { from: start, to: start + 10, zoom: 80 });
    expect(ruler?.querySelector('g')?.getAttribute('data-unit')).not.toBe('month');
  });

  it('stands at the far edge of the view for a ruler at the bottom, one row high', () => {
    const ruler = drawRuler(document, timed, diagram, view(1), { across: 600 })!;
    const size = timed.ruler?.size ?? rulerSize;
    expect(ruler.getAttribute('data-position')).toBe('bottom');
    expect(ruler.getAttribute('transform')).toBe(`translate(0,${600 - size})`);
    expect(ruler.querySelector('rect')!.getAttribute('width')).toBe('800');
    expect(ruler.querySelector('rect')!.getAttribute('height')).toBe(String(size));
    expect(ruler.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws as many rows as it is asked for, the finest nearest the drawing', () => {
    const rows = shownRows(timed, diagram, view(1), { levels: 2 });
    const ruler = drawRuler(document, timed, diagram, view(1), { levels: 2 })!;
    expect(rows).toHaveLength(2);
    expect([...ruler.querySelectorAll('g')].map((row) => row.getAttribute('data-unit'))).toEqual(rows.map((row) => row.unit));
    expect(ruler.querySelector('g line')!.getAttribute('y1')).toBe('0');
  });

  it('lies along y for a ruler at a side', () => {
    const upright = { ...timed, ruler: { ...timed.ruler, position: 'left' as const } };
    const ruler = drawRuler(document, upright, diagram, view(1))!;
    const line = ruler.querySelector('line')!;
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));
    expect(ruler.querySelector('rect')!.getAttribute('height')).toBe('800');
  });

  it('is nothing for an axis without a ruler, and for a ruler that is not visible', () => {
    expect(drawRuler(document, system.y, diagram, view(1))).toBeUndefined();
    expect(drawRuler(document, { ...timed, ruler: { ...timed.ruler, visible: false } }, diagram, view(1))).toBeUndefined();
  });
});
