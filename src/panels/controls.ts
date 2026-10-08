// The controls a form's widgets ask for (DISL 7.5), as rows of a label, a control and the sentence
// of a refusal. Each is a control of the browser's own, so the keyboard uses it as it uses any other,
// and each has its label tied to it. A row knows no form: it is handed what to show and whom to ask.

import type { Option } from '../disl/forms';
import type { Value } from '../disl/model';
import { icon } from './icons';
import { make, nextId } from './panel';

/** What a row shows: the widget, and the item's words and value for the selection. */
export interface ControlState {
  readonly widget: string;
  readonly label: string;
  readonly value: Value | undefined;
  /** The value as text, as the item's `display` words it. */
  readonly display: string;
  readonly placeholder: string;
  readonly options: readonly Option[];
  readonly widgetOptions: Readonly<Record<string, unknown>>;
  /** Nothing can be changed: the value is shown and there is no control. */
  readonly readOnly: boolean;
  /** Why it cannot be changed, when the specification says. */
  readonly reason?: string;
}

/** Whom a row asks. Each answers with the sentence of a refusal, or nothing when the value is taken. */
export interface ControlHandlers {
  /** A value while it is being entered. */
  check?(input: Value): string | undefined;
  /** A value that is committed. */
  commit(input: Value): string | undefined;
}

export interface Control {
  /** The row: a label, the control and the place of a refusal. */
  readonly element: HTMLElement;
  /** Shows another value. The widget, the label, the choices and whether it is read-only stay as they were made. */
  update(state: ControlState): void;
}

type Kind = 'text' | 'multiline' | 'number' | 'checkbox' | 'select' | 'choices' | 'slider' | 'tags' | 'display';

