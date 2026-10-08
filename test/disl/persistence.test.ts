import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../../src/fbl/documents/documentLoader';
import { interpretMetamodel, parseYearMonth } from '../../src/disl/metamodel';
import { bindingOf, fromStored, interpretPersistence, newId, toBinding, toStored } from '../../src/disl/persistence';
import { loadSpecification, type Specification } from '../../src/disl/specification';
import { hypeCycleJson, mindmapJson, tool } from './tool';

const ym = (text: string): number => parseYearMonth(text)!;

describe('the persistence of the hype cycle graph', () => {
  const { specification, metamodel, persistence, binding } = tool();

  it('names the binding and its fragment', () => {
    expect(interpretPersistence(specification, metamodel).findings).toEqual([]);
    expect(persistence.format).toBe('fbl');
    expect(persistence.binding).toEqual({
      document: 'https://raw.githubusercontent.com/etalii-adp/etalii.adp.ide.standalone/develop/src/diagrams/gartner-hype-cycle-graph/backend/EtAlii.Adp.Diagram.GartnerHypeCycleGraph/gartner-hype-cycle-graph.fbl',
      file: 'gartner-hype-cycle-graph.fbl',
      name: 'ghg',
    });
    expect(binding.name).toBe('ghg');
    const document = loadDocument(readFileSync('addons/gartner-hype-cycle-graph/gartner-hype-cycle-graph.fbl')).document!;
    expect(bindingOf({ ...persistence, binding: { ...persistence.binding!, name: 'other' } }, document)).toBeUndefined();
  });

  it('has the id strategy with its defaults filled in, and makes ids by it', () => {
    expect(persistence.ids).toMatchObject({ strategy: 'uuid-v4', encoding: 'base36', stable: true, missing: 'assign', compare: 'exact', pattern: '^[A-Za-z0-9_.:#-]{1,128}$' });
    const ids = [newId(persistence, 'Trend'), newId(persistence, 'Trend')];
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{25}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(new RegExp(persistence.ids.pattern).test(ids[0])).toBe(true);
  });

  it('has the type map and what of the view each viewer keeps', () => {
    expect(Object.keys(persistence.typeMap)).toEqual(['Graph', 'Unit', 'Trend', 'Trigger', 'Note', 'Influence', 'Unreadable']);
    expect(persistence.typeMap.Influence).toMatchObject({ as: 'Influence', attributes: { from: 'source', to: 'target' }, hostAttributes: ['storedId', 'unknownKeys'] });
    expect(persistence.view).toEqual({ store: [], viewer: ['viewpoint', 'filters', 'viewport'] });
  });
});

