import { describe, expect, it } from 'vitest';
import {
  allowsEnd, attributesOf, defaultOf, defaultsOf, formatYearMonth, interpretMetamodel, isA, isRelation, ordinal, parseYearMonth, valueKind, yearMonthOf, zeroOf,
} from '../../src/disl/metamodel';
import { loadSpecification } from '../../src/disl/specification';
import { hypeCycleJson, mindmapJson } from './tool';

const interpret = (json: unknown) => interpretMetamodel(loadSpecification(json).value);
const specification = (metamodel: object) => ({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel });

describe('the metamodel of the hype cycle graph', () => {
  const { value: metamodel, findings } = interpret(hypeCycleJson());

  it('is read without a finding', () => expect(findings).toEqual([]));

  it('has the diagram\'s own attribute, with its default', () => {
    expect(Object.keys(metamodel.diagram)).toEqual(['unit']);
    expect(defaultOf(metamodel.diagram.unit)).toBe('month');
    expect(defaultsOf(metamodel, 'diagram')).toEqual({ unit: 'month' });
  });

  it('has the enums in their order, with labels and stored forms', () => {
    expect(Object.keys(metamodel.enums)).toEqual(['TimeUnit', 'Phase', 'Edge']);
    expect(metamodel.enums.Phase).toMatchObject({ label: 'Phase', ordered: true, extensible: false });
    expect(metamodel.enums.Phase.values.map((value) => [value.key, value.stored, value.label])).toEqual([
      ['peak', 'peak', 'Peak'], ['trough', 'trough', 'Trough'], ['slope', 'slope', 'Slope'], ['plateau', 'plateau', 'Plateau'],
    ]);
    expect(metamodel.enums.Phase.values[0].color).toEqual({ token: 'ghg.peak' });
    expect(ordinal(metamodel, 'Phase', 'slope')).toBe(2);
    expect(ordinal(metamodel, 'Phase', 'summit')).toBe(-1);
    expect(metamodel.enums.Edge.ordered).toBe(false);
  });

  it('has the node types with their attributes, defaults and label attribute', () => {
    expect(Object.keys(metamodel.types)).toEqual(['Trend', 'Trigger', 'Note', 'Influence']);
    const trend = metamodel.types.Trend;
    expect(trend).toMatchObject({ kind: 'node', label: 'Trend', abstract: false, lineage: ['Trend'], labelAttribute: 'name' });
    expect(Object.keys(trend.attributes)).toEqual(['name', 'description', 'tags', 'start', 'stop', 'row', 'phases', 'peakEnd', 'troughEnd', 'slopeEnd']);
    expect(defaultsOf(metamodel, 'Trend')).toEqual({ row: 0, phases: 4 });
    expect(defaultsOf(metamodel, 'Note')).toEqual({ text: '', row: 0, width: 160, height: 64 });
    expect(metamodel.types.Note.labelAttribute).toBe('text');
    expect(trend.declared.bounds?.neighbour?.between).toEqual(['start', 'stop']);
  });

  it('has the relation with the types each end allows', () => {
    const influence = metamodel.types.Influence;
    expect(isRelation(influence)).toBe(true);
    expect(influence).toMatchObject({
      kind: 'relation', directed: true, allowSelfLoops: false, allowParallel: false,
      source: { types: ['Trend', 'Trigger'], optional: false }, target: { types: ['Trend'], optional: false },
    });
    expect(allowsEnd(metamodel, 'Influence', 'source', 'Trigger')).toBe(true);
    expect(allowsEnd(metamodel, 'Influence', 'target', 'Trigger')).toBe(false);
    expect(allowsEnd(metamodel, 'Trend', 'target', 'Trend')).toBe(false);
    expect(Object.keys(attributesOf(metamodel, 'Influence'))).toEqual(['fromPhase', 'fromEdge', 'fromAt', 'toPhase', 'toEdge', 'toAt', 'description']);
  });

  it('knows what the type of an attribute stands for, and its zero value', () => {
    const { attributes } = metamodel.types.Trend;
    expect(valueKind(metamodel, attributes.start.type)).toEqual({ kind: 'primitive', primitive: 'yearMonth' });
    expect(valueKind(metamodel, metamodel.diagram.unit.type)).toMatchObject({ kind: 'enum', enum: { name: 'TimeUnit' } });
    expect(valueKind(metamodel, 'Trend')).toEqual({ kind: 'reference', type: 'Trend' });
    expect(zeroOf(valueKind(metamodel, 'yearMonth'), false)).toBe(0);
    expect(zeroOf(valueKind(metamodel, 'text'), false)).toBe('');
    expect(zeroOf(valueKind(metamodel, 'string'), true)).toEqual([]);
    expect(zeroOf(valueKind(metamodel, 'Trend'), false)).toBeNull();
    expect(zeroOf(valueKind(metamodel, 'bool'), false)).toBe(false);
  });
});

describe('the metamodel of another tool type', () => {
  it('is read from the mind map\'s specification', () => {
    const { value: metamodel, findings } = interpret(mindmapJson());
    expect(findings).toEqual([]);
    expect(metamodel.types.Node.labelAttribute).toBe('text');
    expect(metamodel.enums.Side.values.map((value) => value.key)).toEqual(['right', 'left', 'bottom_or_right', 'top_or_left']);
    expect(defaultsOf(metamodel, 'Node')).toMatchObject({ text: '', folded: false });
  });
});

