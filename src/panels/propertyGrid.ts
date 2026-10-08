// The property grid (etalii.adp spec 012, contracts/shared-parts.md): the form of the specification's
// `forms` for the type of the selection, each item with the control its widget asks for. A value that
// is entered goes through the item's `validate` and `parse`, and then to the edit, whose answer is
// shown beside the control. It changes no model itself.

import { createExpressions, type Expressions } from '../disl/expressions';
import { formFor, interpretForms, type Form, type FormItem, type Forms, type Subject } from '../disl/forms';
import { interpretMetamodel, type Metamodel } from '../disl/metamodel';
import type { Model, Value } from '../disl/model';
import type { Specification } from '../disl/specification';
import { createControl, type Control, type ControlState } from './controls';
import { icon } from './icons';
import { createPanel, make, nextId, type EditResult, type Panel } from './panel';

export type { EditResult, Panel } from './panel';

export interface PropertyGridOptions {
  readonly specification: Specification;
  /** Nothing may be changed: every value is shown and there is no control. */
  readonly readOnly: boolean;
  /**
   * A value entered for an element: `''` is the diagram itself. `form` is the key of the form in the
   * specification's `forms`, `attribute` what the row's `data-attribute` holds, and `value` what was
   * entered: a text, or what the widget gives (a number, a truth value, a choice, a list).
   */
  onChange(element: string, form: string, attribute: string, value: unknown): EditResult;
  /**
   * The same for several selected elements at once, so that the change is one edit and one step of
   * undo. Without it, `onChange` is asked for each element in turn.
   */
  onChangeAll?(elements: readonly string[], form: string, attribute: string, value: unknown): EditResult;
  /** An operation asked for by a button of a form, on the selection. Without it a form shows no button. */
  onOperate?(operation: string, selection: readonly string[]): EditResult;
  /** The specification's parts when they are interpreted already; read from the specification when absent. */
  readonly forms?: Forms;
  readonly metamodel?: Metamodel;
  readonly expressions?: Expressions;
}

export interface PropertyGrid extends Panel {
  /** Element ids; empty shows the diagram's own form. Shown again with the same selection, it follows the model in place. */
  show(selection: readonly string[], model: Model): void;
}

/** Shows a part of a form again, for the selection as it now is. */
type Refresh = () => void;
const nothing: Refresh = () => undefined;

const containers = ['section', 'row', 'group', 'tabs'];
const same = (values: readonly unknown[]): boolean => values.every((value) => JSON.stringify(value ?? null) === JSON.stringify(values[0] ?? null));

