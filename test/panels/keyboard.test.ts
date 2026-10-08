import { describe, expect, it, vi } from 'vitest';
import type { Model } from '../../src/disl/model';
import { createPropertyGrid } from '../../src/panels/propertyGrid';
import { createToolbox } from '../../src/panels/toolbox';
import { accessibleName, change, controls, host, hypeCycle, mindmap, page, press, tabStops, type } from './dom';

// Every control of the toolbox and the property grid is reached with Tab and used with the keyboard
// alone, has a name for assistive technology, and each panel is a named region: 0 controls that need
// a pointer (etalii.adp spec 012, NFR-006, SC-012).

interface Tool extends ReturnType<typeof hypeCycle> { readonly model: Model; }

const selections: readonly (readonly [string, () => Tool, readonly (readonly string[])[]])[] = [
  ['the add-on\'s own tool type', hypeCycle, [[], ['radio'], ['transistor-invented'], ['note-1'], ['radio', 'transistors']]],
  ['another tool type', mindmap, [[], ['ID_1'], ['ID_2']]],
];

// What a browser lets the keyboard use without a line of the add-on: these, once they have the focus.
const native = 'button, input, select, textarea, a[href]';

describe.each(selections)('the keyboard and assistive technology, with %s', (_name, make, chosen) => {
  const tool = make();

  const open = () => {
    // Each page starts with nothing kept, so that a panel collapsed by one is open in the next.
    localStorage.clear();
    const onPick = vi.fn();
    const onChange = vi.fn(() => ({ done: true }) as const);
    const toolbox = page('toolbox');
    const properties = host('property-grid');
    createToolbox(toolbox, { specification: tool.specification, toolbox: tool.toolbox, metamodel: tool.metamodel, readOnly: false, onPick });
    const grid = createPropertyGrid(properties, { specification: tool.specification, forms: tool.forms, metamodel: tool.metamodel, expressions: tool.expressions, readOnly: false, onChange });
    return { toolbox, properties, grid, onPick, onChange };
  };

  it('finds each panel as a region with a name', () => {
    const { toolbox, properties } = open();
    for (const panel of [toolbox, properties]) {
      expect(panel.tagName === 'SECTION' || panel.getAttribute('role') === 'region').toBe(true);
      expect(panel.getAttribute('aria-label')).toMatch(/\S/);
    }
    expect(toolbox.getAttribute('aria-label')).not.toBe(properties.getAttribute('aria-label'));
  });

  it.each(chosen)('names every control, with %j selected', (...selection) => {
    const { toolbox, properties, grid } = open();
    grid.show(selection, tool.model);
    const all = [...controls(toolbox), ...controls(properties)];
    expect(all.length).toBeGreaterThan(2);
    expect(all.filter((control) => accessibleName(control) === '').map((control) => control.outerHTML)).toEqual([]);
    // A group of controls has a name of its own beside those of its members.
    const groups = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"], [role="group"], [role="toolbar"]')];
    expect(groups.filter((group) => accessibleName(group) === '').map((group) => group.outerHTML)).toEqual([]);
  });

  it.each(chosen)('reaches every control with Tab, or with the arrow keys from one that Tab reaches, with %j selected', (...selection) => {
    const { toolbox, properties, grid } = open();
    grid.show(selection, tool.model);
    const all = [...controls(toolbox), ...controls(properties)];
    const stops = new Set([...tabStops(toolbox), ...tabStops(properties)]);
    const unreached = all.filter((control) => !stops.has(control));
    // Only the tools are out of the Tab order: one of them is in it, and the arrow keys reach the others.
    expect(unreached.filter((control) => control.dataset.tool === undefined).map((control) => control.outerHTML)).toEqual([]);
    const tools = [...toolbox.querySelectorAll<HTMLElement>('[data-tool]')];
    expect(tools.filter((item) => stops.has(item)).length).toBe(1);
    const reached = new Set<Element>();
    tools[0].focus();
    for (let step = 0; step < tools.length; step++) {
      reached.add(document.activeElement!);
      press(document.activeElement as HTMLElement, 'ArrowDown');
    }
    expect(reached.size).toBe(tools.length);
    expect(all.filter((control) => control.tabIndex > 0)).toEqual([]);
  });

  it.each(chosen)('uses every control with the keyboard alone, with %j selected', (...selection) => {
    const { toolbox, properties, grid, onPick, onChange } = open();
    grid.show(selection, tool.model);

    const tools = [...toolbox.querySelectorAll<HTMLElement>('[data-tool]')];
    tools.forEach((item, index) => press(item, index % 2 === 0 ? 'Enter' : ' '));
    expect(onPick.mock.calls.map(([id]) => id)).toEqual(tools.map((item) => item.dataset.tool));

    for (const panel of [toolbox, properties]) {
      const toggle = panel.querySelector<HTMLElement>(`#${panel.id}-toggle`)!;
      press(toggle, 'Enter');
      expect(panel.dataset.collapsed).toBe('true');
      press(toggle, ' ');
      expect(panel.dataset.collapsed).toBe('false');
    }

    // Each control of the grid that takes a value takes one from the keyboard, and the edit is asked for.
    const fields = controls(properties).filter((control): control is HTMLInputElement => control.matches('input, textarea, select') && control.closest('[data-attribute]') !== null);
    const attributes = new Set(fields.map((field) => field.closest<HTMLElement>('[data-attribute]')!.dataset.attribute!));
    for (const attribute of attributes) {
      onChange.mockClear();
      const field = controls(properties).find((control) => control.closest<HTMLElement>('[data-attribute]')?.dataset.attribute === attribute && control.matches('input, textarea, select')) as HTMLInputElement;
      if (field.type === 'radio') {
        const other = [...properties.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]`)].find((choice) => !choice.checked)!;
        other.focus();
        other.checked = true;
        change(other);
      } else if (field.type === 'range') {
        field.focus();
        field.value = field.value === field.min ? field.max : field.min;
        change(field);
      } else if (field.tagName === 'TEXTAREA') {
        type(field, `${field.value} more`);
        press(field, 'Enter', { ctrlKey: true });
      } else {
        // A text that its item may refuse still goes through the item: the refusal is then what is shown.
        type(field, attribute === 'tags' ? 'more' : `${field.value}1`);
        press(field, 'Enter');
      }
      const refused = properties.querySelector('[aria-invalid="true"]') !== null;
      expect([attribute, onChange.mock.calls.length > 0 || refused]).toEqual([attribute, true]);
    }
  });

  it.each(chosen)('has nothing that only a pointer can use, with %j selected', (...selection) => {
    // Whatever answers a click is a control the keyboard uses too, or the label of one.
    const count = (() => {
      const { grid } = open();
      grid.show(selection, tool.model);
      return document.body.querySelectorAll('*').length;
    })();
    const pointerOnly: string[] = [];
    for (let index = 0; index < count; index++) {
      const { grid, onPick, onChange } = open();
      grid.show(selection, tool.model);
      const target = document.body.querySelectorAll<HTMLElement>('*')[index];
      const before = document.body.innerHTML;
      // Asked first: a control may draw its own content again when it is used.
      const control = target.closest(`${native}, label`);
      for (const event of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) target.dispatchEvent(new MouseEvent(event, { bubbles: true, cancelable: true }));
      if (typeof target.click === 'function') target.click();
      else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const answered = document.body.innerHTML !== before || onPick.mock.calls.length > 0 || onChange.mock.calls.length > 0;
      if (answered && control === null) pointerOnly.push(target.outerHTML.slice(0, 120));
    }
    expect(pointerOnly).toEqual([]);
  });
});
