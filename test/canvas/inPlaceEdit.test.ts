import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, type Canvas } from '../../src/canvas/canvas';
import type { Done, GestureKind } from '../../src/canvas/gestures';
import { attachInPlaceEdit, type InPlaceEdit, type InPlaceOptions } from '../../src/canvas/inPlaceEdit';
import { arrangedRows, createScene, type SceneLabel } from '../../src/canvas/scene';
import { interpretBehavior, type Change } from '../../src/disl/behavior';
import { interpretConstraints } from '../../src/disl/constraints';
import { interpretToolbox } from '../../src/disl/toolbox';
import { createRegions } from '../../src/frame/page';
import { canvasTool } from './tool';

const made = canvasTool();
const behavior = interpretBehavior(made.specification, made.metamodel, made.expressions, {
  constraints: interpretConstraints(made.specification, made.metamodel, made.expressions).value,
  persistence: made.persistence, toolbox: interpretToolbox(made.specification, made.metamodel).value,
  layout: made.layout, coordinates: made.coordinates, notation: made.notation, viewpoints: made.viewpoints,
  rows: (config, model) => arrangedRows(made.sceneTool, model, createScene(made.sceneTool, model), config),
}).value;
const small = made.fixture('triggers-and-notes').value;

let host: SVGSVGElement;
let canvas: Canvas;
let editor: InPlaceEdit;
let intents: { outcome: Done; gesture: GestureKind }[];
let refusals: string[];
let readOnly: boolean;

const element = (id: string): SVGGElement => host.querySelector<SVGGElement>(`[data-element="${id}"]`)!;
const label = (id: string): SceneLabel => canvas.scene!.nodes.find((node) => node.id === id)!.labels[0];
const input = (): HTMLInputElement | HTMLTextAreaElement | null => document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.adp-inplace-input');
const refusal = (): HTMLElement => document.querySelector<HTMLElement>('.adp-inplace-refusal')!;
const key = (name: string, on: Element, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  on.dispatchEvent(event);
  return event;
};
const type = (text: string): void => {
  input()!.value = text;
};
const changes = (): readonly Change[] => intents.at(-1)!.outcome.changes;

function open(options: Partial<InPlaceOptions> = {}): void {
  editor?.dispose();
  canvas?.dispose();
  host = createRegions(document).canvas;
  document.body.replaceChildren(host);
  // A canvas of 800 by 600 pixels, 10 pixels in from the left of the window and 20 down.
  host.getBoundingClientRect = () => ({ left: 10, top: 20, right: 810, bottom: 620, x: 10, y: 20, width: 800, height: 600, toJSON: () => ({}) });
  canvas = createCanvas(host, { tool: made.sceneTool });
  canvas.show(small);
  canvas.setViewport({ x: 0, y: 0, zoom: 1 });
  editor = attachInPlaceEdit(canvas, {
    behavior,
    onIntent: (outcome, gesture) => void intents.push({ outcome, gesture }),
    onRefused: (sentence) => void refusals.push(sentence),
    readOnly: () => readOnly,
    ...options,
  });
}

beforeEach(() => {
  intents = [];
  refusals = [];
  readOnly = false;
  open();
});

afterEach(() => {
  editor.dispose();
  canvas.dispose();
});

describe('opening the editor of a label', () => {
  it('opens on a double press, over the box of the label, holding the text the label is edited as', () => {
    element('radio').querySelector('[data-label]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 150, clientY: 148 }));
    const field = input()!;
    expect(field.tagName).toBe('INPUT');
    expect(field.value).toBe('Transistor radio');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 16]);
    expect(field.getAttribute('aria-label')).toBe(element('radio').getAttribute('aria-label'));
    expect(editor.editing).toEqual({ element: 'radio', label: 'name' });
    // The label ends at its box's right edge, so the editor does, with room to type in.
    const { box } = label('radio');
    const frame = field.parentElement!;
    expect(frame.className).toBe('adp-inplace');
    expect(parseFloat(frame.style.left) + parseFloat(frame.style.width)).toBeCloseTo(10 + box.x + box.width);
    expect(parseFloat(frame.style.width)).toBeGreaterThanOrEqual(box.width);
    expect(parseFloat(frame.style.top)).toBeCloseTo(20 + box.y);
    expect(field.style.textAlign).toBe('right');
    expect(frame.previousElementSibling).toBe(canvas.controls);
    expect(host.contains(frame)).toBe(false);
  });

  it('opens with Enter and with F2 on the selected element, and holds the text to edit when the label shows more', () => {
    canvas.select(['transistor-invented']);
    element('transistor-invented').focus();
    expect(label('transistor-invented').text).not.toBe('Transistor invented');
    expect(key('F2', element('transistor-invented')).defaultPrevented).toBe(true);
    expect(input()!.value).toBe('Transistor invented');
    key('Escape', input()!);
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(element('transistor-invented'));
    key('Enter', element('transistor-invented'));
    expect(input()!.value).toBe('Transistor invented');
  });

  it('opens a field of several lines for a label that is edited so', () => {
    expect(editor.open('note-1')).toBe(true);
    expect(input()!.tagName).toBe('TEXTAREA');
    expect(input()!.value).toBe('Dates are illustrative.\n\nSee the readme.');
    const { box } = label('note-1');
    expect(parseFloat(input()!.parentElement!.style.left)).toBeCloseTo(10 + box.x);
    expect(parseFloat(input()!.style.height)).toBeCloseTo(box.height);
  });

  it('follows the zoom and the place of the viewport, when it opens and when they change', () => {
    canvas.setViewport({ x: 100, y: 50, zoom: 2 });
    editor.open('note-2');
    const { box, fontSize } = label('note-2');
    const frame = input()!.parentElement!;
    expect(parseFloat(frame.style.left)).toBeCloseTo(10 + (box.x - 100) * 2);
    expect(parseFloat(frame.style.top)).toBeCloseTo(20 + (box.y - 50) * 2);
    expect(parseFloat(frame.style.width)).toBeCloseTo(box.width * 2);
    expect(parseFloat(input()!.style.fontSize)).toBeCloseTo(fontSize * 2);
    host.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 0, bubbles: true, cancelable: true }));
    expect(parseFloat(frame.style.left)).toBeCloseTo(10 + (box.x - 100) * 2 - 30);
  });

  it('does not open without a selection, on a relation, on an element it does not know, or in a diagram that cannot be changed', () => {
    host.focus();
    expect(key('Enter', host).defaultPrevented).toBe(false);
    canvas.select(['i-13']);
    expect(key('F2', host).defaultPrevented).toBe(false);
    expect(editor.open('nothing')).toBe(false);
    readOnly = true;
    expect(editor.open('radio')).toBe(false);
    element('radio').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(input()).toBeNull();
    expect(editor.editing).toBeUndefined();
  });

  it('leaves a key with a modifier to the page', () => {
    canvas.select(['radio']);
    expect(key('Enter', host, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(input()).toBeNull();
  });
});

