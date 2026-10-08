import { describe, expect, it } from 'vitest';
import { interpretCoordinates } from '../../src/disl/coordinates';
import { interpretLayout } from '../../src/disl/layout';
import { interpretMetamodel } from '../../src/disl/metamodel';
import { interpretNotation, nodeNotation } from '../../src/disl/notation';
import { loadSpecification } from '../../src/disl/specification';
import { interpretViewpoints } from '../../src/disl/viewpoints';
import { hypeCycleJson, mindmapJson } from './tool';

const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  const parts = {
    notation: interpretNotation(specification, metamodel).value,
    coordinates: interpretCoordinates(specification, metamodel).value,
    layout: interpretLayout(specification).value,
  };
  return { ...interpretViewpoints(specification, metamodel, parts), metamodel, ...parts };
};
const specification = (viewpoints: object, more: object = {}) => ({
  disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: { types: { Box: {} } },
  notation: { styles: { plain: { fill: 'white', opacity: 1 } }, nodes: { Box: { shape: 'ellipse', style: { fill: 'red', stroke: { width: 2 } }, placement: { x: { attribute: 'at' }, x2: { attribute: 'until' } } } } },
  viewpoints, ...more,
});

describe('the viewpoints of the hype cycle graph', () => {
  const { value: viewpoints, findings, metamodel, notation } = interpret(hypeCycleJson());
  const { trueTime, compact } = viewpoints.all;

  it('are read without a finding', () => expect(findings).toEqual([]));

  it('open in true time, which has the compact variant as a toggle', () => {
    expect(Object.keys(viewpoints.all)).toEqual(['trueTime', 'compact']);
    expect(viewpoints.default).toBe('trueTime');
    expect(trueTime).toMatchObject({ label: 'True time', coordinateSystem: 'hypeCycle', variants: ['compact'], exclude: [] });
    expect(trueTime.variantOf).toBeUndefined();
    expect(trueTime.toggle).toBeUndefined();
    expect(trueTime.layout).toBeUndefined();
    expect(compact).toMatchObject({ label: 'Compact', variantOf: 'trueTime', variants: [], coordinateSystem: 'compact', toggle: { label: 'Compact', position: 'outside-top-left' } });
  });

  it('draw true time with the notation of the specification itself', () => expect(trueTime.notation).toBe(notation));

  it('give the variant its layout', () => {
    expect(compact.layout).toMatchObject({ name: 'rowPacked', algorithm: 'rowPacked', rowPacked: { gap: 4, order: 'start' } });
  });

  it('lay the notation of the variant over the notation under it, a property at a time', () => {
    const trend = nodeNotation(compact.notation, metamodel, 'Trend');
    // The placement is the variant's own: nothing of the bound extent is left in it.
    expect(trend.placement).toEqual({ system: 'compact', x: { layout: true }, y: { attribute: 'row' }, anchor: 'top-left', movable: false, resizable: false });
    expect(trend.size).toEqual({ width: { cel: '24.0 * double(visiblePhases(self))' }, height: 32, resizable: false });
    expect(trend.shape).toMatchObject({ params: { b1: { cel: '1.0 / double(visiblePhases(self))' } } });
    expect(trend.labels).toEqual(nodeNotation(notation, metamodel, 'Trend').labels);

    const trigger = nodeNotation(compact.notation, metamodel, 'Trigger');
    expect(trigger.placement).toMatchObject({ system: 'compact', x: { layout: true }, y: { attribute: 'row', offset: 0.2857142857142857 }, anchor: 'center' });
    expect(trigger).toMatchObject({ shape: 'ellipse', size: { fixed: [16, 16] }, anchors: { mode: 'fixed' } });
    expect(nodeNotation(compact.notation, metamodel, 'Note').size).toEqual(nodeNotation(notation, metamodel, 'Note').size);
    expect(compact.notation.edges).toEqual(notation.edges);
    expect(compact.notation.shapes).toEqual(notation.shapes);
    expect(compact.notation.canvas.filters).toEqual(notation.canvas.filters);
  });
});

