import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, type Canvas } from '../../src/canvas/canvas';
import { attachGestures, matchesShortcut, type Done, type GestureKind, type Gestures, type GestureOptions, type MenuPlace } from '../../src/canvas/gestures';
import { pathData, type Point } from '../../src/canvas/geometry';
import { arrangedRows, createScene, type SceneNode } from '../../src/canvas/scene';
import { baseCoordinate, interpretBehavior, type Behavior, type Change, type Outcome, type Pending, type Question } from '../../src/disl/behavior';
import { interpretConstraints } from '../../src/disl/constraints';
import { parseYearMonth } from '../../src/disl/metamodel';
import type { Model } from '../../src/disl/model';
import { interpretToolbox } from '../../src/disl/toolbox';
import { createRegions } from '../../src/frame/page';
import { hypeCycleJson } from '../disl/tool';
import { canvasTool, exampleBody } from './tool';

// The specification the add-on ships, and one with what it does not use: a tool that draws a
// relation, a sticky tool, and keys bound to a tool and to an operation.
const withMore = (): unknown => {
  const json = hypeCycleJson() as { toolbox: { groups: { tools: Record<string, unknown>[] }[] }; behavior: { operations: Record<string, Record<string, unknown>> } };
  const tools = json.toolbox.groups[0].tools;
  tools[2] = { ...tools[2], sticky: true, shortcut: 'N' };
  tools.push({ id: 'link', creates: 'Influence' });
  json.behavior.operations.evenPhases.shortcut = 'Ctrl+E';
  return json;
};

function interpret(source?: unknown) {
  const made = canvasTool(source);
  const toolbox = interpretToolbox(made.specification, made.metamodel).value;
  const behavior = interpretBehavior(made.specification, made.metamodel, made.expressions, {
    constraints: interpretConstraints(made.specification, made.metamodel, made.expressions).value,
    persistence: made.persistence, toolbox, layout: made.layout, coordinates: made.coordinates, notation: made.notation, viewpoints: made.viewpoints,
    rows: (config, model) => arrangedRows(made.sceneTool, model, createScene(made.sceneTool, model), config),
  }).value;
  return { ...made, toolbox, behavior };
}

const shipped = interpret();
const more = interpret(withMore());
const small = shipped.fixture('triggers-and-notes').value;
const month = (text: string): number => parseYearMonth(text)!;
const trueTime = { env: { viewpoint: shipped.viewpoints.default, mode: 'light' } };

let host: SVGSVGElement;
let canvas: Canvas;
let gestures: Gestures;
let intents: { outcome: Done; gesture: GestureKind }[];
let refusals: string[];
let menus: { target: string | Pending | undefined; place: MenuPlace }[];
let questions: { question: Question; proceed: () => void }[];
let told: (string | undefined)[];
let selected: (readonly string[])[];
let readOnly: boolean;

const fire = (type: string, on: Element, at: Point, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y, ...init });
  on.dispatchEvent(event);
  return event;
};
const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  (document.activeElement && host.contains(document.activeElement) ? document.activeElement : host).dispatchEvent(event);
  return event;
};
const element = (id: string): SVGGElement => host.querySelector<SVGGElement>(`[data-element="${id}"]`)!;
const node = (id: string): SceneNode => canvas.scene!.nodes.find((drawn) => drawn.id === id)!;
const previewed = (look?: string): Element[] => [...host.querySelectorAll(`.adp-gesture-preview > ${look === undefined ? '*' : `.${look}`}`)];
const grips = (): string[] => [...host.querySelectorAll('.adp-gesture-grips > *')].map((grip) => `${grip.getAttribute('data-grip')}:${grip.getAttribute('data-of')}:${grip.getAttribute('data-name')}`);
const click = (on: Element, at: Point, init?: MouseEventInit): void => {
  fire('pointerdown', on, at, init);
  fire('pointerup', on, at, init);
};
/** A press on something and a drag to a point, not yet let go. */
const drag = (on: Element, from: Point, to: Point): void => {
  fire('pointerdown', on, from);
  fire('pointermove', host, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  fire('pointermove', host, to);
};
const changes = (): readonly Change[] => intents.at(-1)!.outcome.changes;
const done = (outcome: Outcome): Done => {
  if (outcome.refused !== undefined) throw new Error(outcome.refused);
  return outcome;
};
const outlines = (model: Model, id: string): string[] =>
  createScene(shipped.sceneTool, model).nodes.find((drawn) => drawn.id === id)!.parts.flatMap((part) => (part.shape.kind === 'path' ? [pathData(part.shape.commands)] : []));

function open(made: typeof shipped = shipped, model: Model = small, options: Partial<GestureOptions> = {}): void {
  canvas?.dispose();
  host = createRegions(document).canvas;
  document.body.replaceChildren(host);
  // A canvas of 800 by 600 pixels at the top left of the window, shown one to one: a pixel is a canvas unit.
  host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600, toJSON: () => ({}) });
  canvas = createCanvas(host, { tool: made.sceneTool, onSelect: (ids) => selected.push(ids) });
  canvas.show(model);
  canvas.setViewport({ x: 0, y: 0, zoom: 1 });
  gestures = attachGestures(canvas, {
    tool: made.sceneTool, behavior: made.behavior, toolbox: made.toolbox,
    onIntent: (outcome, gesture) => void intents.push({ outcome, gesture }),
    onRefused: (sentence) => void refusals.push(sentence),
    onMenu: (target, place) => void menus.push({ target, place }),
    onConfirm: (question, proceed) => void questions.push({ question, proceed }),
    onArmed: (tool) => void told.push(tool),
    readOnly: () => readOnly,
    ...options,
  });
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  intents = [];
  refusals = [];
  menus = [];
  questions = [];
  told = [];
  selected = [];
  readOnly = false;
  open();
});

