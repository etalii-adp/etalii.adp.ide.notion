import { describe, expect, it } from 'vitest';
import { arrangedRows, createScene } from '../../src/canvas/scene';
import { applyChanges, baseCoordinate, interpretBehavior, keptApart, type Change, type Outcome } from '../../src/disl/behavior';
import { interpretConstraints } from '../../src/disl/constraints';
import { interpretCoordinates } from '../../src/disl/coordinates';
import { createExpressions } from '../../src/disl/expressions';
import { formFor, interpretForms, rowsOf, type FormItem } from '../../src/disl/forms';
import { interpretLayout } from '../../src/disl/layout';
import { interpretMetamodel, parseYearMonth } from '../../src/disl/metamodel';
import { emptyModel, type Model, type ModelElement } from '../../src/disl/model';
import { interpretNotation } from '../../src/disl/notation';
import { interpretPersistence } from '../../src/disl/persistence';
import { loadSpecification } from '../../src/disl/specification';
import { interpretToolbox } from '../../src/disl/toolbox';
import { interpretViewpoints } from '../../src/disl/viewpoints';
import { hypeCycleJson, tool } from './tool';

const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  const expressions = createExpressions(specification, metamodel);
  const notation = interpretNotation(specification, metamodel).value;
  const coordinates = interpretCoordinates(specification, metamodel).value;
  const layout = interpretLayout(specification).value;
  const viewpoints = interpretViewpoints(specification, metamodel, { notation, coordinates, layout }).value;
  const scene = { metamodel, expressions, coordinates, viewpoints };
  let made = 0;
  const loaded = interpretBehavior(specification, metamodel, expressions, {
    constraints: interpretConstraints(specification, metamodel, expressions).value,
    persistence: interpretPersistence(specification, metamodel).value,
    toolbox: interpretToolbox(specification, metamodel).value,
    layout, coordinates, notation, viewpoints,
    rows: (config, model) => arrangedRows(scene, model, createScene(scene, model), config),
    newId: () => `new-${++made}`,
  });
  return { behavior: loaded.value, findings: loaded.findings, forms: interpretForms(specification, metamodel, expressions).value };
};

const month = (text: string): number => parseYearMonth(text)!;
// The fixture is drawn in years: 4 canvas units for each, counted from 1900-01, and rows 56 apart.
const years = (count: number): number => count * 4;
const x = (text: string): number => years((month(text) - month('1900-01')) / 12);
const changes = (outcome: Outcome): readonly Change[] => {
  if (outcome.refused !== undefined) throw new Error(`refused: ${outcome.refused}`);
  return outcome.changes;
};
const after = (outcome: Outcome): Model => {
  if (outcome.refused !== undefined) throw new Error(`refused: ${outcome.refused}`);
  return outcome.after;
};
const refusal = (outcome: Outcome): string | undefined => outcome.refused;

