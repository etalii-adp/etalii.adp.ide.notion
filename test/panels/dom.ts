// What the tests of the panels share: the two specifications interpreted, a page to put a panel in,
// and the keyboard as a browser applies it, which jsdom leaves out.
import { createExpressions } from '../../src/disl/expressions';
import { interpretForms } from '../../src/disl/forms';
import { interpretMetamodel } from '../../src/disl/metamodel';
import type { Model } from '../../src/disl/model';
import { loadSpecification } from '../../src/disl/specification';
import { interpretToolbox } from '../../src/disl/toolbox';
import { hypeCycleJson, mindmapJson, tool } from '../disl/tool';

export const addon = 'gartner-hype-cycle-graph';

/** A specification with its parts interpreted, as the page hands them to the panels. */
export function parts(source: unknown) {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  const expressions = createExpressions(specification, metamodel);
  return {
    specification, metamodel, expressions,
    toolbox: interpretToolbox(specification, metamodel).value,
    forms: interpretForms(specification, metamodel, expressions).value,
  };
}

export const hypeCycle = () => ({ ...parts(hypeCycleJson()), model: tool().fixture('triggers-and-notes').value });

/** A mind map of a root with one child: the second tool type, of which no part of the add-on knows. */
export function mindmap() {
  const node = (id: string, attributes: Model['elements'][number]['attributes'], parent?: string): Model['elements'][number] =>
    ({ id, type: 'Node', attributes, host: {}, parent, ephemeral: false, line: 1 });
  const model: Model = {
    diagram: {},
    elements: [node('ID_1', { text: 'Holiday', notes: 'Somewhere warm.\nNot too far.', link: 'https://example.org/holiday' }), node('ID_2', { text: 'Budget' }, 'ID_1')],
    relations: [],
  };
  return { ...parts(mindmapJson()), model };
}

/** An empty page of an add-on with nothing kept, and a region as the frame makes it. */
export function page(id: string): HTMLElement {
  document.body.replaceChildren();
  document.documentElement.dataset.addon = addon;
  return host(id);
}

export function host(id: string): HTMLElement {
  const section = document.createElement('section');
  section.id = id;
  section.className = `adp-${id}`;
  document.body.append(section);
  return section;
}

const shown = (element: Element): boolean => element.closest('[hidden]') === null;

/** The controls of a region: what a reader or a user can act on. */
export const controls = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex], [role="menuitem"]')].filter(shown);

/** The controls the Tab key stops at, in order. */
export const tabStops = (root: ParentNode): HTMLElement[] =>
  controls(root).filter((control) => control.tabIndex >= 0 && !(control as HTMLButtonElement).disabled);

const textOf = (root: Document, ids: string | null): string =>
  (ids ?? '').split(/\s+/).filter(Boolean).map((id) => root.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();

/** The name assistive technology reads for a control: `aria-labelledby`, `aria-label`, its label, else its own text. */
export function accessibleName(control: HTMLElement): string {
  const root = control.ownerDocument;
  const labelled = textOf(root, control.getAttribute('aria-labelledby'));
  if (labelled !== '') return labelled;
  const stated = control.getAttribute('aria-label')?.trim();
  if (stated) return stated;
  const labels = (control as HTMLInputElement).labels;
  if (labels && labels.length > 0) return [...labels].map((label) => label.textContent?.trim() ?? '').join(' ').trim();
  return control instanceof HTMLButtonElement || control.hasAttribute('role') ? control.textContent?.trim() ?? '' : '';
}

/** What describes a control beside its name: the texts `aria-describedby` points at. */
export const description = (control: HTMLElement): string => textOf(control.ownerDocument, control.getAttribute('aria-describedby'));

/**
 * A key pressed on the control that has the focus. A browser turns Enter and Space on a button into
 * a click unless a handler prevents it, and jsdom does not, so that is done here.
 */
export function press(control: HTMLElement, key: string, more: KeyboardEventInit = {}): boolean {
  control.focus();
  const went = control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more }));
  if (went && control instanceof HTMLButtonElement && (key === 'Enter' || key === ' ')) control.click();
  control.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...more }));
  return went;
}

/** A text typed into a control with the keyboard, not yet committed. */
export function type(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  control.focus();
  control.value = text;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A value chosen in a control with the keyboard: the browser reports it as a change. */
export function change(control: HTMLElement): void {
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The row of the property grid for an attribute, or for the id of an item that has none. */
export const row = (root: ParentNode, attribute: string): HTMLElement => {
  const found = [...root.querySelectorAll<HTMLElement>('[data-attribute]')].find((candidate) => candidate.dataset.attribute === attribute);
  if (!found) throw new Error(`No row for '${attribute}'.`);
  return found;
};