afterEach(() => {
  gestures.dispose();
  canvas.dispose();
});

describe('moving', () => {
  it('previews where the behavior lands the element, and ends in one move that stores nothing', () => {
    const drawing = host.querySelector('.adp-canvas-nodes')!.innerHTML;
    drag(element('transistors'), { x: 280, y: 72 }, { x: 289, y: 102 });
    expect(gestures.running).toBe('move');
    // 9 units are two years and a bit, 30 are half a row and a bit: two years later, one row down.
    const landed = done(shipped.behavior.move(small, ['transistors'], { x: 9, y: 30 }, trueTime));
    expect(previewed('adp-gesture-ghost').map((path) => path.getAttribute('d'))).toEqual(outlines(landed.after, 'transistors'));
    expect(intents).toEqual([]);
    fire('pointerup', host, { x: 289, y: 102 });
    expect(intents).toHaveLength(1);
    expect(intents[0].gesture).toBe('move');
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { start: month('1952-01'), stop: month('1992-01'), row: 2 } }]);
    expect(intents[0].outcome.after).toEqual(landed.after);
    expect(previewed()).toEqual([]);
    expect(gestures.running).toBeUndefined();
    expect(canvas.model).toBe(small);
    expect(host.querySelector('.adp-canvas-nodes')!.innerHTML.replace(' data-selected="true"', '')).toBe(drawing);
    expect(selected).toEqual([['transistors']]);
  });

  it('takes a press that hardly travels for a press, and a drag that lands where it began for nothing', () => {
    fire('pointerdown', element('radio'), { x: 250, y: 128 });
    fire('pointermove', host, { x: 251, y: 129 });
    expect(gestures.running).toBeUndefined();
    fire('pointerup', host, { x: 251, y: 129 });
    drag(element('radio'), { x: 258, y: 128 }, { x: 259.5, y: 133 });
    expect(gestures.running).toBe('move');
    fire('pointerup', host, { x: 259.5, y: 133 });
    expect(intents).toEqual([]);
    expect(refusals).toEqual([]);
    expect(canvas.selection).toEqual(['radio']);
  });

  it('is cancelled by Escape, which leaves the drawing and the selection as they were', () => {
    drag(element('radio'), { x: 250, y: 128 }, { x: 300, y: 190 });
    expect(previewed().length).toBeGreaterThan(0);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(previewed()).toEqual([]);
    expect(gestures.running).toBeUndefined();
    fire('pointerup', host, { x: 300, y: 190 });
    expect(intents).toEqual([]);
    expect(canvas.selection).toEqual(['radio']);
  });

  it('moves every selected element when one of them is dragged, as one intent', () => {
    canvas.select(['radio', 'note-2']);
    drag(element('note-2'), { x: 300, y: 300 }, { x: 300, y: 356 });
    fire('pointerup', host, { x: 300, y: 356 });
    expect(intents).toHaveLength(1);
    expect(changes()).toEqual([{ kind: 'set', id: 'radio', attributes: { row: 3 } }, { kind: 'set', id: 'note-2', attributes: { row: 6 } }]);
  });

  it('follows the zoom and the place of the viewport', () => {
    canvas.setViewport({ x: 100, y: 20, zoom: 2 });
    const at = canvas.toScreen({ x: 280, y: 72 });
    drag(element('transistors'), at, { x: at.x + 16, y: at.y });
    fire('pointerup', host, { x: at.x + 16, y: at.y });
    // 16 pixels are 8 canvas units at this zoom: two years.
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { start: month('1952-01'), stop: month('1992-01') } }]);
  });

  it('draws a refused move where it was asked to land, and says the sentence when it is let go', () => {
    open(shipped, small, { behavior: { ...shipped.behavior, move: () => ({ refused: 'Not there.' }) } });
    drag(element('transistors'), { x: 280, y: 72 }, { x: 289, y: 102 });
    const [box] = previewed('adp-gesture-refused');
    expect([box.getAttribute('x'), box.getAttribute('y'), box.getAttribute('width')]).toEqual(['208', '112', '160']);
    fire('pointerup', host, { x: 289, y: 102 });
    expect(refusals).toEqual(['Not there.']);
    expect(intents).toEqual([]);
    expect(previewed()).toEqual([]);
  });

  it('moves the selection one step of its snapping with Alt and an arrow key, and leaves a plain arrow to the canvas', () => {
    click(element('transistors'), { x: 280, y: 72 });
    expect(key('ArrowRight', { altKey: true }).defaultPrevented).toBe(true);
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { start: month('1951-01'), stop: month('1991-01') } }]);
    key('ArrowUp', { altKey: true });
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { row: 0 } }]);
    expect(intents.map((intent) => intent.gesture)).toEqual(['move', 'move']);
    key('ArrowRight');
    expect(intents).toHaveLength(2);
    expect(canvas.selection).not.toEqual(['transistors']);
  });
});