export function createPropertyGrid(host: HTMLElement, options: PropertyGridOptions): PropertyGrid {
  const document = host.ownerDocument;
  const { panel, body } = createPanel(host, { id: 'property-grid', label: 'Property grid' });
  const { specification } = options;
  const metamodel = options.metamodel ?? interpretMetamodel(specification).value;
  const forms = options.forms ?? interpretForms(specification, metamodel, options.expressions ?? createExpressions(specification, metamodel)).value;
  // One object for every subject: the interpreter keeps what it computed for a model and an `env`.
  const env = options.readOnly ? { readOnly: true } : undefined;
  let subjects: readonly Subject[] = [];
  let shown: { readonly key: string; readonly refresh: Refresh } | undefined;

  // What a row shows for the selection: a value all its elements share, else none.
  const stateOf = (item: FormItem): ControlState => {
    const first = subjects[0];
    const displays = subjects.map((on) => item.display(on));
    const values = subjects.map((on) => item.value(on));
    const locks = subjects.map((on) => item.readOnly(on));
    return {
      widget: item.widget,
      label: item.label(first),
      value: same(values) ? values[0] : undefined,
      display: same(displays) ? displays[0] : '',
      placeholder: same(displays) ? item.placeholder(first) : 'Several values',
      options: item.options(first),
      widgetOptions: item.widgetOptions,
      readOnly: options.readOnly || locks.some((lock) => lock.readOnly),
      reason: locks.find((lock) => lock.reason !== undefined)?.reason,
    };
  };
  // What a control is made with and cannot follow by showing another value.
  const shapeOf = (state: ControlState): string => JSON.stringify([state.widget, state.label, state.placeholder, state.options, state.widgetOptions, state.readOnly, state.reason]);
  const visible = (item: FormItem): boolean => subjects.every((on) => item.visible(on));
  const nameOf = (item: FormItem): string => item.attribute ?? item.rowId(subjects[0]);

  const field = (form: Form, item: FormItem, parent: HTMLElement): Refresh => {
    const handlers = {
      check: (input: Value): string | undefined => subjects.map((on) => item.validate(on, input, 'input')).find((sentence) => sentence !== undefined),
      commit: (input: Value): string | undefined => {
        // Every element is asked before any is changed, so that a refusal changes none.
        for (const on of subjects) {
          const parsed = item.parse(on, input);
          if ('refused' in parsed) return parsed.refused;
        }
        if (options.onChangeAll && subjects.length > 1) {
          const result = options.onChangeAll(subjects.map((on) => on.element ?? ''), form.id, nameOf(item), input);
          return result.done ? undefined : result.sentence;
        }
        for (const on of [...subjects]) {
          const result = options.onChange(on.element ?? '', form.id, nameOf(item), input);
          if (!result.done) return result.sentence;
        }
        return undefined;
      },
    };
    let state = stateOf(item);
    let control: Control = createControl(document, state, handlers);
    parent.append(control.element);
    return () => {
      const next = stateOf(item);
      if (shapeOf(next) === shapeOf(state)) {
        control.update(next);
      } else {
        const made = createControl(document, next, handlers);
        const focused = control.element.contains(document.activeElement);
        control.element.replaceWith(made.element);
        if (focused) made.element.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
        control = made;
      }
      state = next;
      control.element.dataset.attribute = nameOf(item);
      control.element.hidden = !visible(item);
    };
  };

  const container = (form: Form, item: FormItem, parent: HTMLElement): Refresh => {
    const group = make(document, 'div', 'adp-form-group');
    const content = make(document, 'div', 'adp-form-items');
    const label = make(document, 'span', 'adp-form-heading-label');
    const heading = make(document, item.collapsible ? 'button' : 'h3', 'adp-form-heading');
    heading.id = nextId();
    group.setAttribute('role', 'group');
    if (heading instanceof HTMLButtonElement) {
      heading.type = 'button';
      const fold = (folded: boolean): void => {
        heading.setAttribute('aria-expanded', String(!folded));
        heading.replaceChildren(icon(document, folded ? 'mdi-menu-right' : 'mdi-menu-down'), label);
        content.hidden = folded;
      };
      fold(item.collapsed);
      heading.addEventListener('click', () => fold(!content.hidden));
    } else {
      heading.append(label);
    }
    group.append(heading, content);
    parent.append(group);
    const children = item.items.map((child) => render(form, child, content));
    return () => {
      label.textContent = item.label(subjects[0]);
      heading.hidden = label.textContent === '';
      if (heading.hidden) group.removeAttribute('aria-labelledby');
      else group.setAttribute('aria-labelledby', heading.id);
      group.hidden = !visible(item);
      for (const child of children) child();
    };
  };

  const button = (item: FormItem, parent: HTMLElement): Refresh => {
    const { operation } = item;
    if (operation === undefined || options.readOnly || !options.onOperate) return nothing;
    const row = make(document, 'div', 'adp-field');
    const made = make(document, 'button', 'adp-button');
    made.type = 'button';
    const refusal = make(document, 'p', 'adp-field-refusal');
    refusal.setAttribute('role', 'alert');
    refusal.hidden = true;
    made.addEventListener('click', () => {
      const result = options.onOperate!(operation, subjects.flatMap((on) => (on.element === undefined ? [] : [on.element])));
      refusal.hidden = result.done;
      refusal.textContent = result.done ? '' : result.sentence;
    });
    row.append(made, refusal);
    parent.append(row);
    return () => {
      made.textContent = item.label(subjects[0]) || operation;
      row.dataset.attribute = nameOf(item);
      row.hidden = !visible(item);
    };
  };

  const render = (form: Form, item: FormItem, parent: HTMLElement): Refresh => {
    if (containers.includes(item.kind)) return container(form, item, parent);
    if (item.kind === 'field' || item.kind === 'computed') return field(form, item, parent);
    if (item.kind === 'button') return button(item, parent);
    if (item.kind === 'divider') parent.append(make(document, 'hr', 'adp-form-divider'));
    if (item.kind !== 'text') return nothing;
    const text = make(document, 'p', 'adp-form-text');
    parent.append(text);
    return () => {
      text.textContent = item.label(subjects[0]);
      text.hidden = !visible(item);
    };
  };

  const say = (sentence: string): void => {
    shown = undefined;
    body.replaceChildren(make(document, 'p', 'adp-form-empty', sentence));
  };

  return Object.assign(panel, {
    show(selection: readonly string[], model: Model): void {
      const types = new Map([...model.elements, ...model.relations].map((element) => [element.id, element.type]));
      const ids = selection.filter((id) => types.has(id));
      const selected = [...new Set(ids.map((id) => types.get(id)!))];
      if (selected.length > 1) return say('The selection holds elements of several types.');
      const form = formFor(forms, selected[0]);
      subjects = ids.length === 0 ? [{ model, env }] : ids.map((element) => ({ model, element, env }));
      if (form.items.length === 0) return say(ids.length === 0 ? 'Nothing is selected.' : 'There is nothing to show for the selection.');

      const key = JSON.stringify([form.id, ids]);
      if (shown?.key !== key) {
        const grid = make(document, 'div', 'adp-form');
        grid.dataset.form = form.id;
        const title = make(document, 'h2', 'adp-form-title');
        grid.append(title);
        const rows = form.items.map((item) => render(form, item, grid));
        body.replaceChildren(grid);
        shown = {
          key,
          refresh: () => {
            const name = form.label(subjects[0]) || (selected[0] === undefined ? '' : metamodel.types[selected[0]]?.label ?? selected[0]);
            title.textContent = ids.length > 1 ? `${name} (${ids.length})` : name;
            title.hidden = name === '';
            for (const row of rows) row();
          },
        };
      }
      shown.refresh();
    },
  });
}
