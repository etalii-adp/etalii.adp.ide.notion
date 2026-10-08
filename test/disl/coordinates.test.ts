import { describe, expect, it } from 'vitest';
import { defaultCoordinates, interpretCoordinates, monthsIn, rulerRows, scaleOf, scalesOf, unitOf } from '../../src/disl/coordinates';
import { interpretMetamodel, parseYearMonth } from '../../src/disl/metamodel';
import { loadSpecification } from '../../src/disl/specification';
import { hypeCycleJson, json, mindmapJson } from './tool';

const ym = (text: string): number => parseYearMonth(text)!;
const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  return interpretCoordinates(specification, interpretMetamodel(specification).value);
};
const withCoordinates = (coordinates: object) => ({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: {}, coordinates });

describe('the coordinates of the hype cycle graph', () => {
  const { value: coordinates, findings } = interpret(hypeCycleJson());
  const time = coordinates.axes.time;

  it('are read without a finding', () => expect(findings).toEqual([]));

  it('have the axes, the systems and the default', () => {
    expect(Object.keys(coordinates.axes)).toEqual(['time', 'rows', 'track']);
    expect(Object.keys(coordinates.systems)).toEqual(['hypeCycle', 'compact']);
    expect(coordinates.default).toBe('hypeCycle');
    expect(coordinates.systems.hypeCycle).toMatchObject({ orientation: 'y-down', infinite: true, x: { name: 'time' }, y: { name: 'rows' } });
    expect(coordinates.systems.compact.x.name).toBe('track');
    expect(coordinates.systems.hypeCycle.snapping?.byGesture?.drop.x).toEqual({ calendar: { unit: { attribute: 'unit' } }, direction: 'floor' });
  });

  it('have the month axis counted from its origin, in the unit the diagram holds', () => {
    expect(time).toMatchObject({ kind: 'time', origin: ym('1900-01'), size: 4, unit: { attribute: 'unit' }, fallbackUnit: 'month', reversed: false });
    expect(coordinates.axes.rows).toMatchObject({ kind: 'linear', origin: 0, size: 56 });
    expect(scaleOf(time)).toMatchObject({ unit: 'month', months: 1, perUnit: 4 });
    expect(scaleOf(time, { unit: 'decade' })).toMatchObject({ unit: 'decade', months: 120 });
    // A unit the axis cannot be drawn in is the attribute's default.
    expect(scaleOf(time, { unit: 'fortnight' }).unit).toBe('month');
  });

  it('map every date of the shared scale fixture to its x, and back', () => {
    const fixture = json('test/fixtures/gartner-hype-cycle-graph/scale-fixture.json') as {
      months: { date: string; x: number }[]; unitDates: { unit: string; date: string; x: number }[]; rows: { row: number; top: number }[];
    };
    for (const { date, x } of fixture.months) {
      expect(scaleOf(time).toCanvas(ym(date)), date).toBeCloseTo(x, 9);
      expect(scaleOf(time).toValue(x), date).toBeCloseTo(ym(date), 9);
    }
    for (const { unit, date, x } of fixture.unitDates) {
      expect(scaleOf(time, { unit }).toCanvas(ym(date)), `${date} in ${unit}`).toBeCloseTo(x, 9);
      expect(scaleOf(time, { unit }).toValue(x), `${date} in ${unit}`).toBeCloseTo(ym(date), 9);
    }
    const { y } = scalesOf(coordinates.systems.hypeCycle);
    for (const { row, top } of fixture.rows) {
      expect(y.toCanvas(row)).toBe(top);
      expect(y.toValue(top)).toBe(row);
    }
  });

  it('give the rows of the ruler that fit, the finest first, with ticks on round boundaries', () => {
    const view = { from: scaleOf(time).toCanvas(ym('1999-11')), to: scaleOf(time).toCanvas(ym('2001-02')), zoom: 1 };
    // At zoom 1 a month is 4 pixels wide, a quarter 12 and a year 48: the decade is the first row with 64.
    const rows = rulerRows(time, {}, view);
    expect(rows.map((row) => [row.unit, row.spacing])).toEqual([['decade', 480], ['century', 4800], ['millennium', 48000]]);
    expect(rows[0].ticks).toEqual([{ value: ym('2000-01'), at: 4800, label: '2000' }]);
    const near = rulerRows(time, {}, { ...view, zoom: 16 });
    expect(near.map((row) => row.unit)).toEqual(['month', 'quarter', 'year', 'decade', 'century', 'millennium']);
    expect(near[0].ticks.map((tick) => tick.label).slice(0, 3)).toEqual(['Nov 1999', 'Dec 1999', 'Jan 2000']);
    expect(near[1].ticks.map((tick) => tick.label)).toEqual(['Jan 2000', 'Apr 2000', 'Jul 2000', 'Oct 2000', 'Jan 2001']);
    expect(near[2].ticks.map((tick) => [tick.label, tick.at])).toEqual([['2000', 4800], ['2001', 4848]]);
  });

  it('never show a row finer than a step of the unit of the diagram, at any zoom', () => {
    const scale = scaleOf(time, { unit: 'year' });
    const rows = rulerRows(time, { unit: 'year' }, { from: scale.toCanvas(ym('-0002-01')), to: scale.toCanvas(ym('0001-01')), zoom: 1000 });
    expect(rows.map((row) => row.unit)).toEqual(['year', 'decade', 'century', 'millennium']);
    expect(rows[0].ticks.map((tick) => tick.label)).toEqual(['-0002', '-0001', '0000', '0001']);
    expect(rows[1].ticks.map((tick) => tick.value)).toEqual([0]);
    expect(rulerRows(coordinates.axes.rows, {}, { from: 0, to: 100, zoom: 1 })).toEqual([]);
  });
});