describe('the behavior of the hype cycle graph', () => {
  const { behavior, findings, forms } = interpret(hypeCycleJson());
  const model = tool().fixture('triggers-and-notes').value;
  const trueTime = { env: { viewpoint: 'trueTime' } };
  // The same graph with the first boundary of a trend dragged to 1960.
  const dragged = after(behavior.dragHandle(model, 'transistors', 'b1', 0.25, trueTime));
  const field = (type: string, id: string): FormItem => rowsOf(formFor(forms, type).items).find((item) => item.rowId({ model }) === id)!;

  it('is read without a finding', () => expect(findings).toEqual([]));

  it('gives the sentence the specification has for a diagram that cannot be edited', () => {
    expect(behavior.messages).toEqual({ 'std.readOnly': 'The graph could not be read, so it cannot be edited.' });
    expect(behavior.message('std.readOnly', model)).toBe('The graph could not be read, so it cannot be edited.');
    expect(behavior.message('std.atStart', model)).toBeUndefined();
    const readOnly = { env: { readOnly: true } };
    for (const outcome of [behavior.create(model, 'trend', { x: 0, y: 0 }, readOnly), behavior.remove(model, ['radio'], readOnly), behavior.operate(model, 'arrange', [], readOnly), behavior.edit(model, 'radio', field('Trend', 'name'), 'x', readOnly)]) {
      expect(refusal(outcome)).toBe('The graph could not be read, so it cannot be edited.');
    }
  });

  describe('a tool dropped on the canvas', () => {
    it('adds a trend in the step and the row of the drop: 12 steps long, four phases, with a name of its own', () => {
      const dropped = behavior.create(model, 'trend', { x: x('1960-01') + 1, y: 56 * 4 + 16 });
      expect(changes(dropped)).toEqual([{ kind: 'add', id: expect.any(String), type: 'Trend', attributes: { name: 'New trend', start: month('1960-01'), stop: month('1972-01'), row: 4, phases: 4 } }]);
      expect(dropped).toMatchObject({ created: [changes(dropped)[0].id], effects: [] });
      const again = behavior.create(after(dropped), 'trend', { x: x('1960-01') + 1, y: 0 });
      expect(changes(again)[0]).toMatchObject({ attributes: { name: 'New trend 2', row: 0 } });
    });

    it('adds a trigger on the row its middle is nearest to, and a note on the row that holds the point, with its editor open', () => {
      expect(changes(behavior.create(model, 'trigger', { x: x('1970-01'), y: 16 }))[0]).toMatchObject({ type: 'Trigger', attributes: { name: 'Trigger', date: month('1970-01'), row: 0 } });
      expect(changes(behavior.create(model, 'trigger', { x: x('1970-01') + 3.9, y: 56 + 45 }))[0]).toMatchObject({ attributes: { date: month('1970-01'), row: 2 } });
      const note = behavior.create(model, 'note', { x: x('1970-01'), y: 60 });
      expect(changes(note)[0]).toMatchObject({ type: 'Note', attributes: { text: '', at: month('1970-01'), row: 1, width: 160, height: 64 } });
      expect(note).toMatchObject({ effects: [{ kind: 'editLabel', elements: [changes(note)[0].id] }] });
    });

    it('lands, in a viewpoint that places by layout, where its point stands in the viewpoint that is varied', () => {
      const pairs = [{ placed: 0, base: 200 }, { placed: 100, base: 400 }];
      expect([baseCoordinate(pairs, 0), baseCoordinate(pairs, -40), baseCoordinate(pairs, 50), baseCoordinate(pairs, 112), baseCoordinate([], 48)]).toEqual([200, 160, 300, 412, 48]);
      const dropped = behavior.create(model, 'trend', { x: x('1960-01'), y: 72 }, { env: { viewpoint: 'compact' } });
      expect(changes(dropped)[0]).toMatchObject({ attributes: { start: month('1960-01'), row: 1 } });
    });

    it('is refused for a tool the toolbox does not have', () => {
      expect(refusal(behavior.create(model, 'cloud', { x: 0, y: 0 }))).toBe('This tool places nothing where it is dropped.');
    });
  });

  describe('a relation drawn between two elements', () => {
    it('attaches where the notation says when the gesture gives no end, and where the gesture says when it does', () => {
      expect(changes(behavior.connect(model, 'Influence', 'radio', 'transistors'))).toEqual([{
        kind: 'add', id: expect.any(String), type: 'Influence', source: 'radio', target: 'transistors',
        attributes: { fromPhase: 'slope', fromEdge: 'bottom', fromAt: 0.5, toPhase: 'peak', toEdge: 'top', toAt: 0.5 },
      }]);
      const given = behavior.connect(model, 'Influence', 'radio', 'transistors', { source: { part: 'peak', side: 'top', at: 0.333 }, target: { part: 'plateau', side: 'bottom', at: 1 } });
      expect(changes(given)[0]).toMatchObject({ attributes: { fromPhase: 'peak', fromEdge: 'top', fromAt: 0.33, toPhase: 'plateau', toEdge: 'bottom', toAt: 1 } });
    });

    it('states no end at an element that has no parts to attach to', () => {
      const added = changes(behavior.connect(model, 'Influence', 'transistor-invented', 'radio'))[0];
      expect(added).toMatchObject({ source: 'transistor-invented', target: 'radio', attributes: { toPhase: 'peak', toEdge: 'top', toAt: 0.5 } });
      expect(Object.keys((added as { attributes: object }).attributes)).toEqual(['toPhase', 'toEdge', 'toAt']);
    });

    it('is refused with the sentence of the limit it would break', () => {
      expect(refusal(behavior.connect(model, 'Influence', 'transistors', 'radio'))).toBe('This trend already influences that one; a trend influences another once in each direction.');
      expect(refusal(behavior.connect(model, 'Influence', 'radio', 'radio'))).toBe('A trend cannot influence itself.');
      expect(refusal(behavior.connect(model, 'Influence', 'radio', 'transistor-invented'))).toBe('An influence cannot end at a trigger.');
      expect(refusal(behavior.connect(model, 'Influence', 'note-1', 'radio'))).toBe('An influence is drawn from one trend to another.');
    });

    it('has an end moved to another place on its element, and not where the end is bound to nothing', () => {
      expect(changes(behavior.reattach(model, 'i-13', 'target', { part: 'trough', side: 'bottom', at: 0.333 }))).toEqual([{ kind: 'set', id: 'i-13', attributes: { toPhase: 'trough', toEdge: 'bottom', toAt: 0.33 } }]);
      expect(refusal(behavior.reattach(model, 'i-12', 'source', { part: 'peak', side: 'top', at: 0.5 }))).toBe('This end cannot be moved.');
    });
  });

  describe('a value entered in the property grid', () => {
    it('is one change with what follows from it: stored boundaries keep their share of a span that is changed', () => {
      const resized = behavior.edit(dragged, 'transistors', field('Trend', 'stop'), '1970-01');
      expect(changes(resized)).toEqual([{ kind: 'set', id: 'transistors', attributes: { stop: month('1970-01'), peakEnd: month('1955-01') } }]);
      expect(after(resized)).toEqual(applyChanges(dragged, changes(resized)));
    });

    it('is refused with the sentence of the constraint it breaks', () => {
      const stop = (text: string): string | undefined => refusal(behavior.edit(model, 'radio', field('Trend', 'stop'), text));
      expect(stop('June')).toBe("'June' is not a date; write it as YYYY-MM, such as 2007-06.");
      expect(stop('1954-01')).toBe('A trend must stop after it starts, at least one month later.');
      expect(stop('1954-03')).toBe('A trend showing 3 phases must be at least 3 months long, one per phase.');
      expect(refusal(behavior.edit(model, 'radio', field('Trend', 'phases'), 5))).toBe('A trend shows 1 to 4 phases.');
      expect(refusal(behavior.edit(model, 'radio', field('Trend', 'name'), '  '))).toBe('A trend needs a name.');
      expect(refusal(behavior.edit(model, 'transistor-invented', field('Trigger', 'name'), ''))).toBe('A trigger needs a name.');
    });

    it('goes through the item\'s own reading of its text', () => {
      expect(changes(behavior.edit(model, 'radio', field('Trend', 'phases'), 'Peak and Trough'))).toEqual([{ kind: 'set', id: 'radio', attributes: { phases: 2 } }]);
      expect(changes(behavior.edit(model, 'note-2', field('Note', 'Size'), '200.456 x 80'))).toEqual([{ kind: 'set', id: 'note-2', attributes: { width: 200.46, height: 80 } }]);
      expect(refusal(behavior.edit(model, 'note-2', field('Note', 'Size'), '0 x 80'))).toBe('A note needs a width and a height.');
      expect(changes(behavior.edit(model, 'i-13', field('Influence', 'To attachment'), 'trough/bottom/0.333'))).toEqual([{ kind: 'set', id: 'i-13', attributes: { toPhase: 'trough', toEdge: 'bottom', toAt: 0.33 } }]);
      expect(refusal(behavior.edit(model, 'i-13', field('Influence', 'To attachment'), 'summit/top/0.5'))).toBe("'summit/top/0.5' is not an attachment; write it as phase/edge/at, such as plateau/bottom/0.3.");
    });

    it('sets a boundary as a drag would, the one that was entered first and the others around it', () => {
      const trough = behavior.edit(dragged, 'transistors', field('Trend', 'troughEnd'), '1955-01');
      // The boundary before it is stored at 1960, and each phase keeps a month.
      expect(changes(trough)).toEqual([{ kind: 'set', id: 'transistors', attributes: { troughEnd: month('1960-02') } }]);
    });

    it('changes nothing for a value that is the one already there, and empties a text', () => {
      expect(changes(behavior.edit(model, 'radio', field('Trend', 'name'), 'Transistor radio'))).toEqual([]);
      expect(changes(behavior.edit(model, 'transistor-invented', field('Trigger', 'tags'), ''))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { tags: [] } }]);
      expect(changes(behavior.change(model, 'transistor-invented', { description: null }))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { description: null } }]);
      expect(changes(behavior.change(model, undefined, { unit: 'decade' }))).toEqual([{ kind: 'set', id: '', attributes: { unit: 'decade' } }]);
    });
  });

  describe('a label edited in place', () => {
    it('goes through the label\'s `parse`, which writes the name alone and trimmed', () => {
      expect(changes(behavior.editLabel(model, 'transistor-invented', '  Point contact '))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { name: 'Point contact' } }]);
      expect(refusal(behavior.editLabel(model, 'transistor-invented', '  '))).toBe('A trigger needs a name.');
    });

    it('goes to the attribute the label shows when it has no `parse`', () => {
      expect(changes(behavior.editLabel(model, 'note-2', 'First\n\nSecond'))).toEqual([{ kind: 'set', id: 'note-2', attributes: { text: 'First\n\nSecond' } }]);
      expect(changes(behavior.editLabel(model, 'note-2', '', undefined, 'text'))).toEqual([{ kind: 'set', id: 'note-2', attributes: { text: '' } }]);
      expect(refusal(behavior.editLabel(model, 'transistors', ' '))).toBe('A trend needs a name.');
      expect(refusal(behavior.editLabel(model, 'i-13', 'x'))).toBe('This text cannot be changed here.');
    });
  });

  describe('an element moved, resized or reshaped on the canvas', () => {
    it('moves a trend by its dates and its row, with what it stores, as one change', () => {
      const moved = behavior.move(dragged, ['transistors'], { x: years(5) + 1.9, y: 56 + 20 });
      expect(changes(moved)).toEqual([{ kind: 'set', id: 'transistors', attributes: { start: month('1955-01'), stop: month('1995-01'), row: 2, peakEnd: month('1965-01') } }]);
    });

    it('moves a trigger by its centre and a note by its corner, each to the nearest step and row', () => {
      expect(changes(behavior.move(model, ['transistor-invented'], { x: x('1950-01') - x('1947-12'), y: 56 }))).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { date: month('1950-01'), row: 2 } }]);
      expect(changes(behavior.move(model, ['note-2'], { x: years(-10), y: -56 * 4 + 20 }))).toEqual([{ kind: 'set', id: 'note-2', attributes: { at: month('1950-01'), row: 1 } }]);
      const both = changes(behavior.move(model, ['radio', 'note-1'], { x: 0, y: 56 }));
      expect(both).toEqual([{ kind: 'set', id: 'radio', attributes: { row: 3 } }, { kind: 'set', id: 'note-1', attributes: { row: 4 } }]);
    });

    it('moves nothing where the viewpoint places by layout, or by less than half a step', () => {
      expect(changes(behavior.move(model, ['radio'], { x: years(3), y: 0 }, { env: { viewpoint: 'compact' } }))).toEqual([]);
      expect(changes(behavior.move(model, ['radio'], { x: 1.9, y: 20 }))).toEqual([]);
    });

    it('resizes a trend by the edge that is dragged, and rescales what it stores', () => {
      expect(changes(behavior.resize(dragged, 'transistors', { right: x('1970-01') - x('1990-01') }))).toEqual([{ kind: 'set', id: 'transistors', attributes: { stop: month('1970-01'), peakEnd: month('1955-01') } }]);
      expect(changes(behavior.resize(model, 'radio', { left: years(2), bottom: 30 }))).toEqual([{ kind: 'set', id: 'radio', attributes: { start: month('1956-01') } }]);
    });

    it('refuses a size its placement constraint does not allow', () => {
      expect(refusal(behavior.resize(model, 'radio', { right: x('1954-01') - x('1975-01') }))).toBe('A trend must stop after it starts, at least one month later.');
      const months = after(behavior.change(model, undefined, { unit: 'month' }));
      expect(refusal(behavior.resize(months, 'radio', { right: (month('1954-03') - month('1975-01')) * 4 }))).toBe('A trend showing 3 phases must be at least 3 months long, one per phase.');
    });

    it('resizes a note by its size, and moves its corner with its left and top edges', () => {
      expect(changes(behavior.resize(model, 'note-2', { right: 80.456, bottom: 40 }))).toEqual([{ kind: 'set', id: 'note-2', attributes: { width: 200.46, height: 80 } }]);
      expect(changes(behavior.resize(model, 'note-2', { left: years(1), top: 56 }))).toEqual([{ kind: 'set', id: 'note-2', attributes: { at: month('1961-01'), width: 116, row: 6, height: -16 } }]);
      expect(changes(behavior.resize(model, 'transistor-invented', { right: 8 }))).toEqual([]);
    });

    it('lands a dragged handle by its own rule and writes what the handle says', () => {
      expect(changes(behavior.dragHandle(model, 'transistors', 'b1', 0.26, trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { peakEnd: month('1960-01') } }]);
      // A step is kept clear of the drawn boundary after it.
      expect(changes(behavior.dragHandle(model, 'transistors', 'b1', 0.9, trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { peakEnd: month('1969-01') } }]);
      expect(changes(behavior.dragHandle(dragged, 'transistors', 'b3', 0.1, trueTime))).toEqual([{ kind: 'set', id: 'transistors', attributes: { slopeEnd: month('1971-01') } }]);
    });

    it('refuses a handle that is not offered, with the handle\'s sentence', () => {
      expect(refusal(behavior.dragHandle(model, 'radio', 'b3', 0.8, trueTime))).toBe('Only a boundary between two visible phases can be moved.');
      expect(refusal(behavior.dragHandle(model, 'transistors', 'b1', 0.3, { env: { viewpoint: 'compact' } }))).toBe('Only a boundary between two visible phases can be moved.');
      expect(refusal(behavior.dragHandle(model, 'transistors', 'b9', 0.3, trueTime))).toBe('That cannot be dragged here.');
    });
  });

  describe('a selection removed', () => {
    it('takes the relations of an element with it, and asks first with their number', () => {
      expect(changes(behavior.remove(model, ['transistor-invented']))).toEqual([{ kind: 'remove', id: 'i-12' }, { kind: 'remove', id: 'transistor-invented' }]);
      expect(behavior.deletion(model, ['transistor-invented'])).toEqual({
        removes: ['i-12', 'transistor-invented'],
        confirm: { title: 'Remove', message: 'Removing this trigger also removes the 1 influence to or from it.', confirmLabel: 'Remove', cancelLabel: 'Cancel', danger: true },
      });
      expect(behavior.deletion(model, ['transistors']).confirm?.message).toBe('Removing this trend also removes the 2 influences to or from it.');
    });

    it('takes a note or a relation alone, without asking', () => {
      expect(behavior.deletion(model, ['note-1'])).toEqual({ removes: ['note-1'] });
      expect(behavior.deletion(model, ['i-12'])).toEqual({ removes: ['i-12'] });
      expect(after(behavior.remove(model, ['i-12', 'note-2', 'gone'])).relations.map((relation) => relation.id)).toEqual(['i-13']);
    });

    it('removes each thing once, whatever of it is selected', () => {
      expect(changes(behavior.remove(model, ['i-13', 'transistors', 'radio'])).map((change) => change.id)).toEqual(['i-13', 'i-12', 'transistors', 'radio']);
    });
  });

  describe('an operation', () => {
    it('is listed with its label, its icon and what it applies to', () => {
      expect(behavior.operations.map((operation) => [operation.id, operation.label, operation.icon, operation.for, operation.keys])).toEqual([
        ['evenPhases', 'Even phases', 'mdi-arrow-split-vertical', ['Trend'], []], ['arrange', 'Arrange diagram', 'mdi-sitemap-outline', ['diagram'], []],
        ['addTrendHere', 'Add trend here', 'mdi-plus', ['diagram'], []], ['addTriggerHere', 'Add trigger here', 'mdi-circle-slice-8', ['diagram'], []],
        ['addNoteHere', 'Add note here', 'mdi-note-text-outline', ['diagram'], []],
      ]);
    });

    it('is offered for what it applies to, and unavailable with the sentence that says why', () => {
      expect(behavior.availability(model, 'evenPhases', ['note-1'])).toMatchObject({ offered: false, available: false });
      expect(behavior.availability(model, 'evenPhases', ['transistors'])).toEqual({ offered: true, available: false, reason: "This trend's phases are already even.", label: 'Even phases', target: 'transistors', confirm: undefined });
      expect(behavior.availability(dragged, 'evenPhases', ['transistors'])).toMatchObject({ offered: true, available: true });
      expect(behavior.availability(emptyModel, 'arrange', [])).toMatchObject({ offered: true, available: false, reason: 'There is nothing to arrange until this graph has a trend.' });
      expect(refusal(behavior.operate(model, 'evenPhases', ['transistors']))).toBe("This trend's phases are already even.");
      expect(refusal(behavior.operate(model, 'evenPhases', ['note-1']))).toBe('This cannot be done with what is selected.');
      expect(refusal(behavior.operate(emptyModel, 'arrange', []))).toBe('There is nothing to arrange until this graph has a trend.');
    });

    it('forgets every stored boundary of a trend', () => {
      expect(changes(behavior.operate(dragged, 'evenPhases', ['transistors']))).toEqual([{ kind: 'set', id: 'transistors', attributes: { peakEnd: null } }]);
    });

    it('arranges the rows through the layout its action names, writes only the rows that change, and then has nothing left to do', () => {
      const arranged = behavior.operate(model, 'arrange', ['radio']);
      expect(changes(arranged).length).toBeGreaterThan(0);
      expect(changes(arranged).every((change) => change.kind === 'set' && Object.keys(change.attributes).join() === 'row')).toBe(true);
      expect(refusal(behavior.operate(after(arranged), 'arrange', []))).toBe('This graph is already arranged.');
    });

    it('adds at the point it was invoked at, as a drop of the tool there would', () => {
      const at = { x: x('1902-06'), y: 30 };
      const added = changes(behavior.operate(model, 'addTrendHere', [], trueTime, at))[0];
      expect(added).toMatchObject({ kind: 'add', type: 'Trend', attributes: { name: 'New trend', start: month('1902-01'), stop: month('1914-01'), row: 0, phases: 4 } });
      expect((added as { attributes: object }).attributes).toEqual((changes(behavior.create(model, 'trend', at))[0] as { attributes: object }).attributes);
      expect(changes(behavior.operate(model, 'addTriggerHere', [], trueTime, at))[0]).toMatchObject({ type: 'Trigger', attributes: { name: 'Trigger', date: month('1902-01'), row: 0 } });
      expect(changes(behavior.operate(model, 'addNoteHere', [], trueTime, { x: 0, y: 60 }))[0]).toMatchObject({ type: 'Note', attributes: { text: '', at: month('1900-01'), row: 1, width: 160, height: 64 } });
    });
  });

  describe('a context menu', () => {
    const labels = (target: Parameters<typeof behavior.menu>[1], on: Model = model, situation: object = trueTime): string[][] =>
      behavior.menu(on, target, situation).groups.map((group) => group.map((entry) => entry.label));

    it('shows the entries of its target in their groups, and an operation only while it applies', () => {
      expect(labels('transistors')).toEqual([['Rename…', 'Remove'], ['Arrange diagram']]);
      expect(labels('transistors', dragged)).toEqual([['Rename…', 'Even phases', 'Remove'], ['Arrange diagram']]);
      expect(labels('note-1')).toEqual([['Edit text…', 'Remove'], ['Arrange diagram']]);
      expect(labels('i-12')).toEqual([['Remove influence'], ['Arrange diagram']]);
      expect(behavior.menu(model, 'transistors', trueTime).groups[0][0]).toEqual({ kind: 'editLabel', label: 'Rename…', icon: 'mdi-pencil-outline', shortcut: 'F2', operation: undefined, creates: undefined, via: undefined, enabled: true, reason: undefined });
    });

    it('has the adds on the empty canvas in the viewpoint that has dates, and no menu in the other', () => {
      expect(labels(undefined)).toEqual([['Add trend here', 'Add trigger here', 'Add note here'], ['Arrange diagram']]);
      expect(labels(undefined, model, { env: { viewpoint: 'compact' } })).toEqual([]);
    });

    it('runs its one entry for a pending connection, and shows nothing in a diagram that is read-only', () => {
      expect(behavior.menu(model, { source: 'radio', target: 'transistors' }, trueTime)).toMatchObject({ runSingle: true, standardEntries: false, groups: [[{ kind: 'connect', via: 'Influence', label: 'Influence', enabled: true }]] });
      expect(labels('transistors', model, { env: { viewpoint: 'trueTime', readOnly: true } })).toEqual([]);
    });
  });
});

