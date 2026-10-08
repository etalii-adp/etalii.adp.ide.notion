import { afterEach, describe, expect, it, vi } from 'vitest';
import { formFor, rowsOf } from '../../src/disl/forms';
import { hasIcon } from '../../src/panels/icons';
import { createPropertyGrid, type PropertyGrid } from '../../src/panels/propertyGrid';
import type { EditResult } from '../../src/panels/panel';
import { createToolbox } from '../../src/panels/toolbox';
import { hypeCycleJson } from '../disl/tool';
import { addon, change, controls, description, host, hypeCycle, page, parts, press, row, type } from './dom';

// The toolbox and the property grid of the add-on's own tool type (etalii.adp spec 012, FR-016,
// FR-017, FR-021). The names of that type are in this test and in its specification only.

const done: EditResult = { done: true };
const key = (panel: string): string => `adp-notion.${addon}.panel.${panel}`;
const input = (root: ParentNode, attribute: string) => row(root, attribute).querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
const refusal = (root: ParentNode, attribute: string): string => row(root, attribute).querySelector('.adp-field-refusal:not([hidden])')?.textContent ?? '';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the toolbox', () => {
  const tool = hypeCycle();
  const open = (readOnly = false) => {
    const onPick = vi.fn();
    const section = page('toolbox');
    const panel = createToolbox(section, { specification: tool.specification, toolbox: tool.toolbox, metamodel: tool.metamodel, readOnly, onPick });
    return { section, panel, onPick };
  };

  it('is a region named for assistive technology, with a toggle that names what it does', () => {
    const { section } = open();
    expect([section.getAttribute('role') ?? section.tagName, section.getAttribute('aria-label')]).toEqual(['region', 'Toolbox']);
    const toggle = section.querySelector<HTMLElement>('#toolbox-toggle')!;
    expect([toggle.tagName, toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-label')]).toEqual(['BUTTON', 'true', 'Collapse the toolbox']);
  });

  it('lists every tool of the specification in its group and order, with its label, icon and description', () => {
    const { section } = open();
    const items = [...section.querySelectorAll<HTMLElement>('[data-tool]')];
    expect(items.map((item) => item.dataset.tool)).toEqual(tool.toolbox.groups.flatMap((group) => group.tools.map((entry) => entry.id)));
    expect(items.map((item) => [item.dataset.tool, item.querySelector('.adp-tool-label')!.textContent, item.querySelector('svg')!.dataset.icon])).toEqual([
      ['trend', 'Trend', 'mdi-arrow-right-bold-box-outline'], ['trigger', 'Trigger', 'mdi-circle-slice-8'], ['note', 'Note', 'mdi-note-text-outline'],
    ]);
    expect(description(items[1])).toBe(tool.toolbox.tools.trigger.doc);
    expect(items.every((item) => item.closest('[role="group"]') !== null && item.closest('[role="toolbar"]') !== null)).toBe(true);
  });

  it('draws an icon from the path its id has, and a neutral one for an id it has no path for', () => {
    const { section } = open();
    const drawn = [...section.querySelectorAll<SVGElement>('[data-tool] svg')].map((svg) => svg.querySelector('path')!.getAttribute('d')!);
    expect(drawn.every((path) => path.length > 0)).toBe(true);
    expect(new Set(drawn).size).toBe(3);
    expect(tool.toolbox.groups.flatMap((group) => group.tools).map((entry) => hasIcon(entry.icon))).toEqual([true, true, true]);
    expect([hasIcon('mdi-circle-slice-8'), hasIcon('mdi-no-such-icon'), hasIcon(undefined)]).toEqual([true, false, false]);
  });

  it('gives the tool that is picked, by pointer, with Enter and with Space', () => {
    const { section, onPick } = open();
    const [trend, trigger, note] = [...section.querySelectorAll<HTMLElement>('[data-tool]')];
    trend.click();
    press(trigger, 'Enter');
    press(note, ' ');
    expect(onPick.mock.calls).toEqual([['trend'], ['trigger'], ['note']]);
  });

  it('moves the focus through the tools with the arrow keys, Home and End, and keeps one of them in the Tab order', () => {
    const { section } = open();
    const items = [...section.querySelectorAll<HTMLElement>('[data-tool]')];
    const stops = (): number[] => items.map((item) => item.tabIndex);
    expect(stops()).toEqual([0, -1, -1]);
    press(items[0], 'ArrowDown');
    expect([document.activeElement, stops()]).toEqual([items[1], [-1, 0, -1]]);
    press(items[1], 'End');
    expect(document.activeElement).toBe(items[2]);
    press(items[2], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    press(items[2], 'Home');
    expect([document.activeElement, stops()]).toEqual([items[0], [0, -1, -1]]);
  });

  it('shows no tool when it is read-only', () => {
    const { section, onPick } = open(true);
    expect(section.querySelectorAll('[data-tool]').length).toBe(0);
    expect(controls(section).map((control) => control.id)).toEqual(['toolbox-toggle']);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('interprets the specification itself when it is handed nothing else, as the contract calls it', () => {
    const section = page('toolbox');
    createToolbox(section, { specification: tool.specification, readOnly: false, onPick: () => undefined });
    expect([...section.querySelectorAll<HTMLElement>('[data-tool]')].map((item) => item.dataset.tool)).toEqual(['trend', 'trigger', 'note']);
  });

  it('leaves the region as it found it when it is disposed of', () => {
    const { section, panel } = open();
    panel.dispose();
    expect([section.childElementCount, section.hasAttribute('data-collapsed'), section.id]).toEqual([0, false, 'toolbox']);
  });
});

describe('the property grid', () => {
  const tool = hypeCycle();
  const open = (onChange: (...values: unknown[]) => EditResult = () => done, readOnly = false, source = tool) => {
    const changed = vi.fn(onChange);
    const section = page('property-grid');
    const grid: PropertyGrid = createPropertyGrid(section, {
      specification: source.specification, forms: source.forms, metamodel: source.metamodel, expressions: source.expressions, readOnly, onChange: changed,
    });
    return { section, grid, changed };
  };

  it('is a region named for assistive technology', () => {
    const { section } = open();
    expect([section.getAttribute('role') ?? section.tagName, section.getAttribute('aria-label')]).toEqual(['region', 'Property grid']);
    expect(section.querySelector('#property-grid-toggle')!.getAttribute('aria-label')).toBe('Collapse the property grid');
  });

  it('shows the inspector form of the selection\'s type, with a row for each item that is visible', () => {
    const { section, grid } = open();
    grid.show(['radio'], tool.model);
    const form = formFor(tool.forms, 'Trend');
    const on = { model: tool.model, element: 'radio' };
    expect(section.querySelector<HTMLElement>('[data-form]')!.dataset.form).toBe('trend');
    const rows = [...section.querySelectorAll<HTMLElement>('[data-attribute]')];
    expect(rows.map((item) => item.dataset.attribute)).toEqual(rowsOf(form.items).map((item) => item.rowId(on)));
    expect(rows.filter((item) => item.closest('[hidden]') === null).map((item) => item.dataset.attribute))
      .toEqual(rowsOf(form.items.filter((section) => section.visible(on))).filter((item) => item.visible(on)).map((item) => item.rowId(on)));
    expect(row(section, 'slopeEnd').closest('[hidden]')).not.toBeNull();
    expect([...section.querySelectorAll('.adp-form-heading')].filter((heading) => heading.closest('[hidden]') === null).map((heading) => heading.textContent))
      .toEqual(['Identity', 'Time', 'Phases', 'Peak', 'Trough', 'Slope']);
  });

  it('gives each row the control its widget asks for, tied to its label', () => {
    const { section, grid } = open();
    grid.show(['radio'], tool.model);
    const control = (attribute: string) => row(section, attribute).querySelector<HTMLInputElement>('input, textarea, select')!;
    expect(['name', 'description', 'phases'].map((attribute) => [control(attribute).tagName, control(attribute).type, control(attribute).labels![0].textContent]))
      .toEqual([['INPUT', 'text', 'Name'], ['TEXTAREA', 'textarea', 'Description'], ['INPUT', 'range', 'Phases']]);
    expect([control('phases').min, control('phases').max, control('phases').step, control('phases').value]).toEqual(['1', '4', '1', '3']);
    expect(row(section, 'tags').querySelector('.adp-tags')).not.toBeNull();
    // A computed item that nothing can change is shown, with no control.
    expect(row(section, 'peakInfluencedBy').querySelector('input, textarea, select, button')).toBeNull();
    expect(row(section, 'peakInfluencedBy').querySelector('output')!.textContent).toBe('Transistors · Slope');
  });

  it('shows each value as the item\'s `display` words it', () => {
    const { section, grid } = open();
    grid.show(['radio'], tool.model);
    expect([input(section, 'name').value, input(section, 'start').value, input(section, 'peakEnd').value]).toEqual(['Transistor radio', '1954-01', '1961-01']);
    expect(input(section, 'phases').getAttribute('aria-valuetext')).toBe('Peak, Trough and Slope');
    expect(row(section, 'phases').querySelector('output')!.textContent).toBe('Peak, Trough and Slope');
  });

  it('hands a committed value to the edit, on Enter and on leaving the control, once', () => {
    const { section, grid, changed } = open();
    grid.show(['radio'], tool.model);
    type(input(section, 'start'), '1955-03');
    press(input(section, 'start'), 'Enter');
    change(input(section, 'start'));
    type(input(section, 'description'), 'Pocket sized.');
    change(input(section, 'description'));
    expect(changed.mock.calls).toEqual([['radio', 'trend', 'start', '1955-03'], ['radio', 'trend', 'description', 'Pocket sized.']]);
    expect(input(section, 'start').getAttribute('aria-invalid')).toBeNull();
  });

  it('commits nothing when the text is as it was', () => {
    const { section, grid, changed } = open();
    grid.show(['radio'], tool.model);
    press(input(section, 'peakEnd'), 'Enter');
    change(input(section, 'peakEnd'));
    expect(changed).not.toHaveBeenCalled();
  });

  it('refuses what the item\'s `validate` refuses, with its sentence beside the control, and changes nothing', () => {
    const { section, grid, changed } = open();
    grid.show(['radio'], tool.model);
    const start = input(section, 'start');
    type(start, 'soon');
    press(start, 'Enter');
    expect(changed).not.toHaveBeenCalled();
    expect(refusal(section, 'start')).toBe('\'soon\' is not a date; write it as YYYY-MM, such as 2007-06.');
    expect([start.getAttribute('aria-invalid'), description(start), start.value]).toEqual(['true', refusal(section, 'start'), 'soon']);
    press(start, 'Escape');
    expect([start.value, start.getAttribute('aria-invalid'), start.getAttribute('aria-describedby'), refusal(section, 'start')]).toEqual(['1954-01', null, null, '']);
  });

  it('reads a text through the item\'s `parse`: its refusal is shown, and what it accepts is handed on under the row\'s name', () => {
    const { section, grid, changed } = open();
    grid.show(['note-1'], tool.model);
    expect(section.querySelector<HTMLElement>('[data-form]')!.dataset.form).toBe('note');
    const size = input(section, 'Size');
    expect(size.value).toBe('160 x 64');
    type(size, 'large');
    press(size, 'Enter');
    expect(refusal(section, 'Size')).toBe('\'large\' is not a size; write it as width x height, such as 160 x 64.');
    type(size, '200 x 80');
    press(size, 'Enter');
    expect(changed.mock.calls).toEqual([['note-1', 'note', 'Size', '200 x 80']]);
    expect(refusal(section, 'Size')).toBe('');
  });

  it('shows the sentence of an edit that is refused, and keeps what was typed', () => {
    const { section, grid } = open(() => ({ done: false, sentence: 'A trend ends after it starts.' }));
    grid.show(['radio'], tool.model);
    const stop = input(section, 'stop');
    type(stop, '1950-01');
    press(stop, 'Enter');
    expect([refusal(section, 'stop'), stop.getAttribute('aria-invalid'), stop.value]).toEqual(['A trend ends after it starts.', 'true', '1950-01']);
  });

  it('keeps a multi-line text\'s Enter for a new line and commits it with CTRL+Enter', () => {
    const { section, grid, changed } = open();
    grid.show(['radio'], tool.model);
    const text = input(section, 'description');
    type(text, 'One\nTwo');
    expect(press(text, 'Enter')).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    press(text, 'Enter', { ctrlKey: true });
    expect(changed.mock.calls).toEqual([['radio', 'trend', 'description', 'One\nTwo']]);
  });

  it('hands a slider\'s value on as a number and a list of tags as a list', () => {
    const { section, grid, changed } = open();
    grid.show(['transistor-invented'], tool.model);
    const tags = row(section, 'tags');
    expect([...tags.querySelectorAll('.adp-tag-label')].map((tag) => tag.textContent)).toEqual(['electronics', 'invention']);
    const add = tags.querySelector<HTMLInputElement>('input')!;
    type(add, 'physics');
    press(add, 'Enter');
    tags.querySelectorAll<HTMLButtonElement>('.adp-tag button')[0].click();
    expect(tags.querySelector<HTMLButtonElement>('.adp-tag button')!.getAttribute('aria-label')).toBe('Remove electronics');
    grid.show(['radio'], tool.model);
    const phases = input(section, 'phases');
    phases.value = '2';
    change(phases);
    expect(changed.mock.calls).toEqual([
      ['transistor-invented', 'trigger', 'tags', ['electronics', 'invention', 'physics']],
      ['transistor-invented', 'trigger', 'tags', ['invention']],
      ['radio', 'trend', 'phases', 2],
    ]);
  });

  it('shows the diagram\'s own form for an empty selection, a few choices as one group of them', () => {
    const { section, grid, changed } = open();
    grid.show([], tool.model);
    expect(section.querySelector<HTMLElement>('[data-form]')!.dataset.form).toBe('diagram');
    const group = row(section, 'unit').querySelector('[role="radiogroup"]')!;
    const choices = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(choices.map((choice) => choice.labels![0].textContent)).toEqual(['Month', 'Year', 'Decade', 'Century']);
    expect(choices.map((choice) => choice.checked)).toEqual([false, true, false, false]);
    choices[0].checked = true;
    change(choices[0]);
    expect(changed.mock.calls).toEqual([['', 'diagram', 'unit', 'month']]);
  });

  it('shows several elements of one type with the values they share, and changes each of them', () => {
    const { section, grid, changed } = open();
    grid.show(['radio', 'transistors'], tool.model);
    expect(section.querySelector<HTMLElement>('[data-form]')!.dataset.form).toBe('trend');
    expect([input(section, 'name').value, input(section, 'stop').value, input(section, 'description').value]).toEqual(['', '', '']);
    expect(input(section, 'name').placeholder).toBe('Several values');
    type(input(section, 'description'), 'Electronics.');
    press(input(section, 'description'), 'Enter', { ctrlKey: true });
    expect(changed.mock.calls).toEqual([['radio', 'trend', 'description', 'Electronics.'], ['transistors', 'trend', 'description', 'Electronics.']]);
  });

  it('asks for one edit of several elements where the page takes one, and shows its refusal', () => {
    const section = page('property-grid');
    const onChange = vi.fn(() => done);
    const onChangeAll = vi.fn((...values: unknown[]): EditResult => (values[3] === 'No.' ? { done: false, sentence: 'Not these.' } : done));
    const grid = createPropertyGrid(section, { specification: tool.specification, forms: tool.forms, metamodel: tool.metamodel, expressions: tool.expressions, readOnly: false, onChange, onChangeAll });
    grid.show(['radio', 'transistors'], tool.model);
    type(input(section, 'description'), 'Electronics.');
    press(input(section, 'description'), 'Enter', { ctrlKey: true });
    type(input(section, 'description'), 'No.');
    press(input(section, 'description'), 'Enter', { ctrlKey: true });
    expect(onChangeAll.mock.calls).toEqual([[['radio', 'transistors'], 'trend', 'description', 'Electronics.'], [['radio', 'transistors'], 'trend', 'description', 'No.']]);
    expect(refusal(section, 'description')).toBe('Not these.');
    // One element is one edit already.
    grid.show(['radio'], tool.model);
    type(input(section, 'description'), 'Pocket sized.');
    press(input(section, 'description'), 'Enter', { ctrlKey: true });
    expect(onChange.mock.calls).toEqual([['radio', 'trend', 'description', 'Pocket sized.']]);
    expect(onChangeAll.mock.calls.length).toBe(2);
  });

  it('shows no form for elements of several types, and says so', () => {
    const { section, grid } = open();
    grid.show(['radio', 'note-1'], tool.model);
    expect(section.querySelector('[data-form]')).toBeNull();
    expect(section.querySelector('.adp-form-empty')!.textContent).toBe('The selection holds elements of several types.');
  });

  it('follows the model it is shown again, keeping the control that has the focus', () => {
    const { section, grid } = open();
    grid.show(['radio'], tool.model);
    const name = input(section, 'name');
    name.focus();
    const renamed = { ...tool.model, elements: tool.model.elements.map((element) => (element.id === 'radio' ? { ...element, attributes: { ...element.attributes, name: 'Radio', phases: 4 } } : element)) };
    grid.show(['radio'], renamed);
    expect([input(section, 'name'), input(section, 'name').value, document.activeElement]).toEqual([name, 'Radio', name]);
    expect(row(section, 'slopeEnd').closest('[hidden]')).toBeNull();
  });

  it('shows a value as the model holds it once the edit is taken, not as it was typed', () => {
    const named = (name: string) => ({ ...tool.model, elements: tool.model.elements.map((element) => (element.id === 'radio' ? { ...element, attributes: { ...element.attributes, name } } : element)) });
    const { section, grid } = open((_element, _form, _attribute, value) => {
      grid.show(['radio'], named(String(value).trim()));
      return done;
    });
    grid.show(['radio'], tool.model);
    type(input(section, 'name'), '  Radio ');
    press(input(section, 'name'), 'Enter');
    expect(input(section, 'name').value).toBe('Radio');
    type(input(section, 'name'), 'Wireless');
    expect(input(section, 'name').value).toBe('Wireless');
  });

  it('folds a group the specification makes collapsible, from a button that says whether it is open', () => {
    const source = structuredClone(hypeCycleJson()) as { forms: { trend: { items: { collapsible?: boolean; collapsed?: boolean }[] } } };
    Object.assign(source.forms.trend.items[1], { collapsible: true, collapsed: true });
    const { section, grid } = open(() => done, false, { ...parts(source), model: tool.model });
    grid.show(['radio'], tool.model);
    const fold = [...section.querySelectorAll<HTMLButtonElement>('button.adp-form-heading')];
    expect(fold.map((button) => [button.textContent, button.getAttribute('aria-expanded')])).toEqual([['Time', 'false']]);
    expect(row(section, 'start').closest('[hidden]')).not.toBeNull();
    press(fold[0], 'Enter');
    expect([fold[0].getAttribute('aria-expanded'), row(section, 'start').closest('[hidden]')]).toEqual(['true', null]);
  });

  it('shows every value and no control that changes one when it is read-only', () => {
    const { section, grid, changed } = open(() => done, true);
    grid.show(['transistor-invented'], tool.model);
    expect(controls(section).map((control) => control.id)).toEqual(['property-grid-toggle']);
    expect(['name', 'date', 'tags'].map((attribute) => row(section, attribute).querySelector('output')!.textContent)).toEqual(['Transistor invented', '1947-12', 'electronics, invention']);
    expect(row(section, 'name').querySelector('output')!.labels[0].textContent).toBe('Name');
    grid.show([], tool.model);
    expect(controls(section).map((control) => control.id)).toEqual(['property-grid-toggle']);
    expect(changed).not.toHaveBeenCalled();
  });

  it('interprets the specification itself when it is handed nothing else, as the contract calls it', () => {
    const section = page('property-grid');
    const grid = createPropertyGrid(section, { specification: tool.specification, readOnly: false, onChange: () => done });
    grid.show(['radio'], tool.model);
    expect(input(section, 'name').value).toBe('Transistor radio');
  });
});

describe('a panel', () => {
  const tool = hypeCycle();
  const toolbox = (section: HTMLElement) => createToolbox(section, { specification: tool.specification, toolbox: tool.toolbox, metamodel: tool.metamodel, readOnly: false, onPick: () => undefined });
  const grid = (section: HTMLElement) => createPropertyGrid(section, { specification: tool.specification, forms: tool.forms, metamodel: tool.metamodel, expressions: tool.expressions, readOnly: false, onChange: () => done });

  it('opens expanded, collapses from its toggle with the pointer or the keyboard, and keeps the toggle in view', () => {
    const section = page('toolbox');
    const panel = toolbox(section);
    const toggle = section.querySelector<HTMLButtonElement>('#toolbox-toggle')!;
    expect([panel.collapsed, section.dataset.collapsed, localStorage.getItem(key('toolbox'))]).toEqual([false, 'false', null]);
    toggle.click();
    expect([panel.collapsed, section.dataset.collapsed, toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-label')]).toEqual([true, 'true', 'false', 'Open the toolbox']);
    expect([toggle.closest('[hidden]'), section.querySelector('[data-tool]')!.closest('[hidden]') === null]).toEqual([null, false]);
    expect(localStorage.getItem(key('toolbox'))).toBe('collapsed');
    press(toggle, 'Enter');
    expect([panel.collapsed, section.dataset.collapsed, localStorage.getItem(key('toolbox'))]).toEqual([false, 'false', 'expanded']);
  });

  it('keeps its state per add-on and per panel, and restores it when a page of the add-on opens', () => {
    const first = toolbox(page('toolbox'));
    first.collapsed = true;
    expect(Object.fromEntries(Object.entries(localStorage))).toEqual({ [key('toolbox')]: 'collapsed' });
    const again = page('toolbox');
    const properties = host('property-grid');
    expect([toolbox(again).collapsed, again.dataset.collapsed, grid(properties).collapsed, properties.dataset.collapsed]).toEqual([true, 'true', false, 'false']);
    document.documentElement.dataset.addon = 'another-add-on';
    expect(toolbox(host('toolbox')).collapsed).toBe(false);
    document.documentElement.dataset.addon = addon;
  });

  it('opens expanded and still collapses where the browser refuses the storage', () => {
    localStorage.setItem(key('property-grid'), 'collapsed');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('refused', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('refused', 'SecurityError'); });
    const section = page('property-grid');
    const panel = grid(section);
    expect([panel.collapsed, section.dataset.collapsed]).toEqual([false, 'false']);
    section.querySelector<HTMLButtonElement>('#property-grid-toggle')!.click();
    expect([panel.collapsed, section.dataset.collapsed]).toEqual([true, 'true']);
  });

  it('writes no class that does not begin with adp-', () => {
    const section = page('toolbox');
    const properties = host('property-grid');
    toolbox(section);
    grid(properties).show(['transistor-invented'], tool.model);
    const classes = [...document.body.querySelectorAll('*')].flatMap((element) => [...element.classList]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });
});
