// The gestures of the canvas (etalii.adp spec 012, FR-015, FR-024): what a user does with the
// pointer and the keys to change a diagram. Each gesture is drawn in the overlay while it runs and
// ends in one intent of the interpreted behavior, which is handed on with its outcome, or in the
// sentence of a refusal with nothing changed. Nothing here stores anything, and nothing here knows
// a tool type: what may be moved, resized, dragged or connected is read from the scene, the
// toolbox and the behavior.
//
// The canvas keeps its own pointer handling: a press on the background pans, a press on an element
// selects. These listeners run before the canvas's (capture) and stop a press only when it is on a
// grip of the selection or made with an armed tool; a press on an element is left to the canvas to
// select, and becomes a gesture when the pointer then moves.

import type { Canvas, Hit } from './canvas';
import { centreOf, distance, holds, pathData, pointIn, pointOn, sides, type Box, type Point, type Side } from './geometry';
import { createScene, type Scene, type SceneEdge, type SceneNode, type SceneShape, type SceneTool } from './scene';
import { svg } from './shapes';
import { createSnapping } from './snapping';
import { baseCoordinate, type Behavior, type EndPlace, type Outcome, type Pending, type Question, type Situation } from '../disl/behavior';
import type { Scope } from '../disl/expressions';
import { allowsEnd, attributesOf, valueKind } from '../disl/metamodel';
import type { Model } from '../disl/model';
import { edgeNotation, nodeNotation, type Style } from '../disl/notation';
import { isObject } from '../disl/specification';
import { setsFor, type Tool, type Toolbox } from '../disl/toolbox';

/** An outcome that is no refusal. */
export type Done = Exclude<Outcome, { readonly refused: string }>;

/** What a gesture was, for whoever names the step it made. */
export type GestureKind = 'create' | 'connect' | 'move' | 'resize' | 'handle' | 'reattach' | 'remove' | 'operate' | 'editLabel';

/** Where the two ends of a relation attach, as far as the gesture said. */
export interface Ends {
  readonly source?: EndPlace;
  readonly target?: EndPlace;
}

/** Where a context menu was asked for. */
export interface MenuPlace {
  /** In canvas units, and in pixels of the window. */
  readonly point: Point;
  readonly client: Point;
  /** What of the element was pressed. */
  readonly hit?: Hit;
  /** For a pending connection: where the gesture left and arrived. */
  readonly ends?: Ends;
}

export interface GestureOptions {
  /** The interpreted specification the canvas was made with. */
  readonly tool: SceneTool;
  readonly behavior: Behavior;
  readonly toolbox: Toolbox;
  /** One gesture ended in one intent. Answering false says it was not taken: an armed tool then stays armed. */
  onIntent(outcome: Done, gesture: GestureKind): boolean | void;
  /** A gesture was refused, and nothing changed. */
  onRefused(sentence: string): void;
  /**
   * A context menu was asked for: on an element, on the empty canvas (no target), or for a
   * connection drawn between two elements that more than one entry could make.
   */
  onMenu?(target: string | Pending | undefined, place: MenuPlace): void;
  /** A removal or an operation asks first. Without this, it runs unasked. */
  onConfirm?(question: Question, proceed: () => void): void;
  /** The armed tool changed by a gesture or a key: a drop disarms a tool that is not sticky. */
  onArmed?(tool: string | undefined): void;
  /** No gesture changes anything while this holds; a context menu is still asked for. */
  readonly readOnly?: boolean | (() => boolean);
  /** More members of `env` (DISL 12.2) for the behavior, beside the viewpoint and the appearance. */
  env?(): Scope;
}

export interface Gestures {
  /** The id of the armed tool. */
  readonly armed: string | undefined;
  /** The gesture that is running. */
  readonly running: GestureKind | undefined;
  /** Arms a tool of the toolbox for the next press on the canvas, or disarms with nothing. */
  arm(tool: string | undefined): void;
  /** Uses a tool at a canvas point, or at the centre of what the canvas shows: the keyboard's drop. */
  drop(tool: string, at?: Point): boolean;
  /** Draws a relation of a type between two elements: what an entry of a pending connection's menu runs. */
  connect(type: string, source: string, target: string, ends?: Ends): boolean;
  /** Removes the selection, asking first when its deletion asks. */
  remove(): void;
  /** Runs an operation on the selection, at a canvas point when it was invoked at one. */
  operate(operation: string, at?: Point): void;
  /** Draws the grips of the selection again. The canvas is watched, so this is seldom needed. */
  refresh(): void;
  dispose(): void;
}

interface Running {
  readonly kind: GestureKind;
  /** Made with the keys: the pointer takes no part in it. */
  readonly keyed?: boolean;
  move(point: Point): void;
  end(point: Point): void;
  key?(event: KeyboardEvent): void;
}

interface Grip {
  readonly kind: 'handle' | 'edge' | 'end';
  readonly element: string;
  /** The parameter of a handle, the edge of a box, or the side of a relation. */
  readonly name: string;
  readonly at: Point;
}

/** A place a relation can leave a node from: a point of it, or anywhere along a side of a box of it. */
type Outlet = { readonly at: Point } | { readonly box: Box; readonly side: Side };

// Screen pixels: how far a press travels before it is a drag, how near a grip it must be, and how
// far either side of where a relation can leave an element the pointer finds that place.
const threshold = 3;
const reach = 6;
const band = 8;
const arrows: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// How far Alt and an arrow key slide an end of a relation along its side.
const slideBy = 0.1;
const within = (value: number): number => Math.min(1, Math.max(0, value));