describe('changes', () => {
  const element = (id: string, attributes: ModelElement['attributes']): ModelElement => ({ id, type: 'Box', attributes, host: {}, ephemeral: false, line: 1 });
  const model: Model = { diagram: { unit: 'year' }, elements: [element('a', { title: 'A', count: 1 })], relations: [] };

  it('are applied in order, and leave the model they are applied to as it was', () => {
    const next = applyChanges(model, [
      { kind: 'add', id: 'b', type: 'Box', attributes: { title: 'B' } },
      { kind: 'add', id: 'r', type: 'Link', attributes: {}, source: 'a', target: 'b' },
      { kind: 'set', id: 'a', attributes: { title: 'Changed', count: null } },
      { kind: 'set', id: '', attributes: { unit: null, zoom: 2 } },
      { kind: 'set', id: 'gone', attributes: { title: 'x' } },
    ]);
    expect(next.elements.map((entry) => [entry.id, entry.attributes])).toEqual([['a', { title: 'Changed' }], ['b', { title: 'B' }]]);
    expect(next.relations).toMatchObject([{ id: 'r', type: 'Link', source: 'a', target: 'b' }]);
    expect(next.diagram).toEqual({ zoom: 2 });
    expect(model.elements[0].attributes).toEqual({ title: 'A', count: 1 });
    expect(applyChanges(next, [{ kind: 'remove', id: 'r' }, { kind: 'remove', id: 'a' }])).toMatchObject({ elements: [{ id: 'b' }], relations: [] });
  });
});