// The widgets of DISL 7.5 that have a control of their own here. Any other is edited as a text,
// which the item's `parse` reads: a date, a link and a list are texts the specification words.
const kinds: Readonly<Record<string, Kind>> = {
  textarea: 'multiline', markdown: 'multiline', code: 'multiline',
  number: 'number', spinner: 'number',
  checkbox: 'checkbox', switch: 'checkbox',
  select: 'select',
  radio: 'choices', segmented: 'choices',
  slider: 'slider',
  tags: 'tags',
  readonly: 'display', progress: 'display',
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const numberOf = (value: unknown): string | undefined => (typeof value === 'number' ? String(value) : undefined);

function choice(document: Document, label: string, value?: string): HTMLOptionElement {
  const made = document.createElement('option');
  made.textContent = label;
  if (value !== undefined) made.value = value;
  return made;
}

/** Makes the row of one item of a form. */
export function createControl(document: Document, state: ControlState, handlers: ControlHandlers): Control {
  const kind: Kind = state.readOnly ? 'display' : kinds[state.widget] ?? 'text';
  const id = nextId();
  const element = make(document, 'div', 'adp-field');
  const refusal = make(document, 'p', 'adp-field-refusal');
  refusal.id = `${id}-refusal`;
  refusal.setAttribute('role', 'alert');
  refusal.hidden = true;
  const reason = state.reason === undefined ? undefined : make(document, 'p', 'adp-field-reason', state.reason);
  if (reason) reason.id = `${id}-reason`;

  // What carries `aria-invalid` and the description: the control, or the group of a few choices.
  let described: HTMLElement = element;
  const describe = (): void => {
    const by = [reason?.id, refusal.hidden ? undefined : refusal.id].filter((part) => part !== undefined).join(' ');
    if (by === '') described.removeAttribute('aria-describedby');
    else described.setAttribute('aria-describedby', by);
  };
  const refuse = (sentence: string | undefined): boolean => {
    refusal.hidden = sentence === undefined;
    refusal.textContent = sentence ?? '';
    if (sentence === undefined) described.removeAttribute('aria-invalid');
    else described.setAttribute('aria-invalid', 'true');
    describe();
    return sentence === undefined;
  };
  // A label of the control with this row's id, or the name of a group when the row holds several controls.
  const label = (group = false): HTMLElement => {
    const made = make(document, group ? 'span' : 'label', 'adp-field-label', state.label);
    if (group) made.id = `${id}-label`;
    else (made as HTMLLabelElement).htmlFor = id;
    return made;
  };
  const finish = (control: HTMLElement, ...parts: HTMLElement[]): void => {
    described = control;
    element.append(...parts, ...(reason ? [reason] : []), refusal);
    describe();
  };

  let update: Control['update'];

  if (kind === 'display') {
    const output = make(document, 'output', 'adp-field-display', state.display);
    output.id = id;
    finish(output, label(), output);
    update = (next) => void (output.textContent = next.display);
  } else if (kind === 'text' || kind === 'multiline' || kind === 'number') {
    const input = make(document, kind === 'multiline' ? 'textarea' : 'input', 'adp-control');
    // A number is shown as it is stored: its display may be a phrase the control cannot hold.
    const textOf = (from: ControlState): string => (kind === 'number' ? numberOf(from.value) ?? '' : from.display);
    let shown = textOf(state);
    let attempted: string | undefined;
    // An edit that is taken shows the model again before it answers: what it then shows is the value.
    let committing = false;
    let followed = false;
    input.id = id;
    input.value = shown;
    input.placeholder = state.placeholder;
    if (input instanceof HTMLInputElement) {
      input.type = kind === 'number' ? 'number' : 'text';
      for (const limit of ['min', 'max', 'step'] as const) {
        const stated = numberOf(state.widgetOptions[limit]);
        if (kind === 'number' && stated !== undefined) input[limit] = stated;
      }
      if (state.options.length > 0) {
        const list = document.createElement('datalist');
        list.id = `${id}-options`;
        list.append(...state.options.map((option) => choice(document, option.label)));
        input.setAttribute('list', list.id);
        element.append(list);
      }
    }
    const commit = (): void => {
      if (input.value === shown || input.value === attempted) return;
      const typed = attempted = input.value;
      committing = true;
      followed = false;
      const taken = refuse(handlers.commit(typed));
      committing = false;
      if (taken && followed) input.value = shown;
      else if (taken) shown = typed;
    };
    input.addEventListener('input', () => {
      attempted = undefined;
      refuse(input.value === shown ? undefined : handlers.check?.(input.value));
    });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') {
        input.value = shown;
        attempted = undefined;
        refuse(undefined);
      } else if (key.key === 'Enter' && (kind !== 'multiline' || key.ctrlKey || key.metaKey)) {
        // Enter in a multi-line text is a new line.
        key.preventDefault();
        commit();
      }
    });
    finish(input, label(), input);
    update = (next) => {
      // What is being typed, or was refused, is the user's until it is committed or given up.
      const dirty = input.value !== shown;
      shown = textOf(next);
      followed = committing;
      if (!dirty) input.value = shown;
    };
  } else if (kind === 'checkbox') {
    const input = make(document, 'input', 'adp-checkbox');
    input.type = 'checkbox';
    input.id = id;
    let shown = state.value === true;
    input.checked = shown;
    input.addEventListener('change', () => {
      if (!refuse(handlers.commit(input.checked))) input.checked = shown;
    });
    finish(input, input, label());
    element.classList.add('adp-field-inline');
    update = (next) => void (input.checked = shown = next.value === true);
  } else if (kind === 'select') {
    const select = make(document, 'select', 'adp-control');
    select.id = id;
    const show = (value: Value | undefined): void => {
      const index = state.options.findIndex((option) => same(option.value, value));
      // A value that is none of the choices is shown as no choice, not as the first of them.
      select.replaceChildren(...(index < 0 ? [choice(document, '', '')] : []), ...state.options.map((option, at) => choice(document, option.label, String(at))));
      select.value = index < 0 ? '' : String(index);
    };
    let shown = state.value;
    show(shown);
    select.addEventListener('change', () => {
      if (select.value !== '' && !refuse(handlers.commit(state.options[Number(select.value)].value))) show(shown);
    });
    finish(select, label(), select);
    update = (next) => show(shown = next.value);
  } else if (kind === 'choices') {
    const name = label(true);
    const group = make(document, 'div', 'adp-choices');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', name.id);
    const inputs = state.options.map((option, at) => {
      const choice = make(document, 'label', 'adp-choice');
      const input = make(document, 'input', 'adp-choice-input');
      input.type = 'radio';
      input.name = id;
      input.value = String(at);
      choice.append(input, make(document, 'span', 'adp-choice-label', option.label));
      group.append(choice);
      return input;
    });
    let shown = state.value;
    const show = (): void => inputs.forEach((input, at) => void (input.checked = same(state.options[at].value, shown)));
    show();
    group.addEventListener('change', (event) => {
      const at = inputs.indexOf(event.target as HTMLInputElement);
      if (at >= 0 && !refuse(handlers.commit(state.options[at].value))) show();
    });
    finish(group, name, group);
    update = (next) => {
      shown = next.value;
      show();
    };
  } else if (kind === 'slider') {
    const input = make(document, 'input', 'adp-slider');
    input.type = 'range';
    input.id = id;
    for (const limit of ['min', 'max', 'step'] as const) input[limit] = numberOf(state.widgetOptions[limit]) ?? input[limit];
    const output = make(document, 'output', 'adp-slider-value');
    output.htmlFor.add(id);
    const marks = Array.isArray(state.widgetOptions.marks) ? (state.widgetOptions.marks as readonly { readonly value?: unknown; readonly label?: unknown }[]) : [];
    let shown = state;
    const show = (text: string): void => {
      output.textContent = text;
      input.setAttribute('aria-valuetext', text);
    };
    const reset = (): void => {
      input.value = numberOf(shown.value) ?? input.min;
      show(shown.display);
    };
    reset();
    // While it moves, the slider says where it is: the mark it is on, else the number.
    input.addEventListener('input', () => {
      const mark = marks.find((entry) => String(entry.value) === input.value);
      show(typeof mark?.label === 'string' ? mark.label : input.value);
    });
    input.addEventListener('change', () => {
      if (!refuse(handlers.commit(Number(input.value)))) reset();
    });
    finish(input, label(), input, output);
    update = (next) => {
      shown = next;
      reset();
    };
  } else {
    const box = make(document, 'div', 'adp-tags');
    const list = make(document, 'ul', 'adp-tags-list');
    const input = make(document, 'input', 'adp-tags-input');
    input.type = 'text';
    input.id = id;
    input.placeholder = state.placeholder;
    const offered = document.createElement('datalist');
    offered.id = `${id}-options`;
    offered.append(...state.options.map((option) => choice(document, option.label)));
    input.setAttribute('list', offered.id);
    let tags: readonly Value[] = [];
    const commit = (next: readonly Value[]): boolean => refuse(handlers.commit(next));
    const show = (value: Value | undefined): void => {
      const focused = list.contains(document.activeElement);
      tags = Array.isArray(value) ? value : [];
      list.replaceChildren(...tags.map((tag, at) => {
        const item = make(document, 'li', 'adp-tag');
        const remove = make(document, 'button', 'adp-tag-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${String(tag)}`);
        remove.append(icon(document, 'mdi-close'));
        remove.addEventListener('click', () => commit(tags.filter((_, index) => index !== at)));
        item.append(make(document, 'span', 'adp-tag-label', String(tag)), remove);
        return item;
      }));
      // The button that had the focus is gone with its tag.
      if (focused) input.focus();
    };
    show(state.value);
    const add = (): void => {
      const text = input.value.trim();
      if (text !== '' && (tags.includes(text) || commit([...tags, text]))) input.value = '';
    };
    input.addEventListener('input', () => refuse(undefined));
    input.addEventListener('keydown', (key) => {
      if (key.key === 'Enter' || key.key === ',') {
        key.preventDefault();
        add();
      } else if (key.key === 'Backspace' && input.value === '' && tags.length > 0) {
        commit(tags.slice(0, -1));
      } else if (key.key === 'Escape') {
        input.value = '';
        refuse(undefined);
      }
    });
    box.append(list, input, offered);
    finish(input, label(), box);
    update = (next) => show(next.value);
  }

  return { element, update };
}
