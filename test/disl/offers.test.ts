// Every tool, gesture, operation and context action the specification offers can be made (etalii.adp
// spec 012-notion-hype-cycle-addon, FR-015, SC-006). The list is read from the specification
// itself, so an offer that is added to it is tried here without a change to this file, apart from
// the value a new row of a form is given.
//
// The first layer makes each one as a change to a model, through the interpreted behavior. The
// second layer makes the same list against the in-memory Notion: each intent's changes become one
// edit of an open document, and the rows are read again afterwards.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arrangedRows, createScene } from '../../src/canvas/scene';
import { applyChanges, interpretBehavior, type Change, type Outcome, type Pending } from '../../src/disl/behavior';
import { interpretConstraints } from '../../src/disl/constraints';
import { interpretCoordinates } from '../../src/disl/coordinates';
import { formFor, interpretForms, rowsOf } from '../../src/disl/forms';
import { interpretLayout } from '../../src/disl/layout';
import { parseYearMonth } from '../../src/disl/metamodel';
import type { Model } from '../../src/disl/model';
import { interpretNotation } from '../../src/disl/notation';
import { interpretToolbox } from '../../src/disl/toolbox';
import { interpretViewpoints } from '../../src/disl/viewpoints';
import { modelChangesOf } from '../../src/store/changes';
import { storeOf } from '../../src/store/document';
import { openExample } from '../support/openExample';
import { hypeCycleJson, tool } from './tool';

type Json = Readonly<Record<string, unknown>>;
const object = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});
const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const at = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((node, step) => object(node)[step], value);

const { specification, metamodel, persistence, expressions, fixture } = tool();
const notation = interpretNotation(specification, metamodel).value;
const coordinates = interpretCoordinates(specification, metamodel).value;
const layout = interpretLayout(specification).value;
const viewpoints = interpretViewpoints(specification, metamodel, { notation, coordinates, layout }).value;
const constraints = interpretConstraints(specification, metamodel, expressions).value;
const forms = interpretForms(specification, metamodel, expressions).value;
const scene = { metamodel, expressions, coordinates, viewpoints };
const behavior = interpretBehavior(specification, metamodel, expressions, {
  constraints, layout, coordinates, persistence, notation, viewpoints,
  toolbox: interpretToolbox(specification, metamodel).value,
  rows: (config, model) => arrangedRows(scene, model, createScene(scene, model), config),
}).value;

const trueTime = { env: { viewpoint: 'trueTime' } };
const point = { x: 250, y: 300 };
const month = (text: string): number => parseYearMonth(text)!;

// The graph every offer is made on: triggers and notes beside two trends, one with a boundary that
// was dragged, so that what is offered only for a stored boundary is offered too.
const setup = (model: Model): readonly Change[] => {
  const outcome = behavior.dragHandle(model, 'transistors', 'b1', 0.25, trueTime);
  if (outcome.refused !== undefined) throw new Error(outcome.refused);
  return outcome.changes;
};
const read = fixture('triggers-and-notes').value;
const model = applyChanges(read, setup(read));

// ---- the list, read from the specification ----

interface Offer {
  readonly group: 'tool' | 'gesture' | 'operation' | 'context action';
  readonly name: string;
  make(on: Model): Outcome;
}

// The value each row of a form is given. A row that is added to a form needs one here.
const entered: Readonly<Record<string, string>> = {
  'trend/name': 'Valves', 'trend/description': 'Before the transistor.', 'trend/tags': 'a, b', 'trend/start': '1951-01', 'trend/stop': '1991-01',
  'trend/phases': 'Peak and Trough', 'trend/peakEnd': '1961-01', 'trend/troughEnd': '1971-01', 'trend/slopeEnd': '1981-01',
  'trigger/name': 'Point contact', 'trigger/description': 'At Bell Labs.', 'trigger/tags': 'physics', 'trigger/date': '1948-01',
  'note/text': 'Changed', 'note/Size': '200 x 80',
  'influence/description': 'Cheap receivers.', 'influence/From attachment': 'plateau/bottom/0.3', 'influence/To attachment': 'trough/top/0.25',
};