describe('ordered attributes kept apart', () => {
  it('give way to the one that was set, each anchor a gap from the next', () => {
    // DISL 4.3: four phases from 2000-01 to 2000-05; the second boundary dragged to 2000-02 lands on 2000-03.
    expect(keptApart([undefined, 1, undefined], 0, 4, 1, 3, true, 1)).toEqual([undefined, 2, undefined]);
    expect(keptApart([10, 4, undefined], 0, 40, 1, 3, true, 1)).toEqual([10, 11, undefined]);
    // Two on one place: the one that was set keeps the room it has, and the other gives way.
    expect(keptApart([12, 12, undefined], 0, 40, 1, 3, true, 0)).toEqual([11, 12, undefined]);
    expect(keptApart([12, 12, undefined], 0, 40, 1, 3, true, -1)).toEqual([12, 13, undefined]);
  });

  it('only keep inside the two ends what is no anchor, and count an absent one only when it is spread', () => {
    expect(keptApart([5, 90, 2], 0, 40, 1, 1, true, -1)).toEqual([5, 39, 39]);
    expect(keptApart([undefined, 39, undefined], 0, 40, 2, 3, false, -1)).toEqual([undefined, 38, undefined]);
    expect(keptApart([undefined, 39, undefined], 0, 40, 2, 3, true, -1)).toEqual([undefined, 36, undefined]);
  });

  it('are refused where the two ends leave too little room, and left alone where none is present', () => {
    expect(keptApart([undefined, 1, undefined], 0, 3, 1, 3, true, 1)).toBeUndefined();
    expect(keptApart([undefined, undefined], 0, 1, 1, 2, true, -1)).toEqual([undefined, undefined]);
  });
});

