import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/disl/behavior';
import { parseYearMonth } from '../../src/disl/metamodel';
import { modelChangesOf } from '../../src/store/changes';
import { storeOf } from '../../src/store/document';
import { tool } from '../disl/tool';
import { openExample } from '../support/openExample';

// The changes of one intent, as the interpreter makes them, become the one change an open document
// takes as one edit (etalii.adp spec 012, FR-024): in the binding's names and the FBL library's values.

const fixture = readFileSync('test/fixtures/gartner-hype-cycle-graph/triggers-and-notes.ghg');
const { binding, metamodel, persistence, fixture: read } = tool();
const store = { binding, metamodel, persistence };
const model = read('triggers-and-notes').value;
const month = (text: string): number => parseYearMonth(text)!;
// The one step an intent comes to, or all of them when there are several, or the refusal.
const of = (...changes: Change[]) => {
  const steps = modelChangesOf(changes, store, model);
  return 'refused' in steps || steps.length !== 1 ? steps : steps[0];
};

describe('one change of the interpreter', () => {
  it('a set is in the values of the binding: a month as its text, an integer as a bigint, null as it is', () => {
    expect(of({ kind: 'set', id: 'transistors', attributes: { start: month('1951-03'), row: 2, name: 'Valves', tags: ['a', 'b'], peakEnd: null } }))
      .toEqual({ kind: 'set', id: 'transistors', attributes: { start: '1951-03', row: 2n, name: 'Valves', tags: ['a', 'b'], peakEnd: null } });
    expect(of({ kind: 'set', id: 'i-12', attributes: { fromPhase: 'trough', fromAt: 0.75 } })).toEqual({ kind: 'set', id: 'i-12', attributes: { fromPhase: 'trough', fromAt: 0.75 } });
  });

  it('an add of a relation carries its ends under the names of the binding', () => {
    expect(of({ kind: 'add', id: 'new', type: 'Influence', attributes: { toAt: 0.5 }, source: 'radio', target: 'transistors' }))
      .toEqual({ kind: 'add', type: 'Influence', id: 'new', attributes: { toAt: 0.5, from: 'radio', to: 'transistors' } });
  });

  it('an add of an element carries its id, its values and its parent', () => {
    expect(of({ kind: 'add', id: 'new', type: 'Trigger', attributes: { name: 'Point contact', date: month('1948-01'), row: 3 }, parent: 'transistors' }))
      .toEqual({ kind: 'add', type: 'Trigger', id: 'new', attributes: { name: 'Point contact', date: '1948-01', row: 3n }, parent: 'transistors' });
  });

  it('a removal is the removal', () => {
    expect(of({ kind: 'remove', id: 'note-1' })).toEqual({ kind: 'remove', id: 'note-1' });
  });

  it('no change at all is no step', () => {
    expect(of()).toEqual([]);
  });
});

describe('the changes of one intent', () => {
  it('a removal that lists what goes with it is the one removal, since the binding takes the rest itself', () => {
    expect(of({ kind: 'remove', id: 'i-12' }, { kind: 'remove', id: 'i-13' }, { kind: 'remove', id: 'transistors' })).toEqual({ kind: 'remove', id: 'transistors' });
  });

  it('a relation removed beside an element that is not its end is a step of its own', () => {
    const other = model.relations.find((relation) => relation.source !== 'transistor-invented' && relation.target !== 'transistor-invented')!;
    expect(modelChangesOf([{ kind: 'remove', id: other.id }, { kind: 'remove', id: 'transistor-invented' }], store, model))
      .toEqual([{ kind: 'remove', id: other.id }, { kind: 'remove', id: 'transistor-invented' }]);
  });

  it('values given to one element in several changes are one set, the later value last', () => {
    expect(of({ kind: 'set', id: 'transistors', attributes: { row: 2, name: 'A' } }, { kind: 'set', id: 'transistors', attributes: { name: 'B', peakEnd: null } }))
      .toEqual({ kind: 'set', id: 'transistors', attributes: { row: 2n, name: 'B', peakEnd: null } });
  });

  it('a value a hook gives a new element is part of its add', () => {
    expect(of({ kind: 'add', id: 'new', type: 'Note', attributes: { text: 'A', row: 1 } }, { kind: 'set', id: 'new', attributes: { width: 120 } }))
      .toEqual({ kind: 'add', type: 'Note', id: 'new', attributes: { text: 'A', row: 1n, width: 120 } });
  });

  it('changes to several entries are several steps, in order', () => {
    expect(of({ kind: 'set', id: 'transistor-invented', attributes: { row: 0 } }, { kind: 'set', id: 'note-2', attributes: { row: 0 } }))
      .toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { row: 0n } }, { kind: 'set', id: 'note-2', attributes: { row: 0n } }]);
  });
});

describe('a set on the diagram', () => {
  it('is a set of the entry the binding reads as the diagram', async () => {
    const { document } = await openExample(fixture);
    const opened = storeOf(document);
    const entry = opened.rows.reading.elements.find((element) => element.rule.type === 'Unit')!;
    expect(modelChangesOf([{ kind: 'set', id: '', attributes: { unit: 'month' } }], opened, document.model)).toEqual([{ kind: 'set', id: entry.id, attributes: { value: 'month' } }]);
  });

  it('is an add of that entry where the store has none', async () => {
    const { document } = await openExample();
    expect(modelChangesOf([{ kind: 'set', id: '', attributes: { unit: 'month' } }], storeOf(document), document.model)).toEqual([{ kind: 'add', type: 'Unit', attributes: { value: 'month' } }]);
  });
});

describe('what the binding cannot take', () => {
  it('is refused with a sentence: a structure, no number, an attribute without a place, a type it does not read, an element that is not there', () => {
    expect(of({ kind: 'set', id: 'note-1', attributes: { width: Number.NaN } })).toEqual({ refused: 'The store cannot hold the value given for `width` of `note-1`.' });
    expect(of({ kind: 'set', id: 'note-1', attributes: { text: { a: 1 } } })).toEqual({ refused: 'The store cannot hold the value given for `text` of `note-1`.' });
    expect(of({ kind: 'set', id: 'note-1', attributes: { colour: 'red' } })).toEqual({ refused: 'The store has no place for `colour` of `note-1`, so the change cannot be stored.' });
    expect(of({ kind: 'add', id: 'new', type: 'Milestone', attributes: {} })).toEqual({ refused: 'The store holds nothing of the kind of `new`, so the change cannot be stored.' });
    expect(of({ kind: 'set', id: 'nobody', attributes: { row: 1 } })).toEqual({ refused: '`nobody` is not in the document, so it cannot be changed.' });
  });
});

describe('through an open document', () => {
  it('a removal that takes relations with it is one edit and one step of undo', async () => {
    const example = await openExample(fixture);
    const { document } = example;
    const before = example.contents();
    const change = modelChangesOf([{ kind: 'remove', id: 'i-12' }, { kind: 'remove', id: 'i-13' }, { kind: 'remove', id: 'transistors' }], storeOf(document), document.model);
    if ('refused' in change) throw new Error(change.refused);

    expect(await example.apply(change)).toEqual({ done: true });
    expect([...document.model.elements, ...document.model.relations].map((element) => element.id).filter((id) => ['i-12', 'i-13', 'transistors'].includes(id))).toEqual([]);
    expect(example.contents()).not.toEqual(before);

    expect(document.undo()).toEqual({ done: true });
    await example.settled();
    expect(document.canUndo).toBe(false);
    expect(example.contents()).toEqual(before);
  });
});