describe('the grips of the selection', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  it('are the handles of its shape that are shown, the edges it may be resized at, and the ends of a relation that are on a part', async () => {
    expect(grips()).toEqual([]);
    click(element('radio'), { x: 250, y: 128 });
    await tick();
    expect(grips()).toEqual(['handle:radio:b1', 'handle:radio:b2', 'edge:radio:right', 'edge:radio:left']);
    canvas.select(['note-1']);
    gestures.refresh();
    expect(grips()).toEqual(['edge:note-1:top', 'edge:note-1:right', 'edge:note-1:bottom', 'edge:note-1:left']);
    canvas.select(['i-12']);
    await tick();
    expect(grips()).toEqual(['end:i-12:target']);
    canvas.select(['i-13']);
    await tick();
    expect(grips()).toEqual(['end:i-13:source', 'end:i-13:target']);
    readOnly = true;
    gestures.refresh();
    expect(grips()).toEqual([]);
  });

  it('follow the scene when the canvas draws another', async () => {
    canvas.select(['radio']);
    canvas.show(done(shipped.behavior.move(small, ['radio'], { x: 0, y: 56 }, trueTime)).after);
    await tick();
    expect(host.querySelector('[data-grip="edge"][data-name="left"]')!.getAttribute('y')).toBe(String(168 + 16 - 4));
  });
});

describe('resizing', () => {
  it('drags an edge the element may be resized at, and ends in one resize', () => {
    click(element('transistors'), { x: 280, y: 72 });
    drag(host, { x: 361, y: 72 }, { x: 371, y: 80 });
    expect(gestures.running).toBe('resize');
    // Ten units are two and a half years: a tie, which goes away from the origin.
    const landed = done(shipped.behavior.resize(small, 'transistors', { right: 10 }, trueTime));
    expect(previewed('adp-gesture-ghost').map((path) => path.getAttribute('d'))).toEqual(outlines(landed.after, 'transistors'));
    fire('pointerup', host, { x: 371, y: 80 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['resize']);
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { stop: month('1993-01') } }]);
    expect(canvas.selection).toEqual(['transistors']);
  });

  it('resizes both ways an element that may be, and moves an element pressed away from its edges', () => {
    click(element('note-2'), { x: 300, y: 300 });
    drag(host, { x: 300, y: 320 }, { x: 300, y: 340 });
    fire('pointerup', host, { x: 300, y: 340 });
    expect(changes()).toEqual([{ kind: 'set', id: 'note-2', attributes: { height: 60 } }]);
    drag(element('note-2'), { x: 300, y: 300 }, { x: 300, y: 356 });
    fire('pointerup', host, { x: 300, y: 356 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['resize', 'move']);
  });

  it('shows a refused resize as refused, and ends in the sentence of the specification with nothing changed', () => {
    click(element('radio'), { x: 250, y: 128 });
    drag(host, { x: 300, y: 128 }, { x: 200, y: 128 });
    expect(previewed('adp-gesture-refused')).toHaveLength(1);
    expect(previewed('adp-gesture-ghost')).toEqual([]);
    fire('pointerup', host, { x: 200, y: 128 });
    expect(refusals).toEqual(['A trend must stop after it starts, at least one month later.']);
    expect(intents).toEqual([]);
  });
});

