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

describe('the internal properties of the Gartner hype cycle graph', () => {
  it('are the order of the rows, the rows, the sizes, the handles of the shape and the anchoring of the ends', () => {
    expect(internalOf()).toEqual(['Order', 'row', 'peak-end', 'trough-end', 'slope-end', 'width', 'height', 'from-phase', 'from-edge', 'from-at', 'to-phase', 'to-edge', 'to-at']);
  });

  it('differ from the list of FR-036 in one property: the place of a note on the time axis, which is a date', () => {
    const found = internalOf();
    expect(listed.filter((name) => !found.includes(name))).toEqual(['at']);
    expect(found.filter((name) => !listed.includes(name))).toEqual([]);
    expect(found.filter((name) => shown.includes(name))).toEqual([]);
  });
});

describe('the rule', () => {
  it('takes a place on an axis that is no time axis for internal, and one on a time axis for shown', () => {
    const linear = internalOf((specification) => void (specification.coordinates.axes.time.kind = 'linear'));
    expect(linear).toEqual(expect.arrayContaining(['at', 'start', 'stop', 'date']));
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