describe('inheritance', () => {
  const types = {
    Base: { abstract: true, labelAttribute: 'title', attributes: { title: { type: 'string' }, height: { type: 'number', default: 10 } } },
    Named: { abstract: true, attributes: { code: { type: 'string', key: true } } },
    Card: { extends: ['Base', 'Named'], attributes: { height: { type: 'number', fixed: 48 }, colour: { type: 'Shade', default: 'light' } } },
    Lone: { attributes: { count: { type: 'int' }, first: { type: 'string' }, needed: { type: 'string', required: true } } },
  };
  const relations = {
    Link: { abstract: true, source: 'Base', target: { types: ['Base'], exclude: ['Card'], optional: true, max: 1 }, allowParallel: false },
    Strong: { extends: 'Link', label: { en: 'Strong link', nl: 'Sterke verbinding' } },
  };
  const enums = { Shade: { values: { light: {}, dark: { value: 'very-dark', label: 'Dark' } } } };
  const dataTypes = { Percentage: { base: 'number' }, Money: { fields: { amount: { type: 'number' } } } };
  const { value: metamodel, findings } = interpret(specification({ types, relations, enums, dataTypes }));

  it('gives a type what its supertypes declare, the nearest first', () => {
    expect(findings).toEqual([]);
    expect(metamodel.types.Card.lineage).toEqual(['Card', 'Base', 'Named']);
    expect(Object.keys(metamodel.types.Card.attributes)).toEqual(['code', 'title', 'height', 'colour']);
    expect(metamodel.types.Card.labelAttribute).toBe('title');
    expect(isA(metamodel, 'Card', 'Named')).toBe(true);
    expect(isA(metamodel, 'Base', 'Card')).toBe(false);
    expect(isA(metamodel, 'Strong', 'Link')).toBe(true);
  });

  it('narrows a redeclared attribute: a fixed value replaces the default and is not a stored default', () => {
    expect(metamodel.types.Card.attributes.height).toEqual({ type: 'number', fixed: 48 });
    expect(defaultOf(metamodel.types.Card.attributes.height)).toBe(48);
    expect(defaultsOf(metamodel, 'Card')).toEqual({ colour: 'light' });
    expect(defaultsOf(metamodel, 'Base')).toEqual({ height: 10 });
  });

  it('picks the label attribute a type does not name: a key, a required string, the first string', () => {
    expect(metamodel.types.Named.labelAttribute).toBe('code');
    expect(metamodel.types.Lone.labelAttribute).toBe('needed');
  });

  it('lets a relation inherit its ends, expanded to subtypes without the excluded', () => {
    const strong = metamodel.types.Strong;
    expect(strong).toMatchObject({
      kind: 'relation', label: 'Strong link', allowParallel: false, allowSelfLoops: false, directed: true,
      source: { types: ['Base', 'Card'] }, target: { types: ['Base'], optional: true, max: 1 },
    });
    expect(interpretMetamodel(loadSpecification(specification({ types, relations })).value, 'nl').value.types.Strong.label).toBe('Sterke verbinding');
  });

  it('derives labels, stored forms and data types', () => {
    expect(metamodel.enums.Shade.values).toMatchObject([{ key: 'light', stored: 'light', label: 'Light' }, { key: 'dark', stored: 'very-dark', label: 'Dark' }]);
    expect(valueKind(metamodel, 'Percentage')).toEqual({ kind: 'primitive', primitive: 'number' });
    expect(valueKind(metamodel, 'Money')).toEqual({ kind: 'struct' });
    expect(valueKind(metamodel, 'Unheard')).toEqual({ kind: 'primitive', primitive: 'string' });
  });

  it('reports what cannot be placed, and keeps the type', () => {
    const broken = interpret(specification({
      types: { A: { extends: 'B' }, B: { extends: 'A' }, C: { extends: 'Nowhere' }, R: {} },
      relations: { R: { source: 'A', target: 'Gone' } },
    }));
    expect(Object.keys(broken.value.types)).toEqual(['A', 'B', 'C', 'R']);
    expect(broken.value.types.C.lineage).toEqual(['C']);
    const messages = broken.findings.map((finding) => finding.message).join('\n');
    expect(messages).toContain('`R` is declared as a node type and as a relation type');
    expect(messages).toContain('extends itself');
    expect(messages).toContain('`C` extends `Nowhere`');
    expect(messages).toContain('names `Gone`');
    expect(broken.findings.every((finding) => finding.code === 'disl.metamodel' && finding.severity === 'error')).toBe(true);
  });
});

describe('year and month', () => {
  it('reads the stored form as a month index', () => {
    expect(parseYearMonth('0000-01')).toBe(0);
    expect(parseYearMonth('-0001-12')).toBe(-1);
    expect(parseYearMonth('2026-09')).toBe(2026 * 12 + 8);
    expect(parseYearMonth('-3200-01')).toBe(-3200 * 12);
    for (const text of ['2026-13', '2026-00', '26-09', '2026-9', '19xx-01', '2026-09-01', '']) expect(parseYearMonth(text)).toBeUndefined();
  });

  it('writes a month index as it is stored', () => {
    expect(formatYearMonth(0)).toBe('0000-01');
    expect(formatYearMonth(-1)).toBe('-0001-12');
    expect(formatYearMonth(2026 * 12 + 8)).toBe('2026-09');
    expect(formatYearMonth(-3200 * 12)).toBe('-3200-01');
    expect(yearMonthOf(-13)).toEqual({ year: -2, month: 12 });
  });
});