describe('dragging a handle of a shape', () => {
  it('gives the behavior the share along the axis of the handle, and ends in one intent', () => {
    click(element('transistors'), { x: 280, y: 72 });
    drag(host, { x: 240, y: 72 }, { x: 260, y: 75 });
    expect(gestures.running).toBe('handle');
    const landed = done(shipped.behavior.dragHandle(small, 'transistors', 'b1', 60 / 160, trueTime));
    expect(previewed('adp-gesture-ghost').map((path) => path.getAttribute('d'))).toEqual(outlines(landed.after, 'transistors'));
    fire('pointerup', host, { x: 260, y: 75 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['handle']);
    expect(changes()).toEqual(landed.changes);
    expect(changes()).toHaveLength(1);
  });

  it('is a move when the element is not selected: a handle is offered on the selection', () => {
    drag(element('transistors'), { x: 240, y: 72 }, { x: 260, y: 72 });
    expect(gestures.running).toBe('move');
  });
});

describe('drawing a relation', () => {
  it('starts where a relation attaches, marks what it may be drawn to, and ends in one connection with both ends', () => {
    drag(element('radio'), { x: 260, y: 142 }, { x: 300, y: 59 });
    expect(gestures.running).toBe('connect');
    expect(previewed('adp-gesture-target')).toHaveLength(2);
    expect(previewed('adp-gesture-hover')).toHaveLength(1);
    expect(previewed('adp-gesture-line')).toHaveLength(1);
    fire('pointerup', host, { x: 300, y: 59 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['connect']);
    expect(changes()).toEqual([{
      kind: 'add', id: expect.any(String), type: 'Influence', source: 'radio', target: 'transistors',
      attributes: { fromPhase: 'slope', fromEdge: 'bottom', fromAt: 0.14, toPhase: 'slope', toEdge: 'top', toAt: 0.9 },
    }]);
    expect(previewed()).toEqual([]);
    expect(menus).toEqual([]);
  });

  it('shows a connection the specification refuses as refused, and ends in its sentence', () => {
    drag(element('transistors'), { x: 300, y: 86 }, { x: 250, y: 115 });
    expect(previewed('adp-gesture-hover')).toEqual([]);
    expect(previewed('adp-gesture-refused').length).toBeGreaterThan(0);
    fire('pointerup', host, { x: 250, y: 115 });
    expect(refusals).toEqual(['This trend already influences that one; a trend influences another once in each direction.']);
    expect(intents).toEqual([]);
  });

  it('comes to nothing when it is let go over nothing, or over what it cannot be drawn to', () => {
    drag(element('radio'), { x: 260, y: 142 }, { x: 600, y: 400 });
    fire('pointerup', host, { x: 600, y: 400 });
    drag(element('radio'), { x: 260, y: 142 }, { x: 300, y: 300 });
    fire('pointerup', host, { x: 300, y: 300 });
    expect(intents).toEqual([]);
    expect(refusals).toEqual([]);
    expect(previewed()).toEqual([]);
  });

  it('starts from a fixed anchor of an element that has them, and moves the element from elsewhere', () => {
    const { box } = node('transistor-invented');
    drag(element('transistor-invented'), { x: box.x + 15, y: box.y + 8 }, { x: 330, y: 70 });
    expect(gestures.running).toBe('connect');
    key('Escape');
    fire('pointerup', host, { x: 330, y: 70 });
    drag(element('transistor-invented'), { x: box.x + 5, y: box.y + 8 }, { x: box.x + 9, y: box.y + 8 });
    expect(gestures.running).toBe('move');
  });

  it('is drawn from anywhere on an element with a tool that draws a relation', () => {
    open(more);
    gestures.arm('link');
    expect(host.getAttribute('data-armed')).toBe('relation');
    drag(element('radio'), { x: 250, y: 128 }, { x: 300, y: 72 });
    expect(gestures.running).toBe('connect');
    fire('pointerup', host, { x: 300, y: 72 });
    expect(changes()).toMatchObject([{ kind: 'add', type: 'Influence', source: 'radio', target: 'transistors' }]);
    // The press was the tool's: the canvas selected nothing with it.
    expect(selected).toEqual([]);
  });

  it('is drawn with the keys: C from the selected element, the arrows to the next target, Enter to connect', () => {
    click(element('radio'), { x: 250, y: 128 });
    key('c');
    expect(gestures.running).toBe('connect');
    expect(previewed('adp-gesture-target')).toHaveLength(2);
    key('ArrowRight');
    key('ArrowLeft');
    expect(canvas.selection).toEqual(['radio']);
    key('Enter');
    expect(gestures.running).toBeUndefined();
    // No end was pointed at, so each attaches where the notation's default says.
    expect(changes()).toEqual(done(shipped.behavior.connect(small, 'Influence', 'radio', 'transistors', undefined, trueTime)).changes.map((change) => ({ ...change, id: expect.any(String) })));
    key('c');
    key('Escape');
    expect(gestures.running).toBeUndefined();
    expect(intents).toHaveLength(1);
  });

  it('hands a connection more than one entry could make to the menu, and connects when one is run', () => {
    const menu: Behavior['menu'] = (...given) => {
      const offered = shipped.behavior.menu(...given);
      return typeof given[1] === 'object' ? { ...offered, groups: [[...offered.groups[0], ...offered.groups[0]]] } : offered;
    };
    open(shipped, small, { behavior: { ...shipped.behavior, menu } });
    drag(element('radio'), { x: 260, y: 142 }, { x: 300, y: 59 });
    fire('pointerup', host, { x: 300, y: 59 });
    expect(intents).toEqual([]);
    expect(menus).toEqual([{ target: { source: 'radio', target: 'transistors' }, place: { point: { x: 300, y: 59 }, client: { x: 300, y: 59 }, ends: { source: { part: 'slope', side: 'bottom', at: 0.14 }, target: { part: 'slope', side: 'top', at: 0.9 } } } }]);
    expect(gestures.connect('Influence', 'radio', 'transistors', menus[0].place.ends)).toBe(true);
    expect(changes()).toMatchObject([{ kind: 'add', attributes: { fromAt: 0.14, toAt: 0.9 } }]);
  });
});

describe('where a relation can start', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve));
  const shown = (within: string): { x: number; y: number; r: number }[] =>
    [...host.querySelectorAll(within)].map((handle) => ({ x: Number(handle.getAttribute('cx')), y: Number(handle.getAttribute('cy')), r: Number(handle.getAttribute('r')) }));
  const hovering = (): { x: number; y: number; r: number }[] => shown('.adp-connect-handles > .adp-connect-handle-hover');
  const offered = (): { x: number; y: number; r: number }[] => shown('.adp-connect-handles > [data-of]');

  it('is shown under the pointer near an edge a relation leaves from, beside it too, and not in the middle of the element', () => {
    const { box } = node('radio');
    fire('pointermove', element('radio'), { x: 260, y: box.y + box.height - 3 });
    expect(hovering()).toEqual([{ x: 260, y: box.y + box.height, r: 4 }]);
    expect(host.hasAttribute('data-connect')).toBe(true);
    fire('pointermove', element('radio'), { x: 260, y: box.y + box.height / 2 });
    expect(hovering()).toEqual([]);
    expect(host.hasAttribute('data-connect')).toBe(false);
    // Beside the element the pointer is on the background, and the band is as wide there.
    fire('pointermove', host, { x: 260, y: box.y - 7 });
    expect(hovering()).toEqual([{ x: 260, y: box.y, r: 4 }]);
    fire('pointermove', host, { x: 260, y: box.y - 12 });
    expect(hovering()).toEqual([]);
    // An end of an element a relation leaves the top and the bottom of is not such a place.
    fire('pointermove', element('radio'), { x: box.x + 2, y: box.y + box.height / 2 });
    expect(hovering()).toEqual([]);
  });

  it('is each fixed anchor of an element that has them, and nothing of an element no relation leaves', () => {
    const { box } = node('transistor-invented');
    fire('pointermove', element('transistor-invented'), { x: box.x + box.width - 1, y: box.y + box.height / 2 });
    expect(hovering()).toEqual([{ x: box.x + box.width, y: box.y + box.height / 2, r: 4 }]);
    const note = node('note-2').box;
    fire('pointermove', element('note-2'), { x: note.x + 20, y: note.y + 1 });
    expect(hovering()).toEqual([]);
  });

  it('goes when the pointer leaves, is not shown on a diagram that cannot be changed, and is never smaller than a press finds', () => {
    const { box } = node('radio');
    fire('pointermove', element('radio'), { x: 260, y: box.y + 2 });
    expect(hovering()).toHaveLength(1);
    fire('pointerleave', host, { x: 900, y: 0 });
    expect(hovering()).toEqual([]);
    expect(host.hasAttribute('data-connect')).toBe(false);
    readOnly = true;
    fire('pointermove', element('radio'), { x: 260, y: box.y + 2 });
    expect(hovering()).toEqual([]);
    readOnly = false;
    canvas.setViewport({ x: 0, y: 0, zoom: 0.5 });
    fire('pointermove', element('radio'), canvas.toScreen({ x: 260, y: box.y + 2 }));
    expect(hovering()).toEqual([{ x: 260, y: box.y, r: 8 }]);
  });

  it('is shown on a selected element without the pointer: the middle of each side of each part, or each fixed anchor', async () => {
    click(element('radio'), { x: 250, y: 128 });
    await tick();
    const radio = node('radio');
    const parts = radio.parts.filter((part) => ['peak', 'trough', 'slope', 'plateau'].includes(part.id));
    expect(offered()).toEqual(parts.flatMap((part) => [
      { x: part.box.x + part.box.width / 2, y: part.box.y, r: 4 }, { x: part.box.x + part.box.width / 2, y: part.box.y + part.box.height, r: 4 },
    ]));
    expect(parts.length).toBeGreaterThan(0);
    click(element('transistor-invented'), { x: node('transistor-invented').box.x + 8, y: node('transistor-invented').box.y + 8 });
    await tick();
    const { box } = node('transistor-invented');
    expect(offered()).toEqual([{ x: box.x + 8, y: box.y, r: 4 }, { x: box.x + 16, y: box.y + 8, r: 4 }, { x: box.x + 8, y: box.y + 16, r: 4 }]);
    canvas.select(['note-2']);
    await tick();
    expect(offered()).toEqual([]);
    canvas.select(['radio']);
    readOnly = true;
    gestures.refresh();
    expect(offered()).toEqual([]);
  });

  it('draws a relation from a handle that is pressed, which leaves from the place of the handle', async () => {
    click(element('radio'), { x: 250, y: 128 });
    await tick();
    const part = node('radio').parts.find((candidate) => candidate.id === 'slope')!;
    const handle = { x: part.box.x + part.box.width / 2, y: part.box.y + part.box.height };
    const connect: Parameters<Behavior['connect']>[] = [];
    open(shipped, small, { behavior: { ...shipped.behavior, connect: (...given) => (connect.push(given), shipped.behavior.connect(...given)) } });
    canvas.select(['radio']);
    // Two units from the handle, and beside the element: the press is the handle's.
    drag(host, { x: handle.x + 2, y: handle.y + 2 }, { x: 300, y: 59 });
    expect(gestures.running).toBe('connect');
    expect(previewed('adp-gesture-target')).toHaveLength(2);
    expect(previewed('adp-gesture-hover')).toHaveLength(1);
    // The line leaves the handle, and the place it would attach at is shown on the target.
    expect(shown('.adp-gesture-preview > .adp-connect-handle')).toEqual([{ ...handle, r: 4 }, { ...canvas.toCanvas({ clientX: 300, clientY: 56 }), r: 4 }]);
    expect(previewed('adp-gesture-line')[0].getAttribute('d')).toBe(`M${handle.x},${handle.y}L300,56`);
    fire('pointerup', host, { x: 300, y: 59 });
    expect(connect.at(-1)!.slice(1, 5)).toEqual(['Influence', 'radio', 'transistors', { source: { part: 'slope', side: 'bottom', at: 0.5 }, target: { part: 'slope', side: 'top', at: 0.9 } }]);
    expect(intents.map((intent) => intent.gesture)).toEqual(['connect']);
    expect(changes()).toMatchObject([{ kind: 'add', source: 'radio', target: 'transistors', attributes: { fromPhase: 'slope', fromEdge: 'bottom', fromAt: 0.5 } }]);
    // The press was beside the element: the canvas neither panned nor cleared the selection.
    expect(canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(canvas.selection).toEqual(['radio']);
  });

  it('leaves a press in the middle of an element to select and move it, and an edge it is resized at to resize it', () => {
    click(element('radio'), { x: 250, y: 128 });
    drag(element('radio'), { x: 258, y: 128 }, { x: 258, y: 184 });
    expect(gestures.running).toBe('move');
    fire('pointerup', host, { x: 258, y: 184 });
    expect(changes()).toEqual([{ kind: 'set', id: 'radio', attributes: { row: 3 } }]);
    const { box } = node('radio');
    fire('pointermove', host, { x: box.x + box.width + 1, y: box.y + 1 });
    expect(hovering()).toEqual([]);
    drag(host, { x: box.x + box.width + 1, y: box.y + 1 }, { x: box.x + box.width + 9, y: box.y + 1 });
    expect(gestures.running).toBe('resize');
  });

  it('says nothing when a relation is let go on an element the specification gives no sentence for', () => {
    const menu: Behavior['menu'] = (...given) => {
      const offered = shipped.behavior.menu(...given);
      return typeof given[1] === 'object' ? { ...offered, groups: [] } : offered;
    };
    open(shipped, small, { behavior: { ...shipped.behavior, menu } });
    drag(element('radio'), { x: 260, y: 142 }, { x: 300, y: 59 });
    expect(previewed('adp-gesture-hover')).toEqual([]);
    expect(previewed('adp-gesture-refused')).toEqual([]);
    fire('pointerup', host, { x: 300, y: 59 });
    expect(refusals).toEqual([]);
    expect(intents).toEqual([]);
    expect(previewed()).toEqual([]);
  });
});