const json = hypeCycleJson();
const all = (on: Model) => [...on.elements, ...on.relations];
const first = (on: Model, type: string): string => all(on).find((element) => element.type === type)!.id;
const typeOf = (on: Model, id: string | undefined): string | undefined => all(on).find((element) => element.id === id)?.type;
const pendingOn = (on: Model, relation: string): Pending => {
  // Two elements the relation may connect and does not yet: its target type's, the later to the earlier.
  const target = String(array(at(json, 'metamodel', 'relations', relation, 'target'))[0] ?? at(json, 'metamodel', 'relations', relation, 'target'));
  const [earlier, later] = on.elements.filter((element) => element.type === target);
  return { source: later.id, target: earlier.id };
};

function offersOf(): Offer[] {
  const offers: Offer[] = [];
  const gesture = (name: string, make: Offer['make']): void => void offers.push({ group: 'gesture', name, make });

  for (const group of array(at(json, 'toolbox', 'groups'))) {
    for (const entry of array(at(group, 'tools'))) {
      const id = String(at(entry, 'id'));
      offers.push({ group: 'tool', name: id, make: (on) => behavior.create(on, id, point, trueTime) });
    }
  }

  for (const [type, node] of Object.entries(object(at(json, 'notation', 'nodes')))) {
    if (at(node, 'placement', 'movable') !== false) gesture(`move a ${type}`, (on) => behavior.move(on, [first(on, type)], { x: 8, y: 56 }, trueTime));
    if (at(node, 'placement', 'resizable') !== false && at(node, 'size', 'resizable') !== false) gesture(`resize a ${type}`, (on) => behavior.resize(on, first(on, type), { right: 8 }, trueTime));
    const handles = array(at(json, 'notation', 'shapes', String(at(node, 'shape', 'type')), 'handles'));
    handles.forEach((handle, index) => {
      const param = String(at(handle, 'param'));
      // Each handle a little after the place it has when all of them are spread evenly.
      gesture(`drag the handle ${param} of a ${type}`, (on) => behavior.dragHandle(on, first(on, type), param, (index + 1) / (handles.length + 1) + 0.05, trueTime));
    });
    for (const label of array(at(node, 'labels'))) {
      const id = String(at(label, 'id'));
      if (at(label, 'editable') !== false) gesture(`edit the label ${id} of a ${type} in place`, (on) => behavior.editLabel(on, first(on, type), 'Changed', trueTime, id));
    }
  }

  for (const [type, edge] of Object.entries(object(at(json, 'notation', 'edges')))) {
    for (const side of ['source', 'target'] as const) {
      const anchor = at(edge, 'anchoring', side);
      if (at(anchor, 'movable') !== true) continue;
      // A place the end is not at now: the second value of the enum each bound attribute has.
      const value = (key: string): string => {
        const attribute = at(json, 'metamodel', 'relations', type, 'attributes', String(at(anchor, key, 'attribute')));
        return Object.keys(object(at(json, 'metamodel', 'enums', String(at(attribute, 'type')), 'values')))[1];
      };
      gesture(`move the ${side} end of an ${type}`, (on) => {
        // An end can be moved where it is on an element with parts: a relation between two elements of one type.
        const relation = on.relations.find((candidate) => candidate.type === type && typeOf(on, candidate.source) === typeOf(on, candidate.target))!;
        return behavior.reattach(on, relation.id, side, { part: value('part'), side: value('side'), at: 0.75 }, trueTime);
      });
    }
  }

  const menus = array(at(json, 'toolbox', 'contextMenus'));
  for (const set of menus.filter((candidate) => array(at(candidate, 'for')).includes('connection'))) {
    for (const entry of array(at(set, 'tools'))) {
      const via = String(at(entry, 'via'));
      gesture(`draw an ${via} from one element to another`, (on) => {
        const pending = pendingOn(on, via);
        return behavior.connect(on, via, pending.source, pending.target, undefined, trueTime);
      });
    }
  }

  for (const [id, form] of Object.entries(object(at(json, 'forms')))) {
    const type = String(at(form, 'for'));
    const editable = (items: readonly unknown[]): unknown[] => items.flatMap((item) => [...(at(item, 'attribute') !== undefined || at(item, 'parse') !== undefined ? [item] : []), ...editable(array(at(item, 'items')))]);
    for (const item of editable(array(at(form, 'items')))) {
      const row = String(at(item, 'id') ?? at(item, 'attribute') ?? at(item, 'label'));
      gesture(`enter the ${row} of a ${type} in the property grid`, (on) => {
        const subject = { model: on, element: first(on, type), env: trueTime.env };
        const found = rowsOf(formFor(forms, type).items).find((candidate) => candidate.rowId(subject) === row);
        if (!found || !Object.hasOwn(entered, `${id}/${row}`)) return { refused: `The row ${id}/${row} has no value to enter in this test.` };
        return found.visible(subject) ? behavior.edit(on, subject.element, found, entered[`${id}/${row}`], trueTime) : { refused: `The row ${id}/${row} is not shown.` };
      });
    }
  }

  for (const [id, operation] of Object.entries(object(at(json, 'behavior', 'operations')))) {
    const target = String(at(operation, 'for'));
    offers.push({ group: 'operation', name: id, make: (on) => behavior.operate(on, id, target === 'diagram' ? [] : [first(on, target)], trueTime, point) });
  }

  for (const set of menus) {
    for (const target of array(at(set, 'for')).map(String)) {
      for (const entry of array(at(set, 'tools'))) {
        const kind = String(at(entry, 'kind'));
        const operation = at(entry, 'operation') as string | undefined;
        const via = at(entry, 'via') as string | undefined;
        offers.push({
          group: 'context action', name: `${String(at(entry, 'label'))} on ${target === 'diagram' ? 'the empty canvas' : target === 'connection' ? 'a pending connection' : `a ${target}`}`,
          make: (on) => {
            const pending = target === 'connection' ? pendingOn(on, via ?? '') : undefined;
            const element = target === 'diagram' || target === 'connection' ? undefined : first(on, target);
            // It is in the menu of its target, and enabled there.
            const shown = behavior.menu(on, pending ?? element, trueTime).groups.flat().find((candidate) => candidate.kind === kind && candidate.operation === operation && candidate.label === at(entry, 'label'));
            if (!shown?.enabled) return { refused: shown?.reason ?? 'It is not in the menu.' };
            if (pending) return behavior.connect(on, via ?? '', pending.source, pending.target, undefined, trueTime);
            if (kind === 'operation') return behavior.operate(on, operation ?? '', element === undefined ? [] : [element], trueTime, point);
            if (element !== undefined && kind === 'editLabel') return behavior.editLabel(on, element, 'Changed', trueTime);
            return element !== undefined && kind === 'delete' ? behavior.remove(on, [element], trueTime) : { refused: `This test does not know how a \`${kind}\` is made.` };
          },
        });
      }
    }
  }
  return offers;
}

