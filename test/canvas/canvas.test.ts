import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, type Canvas, type CanvasView } from '../../src/canvas/canvas';
import { createScene } from '../../src/canvas/scene';
import { scalesOf } from '../../src/disl/coordinates';
import { tokensOf } from '../../src/disl/notation';
import { createRegions } from '../../src/frame/page';
import { canvasTool, exampleBody } from './tool';

const made = canvasTool();
const small = made.fixture('triggers-and-notes').value;
const example = made.read(exampleBody('electric-vehicles')).value;
const variant = Object.values(made.viewpoints.all).find((viewpoint) => viewpoint.toggle)!;

let host: SVGSVGElement;
let canvas: Canvas;
let selected: (readonly string[])[];
let views: CanvasView[];

const element = (id: string) => host.querySelector<SVGGElement>(`[data-element="${id}"]`)!;
const ids = () => [...host.querySelectorAll('[data-element]')].map((drawn) => drawn.getAttribute('data-element'));
const marked = () => [...host.querySelectorAll('[data-selected="true"]')].map((drawn) => drawn.getAttribute('data-element'));
const key = (name: string, more: KeyboardEventInit = {}, on: Element = document.activeElement ?? host) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...more });
  on.dispatchEvent(event);
  return event;
};
const pointer = (type: string, on: Element, more: MouseEventInit = {}) => on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...more }));

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  host = createRegions(document).canvas;
  document.body.replaceChildren(host);
  selected = [];
  views = [];
  canvas = createCanvas(host, { tool: made.sceneTool, onSelect: (chosen) => selected.push(chosen), onView: (view) => views.push(view) });
});

afterEach(() => canvas.dispose());

describe('drawing a scene', () => {
  it('draws 50 nodes of the largest shape in under 1 second', () => {
    const body = ['gartner-hypecycle-graph: 1', 'trends:', ...Array.from({ length: 50 }, (_, index) => [
      `  - id: t${index}`, `    name: Trend number ${index}`, `    start: ${2000 + (index % 10)}-01`, `    stop: ${2012 + (index % 10)}-06`, `    row: ${index}`, '    phases: 4',
    ]).flat(), 'influences:', ...Array.from({ length: 49 }, (_, index) => [
      `  - id: i${index}`, `    from: t${index}`, '    from-phase: slope', '    from-edge: bottom', '    from-at: 0.5', `    to: t${index + 1}`, '    to-phase: peak', '    to-edge: top', '    to-at: 0.5',
    ]).flat(), ''].join('\n');
    const model = made.read(body).value;
    const started = performance.now();
    const scene = canvas.show(model);
    const taken = performance.now() - started;
    expect(scene.nodes).toHaveLength(50);
    expect(scene.nodes.every((node) => node.parts.length >= 4)).toBe(true);
    expect(host.querySelectorAll('.adp-canvas-nodes > [data-element]')).toHaveLength(50);
    expect(host.querySelectorAll('.adp-canvas-edges > [data-element]')).toHaveLength(49);
    expect(taken).toBeLessThan(1000);
  });

  it('gives every drawn element its id, its type and an accessible name', () => {
    const scene = createScene(made.sceneTool, small);
    canvas.draw(scene, small);
    expect(ids()).toEqual([...scene.nodes.map((node) => node.id), ...scene.edges.filter((edge) => edge.hidden === undefined).map((edge) => edge.id)]);
    for (const drawn of [...scene.nodes, ...scene.edges]) expect(element(drawn.id).getAttribute('data-type')).toBe(drawn.type);
    expect(element('transistors').getAttribute('aria-label')).toBe(`${made.metamodel.types[scene.nodes[0].type].label}: Transistors`);
    expect(element('i-13').getAttribute('aria-label')).toContain('Transistors → Transistor radio');
    expect([...host.querySelectorAll('[data-element]')].every((drawn) => drawn.getAttribute('tabindex') === '-1' && drawn.getAttribute('role') === 'graphics-symbol')).toBe(true);
    expect(host.getAttribute('tabindex')).toBe('0');
    expect(host.getAttribute('aria-label')).toBeTruthy();
    expect(element('transistors').querySelectorAll('text')).toHaveLength(1);
  });

  it('colours the drawing from the theme of the appearance in use, and draws again when it changes', async () => {
    canvas.show(small);
    const fill = () => element('transistors').querySelector('[data-part]')!.getAttribute('fill');
    const light = fill();
    expect(Object.values(tokensOf(made.notation.theme, 'light'))).toContain(light);
    document.documentElement.dataset.theme = 'dark';
    await new Promise((resolve) => setTimeout(resolve));
    expect(fill()).not.toBe(light);
    expect(Object.values(tokensOf(made.notation.theme, 'dark'))).toContain(fill());
    expect(views.at(-1)?.mode).toBe('dark');
  });

  it('keeps the viewport and the selection when it draws again', () => {
    canvas.show(small);
    canvas.setViewport({ x: 123, y: 45, zoom: 2 });
    canvas.select(['radio']);
    canvas.show(small);
    expect(canvas.viewport).toEqual({ x: 123, y: 45, zoom: 2 });
    expect(marked()).toEqual(['radio']);
    expect(host.querySelector('.adp-canvas-viewport')!.getAttribute('transform')).toBe('scale(2) translate(-123,-45)');
  });

  it('drops an element from the selection that is no longer drawn, and says so', () => {
    canvas.show(small);
    canvas.select(['radio', 'transistors']);
    canvas.show({ ...small, elements: small.elements.filter((held) => held.id !== 'radio'), relations: [] });
    expect(canvas.selection).toEqual(['transistors']);
    expect(selected).toEqual([['transistors']]);
  });

  it('draws the ruler of the axis for what it shows, following the zoom', () => {
    canvas.show(small);
    const units = [8, 0.05].map((zoom) => {
      canvas.setViewport({ zoom });
      return host.querySelector('.adp-canvas-rulers [data-unit]')?.getAttribute('data-unit');
    });
    expect(units[0]).toBeTruthy();
    expect(units[1]).toBeTruthy();
    expect(units[0]).not.toBe(units[1]);
  });

  it('has an overlay over the drawing, in canvas units', () => {
    canvas.show(small);
    expect(canvas.overlay.parentElement).toBe(host.querySelector('.adp-canvas-viewport'));
    expect(canvas.overlay.previousElementSibling?.getAttribute('class')).toBe('adp-canvas-edges');
  });
});