describe('a behavior', () => {
  const specification = {
    disl: '0.3', language: { id: 'a.b', version: '1.0.0' },
    metamodel: {
      types: {
        State: {
          labelAttribute: 'title',
          attributes: { title: { type: 'string' }, locked: { type: 'bool' }, weight: { type: 'number', precision: 1 }, low: { type: 'int' }, high: { type: 'int' }, first: { type: 'int' }, second: { type: 'int' }, next: { type: 'State' } },
          bounds: { neighbour: { attributes: ['first', 'second'], between: ['low', 'high'], gap: 2 } },
        },
        Final: { extends: 'State' },
      },
      relations: { Step: { source: 'State', target: 'State' } },
    },
    behavior: {
      messages: { 'std.notApplicable': { cel: "'Nothing to do for ' + operationId + '.'" } },
      reasons: { frozen: { when: "diagram.nodes.exists(n, n.title == 'Frozen')", message: 'The diagram is frozen.' } },
      editGate: [{ reason: 'frozen' }],
      hooks: [
        { id: 'number', on: 'create', for: 'State', when: '!has(self.title)', actions: [{ set: { title: "'State ' + string(diagram.nodesOfType('State').size())" } }] },
        { id: 'guard', on: 'delete', for: 'State', phase: 'before', when: 'self.locked', actions: [{ abort: { message: "'Unlock ' + self.title + ' first.'" } }] },
        { id: 'follow', on: 'change', for: 'State', attribute: 'low', when: 'has(old.high)', actions: [{ set: { high: 'self.low + (old.high - old.low)' } }] },
      ],
      operations: {
        chain: { label: { cel: "'Chain from ' + self.title" }, for: ['State'], shortcut: 'Enter', actions: [
          { create: { type: "'State'", attributes: { weight: '1.26' } }, as: 'added' },
          { connect: { type: "'Step'", source: 'self', target: 'added' } },
          { let: { n: 'diagram.nodes.size()' } },
          { if: 'n > 2', then: [{ set: { title: "'Third'" }, target: 'added' }], else: [{ set: { title: "'Second'" }, target: 'added' }] },
          { select: 'added' }, { editLabel: { target: 'added' } },
        ] },
        lockAll: { for: 'selection', actions: [{ forEach: 'selection', as: 's', do: [{ set: { locked: 'true' }, target: 's', when: '!s.locked' }] }, { notify: { message: "'Locked.'" } }] },
        clear: { for: 'diagram', enabled: 'diagram.nodes.size() > 0', confirm: 'Really?', actions: [{ delete: 'diagram.nodes' }] },
        spin: { for: 'diagram', actions: [{ retype: { to: "'Final'" } }] },
        both: { for: 'diagram', actions: [{ call: 'spin' }, { call: 'clear' }] },
      },
      deletion: { Final: { relations: 'forbid' } },
    },
  };
  const { behavior, findings } = interpret(specification);
  const state = (id: string, attributes: ModelElement['attributes'], type = 'State'): ModelElement => ({ id, type, attributes, host: {}, ephemeral: false, line: 1 });
  const model: Model = { diagram: {}, elements: [state('a', { title: 'A' })], relations: [] };

  it('reports an action it does not run, and skips it', () => {
    expect(findings.map((finding) => finding.message)).toEqual(['An action of the operation `spin` is a `retype`, which this add-on does not run, so it is skipped.']);
    expect(changes(behavior.operate(model, 'spin', []))).toEqual([]);
  });

  it('runs the hooks of a change in the same step: a new element is named by the hook of its creation', () => {
    const created = behavior.create(model, 'State', { x: 10, y: 20 });
    expect(changes(created)).toEqual([{ kind: 'add', id: expect.any(String), type: 'State', attributes: { title: 'State 2' } }]);
    expect(created).toMatchObject({ effects: [{ kind: 'editLabel' }] });
    const spans = { ...model, elements: [state('a', { title: 'A', low: 10, high: 30 })] };
    expect(changes(behavior.change(spans, 'a', { low: 15 }))).toEqual([{ kind: 'set', id: 'a', attributes: { low: 15, high: 35 } }]);
  });

  it('runs the actions of an operation in order, each seeing what the ones before it did', () => {
    const chained = behavior.operate(model, 'chain', ['a']);
    expect(changes(chained)).toEqual([
      { kind: 'add', id: expect.any(String), type: 'State', attributes: { weight: 1.3, title: 'Second' } },
      { kind: 'add', id: expect.any(String), type: 'Step', attributes: {}, source: 'a', target: changes(chained)[0].id },
    ]);
    expect(chained).toMatchObject({ created: [changes(chained)[0].id, changes(chained)[1].id], effects: [{ kind: 'select', elements: [changes(chained)[0].id] }, { kind: 'editLabel', elements: [changes(chained)[0].id] }] });
    expect(changes(behavior.operate(after(chained), 'chain', ['a']))[0]).toMatchObject({ attributes: { title: 'Third' } });
  });

  it('says what an operation is: its label for its target, its keys, and the question it asks', () => {
    expect(behavior.operations.find((operation) => operation.id === 'chain')).toMatchObject({ for: ['State'], keys: ['Enter'] });
    expect(behavior.availability(model, 'chain', ['a'])).toMatchObject({ offered: true, available: true, label: 'Chain from A', target: 'a' });
    expect(refusal(behavior.operate(model, 'chain', []))).toBe('Nothing to do for chain.');
    expect(behavior.availability(model, 'clear', []).confirm).toEqual({ title: 'Clear', message: 'Really?', confirmLabel: 'OK', cancelLabel: 'Cancel', danger: false });
    expect(behavior.availability(emptyModel, 'clear', [])).toMatchObject({ offered: true, available: false, reason: undefined });
    expect(refusal(behavior.operate(emptyModel, 'clear', []))).toBe('Clear cannot be done now.');
  });

  it('runs an operation on a selection, and one operation from another', () => {
    const two = { ...model, elements: [state('a', { title: 'A' }), state('b', { title: 'B', locked: true })] };
    const locked = behavior.operate(two, 'lockAll', ['a', 'b']);
    expect(changes(locked)).toEqual([{ kind: 'set', id: 'a', attributes: { locked: true } }]);
    expect(locked).toMatchObject({ effects: [{ kind: 'notify', message: 'Locked.' }] });
    expect(changes(behavior.operate(model, 'both', []))).toEqual([{ kind: 'remove', id: 'a' }]);
  });

  it('is aborted by a hook before the change, with the hook\'s sentence, and withheld by the edit gate with its reason', () => {
    const locked = { ...model, elements: [state('a', { title: 'A', locked: true })] };
    expect(refusal(behavior.remove(locked, ['a']))).toBe('Unlock A first.');
    expect(refusal(behavior.operate(locked, 'clear', []))).toBe('Unlock A first.');
    const frozen = { ...model, elements: [state('a', { title: 'Frozen' })] };
    expect(refusal(behavior.change(frozen, 'a', { title: 'Thawed' }))).toBe('The diagram is frozen.');
    expect(behavior.availability(frozen, 'chain', ['a'])).toMatchObject({ available: false, reason: 'The diagram is frozen.' });
  });

  it('follows the deletion policy of the type: relations that forbid it, and references that are emptied', () => {
    const linked: Model = {
      diagram: {},
      elements: [state('a', { title: 'A', next: 'b' }), state('b', { title: 'B' }), state('f', { title: 'F' }, 'Final')],
      relations: [{ ...state('s', {}, 'Step'), source: 'a', target: 'f' }],
    };
    expect(refusal(behavior.remove(linked, ['f']))).toBe('Final cannot be removed while something is connected to it or lies in it.');
    expect(changes(behavior.remove(linked, ['b']))).toEqual([{ kind: 'set', id: 'a', attributes: { next: null } }, { kind: 'remove', id: 'b' }]);
    expect(changes(behavior.remove(linked, ['a', 's']))).toEqual([{ kind: 'remove', id: 's' }, { kind: 'remove', id: 'a' }]);
  });

  it('keeps ordered attributes a gap apart after a change, and refuses one that leaves no room', () => {
    const spans = { ...model, elements: [state('a', { title: 'A', low: 0, high: 10, first: 3, second: 6 })] };
    expect(changes(behavior.change(spans, 'a', { second: 4 }))).toEqual([{ kind: 'set', id: 'a', attributes: { second: 5 } }]);
    expect(changes(behavior.change(spans, 'a', { title: 'B' }))).toEqual([{ kind: 'set', id: 'a', attributes: { title: 'B' } }]);
    expect(refusal(behavior.change(spans, 'a', { high: 5 }))).toBe('There is too little room between the two ends for this.');
  });

  it('changes no model for a position that is bound to no attribute', () => {
    expect(changes(behavior.move(model, ['a'], { x: 40, y: 40 }))).toEqual([]);
    expect(changes(behavior.resize(model, 'a', { right: 40 }))).toEqual([]);
    expect(refusal(behavior.change(model, 'gone', { title: 'x' }))).toBe('That is no longer in this diagram.');
  });
});
