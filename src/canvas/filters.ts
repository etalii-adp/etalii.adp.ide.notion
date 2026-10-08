// The filters and the legend of a canvas (DISL 6.13, 6.13.1): the controls the notation declares,
// as HTML beside the drawing, and a filter applied by asking for the scene again. A filter is view
// state: it is in no document and no store.

import { createScene, type Scene, type SceneOptions, type SceneTool } from './scene';
import type { Paints } from './shapes';
import type { Metamodel } from '../disl/metamodel';
import type { Model, Value } from '../disl/model';
import { nodeNotation, styleOf, type Filter, type Notation } from '../disl/notation';
import { isCel, isObject, localized, type Message } from '../disl/specification';

/** The value of each filter that is not at its default, and whether an element must match any or all of it. */
export type FilterState = NonNullable<SceneOptions['filters']>;

/** The scene of a model with the filters set: an element a filter hides is not in it. */
export const applyFilters = (tool: SceneTool, model: Model, filters: FilterState, options: SceneOptions = {}): Scene => createScene(tool, model, { ...options, filters });

interface Told {
  readonly tool: SceneTool;
  readonly model: Model;
  readonly locale?: string;
}

/** A message as text: a sentence as it is, a localized one in the locale, and CEL evaluated over the model. */
export function sentenceOf(message: Message | undefined, told: Told): string {
  if (message === undefined) return '';
  if (!isCel(message)) return typeof message === 'string' ? message : localized(message, told.locale) ?? '';
  const result = told.tool.expressions.evaluate(message, told.tool.expressions.over(told.model).scope());
  return result.ok ? String(result.value ?? '') : '';
}

const evaluated = (value: unknown, told: Told): Value | undefined => {
  if (!isCel(value)) return value as Value | undefined;
  const result = told.tool.expressions.evaluate(value, told.tool.expressions.over(told.model).scope());
  return result.ok ? result.value : undefined;
};

/** What a filter offers to choose from, over the model: the values its `options` gives. */
export function filterChoices(filter: Filter, told: Told): string[] {
  const choices = evaluated(filter.options, told);
  return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === 'string') : [];
}

export interface FiltersOptions extends Told {
  readonly notation: Notation;
  readonly state: FilterState;
  /** The state after the user changed a control; the owner asks for a new scene with it. */
  onChange(state: FilterState): void;
}

/**
 * Writes the controls of the notation's filters into `host`, replacing what it held. A filter
 * with nothing to choose from is left out. The control that had the focus has it again.
 */