describe('viewpoints in general', () => {
  it('are the one viewpoint `main`, which shows everything, when a specification declares none', () => {
    const { value, findings, notation, coordinates } = interpret(mindmapJson());
    expect(findings).toEqual([]);
    expect(value.default).toBe('main');
    expect(value.all.main).toMatchObject({ name: 'main', variants: [], exclude: [], coordinateSystem: coordinates.default });
    expect(value.all.main.notation).toBe(notation);
  });

  it('open in the viewpoint marked default, else the first that is no variant', () => {
    expect(interpret(specification({ one: {}, two: { default: true } })).value.default).toBe('two');
    expect(interpret(specification({ small: { variantOf: 'big' }, big: {} })).value.default).toBe('big');
    const twice = interpret(specification({ one: { default: true }, two: { default: true } }));
    expect(twice.value.default).toBe('one');
    expect(twice.findings.map((finding) => finding.message)).toEqual(['More than one viewpoint is the default; `one` is used.']);
  });

  it('give a variant what it does not say from the viewpoint it varies, and its label as its toggle', () => {
    const { value } = interpret(specification({
      whole: { label: 'Whole', include: ['Box'], exclude: ['Other'], members: 'self.id != ""', toolbox: ['basics'], notation: { nodes: { Box: { shape: 'rect' } }, styles: { plain: { fill: 'grey' } } } },
      part: { variantOf: 'whole', exclude: [], notation: { nodes: { Box: { style: { stroke: { color: 'blue' } }, placement: { x: { layout: true } } } } } },
    }));
    expect(value.all.part).toMatchObject({ label: 'Part', include: ['Box'], exclude: [], members: 'self.id != ""', toolbox: ['basics'], toggle: { label: 'Part' } });
    expect(value.all.whole.notation.nodes.Box).toMatchObject({ shape: 'rect', style: { fill: 'red' } });
    expect(value.all.whole.notation.styles.plain).toEqual({ fill: 'grey', opacity: 1 });
    // A style is merged key by key; a placement is replaced as a whole.
    expect(value.all.part.notation.nodes.Box).toMatchObject({ shape: 'rect', style: { fill: 'red', stroke: { width: 2, color: 'blue' } } });
    expect(value.all.part.notation.nodes.Box.placement).toEqual({ x: { layout: true } });
  });

  it('take a layout by name or written in place', () => {
    const more = { layout: { algorithms: { tidy: { algorithm: 'rows', rows: { writes: ['lane'], extent: {} } } } } };
    const { value, findings } = interpret(specification({ named: { layout: 'tidy' }, inline: { layout: { algorithm: 'rowPacked', rowPacked: { order: 'document', gap: 2 } } }, lost: { layout: 'gone' } }, more));
    expect(value.all.named.layout).toMatchObject({ name: 'tidy', algorithm: 'rows' });
    expect(value.all.inline.layout).toMatchObject({ name: 'inline', rowPacked: { gap: 2 } });
    expect(value.all.lost.layout).toBeUndefined();
    expect(findings.map((finding) => finding.message)).toEqual(['The viewpoint `lost` names the layout `gone`, which is not declared.']);
  });

  it('report a variant of nothing, a variant of a variant and a coordinate system that is not declared', () => {
    const { value, findings } = interpret(specification({ base: {}, lone: { variantOf: 'nothing' }, first: { variantOf: 'base', coordinateSystem: 'nowhere' }, second: { variantOf: 'first' } }));
    expect(findings.map((finding) => finding.message)).toEqual([
      'The viewpoint `lone` is a variant of `nothing`, which is no other viewpoint, so it is read as a viewpoint of its own.',
      'The viewpoint `second` is a variant of the variant `first`, so it is read as a viewpoint of its own.',
      'The viewpoint `first` names the coordinate system `nowhere`, which is not declared; `canvas` is used.',
    ]);
    expect(findings.every((finding) => finding.code === 'disl.viewpoints')).toBe(true);
    expect(value.all.base.variants).toEqual(['first']);
    expect([value.all.lone.variantOf, value.all.second.variantOf, value.all.first.coordinateSystem]).toEqual([undefined, undefined, 'canvas']);
  });
});
