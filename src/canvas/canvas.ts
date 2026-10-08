// The canvas of an add-on's page: a scene drawn into the SVG of `id="canvas"`, with the viewport,
// the viewpoint, the filters and the selection of one view (etalii.adp spec 012,
// contracts/addon-address.md). It reads and shows; what changes a document is a gesture, which is
// written against `toCanvas`, `toAxis`, `hitTest` and `overlay` and is no part of this module.

import { drawEdge } from './connectors';
import { drawFilters, drawLegend, sentenceOf, type FilterState } from './filters';
import { cubicPoints, distance, distanceTo, holds, inside, pathOutline, pointsOf, type Box, type Outline, type Point } from './geometry';
import { drawLabel, measureOf } from './labels';
import { drawRuler } from './ruler';
import { createScene, type Scene, type SceneShape, type SceneTool } from './scene';
import { drawNode, paintsOf, svg } from './shapes';
import { scalesOf } from '../disl/coordinates';
import { defaultOf } from '../disl/metamodel';
import { emptyModel, type Attributes, type Model } from '../disl/model';

/** What the canvas shows: the canvas point at the top left of the view, and how far it is zoomed in. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** What a scene of this canvas is asked for with. None of it is in a document. */
export interface CanvasView {
  readonly viewpoint: string;
  readonly filters: FilterState;
  /** The appearance in use: `data-theme` of the page, which is a mode of the specification's theme. */
  readonly mode: string;
}

/** What is at a point: an element, and the handle, the part or the label of it that was hit. */
export interface Hit {
  readonly element: string;
  readonly kind: 'node' | 'edge';
  /** The shape parameter a handle changes. */
  readonly handle?: string;
  readonly part?: string;
  readonly label?: string;
}

export interface CanvasOptions {
  readonly tool: SceneTool;
  /** The ids of the selected elements, each time the selection changes. */
  onSelect?(ids: readonly string[]): void;
  /** Told when the viewpoint, a filter or the appearance changed, after the canvas drew again. */
  onView?(view: CanvasView): void;
  /** The host's measure of a text, for a specification whose text metric is `host`. */
  textWidth?(text: string, fontSize: number): number;
  readonly locale?: string;
}

export interface Canvas {
  readonly host: SVGSVGElement;
  /** A group above the drawing, in canvas units, where a gesture draws what it is doing. */
  readonly overlay: SVGGElement;
  /** The filters, the legend and the viewpoint control: HTML beside the SVG, placed over it by the page. */
  readonly controls: HTMLElement;
  /** What is drawn, and the model it was drawn from. */
  readonly scene: Scene | undefined;
  readonly model: Model;
  readonly view: CanvasView;
  readonly viewport: Viewport;
  readonly selection: readonly string[];
  /** Draws a scene. The viewport and the selection stay; the first scene, and a scene of another viewpoint, is fitted. */
  draw(scene: Scene, model?: Model): void;
  /** Draws the scene of a model in this canvas's viewpoint, filters and appearance, and answers it. */
  show(model: Model): Scene;
  setViewpoint(name: string): void;
  setFilters(filters: FilterState): void;
  /** Shows the whole drawing. */
  fit(): void;
  setViewport(viewport: Partial<Viewport>): void;
  /** Moves what is shown by a number of screen pixels. */
  panBy(dx: number, dy: number): void;
  /** Zooms by a factor, keeping the point at these screen pixels of the canvas where it is; its centre when absent. */
  zoomBy(factor: number, at?: Point): void;
  select(ids: readonly string[]): void;
  /** Brings an element into view when it is outside it. */
  reveal(id: string): void;
  /** A pointer position in canvas units. */
  toCanvas(pointer: { readonly clientX: number; readonly clientY: number }): Point;
  /** A canvas point in screen pixels from the top left of the canvas. */
  toScreen(point: Point): Point;
  /** A canvas point as values of the two axes of the coordinate system that is drawn. */
  toAxis(point: Point): { readonly system: string; readonly x: number; readonly y: number };
  /** The topmost element at a canvas point, within a tolerance in canvas units; a few screen pixels when absent. */
  hitTest(point: Point, tolerance?: number): Hit | undefined;
  dispose(): void;
}

const minZoom = 0.02;
const maxZoom = 8;
// A size for a canvas that has none yet, as in a page that is not laid out.
const unsized = { width: 800, height: 600 };
const margin = 24;

