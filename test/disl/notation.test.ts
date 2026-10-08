import { describe, expect, it } from 'vitest';
import { interpretMetamodel } from '../../src/disl/metamodel';
import { colourOf, edgeNotation, interpretNotation, lineHeight, merged, nodeNotation, styleOf, textWidth, tokensOf } from '../../src/disl/notation';
import { loadSpecification } from '../../src/disl/specification';
import { hypeCycleJson, mindmapJson } from './tool';

const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  return { ...interpretNotation(specification, metamodel), metamodel };
};
const specification = (notation: object, types: object = { Box: {} }) => ({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: { types }, notation });

describe('the notation of the hype cycle graph', () => {
  const { value: notation, findings, metamodel } = interpret(hypeCycleJson());

  it('is read without a finding', () => expect(findings).toEqual([]));

  it('has the text metric, which measures a text the same in every host', () => {
    expect(notation.textMetric).toEqual({ kind: 'average', advance: 0.55, count: 'utf16' });
    expect(textWidth(notation.textMetric, 'Steam engine', 12)).toBeCloseTo(12 * 12 * 0.55, 9);
    expect(lineHeight(notation.textMetric, 10)).toBe(13);
  });

  it('has the theme tokens of each mode', () => {
    expect(Object.keys(notation.theme.tokens)).toHaveLength(10);
    expect(notation.theme.followSystem).toBe(true);
    expect(tokensOf(notation.theme)['ghg.peak']).toBe('#f7e7a1');
    expect(tokensOf(notation.theme, 'dark')['ghg.peak']).toBe('#6b5a17');
    expect(colourOf(notation.theme, { token: 'ghg.note' }, 'dark')).toBe('#423a10');
    expect(colourOf(notation.theme, { token: 'ghg.note' }, 'sepia')).toBe('#fef9c3');
    expect(colourOf(notation.theme, '#123456')).toBe('#123456');
    expect(colourOf(notation.theme, { token: 'ghg.missing' })).toBeUndefined();
  });

  it('has the styles, and lays one over another', () => {
    expect(notation.styles).toEqual({
      segment: { stroke: { width: 0 } },
      chevron: { fill: 'none', stroke: { color: { token: 'ghg.chevron' }, width: 1.5 } },
      attachment: { fill: 'none', stroke: { width: 0 } },
    });
    expect(styleOf(notation, { fill: 'red', stroke: { color: 'blue', width: 2 } }, { extends: 'segment', fill: { token: 'ghg.peak' } }))
      .toEqual({ fill: { token: 'ghg.peak' }, stroke: { color: 'blue', width: 0 } });
    expect(styleOf(notation, undefined, 'chevron', 'none such')).toEqual(notation.styles.chevron);
  });

  it('has the composite shape with its parameters, its outline, its parts and its handles', () => {
    const banner = notation.shapes.phasedBanner;
    expect(Object.keys(notation.shapes)).toEqual(['phasedBanner']);
    expect(banner.params.count).toEqual({ type: 'int', default: 4, min: 1, max: 4, unit: 'count', persist: 'none' });
    expect(Object.keys(banner.params)).toEqual(['count', 'b1', 'b2', 'b3']);
    expect(banner.path).toBeUndefined();
    expect((banner.outline as { segments: unknown[] }).segments).toHaveLength(6);
    expect(banner.parts!.map((part) => part.id)).toEqual(['peakFill', 'troughFill', 'slopeFill', 'plateauFill', 'chevron1', 'chevron2', 'chevron3', 'peak', 'trough', 'slope', 'plateau']);
    expect(banner.parts![1]).toMatchObject({ when: 'p.count >= 2', tooltip: 'Trough of Disillusionment', style: { extends: 'segment' } });
    expect(banner.parts![7]).toMatchObject({ shape: 'rect', hit: false, style: 'attachment' });
    expect(banner.handles.map((handle) => [handle.param, handle.axis, handle.x])).toEqual([['b1', 'x', 'w * p.b1'], ['b2', 'x', 'w * p.b2'], ['b3', 'x', 'w * p.b3']]);
  });

  it('has each node type with its shape, size, bound placement, snapping, labels and anchors', () => {
    expect(Object.keys(notation.nodes)).toEqual(['Trend', 'Trigger', 'Note']);
    const trend = nodeNotation(notation, metamodel, 'Trend');
    expect(trend.shape).toMatchObject({ type: 'phasedBanner', params: { count: { cel: 'visiblePhases(self)' } } });
    expect(trend.size).toEqual({ default: [48, 32], min: [null, 32], max: [null, 32], resizable: 'horizontal' });
    expect(trend.placement).toMatchObject({ system: 'hypeCycle', x: { attribute: 'start' }, x2: { attribute: 'stop' }, y: { attribute: 'row' }, anchor: 'top-left', resizable: { x: true, y: false } });
    expect(trend.snapping?.byGesture?.drop.y).toEqual({ cel: 'math.round(value - 2.0 / 7.0)' });
    expect(trend.labels).toMatchObject([{ id: 'name', text: { attribute: 'name' }, position: 'outside-left', distance: 8, editable: 'inline', wrap: 'none' }]);
    expect(trend).toMatchObject({ anchors: {}, variants: [], connectable: true, selectable: true, style: {} });

    const trigger = nodeNotation(notation, metamodel, 'Trigger');
    expect(trigger.shape).toBe('ellipse');
    expect(trigger.size).toEqual({ fixed: [16, 16] });
    expect(trigger.anchors).toMatchObject({ mode: 'fixed', drawnFrom: 'outline', points: [{ id: 'n', x: 0.5, y: 0 }, { id: 'e', x: 1, y: 0.5 }, { id: 's', x: 0.5, y: 1 }] });
    expect(trigger.labels[0].editText).toEqual({ attribute: 'name' });
    expect(trigger.tooltip).toMatchObject({ cel: expect.stringContaining('Trigger: ') });
    expect(trigger.style.stroke).toEqual({ color: { token: 'ghg.trigger' }, width: 1.5 });

    const note = nodeNotation(notation, metamodel, 'Note');
    expect(note).toMatchObject({ shape: 'rect', connectable: false, size: { width: { attribute: 'width' }, height: { attribute: 'height' }, resizable: true } });
    expect(note.style).toMatchObject({ font: { size: 12 }, padding: [6, 6] });
    expect(note.labels[0]).toMatchObject({ position: 'center', editable: 'multiline', wrap: 'word', maxWidth: 'parent', overflow: 'ellipsis' });
  });

  it('has the edge with its line, markers, anchoring and variant', () => {
    expect(Object.keys(notation.edges)).toEqual(['Influence']);
    const influence = edgeNotation(notation, metamodel, 'Influence');
    expect(influence.line).toMatchObject({ routing: 'bezier', startDirection: 'normal', endDirection: 'normal', stroke: { width: 1.5 } });
    expect([influence.sourceMarker, influence.targetMarker]).toEqual(['none', 'arrowFilled']);
    expect(influence.anchoring.source).toMatchObject({ mode: 'part', part: { attribute: 'fromPhase' }, side: { attribute: 'fromEdge' }, at: { attribute: 'fromAt' }, movable: true });
    expect(influence.anchoring.target?.default).toEqual({ part: 'peak', side: 'top', at: 0.5 });
    expect(influence.variants).toHaveLength(1);
    expect(influence.variants[0]).toMatchObject({ when: "self.source.isA('Trigger')", anchoring: { source: { mode: 'fixed' } } });
  });

  it('has the filter of the canvas with its defaults, and the legend', () => {
    expect(notation.canvas.filters.tags).toMatchObject({
      id: 'tags', label: 'Filter by tags', control: 'chips', appliesTo: ['Trend', 'Trigger'], default: [],
      match: { default: 'any', userToggle: true }, effect: 'hide', position: 'outside-top-left',
    });
    expect(notation.canvas.filters.tags.options?.cel).toContain('distinct()');
    expect(notation.canvas.legend).toMatchObject({ visible: true, position: 'outside-top-left', entries: ['Phase'], from: 'declared' });
  });
});