export function drawFilters(host: HTMLElement, options: FiltersOptions): void {
  const document = host.ownerDocument;
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && host.contains(active) ? { filter: active.dataset.filter, option: active.dataset.option, match: 'match' in active.dataset } : undefined;
  const made: HTMLElement[] = [];
  const html = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text = ''): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    element.className = name;
    element.textContent = text;
    return element;
  };

  for (const filter of Object.values(options.notation.canvas.filters)) {
    const now = options.state[filter.id] ?? {};
    const value = now.value ?? evaluated(filter.default, options) ?? null;
    const match = now.match ?? filter.match.default;
    const change = (next: { value?: Value; match?: 'any' | 'all' }): void => options.onChange({ ...options.state, [filter.id]: { value, match, ...next } });
    const label = sentenceOf(filter.label, options);
    const choices = filterChoices(filter, options);
    const group = html('fieldset', 'adp-filter');
    group.dataset.filter = filter.id;
    group.dataset.control = filter.control;

    if (filter.control === 'chips') {
      if (choices.length === 0) continue;
      const chosen = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      group.append(html('legend', 'adp-filter-label', label));
      for (const choice of choices) {
        const chip = html('button', 'adp-chip', choice);
        chip.type = 'button';
        chip.dataset.filter = filter.id;
        chip.dataset.option = choice;
        chip.setAttribute('aria-pressed', String(chosen.includes(choice)));
        chip.addEventListener('click', () => change({ value: chosen.includes(choice) ? chosen.filter((item) => item !== choice) : [...chosen, choice] }));
        group.append(chip);
      }
      if (filter.match.userToggle) {
        const toggle = html('button', 'adp-filter-match', match === 'all' ? 'All of them' : 'Any of them');
        toggle.type = 'button';
        toggle.dataset.filter = filter.id;
        toggle.dataset.match = match;
        toggle.setAttribute('aria-label', `${label}: ${toggle.textContent}`);
        toggle.addEventListener('click', () => change({ match: match === 'all' ? 'any' : 'all' }));
        group.append(toggle);
      }
    } else {
      const field = html('label', 'adp-filter-label', label);
      const control = filter.control === 'select' ? html('select', 'adp-filter-control') : html('input', 'adp-filter-control');
      control.dataset.filter = filter.id;
      if (control instanceof HTMLSelectElement) {
        for (const choice of ['', ...choices]) control.append(new (document.defaultView ?? window).Option(choice, choice, false, choice === value));
        control.addEventListener('change', () => change({ value: control.value }));
      } else if (filter.control === 'switch') {
        control.type = 'checkbox';
        control.checked = value === true;
        control.addEventListener('change', () => change({ value: control.checked }));
      } else {
        control.type = 'search';
        control.value = typeof value === 'string' ? value : '';
        control.addEventListener('change', () => change({ value: control.value }));
      }
      field.append(control);
      group.append(field);
    }
    made.push(group);
  }
  host.replaceChildren(...made);
  if (!focused) return;
  [...host.querySelectorAll<HTMLElement>('button[data-filter], input[data-filter], select[data-filter]')]
    .find((control) => control.dataset.filter === focused.filter && control.dataset.option === focused.option && ('match' in control.dataset) === focused.match)
    ?.focus();
}

export interface LegendOptions {
  readonly notation: Notation;
  readonly metamodel: Metamodel;
  /** The colours of the specification's theme in the appearance in use. */
  readonly paints: Paints;
  readonly locale?: string;
}

/**
 * Writes the legend the notation declares into `host`, replacing what it held: for an entry that
 * names an enum, one swatch for each of its values in the value's colour; for one that names a
 * type, one swatch in the fill the type is drawn with. A legend that is not visible writes nothing.
 */
export function drawLegend(host: HTMLElement, options: LegendOptions): void {
  const document = host.ownerDocument;
  const { notation, metamodel, paints } = options;
  const legend = notation.canvas.legend;
  const entries: { label: string; colour?: string; key: string }[] = [];
  for (const entry of legend?.visible ? legend.entries : []) {
    const values = Object.hasOwn(metamodel.enums, entry) ? metamodel.enums[entry].values : undefined;
    if (values) entries.push(...values.map((value) => ({ key: `${entry}.${value.key}`, label: value.label, colour: paints.colour(value.color) })));
    else if (Object.hasOwn(metamodel.types, entry)) entries.push({ key: entry, label: metamodel.types[entry].label, colour: paints.colour(styleOf(notation, nodeNotation(notation, metamodel, entry).style).fill) });
  }
  if (entries.length === 0) {
    host.replaceChildren();
    return;
  }
  const list = document.createElement('ul');
  list.className = 'adp-legend';
  const title = legend?.title === undefined || isCel(legend.title) ? '' : typeof legend.title === 'string' ? legend.title : isObject(legend.title) ? localized(legend.title, options.locale) ?? '' : '';
  list.setAttribute('aria-label', title || 'Legend');
  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'adp-legend-entry';
    item.dataset.entry = entry.key;
    const swatch = document.createElement('span');
    swatch.className = 'adp-legend-swatch';
    // The one colour here that is the specification's and not the page's.
    if (entry.colour) swatch.style.background = entry.colour;
    item.append(swatch, entry.label);
    list.append(item);
  }
  host.replaceChildren(list);
}