const within = (shape: SceneShape, outline: Outline | undefined, point: Point): boolean => {
  if (shape.kind === 'path') return inside(pathOutline(shape.commands), point);
  if (shape.kind === 'ellipse') return inside({ kind: 'ellipse', box: shape.box }, point);
  return outline ? inside(outline, point) : holds(shape.box, point);
};

/** Makes the canvas of an SVG element. Nothing is drawn until `draw` or `show`. */
export function createCanvas(host: SVGSVGElement, options: CanvasOptions): Canvas {
  const document = host.ownerDocument;
  const root = document.documentElement;
  const { tool } = options;

  const viewportGroup = svg(document, 'g', { class: 'adp-canvas-viewport' });
  const nodesGroup = svg(document, 'g', { class: 'adp-canvas-nodes' });
  const edgesGroup = svg(document, 'g', { class: 'adp-canvas-edges' });
  const overlay = svg(document, 'g', { class: 'adp-canvas-overlay' });
  const rulers = svg(document, 'g', { class: 'adp-canvas-rulers' });
  viewportGroup.append(nodesGroup, edgesGroup, overlay);
  host.append(viewportGroup, rulers);
  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '0');
  if (!host.hasAttribute('role')) host.setAttribute('role', 'graphics-document');
  if (!host.hasAttribute('aria-label')) host.setAttribute('aria-label', 'Diagram');

  const controls = document.createElement('div');
  controls.className = 'adp-canvas-controls';
  const filtersHost = document.createElement('div');
  const legendHost = document.createElement('div');
  const viewpointsHost = document.createElement('div');
  controls.append(filtersHost, legendHost, viewpointsHost);
  host.after(controls);

  let scene: Scene | undefined;
  let model: Model = emptyModel;
  // Whether the scene is this canvas's own, so that it can be asked for again.
  let own = false;
  let viewpoint = tool.viewpoints.default;
  let filters: FilterState = {};
  let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  let selection: readonly string[] = [];
  let fitted: string | undefined;
  let order: string[] = [];
  const drawn = new Map<string, SVGGElement>();

  const notation = () => (tool.viewpoints.all[viewpoint] ?? tool.viewpoints.all[tool.viewpoints.default]).notation;
  const mode = (): string => root.dataset.theme ?? notation().theme.defaultMode ?? 'light';
  const view = (): CanvasView => ({ viewpoint, filters, mode: mode() });
  const size = (): { width: number; height: number } => {
    const box = host.getBoundingClientRect();
    return { width: box.width || unsized.width, height: box.height || unsized.height };
  };
  // The diagram's own attributes, with the default of each one that is not stored.
  const diagram = (): Attributes => ({
    ...Object.fromEntries(Object.entries(tool.metamodel.diagram).flatMap(([name, attribute]) => (defaultOf(attribute) === undefined ? [] : [[name, defaultOf(attribute)!]]))),
    ...model.diagram,
  });
  const system = () => tool.coordinates.systems[scene?.system ?? ''] ?? tool.coordinates.systems[tool.coordinates.default];

  // ---- the viewport ----

  function place(): void {
    viewportGroup.setAttribute('transform', `scale(${viewport.zoom}) translate(${-viewport.x},${-viewport.y})`);
    const { width, height } = size();
    const axes = system();
    const along = (from: number, length: number) => ({ from, to: from + length / viewport.zoom, zoom: viewport.zoom });
    rulers.replaceChildren(...[
      drawRuler(document, axes.x, diagram(), along(viewport.x, width), { across: height, locale: options.locale }),
      drawRuler(document, axes.y, diagram(), along(viewport.y, height), { across: width, locale: options.locale }),
    ].filter((ruler) => ruler !== undefined));
  }

  function setViewport(next: Partial<Viewport>): void {
    const zoom = Math.min(maxZoom, Math.max(minZoom, next.zoom ?? viewport.zoom));
    viewport = { x: next.x ?? viewport.x, y: next.y ?? viewport.y, zoom };
    place();
  }

  const panBy = (dx: number, dy: number): void => setViewport({ x: viewport.x - dx / viewport.zoom, y: viewport.y - dy / viewport.zoom });

  function zoomBy(factor: number, at?: Point): void {
    const { width, height } = size();
    const fixed = at ?? { x: width / 2, y: height / 2 };
    const zoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom * factor));
    // The canvas point under the fixed pixel is the same before and after.
    setViewport({ x: viewport.x + fixed.x / viewport.zoom - fixed.x / zoom, y: viewport.y + fixed.y / viewport.zoom - fixed.y / zoom, zoom });
  }

  function fit(): void {
    const bounds = scene?.bounds;
    const { width, height } = size();
    if (!bounds) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    // Never enlarged: a small drawing is shown at its own size, in the middle.
    const zoom = Math.min(1, Math.max(minZoom, Math.min((width - 2 * margin) / bounds.width, (height - 2 * margin) / bounds.height)));
    setViewport({ x: bounds.x + bounds.width / 2 - width / zoom / 2, y: bounds.y + bounds.height / 2 - height / zoom / 2, zoom });
  }

  const toScreen = (point: Point): Point => ({ x: (point.x - viewport.x) * viewport.zoom, y: (point.y - viewport.y) * viewport.zoom });
  const fromScreen = (point: Point): Point => ({ x: viewport.x + point.x / viewport.zoom, y: viewport.y + point.y / viewport.zoom });
  const inHost = (pointer: { readonly clientX: number; readonly clientY: number }): Point => {
    const box = host.getBoundingClientRect();
    return { x: pointer.clientX - box.left, y: pointer.clientY - box.top };
  };

  // ---- the selection ----

  function mark(): void {
    for (const [id, element] of drawn) {
      if (selection.includes(id)) element.setAttribute('data-selected', 'true');
      else element.removeAttribute('data-selected');
    }
  }

  function select(ids: readonly string[], tell = false): void {
    const next = [...new Set(ids)];
    const same = next.length === selection.length && next.every((id, index) => id === selection[index]);
    selection = next;
    mark();
    if (tell && !same) options.onSelect?.(selection);
  }

  function reveal(id: string): void {
    const node = scene?.nodes.find((candidate) => candidate.id === id);
    const edge = scene?.edges.find((candidate) => candidate.id === id);
    const at: Box | undefined = node?.box ?? (edge?.from && edge.to ? { x: Math.min(edge.from.x, edge.to.x), y: Math.min(edge.from.y, edge.to.y), width: Math.abs(edge.to.x - edge.from.x), height: Math.abs(edge.to.y - edge.from.y) } : undefined);
    if (!at) return;
    const { width, height } = size();
    const shown = { x: viewport.x, y: viewport.y, width: width / viewport.zoom, height: height / viewport.zoom };
    const centre = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
    if (!holds(shown, centre)) setViewport({ x: centre.x - shown.width / 2, y: centre.y - shown.height / 2 });
  }

  /** Selects one element and gives it the keyboard focus. */
  function go(id: string | undefined): void {
    if (id === undefined) return;
    select([id], true);
    reveal(id);
    drawn.get(id)?.focus({ preventScroll: true });
  }

  // ---- drawing ----

  function drawControls(): void {
    const told = { tool, model, locale: options.locale };
    drawFilters(filtersHost, { ...told, notation: notation(), state: filters, onChange: setFilters });
    drawLegend(legendHost, { notation: notation(), metamodel: tool.metamodel, paints: paintsOf(notation().theme, mode()), locale: options.locale });
    // A viewpoint and its variants are one view: each variant is offered as its toggle (DISL 3.5).
    const base = tool.viewpoints.all[viewpoint]?.variantOf ?? viewpoint;
    const focused = document.activeElement instanceof HTMLElement && viewpointsHost.contains(document.activeElement) ? document.activeElement.dataset.viewpoint : undefined;
    const toggles: HTMLElement[] = [];
    for (const name of tool.viewpoints.all[base]?.variants ?? []) {
      const toggle = tool.viewpoints.all[name]?.toggle;
      if (!toggle) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'adp-canvas-viewpoint';
      button.dataset.viewpoint = name;
      button.textContent = sentenceOf(toggle.label, told);
      button.setAttribute('aria-pressed', String(viewpoint === name));
      button.addEventListener('click', () => setViewpoint(viewpoint === name ? base : name));
      toggles.push(button);
    }
    viewpointsHost.replaceChildren(...toggles);
    if (focused !== undefined) toggles.find((toggle) => toggle.dataset.viewpoint === focused)?.focus();
  }

  function draw(next: Scene, from: Model = emptyModel, mine = false): void {
    const focused = document.activeElement instanceof Element && host.contains(document.activeElement) ? document.activeElement.getAttribute('data-element') : null;
    scene = next;
    model = from;
    own = mine;
    viewpoint = next.viewpoint;
    const used = notation();
    const paints = paintsOf(used.theme, mode());
    const measure = measureOf(used, options.textWidth);
    const typeLabel = (type: string): string => tool.metamodel.types[type]?.label ?? type;
    const names = new Map<string, string>();

    drawn.clear();
    order = [];
    const nodes: SVGGElement[] = [];
    for (const node of next.nodes) {
      const group = drawNode(document, node, paints);
      for (const label of node.labels) group.append(drawLabel(document, label, measure, paints));
      const name = node.labels.map((label) => label.text.trim()).filter(Boolean).join(', ') || node.tooltip || node.id;
      names.set(node.id, name);
      group.setAttribute('role', 'graphics-symbol');
      group.setAttribute('aria-label', `${typeLabel(node.type)}: ${name}`);
      if (node.dimmed) group.setAttribute('class', 'adp-canvas-dimmed');
      group.append(svg(document, 'rect', { class: 'adp-canvas-mark', x: node.box.x - 3, y: node.box.y - 3, width: node.box.width + 6, height: node.box.height + 6, rx: 3, 'stroke-width': 1.5 }));
      if (node.selectable) {
        group.setAttribute('tabindex', '-1');
        order.push(node.id);
      }
      drawn.set(node.id, group);
      nodes.push(group);
    }
    const edges: SVGGElement[] = [];
    for (const edge of next.edges) {
      const group = drawEdge(document, edge, paints);
      if (!group) continue;
      group.setAttribute('role', 'graphics-symbol');
      group.setAttribute('aria-label', `${typeLabel(edge.type)}: ${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}`);
      group.setAttribute('tabindex', '-1');
      // Under the line, and wider than it: what a selected edge is marked with.
      group.prepend(svg(document, 'path', { class: 'adp-canvas-mark', d: group.querySelector('path')?.getAttribute('d') ?? '', 'stroke-width': 7 }));
      order.push(edge.id);
      drawn.set(edge.id, group);
      edges.push(group);
    }
    nodesGroup.replaceChildren(...nodes);
    edgesGroup.replaceChildren(...edges);

    // An element that is no longer drawn is no longer selected.
    select(selection.filter((id) => drawn.has(id)), true);
    if (focused !== null) (drawn.get(focused) ?? host).focus({ preventScroll: true });
    drawControls();
    if (fitted !== next.viewpoint && next.bounds) {
      fitted = next.viewpoint;
      fit();
    } else {
      place();
    }
  }

  function show(from: Model): Scene {
    const made = createScene(tool, from, { viewpoint, filters, env: { mode: mode() }, textWidth: options.textWidth });
    draw(made, from, true);
    return made;
  }

  // The view changed: a scene of this canvas's own is asked for again, another one is drawn again as it is.
  function again(): void {
    if (own) show(model);
    else if (scene) draw(scene, model);
    options.onView?.(view());
  }

  function setViewpoint(name: string): void {
    if (name === viewpoint || !Object.hasOwn(tool.viewpoints.all, name)) return;
    viewpoint = name;
    again();
  }

  function setFilters(next: FilterState): void {
    filters = next;
    again();
  }

  // ---- hit testing ----

  function hitTest(point: Point, tolerance = 4 / viewport.zoom): Hit | undefined {
    if (!scene) return undefined;
    // Edges are drawn over the nodes, and the last drawn is on top.
    for (const edge of [...scene.edges].reverse()) {
      if (edge.hidden !== undefined || edge.path.length === 0) continue;
      const line = edge.curve ? cubicPoints(edge.curve) : pointsOf(edge.path);
      if (distanceTo(line, point) <= tolerance) return { element: edge.id, kind: 'edge' };
    }
    for (const node of [...scene.nodes].reverse()) {
      const handle = node.handles.find((candidate) => candidate.visible && distance(candidate, point) <= tolerance * 1.5);
      if (handle) return { element: node.id, kind: 'node', handle: handle.param };
      const part = [...node.parts].reverse().find((candidate) => candidate.hit && within(candidate.shape, undefined, point));
      if (part || within(node.shape, node.outline, point)) return { element: node.id, kind: 'node', part: part?.id };
      const label = node.labels.find((candidate) => holds(candidate.box, point));
      if (label) return { element: node.id, kind: 'node', label: label.id };
    }
    return undefined;
  }

  // ---- the pointer ----

  let pan: { x: number; y: number; moved: boolean; background: boolean } | undefined;
  // A press on one of several selected elements: it is selected alone once the pointer is let go where it was pressed.
  let kept: { id: string; x: number; y: number } | undefined;

  function onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target.closest('[data-element]') : null;
    const id = target && host.contains(target) ? target.getAttribute('data-element') : null;
    if (event.button === 0 && id !== null) {
      const more = event.shiftKey || event.ctrlKey || event.metaKey;
      // Until then the selection stays, so that a drag that begins here moves all of it.
      kept = !more && selection.length > 1 && selection.includes(id) ? { id, x: event.clientX, y: event.clientY } : undefined;
      if (!kept) select(more ? (selection.includes(id) ? selection.filter((other) => other !== id) : [...selection, id]) : [id], true);
      (drawn.get(id)?.hasAttribute('tabindex') ? drawn.get(id)! : host).focus({ preventScroll: true });
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    pan = { x: event.clientX, y: event.clientY, moved: false, background: event.button === 0 };
    host.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (kept && Math.hypot(event.clientX - kept.x, event.clientY - kept.y) >= 3) kept = undefined;
    if (!pan) return;
    const [dx, dy] = [event.clientX - pan.x, event.clientY - pan.y];
    // A press that hardly moves is a click on the background, not a pan.
    if (!pan.moved && Math.hypot(dx, dy) < 3) return;
    pan = { ...pan, x: event.clientX, y: event.clientY, moved: true };
    panBy(dx, dy);
  }

  function onPointerUp(event: PointerEvent): void {
    if (kept && event.type === 'pointerup') select([kept.id], true);
    kept = undefined;
    if (pan?.background && !pan.moved) select([], true);
    pan = undefined;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    // A pinch arrives as a wheel with the control key; a plain wheel scrolls what is shown.
    if (event.ctrlKey || event.metaKey) zoomBy(Math.exp(-event.deltaY / 300), inHost(event));
    else if (event.shiftKey) panBy(-event.deltaY, -event.deltaX);
    else panBy(-event.deltaX, -event.deltaY);
  }

  // ---- the keyboard ----

  function onKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement instanceof Element ? document.activeElement.getAttribute('data-element') : null;
    const at = order.indexOf(focused ?? selection[0] ?? '');
    const step = 40;
    const arrows: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[event.key];
    let handled = true;
    if (arrow && event.shiftKey) panBy(-arrow[0] * step, -arrow[1] * step);
    else if (arrow && order.length > 0) {
      const forwards = arrow[0] + arrow[1] > 0;
      go(at < 0 ? order.at(forwards ? 0 : -1) : order[(at + (forwards ? 1 : -1) + order.length) % order.length]);
    }
    else if (event.key === 'Tab') {
      // Tab walks through the elements and leaves the canvas after the last, as it does a list.
      const next = at + (event.shiftKey ? -1 : 1);
      if (focused === null && event.shiftKey) handled = false;
      else if (next < 0 || next >= order.length) handled = false;
      else go(order[next]);
    } else if (event.key === 'Home') go(order[0]);
    else if (event.key === 'End') go(order.at(-1));
    else if (event.key === '+' || event.key === '=') zoomBy(1.25);
    else if (event.key === '-') zoomBy(0.8);
    else if (event.key === '0') fit();
    else if (event.key === 'Escape') {
      select([], true);
      host.focus({ preventScroll: true });
    } else handled = false;
    if (handled) event.preventDefault();
  }

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', onPointerUp);
  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('keydown', onKeyDown);

  // The appearance and the size of the page are not told: they are watched.
  const window = document.defaultView;
  const appearance = window && 'MutationObserver' in window ? new window.MutationObserver(() => scene && again()) : undefined;
  appearance?.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const resized = window && 'ResizeObserver' in window ? new window.ResizeObserver(() => place()) : undefined;
  resized?.observe(host);

  return {
    host, overlay, controls,
    get scene() { return scene; },
    get model() { return model; },
    get view() { return view(); },
    get viewport() { return viewport; },
    get selection() { return selection; },
    draw: (next, from) => draw(next, from),
    show, setViewpoint, setFilters, fit, setViewport, panBy, zoomBy,
    select: (ids) => select(ids),
    reveal,
    toCanvas: (pointer) => fromScreen(inHost(pointer)),
    toScreen,
    toAxis(point) {
      const axes = system();
      const scales = scalesOf(axes, diagram());
      return { system: axes.name, x: scales.x.toValue(point.x), y: scales.y.toValue(point.y) };
    },
    hitTest,
    dispose() {
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('keydown', onKeyDown);
      appearance?.disconnect();
      resized?.disconnect();
      viewportGroup.remove();
      rulers.remove();
      controls.remove();
      drawn.clear();
    },
  };
}
