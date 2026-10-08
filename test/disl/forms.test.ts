import { describe, expect, it } from 'vitest';
import { createExpressions } from '../../src/disl/expressions';
import { formFor, interpretForms, rowsOf, type Form, type FormItem, type Subject } from '../../src/disl/forms';
import { interpretMetamodel, parseYearMonth } from '../../src/disl/metamodel';
import { emptyModel, type Model } from '../../src/disl/model';
import { loadSpecification } from '../../src/disl/specification';
import { tool } from './tool';

const month = (text: string): number => parseYearMonth(text)!;
const row = (form: Form, on: Subject, id: string): FormItem => rowsOf(form.items).find((item) => item.rowId(on) === id)!;

const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  return interpretForms(specification, metamodel, createExpressions(specification, metamodel));
};

describe('the forms of the hype cycle graph', () => {
  const { specification, metamodel, expressions, fixture } = tool();
  const { value: forms, findings } = interpretForms(specification, metamodel, expressions);
  const model = fixture('triggers-and-notes').value;
  const on = (element: string, env?: Subject['env']): Subject => ({ model, element, env });

  it('are read without a finding', () => expect(findings).toEqual([]));

  it('are one for each type, each used as the property grid', () => {
    expect(Object.keys(forms.all)).toEqual(['trend', 'trigger', 'note', 'influence']);
    expect(Object.values(forms.all).map((form) => [form.for, form.usage, form.commit, form.generated])).toEqual([
      [['Trend'], ['inspector'], 'immediate', false], [['Trigger'], ['inspector'], 'immediate', false],
      [['Note'], ['inspector'], 'immediate', false], [['Influence'], ['inspector'], 'immediate', false],
    ]);
    expect(formFor(forms, 'Trend')).toBe(forms.all.trend);
    expect(formFor(forms, 'Influence', 'inspector')).toBe(forms.all.influence);
  });

  it('give a trend its rows in sections, each with its row id, label and widget', () => {
    const form = formFor(forms, 'Trend');
    const radio = on('radio');
    expect(form.items.map((section) => [section.kind, section.label(radio), section.visible(radio)])).toEqual([
      ['section', 'Identity', true], ['section', 'Time', true], ['section', 'Phases', true], ['section', 'Peak', true],
      ['section', 'Trough', true], ['section', 'Slope', true], ['section', 'Plateau (hidden)', false],
    ]);
    expect(rowsOf(form.items).map((item) => [item.rowId(radio), item.label(radio), item.widget, item.kind])).toEqual([
      ['name', 'Name', 'text', 'field'], ['description', 'Description', 'textarea', 'field'], ['tags', 'Tags', 'tags', 'field'],
      ['start', 'Start', 'text', 'field'], ['stop', 'Stop', 'text', 'field'],
      ['phases', 'Phases', 'slider', 'field'], ['peakEnd', 'Peak ends', 'text', 'field'], ['troughEnd', 'Trough ends', 'text', 'field'], ['slopeEnd', 'Slope ends', 'text', 'field'],
      ['peakInfluences', 'Influence', 'textarea', 'computed'], ['peakInfluencedBy', 'Influenced by', 'textarea', 'computed'],
      ['troughInfluences', 'Influence', 'textarea', 'computed'], ['troughInfluencedBy', 'Influenced by', 'textarea', 'computed'],
      ['slopeInfluences', 'Influence', 'textarea', 'computed'], ['slopeInfluencedBy', 'Influenced by', 'textarea', 'computed'],
      ['plateauInfluences', 'Influence', 'textarea', 'computed'], ['plateauInfluencedBy', 'Influenced by', 'textarea', 'computed'],
    ]);
    expect(row(form, radio, 'phases').widgetOptions).toMatchObject({ min: 1, max: 4, step: 1 });
  });

  it('show each value as its item says: a month as it is written, a count as its phrase, a boundary where it is drawn', () => {
    const form = formFor(forms, 'Trend');
    const radio = on('radio');
    const shown = (id: string): string => row(form, radio, id).display(radio);
    expect([shown('name'), shown('start'), shown('stop'), shown('phases')]).toEqual(['Transistor radio', '1954-01', '1975-01', 'Peak, Trough and Slope']);
    // No boundary of this trend is stored: the rows show where the spread ones are drawn.
    expect(row(form, radio, 'peakEnd').value(radio)).toBeUndefined();
    expect([shown('peakEnd'), shown('troughEnd')]).toEqual(['1961-01', '1968-01']);
    expect(['peakEnd', 'troughEnd', 'slopeEnd'].map((id) => row(form, radio, id).visible(radio))).toEqual([true, true, false]);
    expect(row(form, radio, 'start').value(radio)).toBe(month('1954-01'));
    expect(shown('peakInfluencedBy')).toBe('Transistors · Slope');
    expect(shown('peakInfluences')).toBe('None');
    expect(row(form, on('transistors'), 'peakInfluencedBy').display(on('transistors'))).toBe('Transistor invented');
  });

  it('offer the tags in use, on trends and then on triggers', () => {
    const tags = row(formFor(forms, 'Trend'), on('radio'), 'tags');
    expect(tags.options(on('radio'))).toEqual([{ value: 'electronics', label: 'electronics' }, { value: 'invention', label: 'invention' }]);
    const trigger = on('transistor-invented');
    expect(row(formFor(forms, 'Trigger'), trigger, 'tags').display(trigger)).toBe('electronics, invention');
    expect(tags.parse(on('radio'), ' semiconductors, a,b , semiconductors ')).toEqual({ set: { tags: ['semiconductors', 'a', 'b'] } });
    expect(tags.parse(on('radio'), '')).toEqual({ set: { tags: [] } });
    expect(tags.parse(on('radio'), ['x', 'y'])).toEqual({ set: { tags: ['x', 'y'] } });
  });

  it('turn an entered month into its value, and refuse a text that is none with the form\'s sentence', () => {
    const radio = on('radio');
    const stop = row(formFor(forms, 'Trend'), radio, 'stop');
    expect(stop.parse(radio, '1980-06')).toEqual({ set: { stop: month('1980-06') } });
    expect(stop.parse(radio, 'June')).toEqual({ refused: "'June' is not a date; write it as YYYY-MM, such as 2007-06." });
    expect(stop.validate(radio, 'June')).toBe("'June' is not a date; write it as YYYY-MM, such as 2007-06.");
    // The validation is judged when the value is committed, not while it is typed.
    expect(stop.validate(radio, 'June', 'input')).toBeUndefined();
    const trigger = on('transistor-invented');
    expect(row(formFor(forms, 'Trigger'), trigger, 'date').parse(trigger, '1947')).toEqual({ refused: "'1947' is not a date; write it as YYYY-MM, such as 1947-12." });
  });

  it('take the number of phases as the slider\'s number or as its phrase', () => {
    const radio = on('radio');
    const phases = row(formFor(forms, 'Trend'), radio, 'phases');
    expect(phases.parse(radio, 2)).toEqual({ set: { phases: 2 } });
    expect(phases.parse(radio, ' All four ')).toMatchObject({ value: ' All four ', write: [{ set: { phases: expect.any(String) } }] });
    expect(phases.parse(radio, 'Five')).toEqual({ refused: "'Five' is not one of Peak, Peak and Trough, Peak, Trough and Slope, All four." });
  });

  it('show a note\'s size as one text and take it back as one', () => {
    const note = on('note-2');
    const form = formFor(forms, 'Note');
    const size = row(form, note, 'Size');
    expect(rowsOf(form.items).map((item) => [item.rowId(note), item.widget, item.editable])).toEqual([['text', 'textarea', true], ['Size', 'text', true]]);
    expect([size.display(note), size.value(note), size.readOnly(note)]).toEqual(['120 x 40', '120 x 40', { readOnly: false }]);
    expect(size.parse(note, '200 x 80')).toMatchObject({ value: '200 x 80' });
    expect(size.parse(note, 'big')).toEqual({ refused: "'big' is not a size; write it as width x height, such as 160 x 64." });
  });

  it('show where an influence is attached, read-only with the reason, and its two ends as texts that can be changed', () => {
    const influence = on('i-13');
    const form = formFor(forms, 'Influence');
    expect(rowsOf(form.items).map((item) => [item.rowId(influence), item.display(influence), item.readOnly(influence).readOnly])).toEqual([
      ['description', '', false], ['From', 'Transistors · Slope', true], ['To', 'Transistor radio · Peak', true],
      ['From attachment', 'slope/bottom/0.5', false], ['To attachment', 'peak/top/0.1', false],
    ]);
    expect(row(form, influence, 'From').readOnly(influence)).toEqual({ readOnly: true, reason: 'Where it is attached; drag the end on the canvas to move it.' });
    expect(row(form, influence, 'From').parse(influence, 'x')).toEqual({ refused: 'Where it is attached; drag the end on the canvas to move it.' });
    expect(row(form, influence, 'To attachment').parse(influence, 'plateau/side/0.3'))
      .toEqual({ refused: "'plateau/side/0.3' is not an attachment; write it as phase/edge/at, such as plateau/bottom/0.3." });
    // An end at a trigger names nothing.
    expect(row(form, on('i-12'), 'From attachment').display(on('i-12'))).toBe('//');
  });

  it('lets nothing be changed in a diagram that is read-only', () => {
    const radio = on('radio', { readOnly: true });
    const rows = rowsOf(formFor(forms, 'Trend').items);
    expect(rows.every((item) => item.readOnly(radio).readOnly)).toBe(true);
    expect(rows[0].parse(radio, 'x')).toEqual({ refused: 'Name cannot be changed here.' });
  });

  it('give the diagram, for no selection, a form made from its own attributes', () => {
    const form = formFor(forms, undefined);
    const diagram: Subject = { model };
    expect([form.generated, form.for]).toEqual([true, ['diagram']]);
    const [unit] = rowsOf(form.items);
    expect([unit.rowId(diagram), unit.label(diagram), unit.widget, unit.value(diagram), unit.display(diagram)]).toEqual(['unit', 'Unit', 'segmented', 'year', 'Year']);
    expect(unit.options(diagram).map((option) => [option.value, option.label])).toEqual([['month', 'Month'], ['year', 'Year'], ['decade', 'Decade'], ['century', 'Century']]);
    expect(unit.parse(diagram, 'Decade')).toEqual({ set: { unit: 'decade' } });
    expect(unit.parse(diagram, 'week')).toEqual({ refused: "'week' is not one of Month, Year, Decade, Century." });
    // In a diagram that stores no unit, the row shows the attribute's default.
    expect(unit.value({ model: emptyModel })).toBe('month');
  });
});