describe('the persistence of another tool type', () => {
  it('is read from the mind map\'s specification, with its prefix on new ids', () => {
    const specification = loadSpecification(mindmapJson()).value;
    const { value, findings } = interpretPersistence(specification, interpretMetamodel(specification).value);
    expect(findings).toEqual([]);
    expect(value.binding).toMatchObject({ file: 'mindmap.fbl', name: 'mindmap' });
    expect(newId(value, 'Node')).toMatch(/^ID_[0-9a-z]{25}$/);
  });

  it('writes the other encodings and a prefix for each type', () => {
    const { persistence } = tool();
    expect(newId({ ...persistence, ids: { ...persistence.ids, encoding: 'hex', prefix: { Trend: 'tr_' } } }, 'Trend')).toMatch(/^tr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newId({ ...persistence, ids: { ...persistence.ids, encoding: 'base64url', prefix: { Trend: 'tr_' } } }, 'Note')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('reports what it does not support', () => {
    const base = hypeCycleJson() as Specification;
    const interpret = (persistence: object) => {
      const specification = loadSpecification({ ...base, persistence }).value;
      return interpretPersistence(specification, interpretMetamodel(specification).value);
    };
    expect(interpret({}).findings.map((finding) => finding.severity)).toEqual(['error', 'warning']);
    expect(interpret({ format: 'fbl', binding: 'no-fragment.fbl', ids: { strategy: 'uuid-v4' } }).findings).toMatchObject([{ code: 'disl.persistence', severity: 'error' }]);
    const mapped = interpret({ format: 'fbl', binding: 'a.fbl#a', ids: { strategy: 'natural', types: {} }, typeMap: { Thing: { as: 'Gone' } } });
    expect(mapped.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('`Gone`'), expect.stringContaining('`natural`'), expect.stringContaining('single types')]);
    expect(mapped.value.binding).toEqual({ document: 'a.fbl', file: 'a.fbl', name: 'a' });
  });
});

describe('a document read into the model', () => {
  const { read, fixture } = tool();

  it('types elements, relations and the diagram by the metamodel\'s names', () => {
    const { value: model, findings } = fixture('triggers-and-notes');
    expect(findings).toEqual([]);
    expect(model.diagram).toEqual({ unit: 'year' });
    expect(model.elements.map((element) => [element.id, element.type])).toEqual([
      ['transistors', 'Trend'], ['radio', 'Trend'], ['transistor-invented', 'Trigger'], ['note-1', 'Note'], ['note-2', 'Note'],
    ]);
    expect(model.elements[0]).toEqual({
      id: 'transistors', type: 'Trend', ephemeral: false, line: 5, parent: undefined,
      attributes: { name: 'Transistors', start: ym('1950-01'), stop: ym('1990-01'), row: 1, phases: 4 },
      host: { storedId: 'transistors', unknownKeys: [] },
    });
    expect(model.elements[2].attributes).toEqual({
      name: 'Transistor invented', date: ym('1947-12'), row: 1, tags: ['electronics', 'invention'], description: 'Bardeen, Brattain and Shockley at Bell Labs.',
    });
    expect(model.elements[3].attributes).toEqual({ text: 'Dates are illustrative.\n\nSee the readme.', at: ym('1950-01'), row: 3, width: 160, height: 64 });
    expect(model.relations.map((relation) => [relation.id, relation.type, relation.source, relation.target])).toEqual([
      ['i-12', 'Influence', 'transistor-invented', 'transistors'], ['i-13', 'Influence', 'transistors', 'radio'],
    ]);
    expect(model.relations[1].attributes).toEqual({ fromPhase: 'slope', fromEdge: 'bottom', fromAt: 0.5, toPhase: 'peak', toEdge: 'top', toAt: 0.1 });
    expect(model.relations[0].attributes).not.toHaveProperty('from');
  });

  it('keeps a relation whose end names nothing, with that end unset, and reports it', () => {
    const { value: model, findings } = fixture('rule-dangling-reference');
    expect(model.relations).toMatchObject([{ id: 'ax', source: 'a', target: undefined }]);
    expect(findings).toMatchObject([{ code: 'std.references', severity: 'error', element: 'ax', detail: { missingId: 'x', end: 'target' }, location: { line: 21, column: 9 } }]);
  });

  it('gives a later holder of an id an id of its place, and says how often the id is held', () => {
    const { value: model, findings } = fixture('rule-duplicate-id');
    expect(model.elements.map((element) => [element.id, element.ephemeral, element.host.storedId])).toEqual([['a', false, 'a'], ['b', false, 'b'], ['trend@15', true, 'a']]);
    expect(findings).toMatchObject([{ code: 'std.duplicateId', element: 'trend@15', detail: { id: 'a', count: 2 } }]);
  });

  it('leaves out a value that is not of its attribute\'s type, and an entry that is no element, and reports each', () => {
    const { value: model, findings } = fixture('malformed-entries');
    expect(model.elements.map((element) => element.id)).toEqual(['good', 'odd']);
    expect(model.elements[1].attributes).toEqual({ name: 'Odd', stop: ym('1910-01') });
    expect(model.elements[1].host).toEqual({ storedId: 'odd', unknownKeys: ['colour'] });
    expect(findings.map((finding) => [finding.code, finding.location.line, finding.element, finding.detail?.reason])).toEqual([
      ['std.unreadableEntry', 9, 'odd', expect.stringContaining('`start` of `odd` is not a value of the type `yearMonth`')],
      ['std.unreadableEntry', 9, 'odd', expect.stringContaining('`row` of `odd`')],
      ['std.unreadableEntry', 9, 'odd', expect.stringContaining('`phases` of `odd`')],
      ['std.unreadableEntry', 16, undefined, 'This entry is not a mapping, so it is kept as it is.'],
    ]);
    expect(model.relations).toMatchObject([{ id: 'link', source: 'good', target: 'odd' }]);
  });

  it('gives an empty model and the library\'s finding for a document that cannot be parsed', () => {
    const { value: model, findings } = fixture('not-yaml');
    expect(model).toEqual({ diagram: {}, elements: [], relations: [] });
    expect(findings).toMatchObject([{ code: 'std.unparseable', severity: 'error' }]);
  });

  it('reads every fixture of the tool type without throwing', () => {
    for (const name of ['crlf-line-endings', 'lf-line-endings', 'no-trailing-newline', 'rules-clean', 'rule-unreadable-entry', 'rule-duplicate-hidden', 'rule-note-position', 'rule-trigger-date', 'rule-bad-attachment']) {
      const { value: model } = fixture(name);
      expect(model.elements.length, name).toBeGreaterThan(0);
    }
    expect(fixture('rules-clean').findings).toEqual([]);
  });

  it('keeps an enum value that is not one of the enum as it is written, and reads a number written as a name', () => {
    const { value: model, findings } = read('gartner-hypecycle-graph: 1\nunit: aeon\ntrends:\n  - id: t\n    name: 2024\n    start: 2000-01\n    stop: 2001-01\n    tags: steam\n');
    expect(model.diagram).toEqual({ unit: 'aeon' });
    expect(model.elements[0].attributes).toMatchObject({ name: '2024' });
    expect(findings).toMatchObject([{ code: 'std.unreadableEntry', element: 't', detail: { reason: expect.stringContaining('`tags` of `t`') } }]);
  });
});

describe('a change on its way to the binding', () => {
  const { binding, metamodel, persistence } = tool();

  it('names a relation\'s ends and its attributes as the binding does, with the library\'s values', () => {
    expect(toBinding(binding, metamodel, persistence, 'Influence', { source: 'a', target: 'b', toPhase: 'peak', toAt: 0.5, description: undefined })).toEqual({
      type: 'Influence', attributes: { from: 'a', to: 'b', toPhase: 'peak', toAt: 0.5, description: null },
    });
    expect(toBinding(binding, metamodel, persistence, 'Trend', { start: ym('2000-01'), phases: 3, tags: ['x'], name: 'N' })).toEqual({
      type: 'Trend', attributes: { start: '2000-01', phases: 3n, tags: ['x'], name: 'N' },
    });
  });

  it('finds the binding type the diagram\'s attribute is read from', () => {
    expect(toBinding(binding, metamodel, persistence, 'diagram', { unit: 'year' })).toEqual({ type: 'Unit', attributes: { value: 'year' } });
    expect(toBinding(binding, metamodel, persistence, 'Nothing', {})).toBeUndefined();
  });

  it('turns a value back into what was read', () => {
    const { attributes } = metamodel.types.Trend;
    for (const [name, stored] of [['start', '-0044-03'], ['phases', 2n], ['name', 'A'], ['tags', ['a', 'b']]] as const) {
      expect(toStored(fromStored(stored, attributes[name], metamodel)!, attributes[name], metamodel)).toEqual(stored);
    }
    expect(fromStored(1.5, attributes.phases, metamodel)).toBeUndefined();
    expect(fromStored(3n, metamodel.types.Note.attributes.width, metamodel)).toBe(3);
    expect(fromStored('wide', metamodel.types.Note.attributes.width, metamodel)).toBeUndefined();
    expect(fromStored(['a', ['b']], attributes.tags, metamodel)).toBeUndefined();
  });
});