/** Whether a key event is a shortcut as a specification writes one, such as `Delete` or `Ctrl+D`. */
export function matchesShortcut(shortcut: string, event: KeyboardEvent): boolean {
  const words = shortcut.split('+').map((word) => word.trim().toLowerCase());
  const key = words.pop() ?? '';
  const held = (...names: string[]): boolean => names.some((name) => words.includes(name));
  const pressed = event.key === ' ' ? 'space' : event.key.toLowerCase();
  return pressed === (key === 'del' ? 'delete' : key === 'esc' ? 'escape' : key)
    && (event.ctrlKey || event.metaKey) === held('ctrl', 'control', 'cmd', 'meta', 'mod') && event.altKey === held('alt', 'option') && event.shiftKey === held('shift');
}

/** Attaches the gestures to a canvas. They are heard until `dispose`. */
export function attachGestures(canvas: Canvas, options: GestureOptions): Gestures {
  const { host } = canvas;
  const document = host.ownerDocument;
  const { tool, behavior, toolbox } = options;
  const { metamodel } = tool;
  const grips = svg(document, 'g', { class: 'adp-gesture-grips' });
  const handles = svg(document, 'g', { class: 'adp-connect-handles' });
  const hovered = svg(document, 'g', { class: 'adp-connect-handles' });
  const preview = svg(document, 'g', { class: 'adp-gesture-preview' });
  canvas.overlay.append(grips, handles, hovered, preview);

  let armed: Tool | undefined;
  let press: { readonly x: number; readonly y: number; begin(): Running | undefined } | undefined;
  let running: Running | undefined;

  const readOnly = (): boolean => (typeof options.readOnly === 'function' ? options.readOnly() : options.readOnly === true);
  const env = (): Scope => ({ ...options.env?.(), viewpoint: canvas.view.viewpoint, mode: canvas.view.mode });
  const situation = (): Situation => ({ env: env() });
  const viewpoint = () => tool.viewpoints.all[canvas.view.viewpoint] ?? tool.viewpoints.all[tool.viewpoints.default];
  const zoomed = (pixels: number): number => pixels / canvas.viewport.zoom;
  const nodeOf = (id: string | undefined): SceneNode | undefined => canvas.scene?.nodes.find((node) => node.id === id);
  const edgeOf = (id: string | undefined): SceneEdge | undefined => canvas.scene?.edges.find((edge) => edge.id === id && edge.hidden === undefined);
  const movable = (node: SceneNode | undefined): node is SceneNode => node !== undefined && (node.movable.x || node.movable.y);
  const pressed = (event: Event): string | undefined => {
    const target = event.target instanceof Element ? event.target.closest('[data-element]') : null;
    return target && host.contains(target) ? target.getAttribute('data-element') ?? undefined : undefined;
  };
  // A press that is a gesture's is not the canvas's to pan or select with.
  const claim = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
  };

  // ---- what is drawn while a gesture runs ----

  const lined = (look: string, more: Readonly<Record<string, string | number>> = {}) => ({ class: look, 'stroke-width': 1.5, ...more });
  const boxed = (box: Box, look: string): SVGElement => svg(document, 'rect', { x: box.x, y: box.y, width: box.width, height: box.height, ...lined(look) });
  const shaped = (shape: SceneShape, look: string): SVGElement => {
    if (shape.kind === 'path') return svg(document, 'path', { d: pathData(shape.commands), ...lined(look) });
    const { x, y, width, height } = shape.box;
    return shape.kind === 'ellipse' ? svg(document, 'ellipse', { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2, ...lined(look) }) : boxed(shape.box, look);
  };
  // A part that draws nothing, as one that only says where a relation attaches, has no outline either.
  const blank = (style: Style): boolean => style.visible === false || ((style.fill === undefined || style.fill === 'none') && typeof style.stroke?.width === 'number' && style.stroke.width <= 0);
  // A node as an outline: its own shape, or the parts a composite shape is made of.
  const outlined = (node: SceneNode, look: string): SVGElement[] => {
    const parts = node.parts.filter((part) => part.shape.kind !== 'none' && !blank(part.style)).map((part) => shaped(part.shape, look));
    return node.shape.kind === 'none' ? (parts.length > 0 ? parts : [boxed(node.box, look)]) : [shaped(node.shape, look), ...parts];
  };
  const line = (from: Point, to: Point, look: string): SVGElement => svg(document, 'path', { d: `M${from.x},${from.y}L${to.x},${to.y}`, ...lined(`adp-gesture-line ${look}`) });
  const dot = (at: Point, look: string): SVGElement => svg(document, 'circle', { cx: at.x, cy: at.y, r: zoomed(4), ...lined(look) });
  const cross = (at: Point, look: string): SVGElement => {
    const arm = zoomed(8);
    return svg(document, 'path', { d: `M${at.x - arm},${at.y}H${at.x + arm}M${at.x},${at.y - arm}V${at.y + arm}`, ...lined(look) });
  };
  // A connection handle: eight canvas units across, and never less than eight pixels.
  const knob = (at: Point, look = 'adp-connect-handle', more: Readonly<Record<string, string | number>> = {}): SVGElement =>
    svg(document, 'circle', { cx: at.x, cy: at.y, r: Math.max(4, zoomed(4)), ...lined(look, more) });
  const clear = (): void => preview.replaceChildren();

  /**
   * Elements of a model as the canvas would draw them. With no layout in the viewpoint each one is
   * placed by its own attributes, so the scene of those few alone is theirs in the whole; a layout
   * places each among the others, and takes the whole scene.
   */
  function drawn(after: Model, ids: readonly string[]): SceneNode[] {
    const wanted = new Set(ids);
    const alone = viewpoint().layout === undefined;
    const from = alone ? { diagram: after.diagram, elements: after.elements.filter((element) => wanted.has(element.id)), relations: [] } : after;
    return createScene(tool, from, { viewpoint: canvas.view.viewpoint, filters: alone ? undefined : canvas.view.filters, env: { mode: canvas.view.mode } }).nodes.filter((node) => wanted.has(node.id));
  }

  function settle(outcome: Outcome, kind: GestureKind): boolean {
    clear();
    if (outcome.refused !== undefined) {
      options.onRefused(outcome.refused);
      return false;
    }
    // A gesture that lands where it began is no step.
    if (outcome.changes.length === 0 && outcome.effects.length === 0) return false;
    return options.onIntent(outcome, kind) !== false;
  }

  // A drag of elements: the behavior says where they land for each place of the pointer, and that is what is drawn.
  const dragging = (kind: GestureKind, ids: readonly string[], intent: (point: Point) => Outcome, refused: (point: Point) => readonly Box[]): Running => ({
    kind,
    move(point) {
      const outcome = intent(point);
      if (outcome.refused !== undefined) preview.replaceChildren(...refused(point).map((box) => boxed(box, 'adp-gesture-refused')));
      else preview.replaceChildren(...drawn(outcome.after, ids).flatMap((node) => outlined(node, 'adp-gesture-ghost')));
    },
    end: (point) => void settle(intent(point), kind),
  });

  // ---- moving, resizing and dragging a handle ----

  function moving(ids: readonly string[], from: Point): Running | undefined {
    const model = canvas.model;
    const nodes = ids.map(nodeOf).filter(movable);
    if (nodes.length === 0) return undefined;
    const free = { x: nodes.some((node) => node.movable.x), y: nodes.some((node) => node.movable.y) };
    const by = (point: Point): Point => ({ x: free.x ? point.x - from.x : 0, y: free.y ? point.y - from.y : 0 });
    const snapping = createSnapping(tool, model, { viewpoint: canvas.view.viewpoint, env: env() });
    // A refused move is drawn where it was asked to land, so that the user sees what was refused.
    const asked = (point: Point): Box[] => nodes.map((node) => {
      const anchor = snapping.anchor(node.type, node.box);
      const landed = snapping.point(node.type, 'move', { x: anchor.x + by(point).x, y: anchor.y + by(point).y }, node.id);
      return { ...node.box, x: node.box.x + (node.movable.x ? landed.x - anchor.x : 0), y: node.box.y + (node.movable.y ? landed.y - anchor.y : 0) };
    });
    return dragging('move', nodes.map((node) => node.id), (point) => behavior.move(model, nodes.map((node) => node.id), by(point), situation()), asked);
  }

  function fromGrip(grip: Grip, from: Point): Running | undefined {
    const model = canvas.model;
    if (grip.kind === 'end') return reattaching(grip.element, grip.name as 'source' | 'target');
    const node = nodeOf(grip.element);
    if (!node) return undefined;
    const here = (): Box[] => [node.box];
    if (grip.kind === 'edge') {
      const across = grip.name === 'left' || grip.name === 'right';
      return dragging('resize', [node.id], (point) => behavior.resize(model, node.id, { [grip.name]: across ? point.x - from.x : point.y - from.y }, situation()), here);
    }
    const axis = node.handles.find((handle) => handle.param === grip.name)?.axis;
    // The value of a handle is its share along its axis in the box of its element.
    const share = (point: Point): number => within(axis === 'y' ? (point.y - node.box.y) / (node.box.height || 1) : (point.x - node.box.x) / (node.box.width || 1));
    return dragging('handle', [node.id], (point) => behavior.dragHandle(model, node.id, grip.name, share(point), situation()), here);
  }

  // ---- the ends of a relation ----

  // What an end may name: the values of the enum its attribute is typed with, when it is bound to one.
  const named = (binding: unknown, relation: string): readonly string[] | undefined => {
    const attribute = isObject(binding) && typeof binding.attribute === 'string' ? attributesOf(metamodel, relation)[binding.attribute] : undefined;
    const kind = attribute && valueKind(metamodel, attribute.type);
    return kind?.kind === 'enum' ? kind.enum.values.map((value) => value.key) : undefined;
  };
  const anchoring = (relation: string, side: 'source' | 'target') => {
    const anchor = edgeNotation(viewpoint().notation, metamodel, relation).anchoring[side];
    return anchor?.mode === 'part' ? { parts: named(anchor.part, relation), sides: named(anchor.side, relation) } : undefined;
  };

  /** The place on a part of a node nearest a point, for an end of a relation type that attaches to parts (DISL 6.10). */
  function placeOn(node: SceneNode, point: Point, relation: string, side: 'source' | 'target'): Required<EndPlace> | undefined {
    const allowed = anchoring(relation, side);
    let best: { readonly far: number; readonly place: Required<EndPlace> } | undefined;
    for (const part of allowed ? node.parts : []) {
      if (!(allowed?.parts?.includes(part.id) ?? true)) continue;
      for (const edge of sides) {
        if (!(allowed?.sides?.includes(edge) ?? true)) continue;
        const along = edge === 'top' || edge === 'bottom' ? (point.x - part.box.x) / (part.box.width || 1) : (point.y - part.box.y) / (part.box.height || 1);
        const at = Math.round(within(along) * 100) / 100;
        const far = distance(pointOn(part.box, edge, at), point);
        if (!best || far < best.far) best = { far, place: { part: part.id, side: edge, at } };
      }
    }
    return best?.place;
  }
  const pointOf = (node: SceneNode, place: EndPlace | undefined): Point | undefined => {
    const part = node.parts.find((candidate) => candidate.id === place?.part);
    return part && place?.side !== undefined ? pointOn(part.box, place.side as Side, place.at ?? 0.5) : undefined;
  };

  function reattaching(id: string, side: 'source' | 'target'): Running | undefined {
    const model = canvas.model;
    const edge = edgeOf(id);
    const end = side === 'source' ? edge?.from : edge?.to;
    const other = side === 'source' ? edge?.to : edge?.from;
    const node = nodeOf(end?.node);
    if (!edge || !node || !other) return undefined;
    const intent = (point: Point): { readonly at: Point; readonly outcome: Outcome } => {
      const place = placeOn(node, point, edge.type, side);
      // With no place to name, the behavior says why the end stays.
      return { at: pointOf(node, place) ?? point, outcome: behavior.reattach(model, id, side, place ?? {}, situation()) };
    };
    return {
      kind: 'reattach',
      move(point) {
        const { at, outcome } = intent(point);
        const look = outcome.refused === undefined ? 'adp-gesture-ghost' : 'adp-gesture-refused';
        preview.replaceChildren(line(other, at, look), dot(at, look));
      },
      end: (point) => void settle(intent(point).outcome, 'reattach'),
    };
  }

  // Alt and an arrow key: the end slides along its side into the next part, or crosses to the side the arrow points at.
  function slide(edge: SceneEdge, [dx, dy]: readonly [number, number], side: 'source' | 'target'): void {
    const end = side === 'source' ? edge.from : edge.to;
    const node = nodeOf(end?.node);
    const allowed = anchoring(edge.type, side);
    if (!end || !node || !allowed || end.part === undefined) return void settle(behavior.reattach(canvas.model, edge.id, side, {}, situation()), 'reattach');
    const lying = end.side === 'top' || end.side === 'bottom';
    const [along, across] = lying ? [dx, dy] : [dy, dx];
    const parts = node.parts.filter((part) => allowed.parts?.includes(part.id) ?? true).map((part) => part.id);
    let part = end.part;
    let at = (end.at ?? 0.5) + along * slideBy;
    const next = parts[parts.indexOf(part) + Math.sign(along)];
    if ((at < -1e-9 || at > 1 + 1e-9) && next !== undefined) [part, at] = [next, along > 0 ? 0 : 1];
    const facing: Side = lying ? (across < 0 ? 'top' : 'bottom') : across < 0 ? 'left' : 'right';
    const edgeSide = across !== 0 && (allowed.sides?.includes(facing) ?? true) ? facing : end.side;
    settle(behavior.reattach(canvas.model, edge.id, side, { part, side: edgeSide, at: Math.round(within(at) * 100) / 100 }, situation()), 'reattach');
  }

  // ---- drawing a relation ----

  // The relation types a connection drawn without a tool may become: those the menus of a pending connection draw (DISL 7.3).
  const pendingTypes = [...new Set(setsFor(toolbox.contextMenus, metamodel, 'connection').flatMap((set) => set.entries.flatMap((entry) => (entry.kind === 'connect' && entry.via !== undefined ? [entry.via] : []))))];
  const starts = (node: SceneNode, types: readonly string[]): boolean => node.connectable && types.some((type) => allowsEnd(metamodel, type, 'source', node.type));

  // Without a tool, a relation is drawn from where one leaves a node: its fixed anchors, else the
  // sides of the parts an end of such a relation attaches to, else its own sides.
  const outlets = new WeakMap<SceneNode, readonly Outlet[]>();
  function outletsOf(node: SceneNode): readonly Outlet[] {
    const known = outlets.get(node);
    if (known) return known;
    const anchors = nodeNotation(viewpoint().notation, metamodel, node.type).anchors;
    const found = new Map<string, Outlet>();
    if (anchors.mode === 'fixed' && anchors.points?.length) for (const anchor of anchors.points) found.set(anchor.id, { at: pointIn(node.box, anchor.x, anchor.y) });
    else {
      for (const type of pendingTypes) {
        const allowed = allowsEnd(metamodel, type, 'source', node.type) ? anchoring(type, 'source') : undefined;
        for (const part of allowed ? node.parts : []) {
          if (!(allowed?.parts?.includes(part.id) ?? true)) continue;
          for (const side of sides) if (allowed?.sides?.includes(side) ?? true) found.set(`${part.id} ${side}`, { box: part.box, side });
        }
      }
      if (found.size === 0) for (const side of anchors.sides ?? sides) found.set(side, { box: node.box, side });
    }
    const all = [...found.values()];
    outlets.set(node, all);
    return all;
  }
  const middleOf = (outlet: Outlet): Point => ('at' in outlet ? outlet.at : pointOn(outlet.box, outlet.side, 0.5));
  const nearestOn = (outlet: Outlet, point: Point): Point => {
    if ('at' in outlet) return outlet.at;
    const { box, side } = outlet;
    return pointOn(box, side, within(side === 'top' || side === 'bottom' ? (point.x - box.x) / (box.width || 1) : (point.y - box.y) / (box.height || 1)));
  };

  /** Where a relation would leave from at a point, given the element the pointer is over. */
  function outletAt(over: string | undefined, point: Point): { readonly node: SceneNode; readonly at: Point } | undefined {
    const only = nodeOf(over);
    // A relation under the pointer is what a press there selects.
    if (over !== undefined && !only) return undefined;
    let best: { readonly far: number; readonly node: SceneNode; readonly at: Point } | undefined;
    for (const node of only ? [only] : canvas.scene?.nodes ?? []) {
      if (!starts(node, pendingTypes)) continue;
      // On the element the band is at most a quarter of it: a press in its middle still selects and moves it.
      const near = only ? Math.min(zoomed(band), node.box.width / 4, node.box.height / 4) : zoomed(band);
      const shown = canvas.selection.includes(node.id);
      for (const outlet of outletsOf(node)) {
        // A handle that is shown is pressed as a whole, and gives its own place.
        const middle = middleOf(outlet);
        const at = shown && distance(middle, point) <= Math.min(near, Math.max(4, zoomed(4))) ? middle : nearestOn(outlet, point);
        const far = distance(at, point);
        if (far <= near && (!best || far < best.far)) best = { far, node, at };
      }
    }
    return best;
  }

  let spotted = false;
  // The place under the pointer a relation would leave from, or none.
  function spot(at?: Point): void {
    if (!at && !spotted) return;
    spotted = at !== undefined;
    hovered.replaceChildren(...(at ? [knob(at, 'adp-connect-handle adp-connect-handle-hover')] : []));
    host.toggleAttribute('data-connect', spotted);
  }

  // What drawing from one element to another comes to: an outcome, or the menu of the entries that could make it.
  function joined(source: SceneNode, target: SceneNode, type: string | undefined, ends: (type: string) => Ends | undefined): Outcome | 'menu' | undefined {
    const model = canvas.model;
    let made = type;
    if (made === undefined) {
      const menu = behavior.menu(model, { source: source.id, target: target.id }, situation());
      const entries = menu.groups.flat().filter((entry) => entry.kind === 'connect' && entry.via !== undefined);
      const open = entries.filter((entry) => entry.enabled);
      // Nothing to draw between these two: a refusal when the specification says why, else nothing at all.
      if (open.length === 0) return entries[0]?.reason === undefined ? undefined : { refused: entries[0].reason };
      if (open.length > 1 || (!menu.runSingle && options.onMenu)) return 'menu';
      made = open[0].via!;
    }
    return behavior.connect(model, made, source.id, target.id, ends(made), situation());
  }

  /** A relation drawn from an element: with the pointer from a point, or with the keys from one target to the next. */
  function connecting(source: SceneNode, type: string | undefined, from?: Point): Running | undefined {
    const types = type === undefined ? pendingTypes : [type];
    const targets = (canvas.scene?.nodes ?? []).filter((node) => node.connectable && types.some((made) => allowsEnd(metamodel, made, 'target', node.type)));
    if (targets.length === 0) return void options.onRefused('There is nothing here to draw this to.');
    const marks = targets.map((node) => boxed(node.box, 'adp-gesture-target'));
    let chosen = from ? undefined : targets.find((node) => node.id !== source.id) ?? targets[0];
    const ends = (target: SceneNode, point: Point | undefined) => (made: string): Ends | undefined =>
      (from && point ? { source: placeOn(source, from, made, 'source'), target: placeOn(target, point, made, 'target') } : undefined);
    const show = (aimed: SceneNode | undefined, point: Point): void => {
      const outcome = aimed && joined(source, aimed, type, ends(aimed, from && point));
      const target = outcome ? aimed : undefined;
      const fine = outcome === undefined || outcome === 'menu' || outcome.refused === undefined;
      const look = fine ? 'adp-gesture-ghost' : 'adp-gesture-refused';
      const added = outcome !== undefined && outcome !== 'menu' && outcome.refused === undefined ? outcome.changes.find((change) => change.kind === 'add' && change.source !== undefined) : undefined;
      // Where the two ends are drawn is where the behavior attaches them, when it says.
      const places = target && added?.kind === 'add' ? drawnEnds(source, target, outcome as Done, added.id) : undefined;
      const left = places?.from ?? from ?? centreOf(source.box);
      // Drawn with the pointer, the place on the target the relation would attach at is shown as the handle it left from.
      const arrives = from && target && fine ? places?.to ?? pointOf(target, placeOn(target, point, type ?? pendingTypes[0] ?? '', 'target')) : undefined;
      preview.replaceChildren(
        ...marks, ...(target ? [boxed(target.box, fine ? 'adp-gesture-hover' : look)] : []),
        line(left, places?.to ?? arrives ?? (from ? point : centreOf(target?.box ?? source.box)), look),
        ...(from ? [knob(left)] : []), ...(arrives ? [knob(arrives, 'adp-connect-handle adp-connect-handle-hover')] : []),
      );
    };
    const finish = (target: SceneNode | undefined, point: Point): void => {
      if (!target) return clear();
      const made = ends(target, from && point);
      const outcome = joined(source, target, type, made);
      if (!outcome) return clear();
      if (outcome !== 'menu') return void settle(outcome, 'connect');
      clear();
      // The ends as the first of those types attaches them; the entry that is run says which type it is.
      options.onMenu?.({ source: source.id, target: target.id }, { point, client: client(point), ends: made(pendingTypes[0] ?? '') });
    };
    // The target at a point, or the one whose box the point is just outside: a line of another relation, or the band beside an edge, is still that element.
    const under = (point: Point): SceneNode | undefined => {
      const hit = canvas.hitTest(point)?.element;
      const near = zoomed(band);
      return targets.find((node) => node.id === hit)
        ?? [...targets].reverse().find((node) => holds({ x: node.box.x - near, y: node.box.y - near, width: node.box.width + 2 * near, height: node.box.height + 2 * near }, point));
    };
    if (!from) show(chosen, centreOf(source.box));
    return {
      kind: 'connect',
      keyed: !from,
      move: (point) => show(under(point), point),
      end: (point) => finish(from ? under(point) : chosen, point),
      key(event) {
        const arrow = arrows[event.key];
        if (arrow && chosen) {
          chosen = targets[(targets.indexOf(chosen) + (arrow[0] + arrow[1] > 0 ? 1 : -1) + targets.length) % targets.length];
          canvas.reveal(chosen.id);
          show(chosen, centreOf(chosen.box));
        } else if (event.key === 'Enter' && chosen) {
          running = undefined;
          finish(chosen, centreOf(chosen.box));
        }
      },
    };
  }

  // The ends of a relation an outcome adds, read from the attributes the behavior gave it through the notation's bindings.
  function drawnEnds(source: SceneNode, target: SceneNode, outcome: Done, id: string): { readonly from?: Point; readonly to?: Point } {
    const relation = outcome.after.relations.find((candidate) => candidate.id === id);
    if (!relation) return {};
    const anchors = edgeNotation(viewpoint().notation, metamodel, relation.type).anchoring;
    const read = (binding: unknown): unknown => (isObject(binding) && typeof binding.attribute === 'string' ? relation.attributes[binding.attribute] : undefined);
    const at = (node: SceneNode, side: 'source' | 'target'): Point | undefined => {
      const anchor = anchors[side];
      const [part, edge, along] = [read(anchor?.part), read(anchor?.side), read(anchor?.at)];
      return typeof part === 'string' && typeof edge === 'string' ? pointOf(node, { part, side: edge, at: typeof along === 'number' ? along : 0.5 }) : undefined;
    };
    return { from: at(source, 'source'), to: at(target, 'target') };
  }

  // ---- a tool used at a point ----

  let based: { readonly scene: Scene; readonly base: Scene } | undefined;

  // A point of a viewpoint that varies another, where it stands in that other: what a drop there is told (../disl/behavior.ts, `baseCoordinate`).
  function inBase(point: Point): Point {
    const varied = viewpoint().variantOf;
    const scene = canvas.scene;
    if (varied === undefined || !scene) return point;
    if (based?.scene !== scene) based = { scene, base: createScene(tool, canvas.model, { viewpoint: varied, env: { mode: canvas.view.mode } }) };
    const places = new Map(based.base.nodes.map((node) => [node.id, node.box]));
    const pairs = (axis: 'x' | 'y') => scene.nodes.flatMap((node) => (places.has(node.id) ? [{ placed: node.box[axis], base: places.get(node.id)![axis] }] : []));
    return { x: baseCoordinate(pairs('x'), point.x), y: baseCoordinate(pairs('y'), point.y) };
  }

  const shown = (): Box => {
    const box = host.getBoundingClientRect();
    return { x: canvas.viewport.x, y: canvas.viewport.y, width: zoomed(box.width), height: zoomed(box.height) };
  };
  const client = (point: Point): Point => {
    const box = host.getBoundingClientRect();
    const at = canvas.toScreen(point);
    return { x: box.left + at.x, y: box.top + at.y };
  };

  function arm(id: string | undefined, tell = false): void {
    cancel();
    armed = id !== undefined && Object.hasOwn(toolbox.tools, id) ? toolbox.tools[id] : undefined;
    if (armed) host.setAttribute('data-armed', armed.relation ? 'relation' : 'element');
    else host.removeAttribute('data-armed');
    if (tell) options.onArmed?.(armed?.id);
  }

  function drop(id: string, at: Point = centreOf(shown())): boolean {
    if (readOnly() || !Object.hasOwn(toolbox.tools, id)) return false;
    const used = toolbox.tools[id];
    const taken = settle(behavior.create(canvas.model, id, inBase(at), situation()), used.operation === undefined ? 'create' : 'operate');
    if (taken && armed?.id === id && !used.sticky) arm(undefined, true);
    return taken;
  }

  // Where an armed tool would put its element, under the pointer.
  function hover(point: Point): void {
    if (!armed || armed.relation || armed.creates === undefined) return;
    const outcome = behavior.create(canvas.model, armed.id, inBase(point), situation());
    // A layout places a new element among the others, which only the whole scene tells: the pointer is marked instead.
    if (outcome.refused !== undefined) preview.replaceChildren(cross(point, 'adp-gesture-refused'));
    else if (viewpoint().layout !== undefined) preview.replaceChildren(cross(point, 'adp-gesture-ghost'));
    else preview.replaceChildren(...drawn(outcome.after, outcome.created).flatMap((node) => outlined(node, 'adp-gesture-ghost')));
  }

  // ---- the selection: its grips, its removal, its operations ----

  function offered(): Grip[] {
    const selection = canvas.selection;
    const found: Grip[] = [];
    if (readOnly() || armed) return found;
    const edge = selection.length === 1 ? edgeOf(selection[0]) : undefined;
    for (const side of ['source', 'target'] as const) {
      const end = side === 'source' ? edge?.from : edge?.to;
      if (edge && end?.part !== undefined) found.push({ kind: 'end', element: edge.id, name: side, at: end });
    }
    for (const node of selection.map(nodeOf)) {
      if (!node) continue;
      for (const handle of node.handles) if (handle.visible) found.push({ kind: 'handle', element: node.id, name: handle.param, at: handle });
      for (const side of sides) {
        const across = side === 'left' || side === 'right';
        if (across ? node.resizable.x : node.resizable.y) found.push({ kind: 'edge', element: node.id, name: side, at: pointOn(node.box, side, 0.5) });
      }
    }
    return found;
  }

  function gripAt(point: Point): Grip | undefined {
    const near = zoomed(reach);
    return offered().find((grip) => {
      if (grip.kind !== 'edge') return distance(grip.at, point) <= near;
      // An edge is a grip along its whole length, and leaves the middle of a small element to be moved by.
      const box = nodeOf(grip.element)!.box;
      const across = grip.name === 'left' || grip.name === 'right';
      const band = Math.min(near, (across ? box.width : box.height) / 4);
      return across
        ? Math.abs(point.x - grip.at.x) <= band && point.y >= box.y - near && point.y <= box.y + box.height + near
        : Math.abs(point.y - grip.at.y) <= band && point.x >= box.x - near && point.x <= box.x + box.width + near;
    });
  }

  let key: readonly unknown[] = [];

  function refresh(): void {
    const next = [canvas.scene, canvas.selection, canvas.viewport.zoom, readOnly(), armed];
    if (next.every((value, index) => value === key[index])) return;
    key = next;
    spot();
    // A selected element shows where a relation can leave it: its fixed anchors, and the middle of each side one attaches along.
    handles.replaceChildren(...(readOnly() || armed ? [] : canvas.selection.map(nodeOf)).flatMap((node) =>
      (node && starts(node, pendingTypes) ? outletsOf(node).map((outlet) => knob(middleOf(outlet), 'adp-connect-handle', { 'data-of': node.id })) : [])));
    const size = zoomed(4);
    grips.replaceChildren(...offered().map((grip) => {
      const look = `adp-gesture-grip adp-gesture-grip-${grip.kind === 'edge' ? (grip.name === 'left' || grip.name === 'right' ? 'x' : 'y') : grip.kind}`;
      const more = { 'data-grip': grip.kind, 'data-of': grip.element, 'data-name': grip.name };
      return grip.kind === 'edge'
        ? svg(document, 'rect', { x: grip.at.x - size, y: grip.at.y - size, width: 2 * size, height: 2 * size, ...lined(look, more) })
        : svg(document, 'circle', { cx: grip.at.x, cy: grip.at.y, r: size, ...lined(look, more) });
    }));
  }

  function remove(): void {
    const ids = canvas.selection.filter((id) => nodeOf(id)?.deletable !== false);
    if (readOnly() || ids.length === 0) return;
    const asked = behavior.deletion(canvas.model, ids, situation());
    if (asked.refused !== undefined) return options.onRefused(asked.refused);
    const run = (): void => void settle(behavior.remove(canvas.model, ids, situation()), 'remove');
    if (asked.confirm && options.onConfirm) options.onConfirm(asked.confirm, run);
    else run();
  }

  function operate(id: string, at?: Point): void {
    if (readOnly()) return;
    const selection = canvas.selection;
    const state = behavior.availability(canvas.model, id, selection, situation());
    const run = (): void => void settle(behavior.operate(canvas.model, id, selection, situation(), at && inBase(at)), 'operate');
    if (state.available && state.confirm && options.onConfirm) options.onConfirm(state.confirm, run);
    else run();
  }

  // Alt and an arrow key: the selection moves one step of its snapping, and the end of a selected relation slides.
  function nudge(arrow: readonly [number, number], shift: boolean): void {
    const selection = canvas.selection;
    const edge = selection.length === 1 ? edgeOf(selection[0]) : undefined;
    if (edge) return slide(edge, arrow, shift ? 'source' : 'target');
    const nodes = selection.map(nodeOf).filter(movable);
    if (nodes.length === 0) return;
    const [first] = nodes;
    const snapping = createSnapping(tool, canvas.model, { viewpoint: canvas.view.viewpoint, env: env() });
    const by = snapping.step(first.type, first.id, snapping.anchor(first.type, first.box), { x: first.movable.x ? arrow[0] : 0, y: first.movable.y ? arrow[1] : 0 });
    if (by.x !== 0 || by.y !== 0) settle(behavior.move(canvas.model, nodes.map((node) => node.id), by, situation()), 'move');
  }

  function menu(event: Event, id: string | undefined, point: Point, at: Point, hit?: Hit): void {
    if (!options.onMenu || running) return;
    event.preventDefault();
    options.onMenu(id, { point, client: at, hit: hit?.element === id ? hit : undefined });
  }

  function cancel(): void {
    press = undefined;
    running = undefined;
    clear();
    spot();
  }

  // ---- the pointer ----

  function onPointerDown(event: PointerEvent): void {
    if (running) {
      // A press during a gesture made with the keys ends it; one during a drag is no second gesture.
      if (running.keyed) cancel();
      return claim(event);
    }
    press = undefined;
    if (event.button !== 0 || readOnly() || !canvas.scene) return;
    const point = canvas.toCanvas(event);
    const begun = (begin: () => Running | undefined): void => { press = { x: event.clientX, y: event.clientY, begin }; };
    if (armed) {
      const relation = armed.relation?.type;
      const source = nodeOf(pressed(event) ?? canvas.hitTest(point)?.element);
      if (relation !== undefined && source && starts(source, [relation])) begun(() => connecting(source, relation, point));
      host.focus({ preventScroll: true });
      return claim(event);
    }
    const grip = gripAt(point);
    if (grip) {
      begun(() => fromGrip(grip, point));
      return claim(event);
    }
    // A press that adds to the selection or takes from it is the canvas's alone.
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    const over = pressed(event);
    const outlet = outletAt(over, point);
    if (outlet) {
      begun(() => connecting(outlet.node, undefined, outlet.at));
      // Beside the element the press is on the background, which the canvas would pan with.
      if (over === undefined) {
        host.focus({ preventScroll: true });
        claim(event);
      }
      return;
    }
    const node = nodeOf(over);
    // The canvas selects the pressed element alone after this; a drag of one of several selected elements still moves them all.
    const before = canvas.selection;
    if (movable(node)) begun(() => moving(before.includes(node.id) ? before : [node.id], point));
  }

  function onPointerMove(event: PointerEvent): void {
    const point = canvas.toCanvas(event);
    if (running) {
      if (!running.keyed) running.move(point);
    } else if (press) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < threshold) return;
      running = press.begin();
      press = undefined;
      spot();
      if (running) host.setPointerCapture?.(event.pointerId);
      running?.move(point);
    } else if (armed) {
      if (!readOnly()) hover(point);
    } else spot(readOnly() || gripAt(point) ? undefined : outletAt(pressed(event), point)?.at);
  }

  function onPointerUp(event: PointerEvent): void {
    const ended = running;
    press = undefined;
    if (ended?.keyed) return;
    running = undefined;
    if (ended) ended.end(canvas.toCanvas(event));
    // Let go over the canvas, an armed tool that creates is used there: after a press on the canvas, or one that began in the toolbox.
    else if (armed && !armed.relation && event.button === 0) drop(armed.id, canvas.toCanvas(event));
  }

  const onPointerLeave = (): void => {
    if (!running) clear();
    spot();
  };

  // Let go outside the canvas, where no drag has the pointer captured: the press is over, and a drag ends with nothing changed.
  const onLetGo = (event: Event): void => {
    if (!(event.target instanceof Node && host.contains(event.target)) && !running?.keyed) cancel();
  };

  function onContextMenu(event: MouseEvent): void {
    const point = canvas.toCanvas(event);
    const hit = canvas.hitTest(point);
    menu(event, pressed(event) ?? hit?.element, point, { x: event.clientX, y: event.clientY }, hit);
  }

  // ---- the keys ----

  // The keys that remove the selection: Delete and Backspace, and what a context menu binds to its `delete` entry.
  const removing = ['Delete', 'Backspace', ...toolbox.contextMenus.flatMap((set) => set.entries.flatMap((entry) => (entry.kind === 'delete' && entry.shortcut !== undefined ? [entry.shortcut] : [])))];

  function onKeyDown(event: KeyboardEvent): void {
    const pressedKey = (shortcut: string | undefined): boolean => shortcut !== undefined && matchesShortcut(shortcut, event);
    if (running || press) {
      // Every key is the gesture's while it runs: Escape ends it with nothing changed.
      if (event.key === 'Escape') cancel();
      else running?.key?.(event);
      return claim(event);
    }
    const selection = canvas.selection;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const first = selection[0];
      const edge = edgeOf(first);
      const at = nodeOf(first) ? centreOf(nodeOf(first)!.box) : edge?.from && edge.to ? { x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2 } : centreOf(shown());
      return menu(event, first, at, client(at));
    }
    if (readOnly()) return;
    const arrow = arrows[event.key];
    const source = selection.length === 1 ? nodeOf(selection[0]) : undefined;
    const begin = (type: string | undefined): void => { running = source && starts(source, type === undefined ? pendingTypes : [type]) ? connecting(source, type) : undefined; };
    const used = Object.values(toolbox.tools).find((candidate) => pressedKey(candidate.shortcut));
    const operation = behavior.operations.find((candidate) => candidate.keys.some(pressedKey) && behavior.availability(canvas.model, candidate.id, selection, situation()).offered);
    if (armed && event.key === 'Escape') arm(undefined, true);
    else if (armed && event.key === 'Enter') {
      if (armed.relation) begin(armed.relation.type);
      else drop(armed.id);
    } else if (arrow && event.altKey && !event.ctrlKey && !event.metaKey) nudge(arrow, event.shiftKey);
    else if (operation) operate(operation.id);
    else if (used) {
      if (used.operation !== undefined) operate(used.operation);
      else arm(used.id, true);
    } else if (removing.some(pressedKey) && selection.length > 0) remove();
    else if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey && source && starts(source, pendingTypes)) begin(undefined);
    else return;
    claim(event);
  }

  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('pointermove', onPointerMove, true);
  host.addEventListener('pointerup', onPointerUp, true);
  host.addEventListener('pointercancel', cancel, true);
  host.addEventListener('pointerleave', onPointerLeave);
  host.addEventListener('contextmenu', onContextMenu);
  host.addEventListener('keydown', onKeyDown, true);

  // The selection, the scene and the zoom are the canvas's, and it does not tell: its drawing is watched.
  const window = document.defaultView;
  window?.addEventListener('pointerup', onLetGo, true);
  const watched = window && 'MutationObserver' in window ? new window.MutationObserver(refresh) : undefined;
  watched?.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-selected', 'transform'] });
  refresh();

  return {
    get armed() { return armed?.id; },
    get running() { return running?.kind; },
    arm: (id) => arm(id),
    drop,
    connect(type, source, target, ends) {
      return !readOnly() && settle(behavior.connect(canvas.model, type, source, target, ends, situation()), 'connect');
    },
    remove, operate, refresh,
    dispose() {
      cancel();
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('pointermove', onPointerMove, true);
      host.removeEventListener('pointerup', onPointerUp, true);
      host.removeEventListener('pointercancel', cancel, true);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('contextmenu', onContextMenu);
      host.removeEventListener('keydown', onKeyDown, true);
      window?.removeEventListener('pointerup', onLetGo, true);
      watched?.disconnect();
      host.removeAttribute('data-armed');
      grips.remove();
      handles.remove();
      hovered.remove();
      preview.remove();
    },
  };
}