describe('dragging an end of a selected relation', () => {
  it('takes it to the nearest place on a part of its element, and ends in one intent', () => {
    click(element('i-13').querySelector('path')!, { x: 250, y: 100 });
    expect(canvas.selection).toEqual(['i-13']);
    drag(host, { x: 217.2, y: 112 }, { x: 240, y: 150 });
    expect(gestures.running).toBe('reattach');
    expect(previewed('adp-gesture-line')).toHaveLength(1);
    expect(previewed('adp-gesture-ghost')).toHaveLength(2);
    fire('pointerup', host, { x: 240, y: 150 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['reattach']);
    expect(changes()).toEqual([{ kind: 'set', id: 'i-13', attributes: { toPhase: 'trough', toEdge: 'bottom', toAt: 0.43 } }]);
    expect(canvas.selection).toEqual(['i-13']);
  });

  it('slides it with Alt and an arrow key: along its side, into the next part, and across to the other side', () => {
    canvas.select(['i-13']);
    host.focus();
    key('ArrowRight', { altKey: true });
    expect(changes()).toEqual([{ kind: 'set', id: 'i-13', attributes: { toAt: 0.2 } }]);
    key('ArrowLeft', { altKey: true, shiftKey: true });
    expect(changes()).toEqual([{ kind: 'set', id: 'i-13', attributes: { fromAt: 0.4 } }]);
    key('ArrowDown', { altKey: true });
    expect(changes()).toEqual([{ kind: 'set', id: 'i-13', attributes: { toEdge: 'bottom' } }]);
    canvas.show(done(shipped.behavior.reattach(small, 'i-13', 'target', { at: 0.95 }, trueTime)).after);
    key('ArrowRight', { altKey: true });
    expect(changes()).toEqual([{ kind: 'set', id: 'i-13', attributes: { toPhase: 'trough', toAt: 0 } }]);
    expect(intents.every((intent) => intent.gesture === 'reattach')).toBe(true);
    canvas.select(['i-12']);
    key('ArrowRight', { altKey: true, shiftKey: true });
    expect(refusals).toEqual(['This end cannot be moved.']);
  });
});

describe('a tool of the toolbox', () => {
  it('shows what it would create under the pointer, creates it where the pointer is let go, and is disarmed', () => {
    const tool = Object.values(shipped.toolbox.tools)[0];
    gestures.arm(tool.id);
    expect(gestures.armed).toBe(tool.id);
    expect(host.getAttribute('data-armed')).toBe('element');
    fire('pointermove', host, { x: 441, y: 130 });
    const landed = done(shipped.behavior.create(small, tool.id, { x: 441, y: 130 }, trueTime));
    expect(previewed('adp-gesture-ghost').length).toBeGreaterThan(0);
    expect(previewed('adp-gesture-ghost').map((path) => path.getAttribute('d'))).toEqual(outlines(landed.after, landed.created[0]));
    fire('pointerleave', host, { x: 900, y: 130 });
    expect(previewed()).toEqual([]);
    click(host, { x: 441, y: 130 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['create']);
    expect(changes()).toEqual(landed.changes.map((change) => ({ ...change, id: expect.any(String) })));
    expect(intents[0].outcome.created).toHaveLength(1);
    expect(gestures.armed).toBeUndefined();
    expect(told).toEqual([undefined]);
    expect(host.hasAttribute('data-armed')).toBe(false);
    // The press was the tool's: the canvas neither panned nor cleared its selection.
    expect(canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(selected).toEqual([]);
  });

  it('is used where a press that began in the toolbox is let go, and stays armed when the intent is not taken', () => {
    open(shipped, small, { onIntent: (outcome, gesture) => (intents.push({ outcome, gesture }), false) });
    gestures.arm('trigger');
    fire('pointerup', host, { x: 300, y: 300 });
    expect(changes()).toMatchObject([{ kind: 'add', type: 'Trigger', attributes: { date: month('1975-01'), row: 5 } }]);
    expect(gestures.armed).toBe('trigger');
  });

  it('is used at the centre of what the canvas shows without a pointer: by its entry, or by Enter while it is armed', () => {
    const centre = done(shipped.behavior.create(small, 'note', { x: 400, y: 300 }, trueTime));
    expect(gestures.drop('note')).toBe(true);
    expect(changes()).toEqual(centre.changes.map((change) => ({ ...change, id: expect.any(String) })));
    canvas.setViewport({ x: 100, y: 100, zoom: 2 });
    gestures.arm('trend');
    host.focus();
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(changes()).toEqual(done(shipped.behavior.create(small, 'trend', { x: 300, y: 250 }, trueTime)).changes.map((change) => ({ ...change, id: expect.any(String) })));
    expect(gestures.armed).toBeUndefined();
    expect(gestures.drop('cloud')).toBe(false);
  });

  it('stays armed when it is sticky, is armed by its key, and is disarmed by Escape', () => {
    open(more);
    host.focus();
    expect(key('n').defaultPrevented).toBe(true);
    expect(gestures.armed).toBe('note');
    click(host, { x: 500, y: 400 });
    click(host, { x: 520, y: 460 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['create', 'create']);
    expect(gestures.armed).toBe('note');
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(gestures.armed).toBeUndefined();
    expect(told).toEqual(['note', undefined]);
  });

  it('lands, in a viewpoint that varies another, where its point stands in that other', () => {
    const variant = Object.values(shipped.viewpoints.all).find((viewpoint) => viewpoint.variantOf !== undefined)!;
    canvas.setViewpoint(variant.name);
    canvas.setViewport({ x: 0, y: 0, zoom: 1 });
    const base = createScene(shipped.sceneTool, small);
    const pairs = canvas.scene!.nodes.map((placed) => ({ placed: placed.box.x, base: base.nodes.find((other) => other.id === placed.id)!.box.x }));
    gestures.arm('trend');
    fire('pointermove', host, { x: 60, y: 130 });
    expect(previewed('adp-gesture-ghost')).toHaveLength(1);
    click(host, { x: 60, y: 130 });
    const expected = done(shipped.behavior.create(small, 'trend', { x: baseCoordinate(pairs, 60), y: 130 }, { env: { viewpoint: variant.name } }));
    expect(changes()).toEqual(expected.changes.map((change) => ({ ...change, id: expect.any(String) })));
    expect(baseCoordinate(pairs, 60)).not.toBe(60);
  });
});

describe('removing the selection', () => {
  it('removes with Delete and with Backspace, as one intent', () => {
    click(element('note-1'), { x: 280, y: 200 });
    expect(key('Delete').defaultPrevented).toBe(true);
    expect(intents.map((intent) => intent.gesture)).toEqual(['remove']);
    expect(changes()).toEqual([{ kind: 'remove', id: 'note-1' }]);
    key('Backspace');
    expect(intents).toHaveLength(2);
    expect(questions).toEqual([]);
  });

  it('asks first when the deletion asks, and removes what goes with it in the same intent', () => {
    click(element('transistors'), { x: 280, y: 72 });
    key('Delete');
    expect(intents).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0].question.message).toBe('Removing this trend also removes the 2 influences to or from it.');
    questions[0].proceed();
    expect(intents).toHaveLength(1);
    expect(changes()).toEqual([{ kind: 'remove', id: 'i-12' }, { kind: 'remove', id: 'i-13' }, { kind: 'remove', id: 'transistors' }]);
  });

  it('does nothing with nothing selected, and leaves the key to the page then', () => {
    host.focus();
    expect(key('Delete').defaultPrevented).toBe(false);
    expect(intents).toEqual([]);
  });
});

describe('the keys of the specification', () => {
  it('reads a shortcut as a specification writes one', () => {
    const pressed = (name: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: name, ...init });
    expect(matchesShortcut('Delete', pressed('Delete'))).toBe(true);
    expect(matchesShortcut('Delete', pressed('Delete', { shiftKey: true }))).toBe(false);
    expect(matchesShortcut('Ctrl+E', pressed('e', { ctrlKey: true }))).toBe(true);
    expect(matchesShortcut('Ctrl+E', pressed('e', { metaKey: true }))).toBe(true);
    expect(matchesShortcut('Ctrl+E', pressed('e'))).toBe(false);
    expect(matchesShortcut('Ctrl+Shift+E', pressed('E', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut('Space', pressed(' '))).toBe(true);
    expect(matchesShortcut('F2', pressed('F2'))).toBe(true);
  });

  it('runs an operation by its key on the selection, and says why when it cannot run', () => {
    const dragged = done(more.behavior.dragHandle(small, 'transistors', 'b1', 0.4, trueTime)).after;
    open(more, dragged);
    click(element('radio'), { x: 250, y: 128 });
    expect(key('e', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(refusals).toEqual(['This trend\'s phases are already even.']);
    click(element('transistors'), { x: 280, y: 72 });
    key('e', { ctrlKey: true });
    expect(intents.map((intent) => intent.gesture)).toEqual(['operate']);
    expect(changes()).toEqual([{ kind: 'set', id: 'transistors', attributes: { peakEnd: null } }]);
    // An operation that is not for what is selected is not run, and its key is left to the page.
    click(element('note-1'), { x: 280, y: 200 });
    expect(key('e', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('runs an operation at a point when it is invoked at one', () => {
    gestures.operate('addNoteHere', { x: 400, y: 300 });
    expect(intents.map((intent) => intent.gesture)).toEqual(['operate']);
    expect(changes()).toMatchObject([{ kind: 'add', type: 'Note', attributes: { at: month('2000-01'), row: 5 } }]);
  });
});

describe('a context menu', () => {
  it('is asked for on what was pressed with the other button, and on the empty canvas', () => {
    const event = fire('contextmenu', element('radio'), { x: 250, y: 128 }, { button: 2 });
    expect(event.defaultPrevented).toBe(true);
    expect(menus).toEqual([{ target: 'radio', place: { point: { x: 250, y: 128 }, client: { x: 250, y: 128 }, hit: canvas.hitTest({ x: 250, y: 128 }) } }]);
    fire('contextmenu', host, { x: 600, y: 500 }, { button: 2 });
    expect(menus[1]).toEqual({ target: undefined, place: { point: { x: 600, y: 500 }, client: { x: 600, y: 500 }, hit: undefined } });
    expect(intents).toEqual([]);
  });

  it('is asked for with the menu key and with Shift and F10, on the selection', () => {
    click(element('radio'), { x: 250, y: 128 });
    expect(key('ContextMenu').defaultPrevented).toBe(true);
    expect(menus[0]).toEqual({ target: 'radio', place: { point: { x: 258, y: 128 }, client: { x: 258, y: 128 }, hit: undefined } });
    key('Escape');
    key('F10', { shiftKey: true });
    expect(menus[1]).toEqual({ target: undefined, place: { point: { x: 400, y: 300 }, client: { x: 400, y: 300 }, hit: undefined } });
  });
});

describe('a diagram that cannot be changed', () => {
  it('starts no gesture and hears no key that changes it, and still asks for a menu', () => {
    readOnly = true;
    click(element('transistors'), { x: 280, y: 72 });
    drag(element('transistors'), { x: 280, y: 72 }, { x: 300, y: 130 });
    expect(gestures.running).toBeUndefined();
    fire('pointerup', host, { x: 300, y: 130 });
    expect(key('Delete').defaultPrevented).toBe(false);
    key('ArrowRight', { altKey: true });
    gestures.arm('trend');
    click(host, { x: 500, y: 300 });
    expect(gestures.drop('trend')).toBe(false);
    gestures.remove();
    gestures.operate('addNoteHere', { x: 1, y: 1 });
    expect(gestures.connect('Influence', 'radio', 'transistors')).toBe(false);
    expect(intents).toEqual([]);
    expect(refusals).toEqual([]);
    fire('contextmenu', element('radio'), { x: 250, y: 128 }, { button: 2 });
    expect(menus).toHaveLength(1);
  });
});

describe('beside the canvas', () => {
  it('leaves a press on the background to the canvas, which pans', () => {
    fire('pointerdown', host, { x: 600, y: 500 });
    fire('pointermove', host, { x: 640, y: 480 });
    fire('pointerup', host, { x: 640, y: 480 });
    expect(canvas.viewport).toEqual({ x: -40, y: 20, zoom: 1 });
    expect(intents).toEqual([]);
  });

  it('ends a drag with nothing changed when the pointer is let go outside the canvas', () => {
    drag(element('radio'), { x: 258, y: 128 }, { x: 300, y: 190 });
    fire('pointerup', document.body, { x: 900, y: 700 });
    expect(gestures.running).toBeUndefined();
    expect(previewed()).toEqual([]);
    expect(intents).toEqual([]);
    // The keys are the canvas's again.
    expect(key('Delete').defaultPrevented).toBe(true);
    expect(questions).toHaveLength(1);
  });

  it('leaves a press with the shift key to the canvas, which adds to the selection', () => {
    click(element('radio'), { x: 250, y: 128 });
    fire('pointerdown', element('note-2'), { x: 300, y: 300 }, { shiftKey: true });
    fire('pointermove', host, { x: 340, y: 360 }, { shiftKey: true });
    expect(gestures.running).toBeUndefined();
    expect(canvas.selection).toEqual(['radio', 'note-2']);
  });

  it('takes away what it added, and hears nothing more', () => {
    canvas.select(['radio']);
    gestures.refresh();
    gestures.arm('trend');
    gestures.dispose();
    expect(canvas.overlay.children).toHaveLength(0);
    expect(host.hasAttribute('data-armed')).toBe(false);
    drag(element('transistors'), { x: 280, y: 72 }, { x: 300, y: 130 });
    fire('pointerup', host, { x: 300, y: 130 });
    key('Delete');
    expect(intents).toEqual([]);
  });

  it('previews a drag in the largest example well within a frame', () => {
    const large = shipped.read(exampleBody('technology-trends')).value;
    open(shipped, large);
    const moved = canvas.scene!.nodes.find((drawn) => drawn.movable.x && drawn.parts.length > 0)!;
    canvas.setViewport({ x: moved.box.x - 100, y: moved.box.y - 100, zoom: 1 });
    const from = { x: 100 + moved.box.width / 2, y: 100 + moved.box.height / 2 };
    fire('pointerdown', element(moved.id), from);
    fire('pointermove', host, { x: from.x + 10, y: from.y });
    const moves = 50;
    const started = performance.now();
    for (let index = 0; index < moves; index++) fire('pointermove', host, { x: from.x + 10 + index * 3, y: from.y + index * 2 });
    const each = (performance.now() - started) / moves;
    expect(gestures.running).toBe('move');
    expect(previewed().length).toBeGreaterThan(0);
    expect(each).toBeLessThan(8);
    fire('pointerup', host, { x: from.x + 160, y: from.y + 100 });
    expect(intents).toHaveLength(1);
  });
});

describe('canvas.css', () => {
  it('styles what a gesture draws, each look by a property of Notion', () => {
    const css = readFileSync('src/canvas/canvas.css', 'utf8');
    for (const look of ['adp-gesture-ghost', 'adp-gesture-refused', 'adp-gesture-target', 'adp-gesture-hover', 'adp-gesture-grip', 'adp-gesture-line']) expect(css).toContain(`.${look}`);
    expect(css).toMatch(/\.adp-gesture-refused \{[^}]*var\(--notion-error-border\)/);
  });
});