describe('the viewport', () => {
  it('fits the whole drawing the first time, never enlarged', () => {
    const scene = canvas.show(small);
    const { x, y, zoom } = canvas.viewport;
    expect(zoom).toBeLessThanOrEqual(1);
    const bounds = scene.bounds!;
    expect(x).toBeLessThanOrEqual(bounds.x);
    expect(y).toBeLessThanOrEqual(bounds.y);
    expect(x + 800 / zoom).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(y + 600 / zoom).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    canvas.setViewport({ x: 0, y: 0, zoom: 1 });
    canvas.fit();
    expect(canvas.viewport).toEqual({ x, y, zoom });
  });

  it('pans by the pointer on the background, and by the wheel', () => {
    canvas.show(small);
    canvas.setViewport({ x: 0, y: 0, zoom: 2 });
    pointer('pointerdown', host, { clientX: 100, clientY: 100 });
    pointer('pointermove', host, { clientX: 140, clientY: 80 });
    pointer('pointerup', host, { clientX: 140, clientY: 80 });
    expect(canvas.viewport).toEqual({ x: -20, y: 10, zoom: 2 });
    const wheel = new WheelEvent('wheel', { deltaX: 10, deltaY: 20, bubbles: true, cancelable: true });
    host.dispatchEvent(wheel);
    expect(canvas.viewport).toEqual({ x: -15, y: 20, zoom: 2 });
    expect(wheel.defaultPrevented).toBe(true);
  });

  it('zooms by the wheel with the control key, around the pointer', () => {
    canvas.show(small);
    canvas.setViewport({ x: 0, y: 0, zoom: 1 });
    const under = canvas.toCanvas({ clientX: 200, clientY: 100 });
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: 200, clientY: 100, bubbles: true, cancelable: true }));
    expect(canvas.viewport.zoom).toBeCloseTo(Math.E);
    expect(canvas.toCanvas({ clientX: 200, clientY: 100 }).x).toBeCloseTo(under.x);
    expect(canvas.toCanvas({ clientX: 200, clientY: 100 }).y).toBeCloseTo(under.y);
  });

  it('pans and zooms by the keyboard', () => {
    canvas.show(small);
    canvas.setViewport({ x: 0, y: 0, zoom: 1 });
    host.focus();
    expect(key('ArrowRight', { shiftKey: true }).defaultPrevented).toBe(true);
    key('ArrowDown', { shiftKey: true });
    expect(canvas.viewport).toEqual({ x: 40, y: 40, zoom: 1 });
    key('+');
    expect(canvas.viewport.zoom).toBe(1.25);
    key('-');
    expect(canvas.viewport.zoom).toBeCloseTo(1);
    const fitted = (canvas.fit(), canvas.viewport);
    canvas.setViewport({ x: 5, zoom: 3 });
    key('0');
    expect(canvas.viewport).toEqual(fitted);
  });

  it('keeps the zoom within its limits', () => {
    canvas.setViewport({ zoom: 1000 });
    expect(canvas.viewport.zoom).toBe(8);
    canvas.zoomBy(0.000001);
    expect(canvas.viewport.zoom).toBe(0.02);
  });

  it('leaves a key with the control key to the page', () => {
    canvas.show(small);
    expect(key('z', { ctrlKey: true }, host).defaultPrevented).toBe(false);
  });
});