describe('committing', () => {
  it('commits with Enter through the behavior, parsed as the specification asks, as one intent', () => {
    editor.open('transistor-invented');
    type('  Point contact ');
    expect(key('Enter', input()!).defaultPrevented).toBe(true);
    expect(intents.map((intent) => intent.gesture)).toEqual(['editLabel']);
    expect(changes()).toEqual([{ kind: 'set', id: 'transistor-invented', attributes: { name: 'Point contact' } }]);
    expect(input()).toBeNull();
    expect(editor.editing).toBeUndefined();
    expect(document.activeElement).toBe(element('transistor-invented'));
    expect(canvas.model).toBe(small);
  });

  it('commits when the field loses the focus', () => {
    editor.open('radio');
    type('Pocket radio');
    host.focus();
    expect(changes()).toEqual([{ kind: 'set', id: 'radio', attributes: { name: 'Pocket radio' } }]);
    expect(intents).toHaveLength(1);
    expect(input()).toBeNull();
  });

  it('cancels with Escape, and closes without an intent when the text is as it was', () => {
    editor.open('radio');
    type('Something else');
    expect(key('Escape', input()!).defaultPrevented).toBe(true);
    expect(input()).toBeNull();
    editor.open('radio');
    key('Enter', input()!);
    expect(input()).toBeNull();
    expect(intents).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it('shows the sentence of a refusal and stays open, until a text is taken', () => {
    editor.open('radio');
    type('   ');
    key('Enter', input()!);
    expect(refusals).toEqual(['A trend needs a name.']);
    expect(refusal().textContent).toBe('A trend needs a name.');
    expect(refusal().getAttribute('role')).toBe('alert');
    expect(input()!.getAttribute('aria-invalid')).toBe('true');
    expect(input()!.getAttribute('aria-describedby')).toBe(refusal().id);
    expect(document.activeElement).toBe(input());
    expect(intents).toEqual([]);
    type('Wireless');
    key('Enter', input()!);
    expect(changes()).toEqual([{ kind: 'set', id: 'radio', attributes: { name: 'Wireless' } }]);
    expect(input()).toBeNull();
  });

  it('stays open with the sentence when a text that is refused loses the focus', () => {
    editor.open('radio');
    type(' ');
    host.focus();
    expect(refusals).toEqual(['A trend needs a name.']);
    expect(input()!.getAttribute('aria-invalid')).toBe('true');
    expect(intents).toEqual([]);
  });

  it('makes a new line with Shift and Enter in a field of several lines, and commits with Enter', () => {
    editor.open('note-2');
    type('First\n\nSecond');
    expect(key('Enter', input()!, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(input()).not.toBeNull();
    key('Enter', input()!);
    expect(changes()).toEqual([{ kind: 'set', id: 'note-2', attributes: { text: 'First\n\nSecond' } }]);
  });

  it('keeps the keys typed in the field from the canvas and the page', () => {
    editor.open('radio');
    const heard: string[] = [];
    const hear = (event: KeyboardEvent): void => void heard.push(event.key);
    document.body.addEventListener('keydown', hear);
    key('Delete', input()!);
    key('z', input()!, { ctrlKey: true });
    document.body.removeEventListener('keydown', hear);
    expect(heard).toEqual([]);
  });

  it('closes one editor when another opens, and takes everything away when it is disposed', () => {
    editor.open('radio');
    type('Lost');
    editor.open('note-2');
    expect(document.querySelectorAll('.adp-inplace')).toHaveLength(1);
    expect(editor.editing).toEqual({ element: 'note-2', label: 'text' });
    expect(intents).toEqual([]);
    editor.dispose();
    expect(document.querySelector('.adp-inplace')).toBeNull();
    canvas.select(['radio']);
    key('F2', host);
    expect(input()).toBeNull();
  });
});

describe('canvas.css', () => {
  it('styles the editor from the properties of Notion', () => {
    const css = readFileSync('src/canvas/canvas.css', 'utf8');
    expect(css).toMatch(/\.adp-inplace-input \{[^}]*var\(--notion-background-input\)/);
    expect(css).toMatch(/\.adp-inplace-input:focus-visible \{[^}]*var\(--notion-focus-ring\)/);
    expect(css).toMatch(/\.adp-inplace-refusal \{[^}]*var\(--notion-error-text\)/);
  });
});
