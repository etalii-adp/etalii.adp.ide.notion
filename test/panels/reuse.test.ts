import { describe, expect, it, vi } from 'vitest';
import { formFor, rowsOf } from '../../src/disl/forms';
import { hasIcon } from '../../src/panels/icons';
import { openMenu } from '../../src/panels/menu';
import { createPropertyGrid } from '../../src/panels/propertyGrid';
import { createToolbox } from '../../src/panels/toolbox';
import { description, mindmap, page, press, row, type } from './dom';

// The panels with the specification of another tool type, the mind map's, and no line of them
// changed (etalii.adp spec 012, User Story 5 scenarios 1 and 2, FR-027, SC-007).

describe('the panels with the specification of another tool type', () => {
  const tool = mindmap();

  it('list that type\'s tools in the toolbox, with their names, icons and descriptions', () => {
    const onPick = vi.fn();
    const section = page('toolbox');
    createToolbox(section, { specification: tool.specification, readOnly: false, onPick });
    const items = [...section.querySelectorAll<HTMLElement>('[data-tool]')];
    expect(items.map((item) => [item.dataset.tool, item.querySelector('.adp-tool-label')!.textContent, item.querySelector('svg')!.dataset.icon, description(item)]))
      .toEqual([['node', 'Node', 'mdi-card-plus-outline', 'Drop on a node to add a child under it.']]);
    expect(hasIcon('mdi-card-plus-outline')).toBe(true);
    expect(section.querySelector('.adp-tools-heading')!.textContent).toBe('Mind map');
    press(items[0], 'Enter');
    expect(onPick.mock.calls).toEqual([['node']]);
  });

  it('show an element\'s attributes in the property grid, with the controls its forms ask for', () => {
    const onChange = vi.fn(() => ({ done: true }) as const);
    const section = page('property-grid');
    const grid = createPropertyGrid(section, { specification: tool.specification, readOnly: false, onChange });
    grid.show(['ID_1'], tool.model);
    const on = { model: tool.model, element: 'ID_1' };
    const form = formFor(tool.forms, 'Node');
    expect(section.querySelector<HTMLElement>('[data-form]')!.dataset.form).toBe('nodeProperties');
    expect([...section.querySelectorAll<HTMLElement>('[data-attribute]')].map((item) => item.dataset.attribute)).toEqual(rowsOf(form.items).map((item) => item.rowId(on)));
    const control = (attribute: string) => row(section, attribute).querySelector<HTMLInputElement>('input, textarea')!;
    expect(['text', 'notes', 'link'].map((attribute) => [control(attribute).tagName, control(attribute).labels![0].textContent, control(attribute).value])).toEqual([
      ['INPUT', 'Text', 'Holiday'], ['TEXTAREA', 'Notes', 'Somewhere warm.\nNot too far.'], ['INPUT', 'Link', 'https://example.org/holiday'],
    ]);
    expect(control('link').placeholder).toBe('Empty to unlink');
    // An item nothing can change is shown with the reason the specification gives for it.
    const identifier = row(section, 'identifier').querySelector('output')!;
    expect([identifier.textContent, identifier.labels[0].textContent]).toEqual(['ID_1', 'Identifier']);
    expect(description(identifier)).toBe('Freeplane gives every node its identifier and other files may link to it, so it is not ours to change.');
    expect([...section.querySelectorAll('.adp-form-heading')].map((heading) => heading.textContent)).toEqual(['View', 'Model']);

    type(control('text'), 'Summer holiday');
    press(control('text'), 'Enter');
    expect(onChange.mock.calls).toEqual([['ID_1', 'nodeProperties', 'text', 'Summer holiday']]);
  });

  it('show an entry of that type\'s context menu with its icon and shortcut', () => {
    const entries = tool.toolbox.contextMenus[0].entries.slice(0, 2).map((entry) => ({ label: String(entry.label), icon: entry.icon, shortcut: entry.shortcut, enabled: true }));
    const onPick = vi.fn();
    const menu = openMenu({ x: 10, y: 10 }, [entries], { onPick });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
    expect(items.map((item) => [item.querySelector('.adp-menu-label')!.textContent, item.querySelector('svg')!.dataset.icon, item.querySelector('.adp-menu-shortcut')!.textContent]))
      .toEqual([['Add child', 'mdi-subdirectory-arrow-right', 'Insert'], ['Add sibling', 'mdi-plus', 'Enter']]);
    menu.close();
  });
});