describe('the selection', () => {
  beforeEach(() => canvas.show(small));

  it('selects the element under the pointer, and nothing on the background', () => {
    pointer('pointerdown', element('radio').querySelector('[data-part]')!);
    expect(marked()).toEqual(['radio']);
    expect(selected).toEqual([['radio']]);
    expect(document.activeElement).toBe(element('radio'));
    pointer('pointerdown', element('i-13').querySelector('path')!);
    expect(marked()).toEqual(['i-13']);
    pointer('pointerdown', host);
    pointer('pointerup', host);
    expect(marked()).toEqual([]);
    expect(selected).toEqual([['radio'], ['i-13'], []]);
  });

  it('adds to the selection and takes from it with the shift or the control key', () => {
    pointer('pointerdown', element('radio'));
    pointer('pointerdown', element('transistors'), { shiftKey: true });
    expect(canvas.selection).toEqual(['radio', 'transistors']);
    pointer('pointerdown', element('radio'), { ctrlKey: true });
    expect(canvas.selection).toEqual(['transistors']);
    expect(marked()).toEqual(['transistors']);
  });

  it('keeps several selected elements through a press on one of them, until the pointer is let go where it was pressed', () => {
    pointer('pointerdown', element('radio'));
    pointer('pointerdown', element('transistors'), { shiftKey: true });
    // A press that then moves is a drag of them all: the selection stays.
    pointer('pointerdown', element('radio'), { clientX: 10, clientY: 10 });
    expect(canvas.selection).toEqual(['radio', 'transistors']);
    pointer('pointermove', host, { clientX: 30, clientY: 10 });
    pointer('pointerup', host, { clientX: 30, clientY: 10 });
    expect(canvas.selection).toEqual(['radio', 'transistors']);
    // Let go where it was pressed, the pressed element is selected alone.
    pointer('pointerdown', element('radio'), { clientX: 10, clientY: 10 });
    expect(canvas.selection).toEqual(['radio', 'transistors']);
    pointer('pointerup', element('radio'), { clientX: 11, clientY: 10 });
    expect(canvas.selection).toEqual(['radio']);
    expect(selected.at(-1)).toEqual(['radio']);
    expect(document.activeElement).toBe(element('radio'));
  });

  it('moves through the elements with the arrow keys, selecting the one that has the focus', () => {
    const order = ids();
    host.focus();
    key('ArrowRight');
    expect(document.activeElement).toBe(element(order[0]!));
    expect(marked()).toEqual([order[0]]);
    key('ArrowDown');
    expect(marked()).toEqual([order[1]]);
    key('ArrowLeft');
    key('ArrowUp');
    expect(marked()).toEqual([order.at(-1)]);
    key('Home');
    expect(marked()).toEqual([order[0]]);
    key('End');
    expect(document.activeElement).toBe(element(order.at(-1)!));
    expect(selected.at(-1)).toEqual([order.at(-1)]);
  });

  it('moves through the elements with Tab, and lets Tab leave after the last', () => {
    const order = ids();
    host.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(marked()).toEqual([order[0]]);
    key('Tab');
    expect(document.activeElement).toBe(element(order[1]!));
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(marked()).toEqual([order[0]]);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    key('End');
    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('clears the selection with Escape and gives the canvas the focus', () => {
    pointer('pointerdown', element('radio'));
    key('Escape');
    expect(marked()).toEqual([]);
    expect(document.activeElement).toBe(host);
  });

  it('is set from outside without telling it back, and keeps the focus when it draws again', () => {
    canvas.select(['transistors']);
    expect(marked()).toEqual(['transistors']);
    expect(selected).toEqual([]);
    host.focus();
    key('End');
    const focused = document.activeElement!.getAttribute('data-element');
    canvas.show(small);
    expect(document.activeElement).toBe(element(focused!));
  });

  it('brings an element into view that is outside it', () => {
    canvas.setViewport({ x: 1e6, y: 1e6, zoom: 1 });
    canvas.reveal('radio');
    const box = canvas.scene!.nodes.find((node) => node.id === 'radio')!.box;
    const at = canvas.toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(at.x).toBeCloseTo(400);
    expect(at.y).toBeCloseTo(300);
  });
});

describe('the viewpoint, the filters and the legend', () => {
  it('offers the toggle of a variant, and switches to it and back', () => {
    canvas.show(small);
    const toggle = () => canvas.controls.querySelector<HTMLButtonElement>('button[data-viewpoint]')!;
    expect(toggle().dataset.viewpoint).toBe(variant.name);
    expect(toggle().textContent).toBe(variant.toggle!.label);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    const before = canvas.scene!.nodes.find((node) => node.id === 'transistors')!.box;
    toggle().focus();
    toggle().click();
    expect(canvas.view.viewpoint).toBe(variant.name);
    expect(canvas.scene!.viewpoint).toBe(variant.name);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(toggle());
    expect(canvas.scene!.nodes.find((node) => node.id === 'transistors')!.box).not.toEqual(before);
    expect(views.at(-1)?.viewpoint).toBe(variant.name);
    toggle().click();
    expect(canvas.view.viewpoint).toBe(made.viewpoints.default);
    expect(canvas.scene!.nodes.find((node) => node.id === 'transistors')!.box).toEqual(before);
  });

  it('fits the drawing again in another viewpoint', () => {
    canvas.show(small);
    canvas.setViewport({ x: 9e5, y: 9e5, zoom: 1 });
    canvas.setViewpoint(variant.name);
    const bounds = canvas.scene!.bounds!;
    expect(canvas.viewport.x).toBeLessThanOrEqual(bounds.x);
    expect(canvas.viewport.x).toBeGreaterThan(bounds.x - 1e4);
    expect(host.querySelector('.adp-canvas-rulers [data-unit]')).toBeNull();
  });

  it('applies a filter by drawing the scene with it', () => {
    canvas.show(example);
    const all = ids().length;
    const chip = canvas.controls.querySelector<HTMLButtonElement>('button[data-option]')!;
    chip.click();
    expect(canvas.view.filters).toEqual({ [chip.dataset.filter!]: { value: [chip.dataset.option], match: 'any' } });
    expect(canvas.scene!.filtered.length).toBeGreaterThan(0);
    expect(ids().length).toBeLessThan(all);
    expect(canvas.controls.querySelector(`button[data-option="${chip.dataset.option}"]`)!.getAttribute('aria-pressed')).toBe('true');
    canvas.setFilters({});
    expect(ids()).toHaveLength(all);
  });

  it('shows the legend of the notation beside the drawing', () => {
    canvas.show(small);
    const legend = made.notation.canvas.legend!;
    expect([...canvas.controls.querySelectorAll('.adp-legend li')].map((entry) => entry.textContent)).toEqual(made.metamodel.enums[legend.entries[0]].values.map((value) => value.label));
    expect(canvas.controls.previousElementSibling).toBe(host);
  });
});

describe('what a gesture is written against', () => {
  beforeEach(() => {
    canvas.show(small);
    canvas.setViewport({ x: 100, y: 50, zoom: 2 });
  });

  it('turns a pointer position into canvas units and back', () => {
    expect(canvas.toCanvas({ clientX: 40, clientY: 20 })).toEqual({ x: 120, y: 60 });
    expect(canvas.toScreen({ x: 120, y: 60 })).toEqual({ x: 40, y: 20 });
  });

  it('turns a canvas point into the values of the two axes', () => {
    const node = canvas.scene!.nodes.find((drawn) => drawn.id === 'transistors')!;
    const system = made.coordinates.systems[canvas.scene!.system];
    const scales = scalesOf(system, { unit: 'year' });
    const at = canvas.toAxis({ x: node.box.x, y: node.box.y });
    expect(at).toEqual({ system: system.name, x: scales.x.toValue(node.box.x), y: scales.y.toValue(node.box.y) });
    expect(at.y).toBeCloseTo(1);
    // 1950-01, counted in months from year 0.
    expect(at.x).toBeCloseTo(1950 * 12);
  });

  it('finds the element at a point, with the part, the label or the handle that was hit', () => {
    const node = canvas.scene!.nodes.find((drawn) => drawn.id === 'transistors')!;
    const inside = { x: node.box.x + 4, y: node.box.y + node.box.height / 2 };
    expect(canvas.hitTest(inside)).toMatchObject({ element: 'transistors', kind: 'node' });
    expect(node.parts.map((part) => part.id)).toContain(canvas.hitTest(inside)!.part);
    const label = canvas.scene!.nodes.find((drawn) => drawn.id === 'radio')!.labels[0];
    expect(canvas.hitTest({ x: label.box.x + 2, y: label.box.y + 2 })).toEqual({ element: 'radio', kind: 'node', label: label.id });
    const handle = node.handles.find((candidate) => candidate.visible);
    if (handle) expect(canvas.hitTest(handle)).toMatchObject({ element: 'transistors', handle: handle.param });
    const edge = canvas.scene!.edges.find((drawn) => drawn.id === 'i-13')!;
    const middle = { x: (edge.curve![0].x + 3 * edge.curve![1].x + 3 * edge.curve![2].x + edge.curve![3].x) / 8, y: (edge.curve![0].y + 3 * edge.curve![1].y + 3 * edge.curve![2].y + edge.curve![3].y) / 8 };
    expect(canvas.hitTest(middle)).toEqual({ element: 'i-13', kind: 'edge' });
    expect(canvas.hitTest({ x: -1e6, y: -1e6 })).toBeUndefined();
  });
});

describe('dispose', () => {
  it('takes away what the canvas added, and hears nothing more', () => {
    canvas.show(small);
    canvas.dispose();
    expect(host.children).toHaveLength(0);
    expect(document.querySelector('.adp-canvas-controls')).toBeNull();
    pointer('pointerdown', host);
    pointer('pointerup', host);
    expect(selected).toEqual([]);
  });
});

describe('canvas.css', () => {
  const css = readFileSync('src/canvas/canvas.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('states no colour, size or spacing of its own, and uses only properties notion.css states', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d*\.?\d+(?:px|pt|em|rem|ch)\b/gi) ?? []).toEqual([]);
    const stated = new Set([...readFileSync('src/panels/notion.css', 'utf8').matchAll(/(--notion-[\w-]+)\s*:/g)].map((match) => match[1]));
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
    expect(used.filter((name) => !stated.has(name))).toEqual([]);
    expect([...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))].filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });

  it('takes the selection mark and the focus from the Notion properties', () => {
    expect(css).toMatch(/\[data-selected="true"\][^{]*\{[^}]*var\(--notion-selection\)/);
    expect(css).toMatch(/focus-visible[^{]*\{[^}]*var\(--notion-focus-ring\)/);
    expect(readFileSync('src/frame/frame.css', 'utf8')).toMatch(/\.adp-canvas \{[^}]*var\(--notion-canvas-background\)/);
  });
});