const offers = offersOf();

// ---- the first layer: as a change to a model ----

describe('what the specification offers', () => {
  it('is 3 tools, 32 gestures, 5 operations and 17 context actions', () => {
    const count = (group: Offer['group']): number => offers.filter((offer) => offer.group === group).length;
    expect([count('tool'), count('gesture'), count('operation'), count('context action'), offers.length]).toEqual([3, 32, 5, 17, 57]);
    expect(new Set(offers.map((offer) => `${offer.group}: ${offer.name}`)).size).toBe(offers.length);
  });

  it('has, among its gestures, 14 on the canvas and 18 in the property grid', () => {
    const gestures = offers.filter((offer) => offer.group === 'gesture').map((offer) => offer.name);
    expect(gestures.filter((name) => name.endsWith('in the property grid'))).toHaveLength(18);
    expect(gestures.filter((name) => !name.endsWith('in the property grid'))).toEqual([
      'move a Trend', 'resize a Trend', 'drag the handle b1 of a Trend', 'drag the handle b2 of a Trend', 'drag the handle b3 of a Trend', 'edit the label name of a Trend in place',
      'move a Trigger', 'edit the label name of a Trigger in place',
      'move a Note', 'resize a Note', 'edit the label text of a Note in place',
      'move the source end of an Influence', 'move the target end of an Influence', 'draw an Influence from one element to another',
    ]);
  });
});

