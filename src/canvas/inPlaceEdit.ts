// Editing a label in place (DISL 6.12): a field over the label's box, holding the text the label is
// edited as, which is committed through the behavior so that the specification's `parse` writes it.
// The field is HTML beside the SVG, placed where the label is drawn; it stores nothing itself.

import type { Canvas } from './canvas';
import type { Done, GestureKind } from './gestures';
import type { SceneLabel } from './scene';
import type { Behavior } from '../disl/behavior';
import type { Scope } from '../disl/expressions';

export interface InPlaceOptions {
  readonly behavior: Behavior;
  /** A text was committed and taken: one intent, with the gesture `editLabel`. */
  onIntent(outcome: Done, gesture: GestureKind): boolean | void;
  /** A text was refused. The sentence is also shown under the field, which stays open. */
  onRefused(sentence: string): void;
  /** No editor opens while this holds. */
  readonly readOnly?: boolean | (() => boolean);
  /** More members of `env` (DISL 12.2) for the behavior, beside the viewpoint and the appearance. */
  env?(): Scope;
}

export interface InPlaceEdit {
  /** What is being edited. */
  readonly editing: { readonly element: string; readonly label: string } | undefined;
  /** Opens the editor of an element's label: its first one that is edited in place when none is named. False when it has none. */
  open(element: string, label?: string): boolean;
  /** Closes the editor without committing. */
  close(): void;
  dispose(): void;
}

// The least width of the field in pixels, so that a short text can be made longer.
const least = 96;
let made = 0;

/** Attaches the editor to a canvas: a double press, Enter or F2 on a selected element opens it. */
export function attachInPlaceEdit(canvas: Canvas, options: InPlaceOptions): InPlaceEdit {
  const { host } = canvas;
  const document = host.ownerDocument;
  let current: { readonly element: string; readonly label: string; readonly own: boolean; readonly frame: HTMLElement; readonly field: HTMLInputElement | HTMLTextAreaElement; readonly refusal: HTMLElement } | undefined;

  const readOnly = (): boolean => (typeof options.readOnly === 'function' ? options.readOnly() : options.readOnly === true);
  const drawn = (id: string): Element | undefined => [...host.querySelectorAll('[data-element]')].find((group) => group.getAttribute('data-element') === id);
  const inPlace = (label: SceneLabel): boolean => label.editable === 'inline' || label.editable === 'multiline';
  const labelOf = (element: string, name?: string): SceneLabel | undefined =>
    canvas.scene?.nodes.find((node) => node.id === element)?.labels.find((label) => inPlace(label) && (name === undefined || label.id === name));

  // Over the label's box as it is drawn now; a field of one line keeps a least width, on the side the text is held at.
  function place(): void {
    if (!current) return;
    const label = labelOf(current.element, current.label);
    if (!label) return close();
    const { zoom } = canvas.viewport;
    const frame = host.getBoundingClientRect();
    const at = canvas.toScreen(label.box);
    const width = Math.max(label.box.width * zoom, label.editable === 'inline' ? least : 0);
    const spare = width - label.box.width * zoom;
    current.frame.style.left = `${frame.left + at.x - (label.align === 'end' ? spare : label.align === 'center' ? spare / 2 : 0)}px`;
    current.frame.style.top = `${frame.top + at.y}px`;
    current.frame.style.width = `${width}px`;
    current.field.style.height = `${label.box.height * zoom}px`;
    current.field.style.fontSize = `${label.fontSize * zoom}px`;
    current.field.style.textAlign = label.align === 'end' ? 'right' : label.align === 'center' ? 'center' : 'left';
  }

  function close(focus = false): void {
    const closed = current;
    // Emptied first: taking the field away makes it lose the focus, which must not commit.
    current = undefined;
    closed?.frame.remove();
    if (closed && focus) ((drawn(closed.element) as SVGElement | undefined) ?? host).focus({ preventScroll: true });
  }

  function commit(focus: boolean): void {
    if (!current) return;
    const { element, label, own, field, refusal } = current;
    const before = labelOf(element, label);
    if (!before || field.value === before.editText) return close(focus);
    const env = { ...options.env?.(), viewpoint: canvas.view.viewpoint, mode: canvas.view.mode };
    const outcome = options.behavior.editLabel(canvas.model, element, field.value, { env }, own ? undefined : label);
    if (outcome.refused !== undefined) {
      refusal.textContent = outcome.refused;
      field.setAttribute('aria-invalid', 'true');
      options.onRefused(outcome.refused);
      return;
    }
    close(focus);
    if (outcome.changes.length > 0 || outcome.effects.length > 0) options.onIntent(outcome, 'editLabel');
  }

  function open(element: string, name?: string): boolean {
    const label = readOnly() ? undefined : labelOf(element, name);
    if (!label) return false;
    close();
    const frame = document.createElement('div');
    frame.className = 'adp-inplace';
    // In a field of several lines Enter commits and Shift with Enter makes a new line, as in Notion.
    const lines = label.editable === 'multiline';
    const field = document.createElement(lines ? 'textarea' : 'input');
    field.className = 'adp-inplace-input';
    field.value = label.editText;
    field.setAttribute('aria-label', drawn(element)?.getAttribute('aria-label') ?? label.editText);
    const refusal = document.createElement('div');
    refusal.className = 'adp-inplace-refusal';
    refusal.id = `adp-inplace-refusal-${++made}`;
    refusal.setAttribute('role', 'alert');
    field.setAttribute('aria-describedby', refusal.id);
    frame.append(field, refusal);
    // The behavior takes the first label that is edited in place when none is named, which is how a label without an id is reached.
    current = { element, label: label.id, own: labelOf(element)?.id === label.id, frame, field, refusal };
    canvas.controls.after(frame);
    place();

    (field as HTMLElement).addEventListener('keydown', (event) => {
      // What is typed here is the field's: neither the canvas nor the page acts on it.
      event.stopPropagation();
      if (event.key === 'Escape') close(true);
      else if (event.key === 'Enter' && !(lines && event.shiftKey)) commit(true);
      else return;
      event.preventDefault();
    });
    field.addEventListener('input', () => {
      field.removeAttribute('aria-invalid');
      refusal.textContent = '';
    });
    field.addEventListener('blur', () => { if (current?.field === field) commit(false); });
    field.focus({ preventScroll: true });
    field.select();
    return true;
  }

  function onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const element = target?.closest('[data-element]')?.getAttribute('data-element');
    if (element === null || element === undefined) return;
    const pressed = target?.closest('[data-label]')?.getAttribute('data-label') ?? canvas.hitTest(canvas.toCanvas(event))?.label;
    if (open(element, pressed !== undefined && labelOf(element, pressed) ? pressed : undefined)) event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if ((event.key !== 'Enter' && event.key !== 'F2') || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (canvas.selection.length === 1 && open(canvas.selection[0])) event.preventDefault();
  }

  host.addEventListener('dblclick', onDoubleClick);
  host.addEventListener('keydown', onKeyDown);
  // Heard after the canvas moved what it shows.
  host.addEventListener('wheel', place);
  const window = document.defaultView;
  window?.addEventListener('resize', place);

  return {
    get editing() { return current && { element: current.element, label: current.label }; },
    open,
    close: () => close(),
    dispose() {
      close();
      host.removeEventListener('dblclick', onDoubleClick);
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('wheel', place);
      window?.removeEventListener('resize', place);
    },
  };
}
