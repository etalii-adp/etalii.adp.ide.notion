import { describe, expect, it } from 'vitest';
import { internalProperties } from '../../src/store/internal';
import { storeSchema } from '../../src/store/schema';
import { hypeCycleJson, tool } from '../disl/tool';

// Which properties are internal (etalii.adp spec 012, FR-036), as the rule of src/store/internal.ts
// finds them from the specification the add-on ships.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function internalOf(change: (specification: Json) => void = () => undefined): string[] {
  const source = hypeCycleJson() as Json;
  change(source);
  const { specification, metamodel, persistence, binding } = tool(source);
  return internalProperties(specification, metamodel, persistence, storeSchema(binding, metamodel, persistence));
}

// FR-036 as the maintainer listed it.
const listed = ['Order', 'row', 'at', 'width', 'height', 'peak-end', 'trough-end', 'slope-end', 'from-phase', 'from-edge', 'from-at', 'to-phase', 'to-edge', 'to-at'];
const shown = ['id', 'name', 'Kind', 'description', 'tags', 'start', 'stop', 'date', 'phases', 'text', 'from', 'to', 'unit'];

/** The item of a declared form that edits an attribute. */
function fieldOf(specification: Json, form: string, attribute: string): Json {
  const among = (items: Json[]): Json | undefined => items.flatMap((item) => [item, ...(item.items ? [among(item.items)] : [])]).find((item) => item?.attribute === attribute);
  return among(specification.forms[form].items)!;
}

describe('the internal properties of the Gartner hype cycle graph', () => {
  it('are the fourteen of FR-036, in the order of the schema', () => {
    const found = internalOf();
    expect(found).toEqual(['Order', 'row', 'peak-end', 'trough-end', 'slope-end', 'at', 'width', 'height', 'from-phase', 'from-edge', 'from-at', 'to-phase', 'to-edge', 'to-at']);
    expect([...found].sort()).toEqual([...listed].sort());
  });

  it('are none of the properties that say what the graph is about', () => {
    expect(internalOf().filter((name) => shown.includes(name))).toEqual([]);
    expect([...listed, ...shown].sort()).toEqual(storeSchema(tool().binding, tool().metamodel, tool().persistence).properties.map((property) => property.name).sort());
  });
});

describe('the rule', () => {
  it('takes every place on an axis that is no time axis for internal', () => {
    const linear = internalOf((specification) => void (specification.coordinates.axes.time.kind = 'linear'));
    expect(linear).toEqual(expect.arrayContaining(['at', 'start', 'stop', 'date']));
  });

  it('shows a place on a time axis only where a form offers it as a field', () => {
    // A form that offers the date of a note makes it a date of the domain.
    expect(internalOf((specification) => void specification.forms.note.items.push({ attribute: 'at', label: 'Date' }))).not.toContain('at');
    // Shown, computed or read-only, it is not offered; and neither is a field that is taken out.
    expect(internalOf((specification) => void specification.forms.note.items.push({ kind: 'computed', attribute: 'at', value: { attribute: 'at' } }))).toContain('at');
    expect(internalOf((specification) => void specification.forms.note.items.push({ attribute: 'at', readOnly: true }))).toContain('at');
    expect(internalOf((specification) => void (fieldOf(specification, 'trigger', 'date').readOnly = true))).toContain('date');
    expect(internalOf((specification) => void (fieldOf(specification, 'trend', 'start').kind = 'computed'))).toContain('start');
    expect(internalOf((specification) => void delete specification.forms.trend)).toEqual(expect.arrayContaining(['start', 'stop']));
  });

  it('keeps what a handle of a shape sets internal, though a form offers it as a field', () => {
    expect(fieldOf(hypeCycleJson() as Json, 'trend', 'peakEnd')).toBeDefined();
    expect(internalOf()).toContain('peak-end');
  });

  it('shows a property that is internal for one kind and not for another', () => {
    // The trigger's date placed on the rows: the property of the rows is no longer internal for every kind.
    const found = internalOf((specification) => void (specification.notation.nodes.Trigger.placement.y = { attribute: 'date' }));
    expect(found).not.toContain('row');
  });

  it('finds nothing but the order of the rows where the notation binds nothing', () => {
    expect(internalOf((specification) => {
      specification.notation.nodes = {};
      specification.notation.edges = {};
    })).toEqual(['Order']);
  });
});