describe('every offer of the specification, made as a change to a model', () => {
  const before = constraints.check(model).map((finding) => finding.message);

  it.each(offers)('$group: $name', ({ make }) => {
    const outcome = make(model);
    expect(outcome.refused).toBeUndefined();
    if (outcome.refused !== undefined) return;
    // It changes the model, the changes come to the model it says, and it breaks no rule that held.
    expect(outcome.changes.length).toBeGreaterThan(0);
    expect(outcome.after).toEqual(applyChanges(model, outcome.changes));
    expect(outcome.after).not.toEqual(model);
    expect(constraints.check(outcome.after).map((finding) => finding.message).filter((message) => !before.includes(message))).toEqual([]);
  });

  it('is 0 that cannot be done', () => {
    expect(offers.filter((offer) => offer.make(model).refused !== undefined).map((offer) => `${offer.group}: ${offer.name}`)).toEqual([]);
  });
});

// ---- where the hosts do what the specification does not state ----

// Each of these is made as the specification says. What the hosts do beside it is their own code,
// and is raised as an issue in etalii.adp, not built into the interpreter.
describe('an edit the hosts carry out differently from what the specification states', () => {
  const changed = (outcome: Outcome): readonly Change[] => (outcome.refused === undefined ? outcome.changes : []);
  const row = (type: string, id: string) => rowsOf(formFor(forms, type).items).find((candidate) => candidate.rowId({ model }) === id)!;

  it('a name with spaces around it: the hosts write it trimmed, and the specification trims only the label of the type whose label has a `parse`', () => {
    // The hosts write `Solid state` for all three.
    expect(changed(behavior.editLabel(model, 'transistors', ' Solid state ', trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { name: ' Solid state ' } }]);
    expect(changed(behavior.edit(model, 'transistors', row('Trend', 'name'), ' Solid state ', trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { name: ' Solid state ' } }]);
    expect(changed(behavior.edit(model, 'transistor-invented', row('Trigger', 'name'), ' Solid state ', trueTime))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { name: ' Solid state ' } }]);
    expect(changed(behavior.editLabel(model, 'transistor-invented', ' Solid state ', trueTime))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { name: 'Solid state' } }]);
  });

  it('a description of spaces alone: the hosts remove the description, and the specification states nothing', () => {
    // The hosts remove the key, as for an empty text.
    expect(changed(behavior.edit(model, 'transistor-invented', row('Trigger', 'description'), ' ', trueTime))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { description: ' ' } }]);
  });

  it('a size entered with a month and a row: the hosts move the note there too, and the specification\'s `write` sets the size alone', () => {
    // The hosts also write `at: 1961-01` and `row: 6`. The item's `accepts` takes the text, and its `write` reads two numbers of it.
    expect(changed(behavior.edit(model, 'note-2', row('Note', 'Size'), '200 x 80 at 1961-01 row 6', trueTime))).toEqual([{ kind: 'set', id: 'note-2', attributes: { width: 200, height: 80 } }]);
  });

  it('a dropped trend or trigger: the hosts select it, and the specification says nothing follows the drop', () => {
    expect(behavior.create(model, 'trend', point, trueTime)).toMatchObject({ effects: [] });
    expect(behavior.create(model, 'trigger', point, trueTime)).toMatchObject({ effects: [] });
  });

  it('an add at a point of the empty canvas takes the row a drop there takes, only while the point it is given is not snapped', () => {
    // DISL 7.3 says the point is snapped as a drop would be, and 5.9 that a drop snaps by the type it
    // creates, which an operation's `position` does not know. Snapped by the coordinate system alone,
    // a point in the lower part of a row would be the next row: the hosts, and this, give row 5.
    const low = { x: point.x, y: 5 * 56 + 40 };
    const added = (operation: string): unknown => at(changed(behavior.operate(model, operation, [], trueTime, low))[0], 'attributes', 'row');
    expect([added('addTrendHere'), added('addTriggerHere'), added('addNoteHere')]).toEqual([5, 5, 5]);
    expect(at(changed(behavior.create(model, 'trend', low, trueTime))[0], 'attributes', 'row')).toBe(5);
  });

  it('a handle is dragged to a share of the width, which the specification\'s handles do not derive from the pointer', () => {
    // DISL 6.8: without `value`, a handle's new value is the pointer's coordinate along its axis, in
    // canvas units. The handles of the specification state no `value`, and their `snap` and `write`
    // read a share from 0 to 1. The gesture gives the share: 0.25 of 40 years from 1950 is 1960.
    expect(array(at(json, 'notation', 'shapes', 'phasedBanner', 'handles')).map((handle) => at(handle, 'value'))).toEqual([undefined, undefined, undefined]);
    expect(changed(behavior.dragHandle(read, 'transistors', 'b1', 0.25, trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { peakEnd: month('1960-01') } }]);
  });
});