describe('a form', () => {
  const specification = (forms: object | undefined) => ({
    disl: '0.3', language: { id: 'a.b', version: '1.0.0' },
    metamodel: {
      enums: { Size: { values: { s: { label: 'Small' }, m: {}, l: {}, xl: {}, xxl: {} } } },
      types: {
        Box: { attributes: {
          title: { type: 'string', group: 'Naming', order: 2, label: 'Title' }, code: { type: 'string', group: 'Naming', order: 1, readOnly: true },
          count: { type: 'int', default: 3 }, ratio: { type: 'number', min: 0, max: 1, step: 0.1 }, done: { type: 'bool' }, size: { type: 'Size' },
          since: { type: 'yearMonth' }, notes: { type: 'text', absentText: 'Nothing yet' }, total: { type: 'int', derived: 'self.count * 2' },
        } },
        Crate: { extends: 'Box' },
      },
    },
    behavior: { reasons: { frozen: { when: 'self.done', message: 'It is done.' } } },
    ...(forms === undefined ? {} : { forms }),
  });
  const model: Model = { diagram: {}, relations: [], elements: [{ id: 'a', type: 'Crate', attributes: { title: 'A', done: true }, host: {}, ephemeral: false, line: 1 }] };
  const a: Subject = { model, element: 'a' };

  it('that is not declared is made from the attributes: the ungrouped first, then a section for each group, in their order', () => {
    const { value: forms, findings } = interpret(specification(undefined));
    const form = formFor(forms, 'Crate');
    expect(findings).toEqual([]);
    expect(form.generated).toBe(true);
    expect(form.items.map((item) => [item.kind, item.label(a)])).toEqual([['field', 'Count'], ['field', 'Ratio'], ['field', 'Done'], ['field', 'Size'], ['field', 'Since'], ['field', 'Notes'], ['section', 'Naming']]);
    expect(rowsOf(form.items).map((item) => [item.attribute, item.widget])).toEqual([
      ['count', 'number'], ['ratio', 'slider'], ['done', 'checkbox'], ['size', 'select'], ['since', 'month'], ['notes', 'textarea'], ['code', 'text'], ['title', 'text'],
    ]);
  });

  it('reads a value by the type of its attribute, and says what a text is not', () => {
    const { value: forms } = interpret(specification(undefined));
    const rows = Object.fromEntries(rowsOf(formFor(forms, 'Crate').items).map((item) => [item.attribute, item]));
    expect([rows.count.value(a), rows.count.display(a), rows.notes.display(a), rows.done.display(a)]).toEqual([3, '3', 'Nothing yet', 'true']);
    expect(rows.count.parse(a, '12')).toEqual({ set: { count: 12 } });
    expect(rows.count.parse(a, '1.5')).toEqual({ refused: "'1.5' is not a whole number." });
    expect(rows.ratio.parse(a, '0.25')).toEqual({ set: { ratio: 0.25 } });
    expect(rows.ratio.parse(a, 'half')).toEqual({ refused: "'half' is not a number." });
    expect(rows.done.parse(a, 'false')).toEqual({ set: { done: false } });
    expect(rows.since.parse(a, '2020-13')).toEqual({ refused: "'2020-13' is not a year and a month, written as YYYY-MM." });
    expect(rows.size.parse(a, 'small')).toEqual({ set: { size: 's' } });
    // An emptied value that is no text is no value at all.
    expect(rows.count.parse(a, ' ')).toEqual({ set: { count: null } });
    expect(rows.title.parse(a, '')).toEqual({ set: { title: '' } });
    expect(rows.code.readOnly(a)).toEqual({ readOnly: true });
  });

  it('is found for a subtype, by the usage asked for, and words its reasons and conditions over the element', () => {
    const { value: forms } = interpret(specification({
      box: { for: ['Box'], usage: ['inspector', 'create'], label: { cel: "'Box ' + self.title" }, items: [
        { attribute: 'title', readOnlyReasons: [{ reason: 'frozen' }, 'Never.'], placeholder: 'A title' },
        { attribute: 'count', visible: 'self.done', enabled: '!self.done', validate: [{ rule: 'value > 0', message: 'More than none.' }, { rule: 'value < 100', message: 'A warning.', severity: 'warning' }] },
        { kind: 'row', items: [{ attribute: 'size', options: [{ value: 'm', label: 'Medium' }, 'l'] }] },
        { kind: 'tabs', tabs: [{ title: 'More', items: [{ kind: 'computed', label: 'Twice', value: { cel: 'string(self.count * 2)' } }] }] },
        { kind: 'button', label: 'Go', operation: 'go' },
      ] },
      dialog: { for: 'Box', usage: ['popover'], items: [{ attribute: 'title' }] },
    }));
    const form = formFor(forms, 'Crate');
    expect([form.id, form.label(a), formFor(forms, 'Crate', 'create').id, formFor(forms, 'Crate', 'popover').id, forms.all.dialog.commit]).toEqual(['box', 'Box A', 'box', 'dialog', 'explicit']);
    const [title, count, size, twice] = rowsOf(form.items);
    expect([title.readOnly(a), title.placeholder(a)]).toEqual([{ readOnly: true, reason: 'It is done.' }, 'A title']);
    const open: Subject = { model: { ...model, elements: [{ ...model.elements[0], attributes: { title: 'A' } }] }, element: 'a' };
    expect(title.readOnly(open)).toEqual({ readOnly: true, reason: 'Never.' });
    expect([count.visible(a), count.visible(open), count.readOnly(a).readOnly, count.readOnly(open).readOnly]).toEqual([true, false, true, false]);
    expect([count.validate(open, 0), count.validate(open, 500), count.parse(open, 0)]).toEqual(['More than none.', undefined, { refused: 'More than none.' }]);
    expect(size.options(a)).toEqual([{ value: 'm', label: 'Medium', icon: undefined }, { value: 'l', label: 'l' }]);
    expect([twice.display(a), twice.readOnly(a).readOnly, twice.editable]).toEqual(['6', true, false]);
    expect(form.items[4]).toMatchObject({ kind: 'button', operation: 'go' });
  });

  it('reports an expression that cannot be read, and keeps the item', () => {
    const { value: forms, findings } = interpret(specification({ box: { for: 'Box', items: [{ attribute: 'title', visible: 'self.(' }] } }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/^The `visible` of the item `title` of the form `box` cannot be read: /);
    expect(rowsOf(forms.all.box.items)[0].visible(a)).toBe(true);
  });
});