describe('coordinates in general', () => {
  it('are one canvas of pixels when a specification declares none', () => {
    const { value, findings } = interpret({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: {} });
    expect(findings).toEqual([]);
    expect(value).toBe(defaultCoordinates);
    expect(scaleOf(value.systems.canvas.x).toCanvas(12)).toBe(12);
  });

  it('read the coordinates of another tool type without a finding', () => {
    const { value, findings } = interpret(mindmapJson());
    expect(findings).toEqual([]);
    expect(Object.keys(value.systems)).toContain(value.default);
  });

  it('know the months of a unit, and no unit finer than a month', () => {
    expect(['month', 'quarter', 'year', 'decade', 'century', 'millennium'].map(monthsIn)).toEqual([1, 3, 12, 120, 1200, 12000]);
    expect(monthsIn('day')).toBeUndefined();
    expect(unitOf({ attribute: 'step' }, { step: 'quarter' })).toBe('quarter');
    expect(unitOf({ attribute: 'step' }, {}, 'year')).toBe('year');
  });

  it('run a reversed axis and a y axis that points up against the canvas', () => {
    const { value } = interpret(withCoordinates({
      axes: { across: { kind: 'linear', scale: 2, origin: 10, reversed: true }, up: { kind: 'linear', scale: 5 } },
      systems: { plan: { kind: 'cartesian', x: 'across', y: 'up', orientation: 'y-up' } },
    }));
    const { x, y } = scalesOf(value.systems.plan);
    expect([x.toCanvas(12), x.toValue(-4)]).toEqual([-4, 12]);
    expect([y.toCanvas(3), y.toValue(-15), y.perUnit]).toEqual([-15, 3, -5]);
    expect(value.default).toBe('plan');
  });

  it('report what they cannot draw, and draw the nearest thing', () => {
    const { value, findings } = interpret(withCoordinates({
      axes: { lanes: { kind: 'ordinal' }, when: { kind: 'time' }, months: { kind: 'time', valueType: 'yearMonth', origin: 'soon', scale: { unit: 'day', size: 2 } } },
      systems: { wheel: { kind: 'polar', x: 'lanes', y: 'nowhere', snapping: 'missing' } },
      default: 'other',
    }));
    expect(findings.map((finding) => finding.message)).toEqual([
      'The axis `lanes` is a `ordinal` axis, which this add-on does not draw; it is read as a linear axis.',
      'The axis `when` is a time axis of `datetime` values, which this add-on does not draw; it is read as a linear axis.',
      'The axis `months` places by month, and the unit `day` of its scale is finer than a month; it is drawn in months.',
      'The origin of the axis `months` is not a year and a month, so the axis starts at year 0.',
      'The coordinate system `wheel` is `polar`, which this add-on does not draw; it is read as cartesian.',
      'The coordinate system `wheel` names the snap profile `missing`, which is not declared.',
      'The coordinate system `wheel` names the axis `nowhere`, which is not declared; a linear axis is used.',
      'The default coordinate system `other` is not declared; `wheel` is used.',
    ]);
    expect(findings.every((finding) => finding.code === 'disl.coordinates' && finding.severity === 'warning')).toBe(true);
    expect(value.axes.months).toMatchObject({ kind: 'time', origin: 0, size: 2, unit: 'month' });
    expect(value.default).toBe('wheel');
  });
});