// ---- the second layer: against the in-memory Notion ----

// The fixture put into an in-memory Notion and opened as the frame opens it. `apply` carries the
// changes of one intent out as one edit of the document, waits until its writes are stored, and
// answers with the model the database then holds, read whole, or with the sentence of a refusal.
interface Stored {
  readonly model: Model;
  apply(changes: readonly Change[]): Promise<{ readonly model: Model } | { readonly refused: string }>;
}
async function openStore(): Promise<Stored> {
  const example = await openExample(readFileSync('test/fixtures/gartner-hype-cycle-graph/triggers-and-notes.ghg'));
  const { document } = example;
  return {
    get model() {
      return document.model;
    },
    async apply(changes) {
      const steps = modelChangesOf(changes, storeOf(document), document.model);
      if ('refused' in steps) return steps;
      const result = await example.apply(steps);
      if (!result.done) return { refused: result.sentence };
      const failed = example.events.find((event) => event.kind === 'reloaded');
      if (failed?.kind === 'reloaded') return { refused: failed.sentence };
      return { model: (await example.reopen()).model };
    },
  };
}

// A model as the store and the interpreter must agree on it: what each element is and holds. In a
// store an empty property is an absent key (contracts/store.md), so an empty text or list is none.
const held = (attributes: Model['diagram']) => Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== '' && !(Array.isArray(value) && value.length === 0)));
const comparable = (on: Model) => ({
  diagram: held(on.diagram),
  elements: all(on).map((element) => ({ id: element.id, type: element.type, attributes: held(element.attributes), source: 'source' in element ? element.source : undefined, target: 'target' in element ? element.target : undefined }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});

describe('every offer of the specification, made against the in-memory Notion', () => {
  const made = async ({ make }: Offer): Promise<string | undefined> => {
    const store = await openStore();
    const prepared = await store.apply(setup(store.model));
    if ('refused' in prepared) return prepared.refused;
    const outcome = make(prepared.model);
    if (outcome.refused !== undefined) return outcome.refused;
    const stored = await store.apply(outcome.changes);
    if ('refused' in stored) return stored.refused;
    // What the rows hold afterwards is the model the interpreter said the intent comes to.
    expect(comparable(stored.model)).toEqual(comparable(outcome.after));
    return undefined;
  };

  it.each(offers)('$group: $name', async (offer) => {
    expect(await made(offer)).toBeUndefined();
  });
});