describe('a notation in general', () => {
  it('draws a type without a notation by the defaults of DISL', () => {
    const { value, findings, metamodel } = interpret({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: { types: { Box: { labelAttribute: 'title', attributes: { title: { type: 'string' } } }, Plain: {} }, relations: { Line: { source: 'Box', target: 'Box' }, Tie: { source: 'Box', target: 'Box', directed: false } } } });
    expect(findings).toEqual([]);
    expect(value.textMetric).toBe('host');
    expect(nodeNotation(value, metamodel, 'Box')).toMatchObject({ shape: 'rect', labels: [{ text: { attribute: 'title' }, position: 'center' }], connectable: true });
    expect(nodeNotation(value, metamodel, 'Plain').labels).toEqual([]);
    expect(edgeNotation(value, metamodel, 'Line')).toMatchObject({ sourceMarker: 'none', targetMarker: 'arrowFilled', anchoring: {} });
    expect(edgeNotation(value, metamodel, 'Tie').targetMarker).toBe('none');
    expect(textWidth('host', 'four', 10, (text, size) => text.length * size)).toBe(40);
  });

  it('draws a subtype as its nearest supertype is drawn', () => {
    const { value, metamodel } = interpret(specification({ nodes: { Box: { shape: 'ellipse' } } }, { Box: {}, Crate: { extends: 'Box' } }));
    expect(nodeNotation(value, metamodel, 'Crate').shape).toBe('ellipse');
  });

  it('works out what a style extends, the leftmost first, and its own last', () => {
    const { value, findings } = interpret(specification({
      styles: { base: { fill: 'white', stroke: { width: 1, color: 'black' } }, bold: { stroke: { width: 3 } }, both: { extends: ['base', 'bold'], fill: 'grey' }, loop: { extends: 'loop', fill: 'red' } },
      nodes: { Box: { style: ['both', { opacity: 0.5 }], partStyles: { head: 'bold' }, variants: [{ when: 'self.id == "a"', style: 'bold' }, { style: 'base' }] } },
    }));
    expect(value.styles.both).toEqual({ fill: 'grey', stroke: { width: 3, color: 'black' } });
    expect(value.styles.loop).toEqual({ fill: 'red' });
    expect(value.nodes.Box.style).toEqual({ fill: 'grey', stroke: { width: 3, color: 'black' }, opacity: 0.5 });
    expect(value.nodes.Box.partStyles).toEqual({ head: { stroke: { width: 3 } } });
    // A variant without a `when` is no variant.
    expect(value.nodes.Box.variants).toEqual([{ when: 'self.id == "a"', style: { stroke: { width: 3 } } }]);
    expect(findings.map((finding) => finding.message)).toEqual(['The style `loop` extends itself, so it is read without what it extends.']);
  });

  it('reports what it cannot draw', () => {
    const { findings } = interpret(specification({
      shapes: { stamp: { svg: '<svg/>' }, pair: { parts: [{ id: 'one', shape: 'cloud' }] } },
      nodes: { Box: { shape: { type: 'star' }, style: 'missing' }, Ghost: {} },
      edges: { Box: {} },
      canvas: { filters: { open: { control: 'switch' } } },
    }));
    expect(findings.map((finding) => finding.message)).toEqual([
      'The shape `stamp` is drawn from `svg` or a plugin, which this add-on does not draw; it is drawn as its bounds.',
      'A part of the shape `pair` is drawn as the shape `cloud`, which this add-on does not draw; a rectangle is drawn.',
      'The style `missing` is not declared, so nothing is taken from it.',
      'A node of the type `Box` is drawn as the shape `star`, which this add-on does not draw; a rectangle is drawn.',
      'The notation draws nodes of the type `Ghost`, which is no node type of the metamodel.',
      'The notation draws edges of the type `Box`, which is no relation type of the metamodel.',
      'The filter `open` does not say what it keeps, so it hides nothing.',
    ]);
    expect(findings.every((finding) => finding.code === 'disl.notation' && finding.severity === 'warning')).toBe(true);
  });

  it('reads the notation of another tool type', () => {
    const { value } = interpret(mindmapJson());
    expect(Object.keys(value.nodes).length).toBeGreaterThan(0);
  });

  it('merges key by key, and replaces a list', () => {
    expect(merged({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, e: 2 })).toEqual({ a: { b: 1, c: [3] }, d: 1, e: 2 });
    expect(merged({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});
