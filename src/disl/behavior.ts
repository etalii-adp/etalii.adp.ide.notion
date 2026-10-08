// The behavior of a specification (DISL 9), and with it every way a user changes a model: an
// intent (a tool used at a place, two elements connected, a value entered, an element moved, a
// selection removed, an operation run) becomes one ordered list of changes with the model as it
// would be afterwards, or the sentence of a refusal. One intent is one transaction (DISL 14.4):
// the gesture's constraints, the change, the hooks, the neighbour bounds, then the invariants.
//
// What is built: `messages`, `reasons`, `editGate`, hooks (`on`, `for`, `attribute`, `when`,
// `phase`, `order`, `maxHookDepth`), operations (`for`, `enabled`, `unavailable`, `confirm`,
// `actions`), `deletion` (`relations`, `children`, `references: "unset"`, `confirm`), the actions
// `set`, `unset`, `create`, `connect`, `delete`, `let`, `if`, `forEach`, `layout` (the `rows`
// algorithm), `abort`, `call`, and those that only ask the host for something (`select`, `reveal`,
// `highlight`, `editLabel`, `openForm`, `notify`). Parent placements, the clipboard, retyping and
// simulations are not read, and an action of another kind is reported and skipped.

import type { Constraints, Gesture } from './constraints';
import { monthsIn, scalesOf, unitOf, type Axis, type Coordinates, type CoordinateSystem, type Placement, type PlacementSource, type SnapRule, type Snapping } from './coordinates';
import type { Expressions, Scope, World } from './expressions';
import { createTexts, type FormItem } from './forms';
import type { Layout, LayoutConfig } from './layout';
import { attributesOf, defaultOf, defaultsOf, isA, isRelation, parseYearMonth, valueKind, type Metamodel } from './metamodel';
import { finding, type Attributes, type Finding, type Loaded, type Model, type ModelElement, type ModelRelation, type Value } from './model';
import { edgeNotation, interpretNotation, nodeNotation, type EndAnchor, type Label, type Notation } from './notation';
import { newId, type InterpretedPersistence } from './persistence';
import { isCel, isObject, labelOf, localized, type Attribute, type CelValue, type Doc, type Expression, type Message, type NeighbourBounds, type Reason, type Specification } from './specification';
import { setsFor, type ContextSet, type Toolbox } from './toolbox';
import type { Viewpoints } from './viewpoints';

// ---- as the schema has them ----

/** `$defs/Hook` (DISL 9.2). */
export interface HookDeclaration {
  readonly id: string;
  readonly on: string | readonly string[];
  readonly for?: string | readonly string[];
  readonly attribute?: string | readonly string[];
  readonly when?: Expression;
  readonly actions: readonly unknown[];
  readonly phase?: 'before' | 'after';
  readonly order?: number;
  readonly doc?: Doc;
}

/** `$defs/Confirmation` (DISL 9.5). */
export interface Confirmation {
  readonly message: Message;
  readonly title?: Message;
  readonly confirmLabel?: Message;
  readonly cancelLabel?: Message;
  readonly danger?: boolean;
  readonly when?: Expression;
  readonly count?: Expression;
  readonly threshold?: number;
}

/** `$defs/Operation` (DISL 9.3). */
export interface OperationDeclaration {
  readonly label?: Message;
  readonly icon?: unknown;
  readonly shortcut?: string;
  readonly for?: string | readonly string[];
  readonly enabled?: Expression;
  readonly unavailable?: readonly Reason[];
  readonly confirm?: Message | Confirmation;
  readonly actions?: readonly unknown[];
  readonly doc?: Doc;
}

/** `$defs/DeletionPolicy` (DISL 9.5). */
export interface DeletionPolicy {
  readonly children?: 'delete' | 'reparent' | 'forbid';
  readonly relations?: 'delete' | 'forbid' | 'reconnect';
  readonly references?: 'unset' | 'delete-referencing' | 'forbid';
  readonly confirm?: Message | Confirmation;
}

/** `$defs/Behavior` (DISL 9.1), as far as it is read. */
export interface BehaviorSection {
  readonly hooks?: readonly HookDeclaration[];
  readonly operations?: Readonly<Record<string, OperationDeclaration>>;
  readonly deletion?: Readonly<Record<string, DeletionPolicy>>;
  readonly maxHookDepth?: number;
  readonly editGate?: readonly Reason[];
  readonly messages?: Readonly<Record<string, Message>>;
  readonly doc?: Doc;
}

// ---- what an intent gives ----

/**
 * One change to a model, at the metamodel's level: the types, the attribute names and the values
 * are the metamodel's (`Value`: an integer and a `yearMonth` are numbers, an enum value is its key).
 *
 * - `add`: a new element, or a new relation when it has `source` and `target` (the ids of its ends).
 *   `attributes` holds every value it starts with, the consequences of hooks included.
 * - `set`: values of attributes of one element or relation; null empties an attribute. The id `''`
 *   is the diagram itself.
 * - `remove`: an element or a relation. What goes with it is in the list as changes of its own, before it.
 */
export type Change =
  | { readonly kind: 'add'; readonly id: string; readonly type: string; readonly attributes: Attributes; readonly source?: string; readonly target?: string; readonly parent?: string }
  | { readonly kind: 'set'; readonly id: string; readonly attributes: Readonly<Record<string, Value | null>> }
  | { readonly kind: 'remove'; readonly id: string };

/** What an action asks of the host beside the change: nothing of it is part of the model. */
export interface Effect {
  readonly kind: 'select' | 'editLabel' | 'openForm' | 'reveal' | 'highlight' | 'notify';
  readonly elements: readonly string[];
  readonly message?: string;
}

/** What one intent comes to: the changes in order and the model after them, or the sentence that refuses it. */
export type Outcome =
  | { readonly changes: readonly Change[]; readonly after: Model; readonly created: readonly string[]; readonly effects: readonly Effect[]; readonly refused?: undefined }
  | { readonly refused: string };

/** Where an intent takes place: the members of `env` (DISL 12.2), of which `viewpoint` and `readOnly` are read here. */
export interface Situation {
  readonly env?: Scope;
}

/** A point of the canvas, in canvas units at zoom 1, in the coordinate system of the viewpoint. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where an end of a relation attaches: the part of the element, the side of that part, and how far along it (DISL 6.10). */
export interface EndPlace {
  readonly part?: string;
  readonly side?: string;
  readonly at?: number;
}

export interface Question {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly danger: boolean;
}

export interface Operation {
  readonly id: string;
  readonly label: Message;
  readonly icon?: string;
  readonly doc?: string;
  /** Types of the metamodel, `diagram` or `selection`. */
  readonly for: readonly string[];
  /** Its own shortcut, and those of the tools and context entries that run it. */
  readonly keys: readonly string[];
}

export interface Availability {
  /** Whether the operation applies to the selection at all; one that does not is not shown. */
  readonly offered: boolean;
  /** Whether it can run now; one that cannot is shown disabled, with `reason` when there is one. */
  readonly available: boolean;
  readonly reason?: string;
  readonly label: string;
  /** The element it runs on; absent when it runs on the diagram or on the selection. */
  readonly target?: string;
  /** The question to ask before it runs. */
  readonly confirm?: Question;
}

export interface OfferedEntry {
  readonly kind: string;
  readonly label: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly operation?: string;
  readonly creates?: string;
  readonly via?: string;
  readonly enabled: boolean;
  /** Why it is not enabled. */
  readonly reason?: string;
}

/** A pending connection (DISL 7.3): a connect gesture that ended on an element. */
export interface Pending {
  readonly source: string;
  readonly target: string;
}

export interface Behavior {
  /** The sentences the specification gives in place of the host's own, by their standard id (DISL 9.1). */
  readonly messages: Readonly<Record<string, Message>>;
  /** One of them as text, or nothing when the specification does not give it. */
  message(id: string, model: Model, situation?: Situation, more?: Scope): string | undefined;
  readonly operations: readonly Operation[];
  availability(model: Model, operation: string, selection: readonly string[], situation?: Situation): Availability;
  /**
   * The entries offered on a target, in groups that are shown apart: an element, the empty canvas
   * (no target) or a pending connection. `sets` are the context menus unless the context tools are given.
   */
  menu(model: Model, target: string | Pending | undefined, situation?: Situation, sets?: readonly ContextSet[]): { readonly groups: readonly (readonly OfferedEntry[])[]; readonly standardEntries: boolean; readonly runSingle: boolean };
  /** What removing a selection takes with it, and the question to ask first when there is one. */
  deletion(model: Model, selection: readonly string[], situation?: Situation): { readonly removes: readonly string[]; readonly confirm?: Question; readonly refused?: string };

  /** A tool used at a point: the element it creates there, or the operation it runs. */
  create(model: Model, tool: string, at: Point, situation?: Situation): Outcome;
  /** A relation of a type drawn from one element to another; an end that is not given attaches where the notation's default says. */
  connect(model: Model, type: string, source: string, target: string, ends?: { readonly source?: EndPlace; readonly target?: EndPlace }, situation?: Situation): Outcome;
  /** Attributes of an element (the diagram when none is named) set to values; null empties one. */
  change(model: Model, element: string | undefined, values: Readonly<Record<string, Value | null>>, situation?: Situation): Outcome;
  /** A value entered in an item of a form: a text, or what the item's widget gives. */
  edit(model: Model, element: string | undefined, item: FormItem, input: Value, situation?: Situation): Outcome;
  /** A label edited in place: the text goes through the label's `parse`, else to the attribute it shows. The first editable label when none is named. */
  editLabel(model: Model, element: string, text: string, situation?: Situation, label?: string): Outcome;
  /** Elements dragged by a distance in canvas units; each lands where the snapping of a move puts it. */
  move(model: Model, elements: readonly string[], by: Point, situation?: Situation): Outcome;
  /** Edges of an element dragged, each by a distance in canvas units. */
  resize(model: Model, element: string, by: { readonly left?: number; readonly top?: number; readonly right?: number; readonly bottom?: number }, situation?: Situation): Outcome;
  /** A handle of an element's shape dragged to a value of its parameter, before snapping. */
  dragHandle(model: Model, element: string, param: string, value: number, situation?: Situation): Outcome;
  /** An end of a relation dragged to another place on the element it is on. */
  reattach(model: Model, relation: string, side: 'source' | 'target', end: EndPlace, situation?: Situation): Outcome;
  remove(model: Model, selection: readonly string[], situation?: Situation): Outcome;
  /** An operation run on a selection, at the point it was invoked at when there is one. */
  operate(model: Model, operation: string, selection: readonly string[], situation?: Situation, at?: Point, args?: Readonly<Record<string, Value>>): Outcome;
}

/** The other sections the behavior works with. */
export interface BehaviorParts {
  readonly constraints: Constraints;
  readonly layout: Layout;
  readonly coordinates: Coordinates;
  readonly persistence: InterpretedPersistence;
  readonly toolbox: Toolbox;
  /** The notation, which says what a position and a size are bound to; read from the specification when absent. */
  readonly notation?: Notation;
  /** The viewpoints, for the notation and the coordinate system of the one an intent takes place in. */
  readonly viewpoints?: Viewpoints;
  /** The row a `rows` layout gives each element (DISL 10.2), which needs where the elements are drawn: the canvas brings it. */
  rows?(config: LayoutConfig, model: Model): ReadonlyMap<string, number>;
  /** The id of a new element of a type; the persistence's when absent. */
  newId?(type: string): string;
}

// ---- changes ----

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const merged = (attributes: Attributes, values: Readonly<Record<string, Value | null>>): Attributes => {
  const next: Record<string, Value> = { ...attributes };
  for (const [name, value] of Object.entries(values)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
};

/** A model with changes applied, in order. A change that names nothing in the model is left out. */
export function applyChanges(model: Model, changes: readonly Change[]): Model {
  let { diagram, elements, relations } = model;
  for (const change of changes) {
    if (change.kind === 'add') {
      const line = Math.max(0, ...elements.map((element) => element.line), ...relations.map((relation) => relation.line)) + 1;
      const made: ModelElement = { id: change.id, type: change.type, attributes: change.attributes, host: {}, ephemeral: false, line, ...(change.parent === undefined ? {} : { parent: change.parent }) };
      if ('source' in change || 'target' in change) relations = [...relations, { ...made, source: change.source, target: change.target }];
      else elements = [...elements, made];
    } else if (change.kind === 'remove') {
      elements = elements.filter((element) => element.id !== change.id);
      relations = relations.filter((relation) => relation.id !== change.id);
    } else if (change.id === '') {
      diagram = merged(diagram, change.attributes);
    } else {
      const update = <T extends ModelElement>(element: T): T => (element.id === change.id ? { ...element, attributes: merged(element.attributes, change.attributes) } : element);
      elements = elements.map(update);
      relations = relations.map(update);
    }
  }
  return { diagram, elements, relations };
}

// ---- snapping (DISL 5.9, 5.10) ----

const awayFromZero = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

// The rule of a gesture along an axis: the most specific declaration wins, and one for the gesture is more specific than its level.
const ruleFor = (system: CoordinateSystem | undefined, own: Snapping | undefined, gesture: string, axis: 'x' | 'y'): SnapRule | undefined =>
  own?.byGesture?.[gesture]?.[axis] ?? own?.[axis] ?? system?.snapping?.byGesture?.[gesture]?.[axis] ?? system?.snapping?.[axis];

// A value on the nearest allowed one. A tie goes by `ties`: away from the origin of the axis unless it says otherwise.
function snapped(rule: SnapRule | undefined, value: number, axis: Axis | undefined, diagram: Attributes, cel: (source: string, value: number) => number | undefined): number {
  if (!isObject(rule)) return value;
  const zero = axis?.origin ?? 0;
  let result = value;
  if (typeof rule.cel === 'string') {
    result = cel(rule.cel, value) ?? value;
  } else if (Array.isArray(rule.values) && rule.values.length > 0) {
    result = (rule.values as number[]).reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best));
  } else {
    const months = rule.calendar ? (monthsIn(unitOf(rule.calendar.unit, diagram, axis?.fallbackUnit)) ?? 1) * Math.max(1, rule.calendar.step ?? 1) : undefined;
    const step = months ?? (typeof rule.grid?.spacing === 'number' ? rule.grid.spacing : 0);
    if (step > 0) {
      const offset = rule.grid?.offset ?? 0;
      const lower = offset + Math.floor((value - offset) / step) * step;
      const upper = lower + step;
      const tie = Math.abs((value - lower) - (upper - value)) < 1e-9;
      const away = Math.abs(upper - zero) >= Math.abs(lower - zero) ? upper : lower;
      if (value === lower || rule.direction === 'floor') result = lower;
      else if (rule.direction === 'ceil') result = upper;
      else if (!tie) result = value - lower < upper - value ? lower : upper;
      else if (rule.ties === 'up') result = upper;
      else if (rule.ties === 'down') result = lower;
      else if (rule.ties === 'even') result = Math.round((lower - offset) / step) % 2 === 0 ? lower : upper;
      else result = rule.ties === 'toward-zero' ? (away === upper ? lower : upper) : away;
    }
  }
  if (typeof rule.min === 'number') result = Math.max(rule.min, result);
  if (typeof rule.max === 'number') result = Math.min(rule.max, result);
  return result;
}

// ---- neighbour bounds (DISL 4.3) ----

const within = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/**
 * The present values of ordered attributes, each kept `gap` from the anchors around it and from
 * the two ends. The first `inner` are anchors; an absent one among them counts as an anchor when
 * `spread`. The pinned one is placed first, and the others around it. Nothing when there is no room.
 */
export function keptApart(values: readonly (number | undefined)[], low: number, high: number, gap: number, inner: number, spread: boolean, pinned: number): (number | undefined)[] | undefined {
  const slots = [...values];
  const count = Math.max(0, Math.min(inner, slots.length));
  // The gaps between two places: one for each anchor from the first to the second.
  const steps = (from: number, to: number): number => (spread ? to - from : 1 + slots.slice(from + 1, to).filter((slot) => slot !== undefined).length);
  if (slots.every((slot) => slot === undefined)) return slots;
  if (steps(-1, count) * gap > high - low) return undefined;

  const moved = pinned >= 0 && pinned < count ? slots[pinned] : undefined;
  if (moved !== undefined) {
    let below = pinned - 1;
    while (below >= 0 && slots[below] === undefined) below--;
    let above = pinned + 1;
    while (above < count && slots[above] === undefined) above++;
    const floor = (below < 0 ? low : slots[below]!) + steps(below, pinned) * gap;
    slots[pinned] = within(moved, floor, (above >= count ? high : slots[above]!) - steps(pinned, above >= count ? count : above) * gap);
  }

  let previousAt = -1;
  let previous = low;
  for (let index = 0; index < slots.length; index++) {
    const value = slots[index];
    if (value === undefined) continue;
    // One that is no anchor is only kept between the two ends, after the one before it.
    const highest = Math.max(low, high - gap);
    const kept = index < count
      ? within(value, previous + steps(previousAt, index) * gap, high - steps(index, count) * gap)
      : within(value, Math.min(previous + gap, highest), highest);
    slots[index] = kept;
    previousAt = index;
    previous = kept;
  }
  return slots;
}

// ---- a drop in a viewpoint that places by layout ----

/**
 * Where a point along an axis that a layout places stands on the axis of the viewpoint it varies.
 * DISL does not state it, so this is an interim rule: between two placed elements the coordinate
 * runs evenly from the one's own place to the other's, beyond the first and the last it runs at the
 * scale of the base axis, and with nothing placed it is the point itself. Each pair is where an
 * element is placed by the layout, and where it is in the base viewpoint.
 */
export function baseCoordinate(pairs: readonly { readonly placed: number; readonly base: number }[], at: number): number {
  const ordered = [...pairs].sort((a, b) => a.placed - b.placed);
  const before = ordered.filter((pair) => pair.placed <= at).at(-1);
  const after = ordered.find((pair) => pair.placed > at);
  if (!before) return after ? after.base - (after.placed - at) : at;
  if (!after || after.placed === before.placed) return before.base + (at - before.placed);
  return before.base + ((at - before.placed) / (after.placed - before.placed)) * (after.base - before.base);
}

// ---- the behavior ----

type Source = 'user' | 'hook' | 'operation' | 'layout';

// An element among the variables of a transaction: it is looked up again in the working model each time.
class Reference {
  constructor(readonly ids: string | readonly string[]) {}
}

const skips = ['move', 'resize', 'retype', 'reparent', 'reorder', 'view', 'plugin'];
const asks = ['select', 'reveal', 'highlight', 'editLabel', 'openForm'] as const;
const defaultLabels: Readonly<Record<string, string>> = { delete: 'Delete', editLabel: 'Rename', duplicate: 'Duplicate', openForm: 'Properties', moveUp: 'Move up', moveDown: 'Move down' };

const list = (value: string | readonly string[] | undefined): readonly string[] => (value === undefined ? [] : typeof value === 'string' ? [value] : value);
const bound = (source: PlacementSource | undefined): { readonly attribute: string; readonly offset: number } | undefined =>
  (isObject(source) && 'attribute' in source ? { attribute: source.attribute, offset: typeof source.offset === 'number' ? source.offset : 0 } : undefined);
const allowed = (flag: Placement['movable'], axis: 'x' | 'y'): boolean => (typeof flag === 'object' ? flag[axis] !== false : flag !== false);
const attributeIn = (value: unknown): string | undefined => (isObject(value) && typeof value.attribute === 'string' ? value.attribute : undefined);

/** Interprets `behavior`. Its findings are the expressions that cannot be read and the actions that are not run. */
export function interpretBehavior(specification: Specification, metamodel: Metamodel, expressions: Expressions, parts: BehaviorParts): Loaded<Behavior> {
  const section = (specification.behavior ?? {}) as BehaviorSection;
  const { constraints, coordinates, toolbox } = parts;
  const findings: Finding[] = [];
  const texts = createTexts(specification, expressions);
  const { worded, applicable, holds } = texts;
  const locale = specification.language.defaultLocale ?? 'en';
  const ownNotation = parts.notation ?? interpretNotation(specification, metamodel).value;
  const hooks = [...(section.hooks ?? [])].sort((a, b) => Number(b.phase === 'before') - Number(a.phase === 'before') || (a.order ?? 0) - (b.order ?? 0));
  const declared = section.operations ?? {};
  const messages = section.messages ?? {};
  // A condition that is not given holds, and one that cannot be evaluated does not.
  const given = (condition: unknown, scope: Scope): boolean => condition === undefined || holds(condition, scope, false);
  const mint = (type: string): string => parts.newId?.(type) ?? newId(parts.persistence, type);

  // ---- what cannot be read ----

  const unread = (owner: string, values: readonly unknown[]): void => {
    for (const value of values) {
      const error = typeof value === 'string' || isCel(value) ? expressions.compile(value).error : undefined;
      if (error !== undefined) findings.push(finding('disl.behavior', 'error', `An expression of ${owner} cannot be read: ${error}`));
    }
  };
  const inspect = (owner: string, actions: readonly unknown[] | undefined): void => {
    for (const action of actions ?? []) {
      if (!isObject(action)) continue;
      const skipped = skips.find((kind) => kind in action);
      if (skipped !== undefined) findings.push(finding('disl.behavior', 'warning', `An action of ${owner} is a \`${skipped}\`, which this add-on does not run, so it is skipped.`));
      const members = (value: unknown): unknown[] => (isObject(value) ? Object.values(value).flatMap((member) => (isObject(member) && !isCel(member) ? Object.values(member) : [member])) : []);
      unread(owner, [action.when, action.if, action.forEach, action.delete, action.target, ...members(action.set), ...members(action.let), ...members(action.create), ...members(action.connect), ...members(action.abort)]);
      for (const nested of [action.then, action.else, action.do]) if (Array.isArray(nested)) inspect(owner, nested);
    }
  };
  for (const hook of hooks) {
    unread(`the hook \`${hook.id}\``, [hook.when]);
    inspect(`the hook \`${hook.id}\``, hook.actions);
  }
  for (const [id, operation] of Object.entries(declared)) {
    unread(`the operation \`${id}\``, [operation.enabled, isCel(operation.label) ? operation.label : undefined]);
    inspect(`the operation \`${id}\``, operation.actions);
  }

  // ---- the viewpoint an intent takes place in ----

  const viewOf = (situation: Situation | undefined, base: boolean): { readonly notation: Notation; readonly system: CoordinateSystem | undefined } => {
    const all = parts.viewpoints?.all ?? {};
    const name = typeof situation?.env?.viewpoint === 'string' && situation.env.viewpoint !== '' ? situation.env.viewpoint : parts.viewpoints?.default;
    const own = name !== undefined && Object.hasOwn(all, name) ? all[name] : undefined;
    // What is created is placed as the viewpoint a variant varies places it.
    const viewpoint = base && own?.variantOf !== undefined ? all[own.variantOf] : own;
    return { notation: viewpoint?.notation ?? ownNotation, system: coordinates.systems[viewpoint?.coordinateSystem ?? coordinates.default] };
  };

  const indexes = new WeakMap<Model, Map<string, ModelElement | ModelRelation>>();
  const find = (model: Model, id: string): ModelElement | ModelRelation | undefined => {
    let index = indexes.get(model);
    if (!index) indexes.set(model, index = new Map<string, ModelElement | ModelRelation>([...model.relations, ...model.elements].map((element) => [element.id, element])));
    return index.get(id);
  };
  const typeOf = (model: Model, id: string): string => (id === '' ? 'diagram' : find(model, id)?.type ?? '');
  const policyOf = (type: string): DeletionPolicy => {
    const name = (metamodel.types[type]?.lineage ?? [type]).find((candidate) => Object.hasOwn(section.deletion ?? {}, candidate));
    return name === undefined ? {} : section.deletion![name];
  };

  // The value an attribute takes: a whole number for an integer and a month, and no more decimals than its `precision`.
  const fitted = (value: Value | null, attribute: Attribute | undefined): Value | null => {
    if (value === null || !attribute) return value;
    const kind = valueKind(metamodel, attribute.type);
    if (kind.kind !== 'primitive' || Array.isArray(value)) return value;
    if (kind.primitive === 'yearMonth' && typeof value === 'string') return parseYearMonth(value) ?? value;
    if (typeof value !== 'number') return value;
    if (kind.primitive === 'int' || kind.primitive === 'yearMonth') return awayFromZero(value);
    const factor = typeof attribute.precision === 'number' ? 10 ** attribute.precision : undefined;
    return factor === undefined ? value : awayFromZero(value * factor) / factor;
  };

  const question = (confirm: Message | Confirmation | undefined, scope: Scope, deleting: boolean, title: string): Question | undefined => {
    if (confirm === undefined) return undefined;
    const asked: Confirmation = isObject(confirm) && !isCel(confirm) && 'message' in confirm ? (confirm as unknown as Confirmation) : { message: confirm as Message };
    const counted = asked.count === undefined ? undefined : expressions.evaluate(asked.count, scope);
    const count = counted?.ok ? counted.raw : undefined;
    const asking = { ...scope, count };
    if (!given(asked.when, asking) || (count !== undefined && Number(count) < (asked.threshold ?? 0))) return undefined;
    return {
      title: worded(asked.title, asking, title),
      message: worded(asked.message, asking, ''),
      confirmLabel: worded(asked.confirmLabel, asking, deleting ? 'Delete' : 'OK'),
      cancelLabel: worded(asked.cancelLabel, asking, 'Cancel'),
      danger: asked.danger ?? deleting,
    };
  };

  const message = (id: string, model: Model, situation?: Situation, more?: Scope): string | undefined =>
    (Object.hasOwn(messages, id) ? worded(messages[id], texts.scope({ model, env: situation?.env }, more), '') || undefined : undefined);

  // Why no change can be made at all: the diagram is read-only, or a reason of the edit gate applies (DISL 9.1).
  const gate = (model: Model, situation: Situation | undefined): string | undefined => {
    if (situation?.env?.readOnly === true) return message('std.readOnly', model, situation) ?? 'This diagram cannot be changed here.';
    return applicable(section.editGate, texts.scope({ model, env: situation?.env }));
  };

  // ---- one transaction ----

  const open = (model: Model, situation: Situation | undefined, kind: 'change' | 'handle' | 'create') => {
    const env = situation?.env;
    const before = expressions.over(model, { env });
    const changes: Change[] = [];
    const created: string[] = [];
    const effects: Effect[] = [];
    const ran = new Set<string>();
    const edited = new Map<string, string[]>();
    const touched = new Map<string, Set<string>>();
    let working = model;
    let world: { readonly model: Model; readonly world: World } = { model, world: before };
    let refused = gate(model, situation);
    let lastGesture: Gesture | undefined;

    const refuse = (sentence: string): void => { refused ??= sentence; };
    const now = (): World => {
      if (world.model !== working) world = { model: working, world: expressions.over(working, { env }) };
      return world.world;
    };
    const scopeOf = (self: string | undefined, variables: Readonly<Record<string, unknown>> = {}): Scope => {
      const over = now();
      const more: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(variables)) {
        more[name] = !(value instanceof Reference) ? value : typeof value.ids === 'string' ? over.element(value.ids) : value.ids.map((id) => over.element(id));
      }
      if (self === undefined) return over.scope(undefined, more);
      return self === '' ? over.scope(undefined, { self: over.diagram, ...more }) : over.scope(self, more);
    };
    const evaluated = (expression: unknown, scope: Scope): { readonly value: Value; readonly raw: unknown } | undefined => {
      if (typeof expression !== 'string' && !isCel(expression)) return expression === undefined ? undefined : { value: expression as Value, raw: expression };
      const result = expressions.evaluate(expression, scope);
      if (!result.ok) refuse(`This could not be done: ${result.error}`);
      return result.ok ? result : undefined;
    };

    // A gesture is checked against the model as it was before the transaction (DISL 8.4).
    const check = (gesture: Gesture): boolean => {
      if (refused !== undefined) return false;
      lastGesture = gesture;
      const found = constraints.refusals(gesture, model);
      if (found.length > 0) refuse(found[0].message);
      return found.length === 0;
    };

    const apply = (change: Change): void => {
      working = applyChanges(working, [change]);
      const at = change.kind === 'set' ? changes.map((other) => other.id).lastIndexOf(change.id) : -1;
      const earlier = at < 0 ? undefined : changes[at];
      if (earlier?.kind === 'add' && change.kind === 'set') changes[at] = { ...earlier, attributes: merged(earlier.attributes, change.attributes) };
      else if (earlier?.kind === 'set' && change.kind === 'set') changes[at] = { ...earlier, attributes: { ...earlier.attributes, ...change.attributes } };
      else changes.push(change);
    };

    const fire = (event: string, id: string, attributes: readonly string[], source: Source): void => {
      for (const hook of hooks) {
        if (refused !== undefined) return;
        const type = typeOf(working, id);
        if (!list(hook.on).includes(event) || (hook.for !== undefined && !list(hook.for).some((name) => isA(metamodel, type, name)))) continue;
        if (event === 'change' && hook.attribute !== undefined && !list(hook.attribute).some((name) => attributes.includes(name))) continue;
        // A hook runs once for an element in a transaction, and a transaction runs no more than so many (DISL 9.2).
        const key = JSON.stringify([hook.id, id]);
        if (ran.has(key)) continue;
        const variables = { old: before.element(id), event: { kind: event, attribute: attributes[0] ?? null, source } };
        if (!given(hook.when, scopeOf(id, variables))) continue;
        if (ran.size >= (section.maxHookDepth ?? 100)) return refuse('This could not be done: its consequences do not come to an end.');
        ran.add(key);
        act(hook.actions, id, { ...variables }, 'hook');
      }
    };

    const write = (id: string, values: Readonly<Record<string, Value | null>>, source: Source, checked = source !== 'hook'): void => {
      if (refused !== undefined) return;
      const element = id === '' ? undefined : find(working, id);
      if (id !== '' && !element) return refuse('That is no longer in this diagram.');
      const type = element?.type ?? 'diagram';
      const attributes = attributesOf(metamodel, type);
      const current = element?.attributes ?? working.diagram;
      const next: Record<string, Value | null> = {};
      for (const [name, value] of Object.entries(values)) {
        const fits = fitted(value, Object.hasOwn(attributes, name) ? attributes[name] : undefined);
        if (!same(current[name], fits)) next[name] = fits;
      }
      const names = Object.keys(next);
      if (names.length === 0) return;
      if (checked) for (const name of names) if (!check({ kind: 'change', self: id === '' ? undefined : id, values: { attribute: name, newValue: next[name] } })) return;
      apply({ kind: 'set', id, attributes: next });
      touched.set(id, new Set([...(touched.get(id) ?? []), ...names]));
      if (source === 'user') edited.set(id, [...(edited.get(id) ?? []), ...names]);
      fire('change', id, names, source);
    };

    // The snapped point of a drop of an element of a type, in domain values, and what its placement binds to it.
    const dropped = (type: string, at: Point | undefined): { readonly position: Point | null; readonly placed: Record<string, Value> } => {
      if (!at) return { position: null, placed: {} };
      const view = viewOf(situation, true);
      const node = nodeNotation(view.notation, metamodel, type);
      const system = coordinates.systems[node.placement.system ?? ''] ?? view.system;
      const position = { x: at.x, y: at.y };
      const placed: Record<string, Value> = {};
      for (const axis of ['x', 'y'] as const) {
        position[axis] = snapped(ruleFor(system, node.snapping, 'drop', axis), at[axis], system?.[axis], working.diagram, (cel, value) => {
          const result = expressions.evaluate(cel, scopeOf(undefined, { value }));
          return result.ok && typeof result.value === 'number' ? result.value : undefined;
        });
        const source = bound(node.placement[axis]);
        if (source) placed[source.attribute] = position[axis] - source.offset;
      }
      return { position, placed };
    };

    const add = (type: string, attributes: Readonly<Record<string, Value | null>>, ends?: { readonly source: string; readonly target: string }, parent?: string): string | undefined => {
      const meta = metamodel.types[type];
      if (!meta || meta.abstract || isRelation(meta) !== (ends !== undefined)) {
        refuse(`This could not be done: \`${type}\` is not a type that can be created here.`);
        return undefined;
      }
      const id = mint(type);
      const fits: Record<string, Value | null> = {};
      for (const [name, value] of Object.entries({ ...defaultsOf(metamodel, type), ...attributes })) fits[name] = fitted(value, meta.attributes[name]);
      apply({ kind: 'add', id, type, attributes: merged({}, fits), ...ends, ...(parent === undefined ? {} : { parent }) });
      created.push(id);
      fire(ends ? 'connect' : 'create', id, [], 'user');
      return id;
    };

    // The attributes the ends of a relation are bound to, with where each end attaches: where it is given, else the notation's default.
    const attached = (id: string, places: { readonly source?: EndPlace; readonly target?: EndPlace }, defaults: boolean): Record<string, Value> => {
      const notation = edgeNotation(viewOf(situation, false).notation, metamodel, typeOf(working, id));
      let anchoring = notation.anchoring;
      for (const variant of notation.variants) if (given(variant.when, scopeOf(id))) anchoring = { ...anchoring, ...variant.anchoring };
      const values: Record<string, Value> = {};
      for (const side of ['source', 'target'] as const) {
        const anchor: EndAnchor | undefined = anchoring[side];
        const end = places[side];
        if (anchor?.mode !== 'part' || (!defaults && !end)) continue;
        for (const key of ['part', 'side', 'at'] as const) {
          const attribute = attributeIn(anchor[key]);
          if (attribute === undefined) continue;
          const preset = anchor.default?.[key];
          // A default is a literal, or computed for the relation as it is now.
          const value = end?.[key] ?? (!defaults ? undefined : isCel(preset) ? evaluated(preset, scopeOf(id))?.value : isObject(preset) ? undefined : preset);
          if (value !== undefined && value !== null) values[attribute] = value;
        }
      }
      return values;
    };

    const drop = (selection: readonly string[]): void => {
      const doomed: string[] = [];
      const mark = (id: string): void => {
        const element = find(working, id);
        if (!element || doomed.includes(id) || refused !== undefined) return;
        if (!isRelation(metamodel.types[element.type]) && !('source' in element)) {
          const policy = policyOf(element.type);
          const relations = working.relations.filter((relation) => relation.source === id || relation.target === id);
          const children = working.elements.filter((child) => child.parent === id);
          const kept = (relations.length > 0 && (policy.relations === 'forbid' || policy.relations === 'reconnect')) || (children.length > 0 && (policy.children === 'forbid' || policy.children === 'reparent'));
          if (kept) return refuse(`${metamodel.types[element.type]?.label ?? 'This'} cannot be removed while something is connected to it or lies in it.`);
          for (const other of [...relations, ...children]) mark(other.id);
        }
        doomed.push(id);
      };
      for (const id of selection) mark(id);
      if (doomed.length === 0) return;
      if (!check({ kind: 'delete', self: selection.find((id) => doomed.includes(id)), values: { selection: selection.map((id) => before.element(id)).filter((element) => element !== null) } })) return;
      for (const id of doomed) {
        const element = find(working, id);
        if (!element) continue;
        fire('source' in element ? 'disconnect' : 'delete', id, [], 'user');
        // A reference to what is removed is emptied (`references: "unset"`, DISL 9.5).
        for (const other of [...working.elements, ...working.relations]) {
          const referring = Object.entries(attributesOf(metamodel, other.type)).filter(([name, attribute]) => other.attributes[name] === id && valueKind(metamodel, attribute.type).kind === 'reference');
          if (referring.length > 0) apply({ kind: 'set', id: other.id, attributes: Object.fromEntries(referring.map(([name]) => [name, null])) });
        }
        apply({ kind: 'remove', id });
      }
    };

    const laidOut = (action: Readonly<Record<string, unknown>>, scope: Scope): void => {
      const config = typeof action.algorithm === 'string' && Object.hasOwn(parts.layout.algorithms, action.algorithm) ? parts.layout.algorithms[action.algorithm] : undefined;
      const refusals = isObject(action.refusals) ? action.refusals : {};
      // Another algorithm places what is drawn and writes nothing to the model.
      if (!config?.rows) return;
      const rows = parts.rows?.(config, working) ?? new Map<string, number>();
      if (rows.size === 0) return refuse(worded(refusals.nothingDrawn as Message | undefined, scope, 'There is nothing to lay out.'));
      let written = false;
      for (const element of working.elements) {
        const row = rows.get(element.id);
        const values: Record<string, Value> = {};
        for (const name of config.rows.writes) {
          const attribute = attributesOf(metamodel, element.type)[name] as Attribute | undefined;
          if (row !== undefined && attribute && !same(element.attributes[name] ?? defaultOf(attribute), row)) values[name] = row;
        }
        if (Object.keys(values).length === 0) continue;
        written = true;
        write(element.id, values, 'layout');
      }
      if (!written) refuse(worded(refusals.unchanged as Message | undefined, scope, 'This would change nothing.'));
    };

    function act(actions: readonly unknown[], self: string, variables: Record<string, unknown>, source: Source): void {
      for (const action of actions) {
        if (refused !== undefined) return;
        if (!isObject(action) || !given(action.when, scopeOf(self, variables))) continue;
        const one = (expression: unknown): { readonly value: Value; readonly raw: unknown } | undefined => evaluated(expression, scopeOf(self, variables));
        const each = (members: unknown): Record<string, Value | null> | undefined => {
          const values: Record<string, Value | null> = {};
          for (const [name, expression] of Object.entries(isObject(members) ? members : {})) {
            const result = one(expression);
            if (!result) return undefined;
            values[name] = result.value;
          }
          return values;
        };
        const target = action.target === undefined ? self : one(action.target)?.value;
        const kept = (name: unknown, id: string | undefined): void => { if (typeof name === 'string' && id !== undefined) variables[name] = new Reference(id); };
        const asked = asks.find((kind) => kind in action);
        // A sentence of an action is an expression, as every value of an action is (DISL 9.4).
        const said = (text: unknown, otherwise: string): string => {
          const result = text === undefined ? undefined : one(text)?.value;
          return typeof result === 'string' ? result : otherwise;
        };

        if (isObject(action.set)) {
          const values = each(action.set);
          if (values && typeof target === 'string') write(target, values, source);
        } else if (Array.isArray(action.unset)) {
          const stored = typeof target === 'string' ? (target === '' ? working.diagram : find(working, target)?.attributes) ?? {} : {};
          if (typeof target === 'string') write(target, Object.fromEntries((action.unset as string[]).filter((name) => Object.hasOwn(stored, name)).map((name) => [name, null])), source);
        } else if (isObject(action.create)) {
          const type = one(action.create.type)?.value;
          const values = each(action.create.attributes);
          const at = action.create.at === undefined ? undefined : one(action.create.at)?.value;
          const parent = action.create.parent === undefined ? undefined : one(action.create.parent)?.value;
          if (typeof type !== 'string' || !values) continue;
          const point = isObject(at) && typeof at.x === 'number' && typeof at.y === 'number' ? { x: at.x, y: at.y } : undefined;
          const { position, placed } = dropped(type, point);
          if (check({ kind: 'create', values: { elementType: type, position, parent: null, dropTarget: null, tool: null } })) kept(action.as, add(type, { ...placed, ...values }, undefined, typeof parent === 'string' ? parent : undefined));
        } else if (isObject(action.connect)) {
          const type = one(action.connect.type)?.value;
          const from = one(action.connect.source)?.value;
          const to = one(action.connect.target)?.value;
          const values = each(action.connect.attributes);
          if (typeof type === 'string' && typeof from === 'string' && typeof to === 'string' && values) kept(action.as, related(type, from, to, {}, values));
        } else if (action.delete !== undefined) {
          const doomed = one(action.delete)?.value;
          drop((Array.isArray(doomed) ? doomed : [doomed]).filter((id): id is string => typeof id === 'string'));
        } else if (isObject(action.let)) {
          for (const [name, expression] of Object.entries(action.let)) {
            const result = one(expression);
            if (!result) break;
            // An element is kept by its id, so that a later action sees it as it is then.
            const element = typeof result.raw === 'object' && result.raw !== null && typeof result.value === 'string';
            variables[name] = element ? new Reference(result.value as string) : result.raw;
          }
        } else if (action.if !== undefined) {
          const branch = holds(action.if, scopeOf(self, variables), false) ? action.then : action.else;
          if (Array.isArray(branch)) act(branch, self, variables, source);
        } else if (action.forEach !== undefined) {
          const items = one(action.forEach);
          const name = typeof action.as === 'string' ? action.as : 'item';
          if (!items || !Array.isArray(items.raw) || !Array.isArray(items.value) || !Array.isArray(action.do)) continue;
          const plain = items.value;
          items.raw.forEach((item: unknown, index) => {
            const id = typeof item === 'object' && item !== null ? plain[index] : undefined;
            act(action.do as unknown[], self, { ...variables, [name]: typeof id === 'string' ? new Reference(id) : item, index: BigInt(index) }, source);
          });
        } else if (isObject(action.layout)) {
          laidOut(action.layout, scopeOf(self, variables));
        } else if (isObject(action.abort)) {
          refuse(said(action.abort.message, 'This is not possible here.'));
        } else if (typeof action.call === 'string' && Object.hasOwn(declared, action.call)) {
          act(declared[action.call].actions ?? [], self, { ...variables, p: each(action.args) ?? {} }, source);
        } else if (isObject(action.notify)) {
          effects.push({ kind: 'notify', elements: [], message: said(action.notify.message, '') });
        } else if (asked !== undefined) {
          const named = isObject(action[asked]) ? (action[asked] as Record<string, unknown>).target : action[asked];
          const ids = named === undefined ? self : one(named)?.value;
          effects.push({ kind: asked, elements: (Array.isArray(ids) ? ids : [ids]).filter((id): id is string => typeof id === 'string' && id !== '') });
        }
      }
    }

    function related(type: string, source: string, target: string, ends: { readonly source?: EndPlace; readonly target?: EndPlace }, values: Readonly<Record<string, Value | null>> = {}): string | undefined {
      if (!check({ kind: 'connect', elements: { source, target }, values: { relationType: type } })) return undefined;
      const id = add(type, values, { source, target });
      if (id !== undefined) write(id, attached(id, ends, true), 'hook');
      return id;
    }

    // The neighbour bounds of every element the transaction touched (DISL 4.3): after the hooks, and part of the same step.
    const bounds = (): void => {
      for (const [id, names] of touched) {
        const element = id === '' ? undefined : find(working, id);
        const neighbour: NeighbourBounds | undefined = (metamodel.types[element?.type ?? '']?.lineage ?? []).map((type) => metamodel.types[type].declared.bounds?.neighbour).find((entry) => entry !== undefined);
        if (!element || !neighbour || !(neighbour.on ?? ['change', 'handle', 'create']).includes(kind)) continue;
        if (![...neighbour.attributes, ...neighbour.between].some((name) => names.has(name))) continue;
        const stored = (name: string): number | undefined => (typeof element.attributes[name] === 'number' ? element.attributes[name] : undefined);
        const number = (value: number | CelValue | undefined, otherwise: number): number => {
          const result = isCel(value) ? expressions.evaluate(value, scopeOf(id)) : undefined;
          return typeof value === 'number' ? value : result?.ok && typeof result.value === 'number' ? result.value : otherwise;
        };
        const [low, high] = neighbour.between.map(stored);
        if (low === undefined || high === undefined) continue;
        const values = neighbour.attributes.map(stored);
        const pinned = neighbour.pinned === 'edited' ? neighbour.attributes.findIndex((name) => edited.get(id)?.includes(name)) : -1;
        const kept = keptApart(values, low, high, number(neighbour.gap, 0), number(neighbour.inner, values.length), neighbour.absent === 'spread', pinned);
        if (!kept) return refuse('There is too little room between the two ends for this.');
        const next = Object.fromEntries(neighbour.attributes.flatMap((name, index) => (kept[index] !== undefined && kept[index] !== values[index] ? [[name, kept[index]]] : [])));
        if (Object.keys(next).length > 0) apply({ kind: 'set', id, attributes: next });
      }
    };

    const finish = (): Outcome => {
      if (refused === undefined) bounds();
      // An invariant that prevents rejects the whole transaction (DISL 14.4).
      const broken = refused === undefined && changes.length > 0 && lastGesture ? constraints.refusals(lastGesture, model, working) : [];
      if (broken.length > 0) refuse(broken[0].message);
      return refused === undefined ? { changes, after: working, created, effects } : { refused };
    };

    return { act, add, attached, check, dropped, drop, evaluated, finish, fire, refuse, related, scopeOf, write, effects };
  };

  // ---- operations ----

  const operations: Operation[] = Object.entries(declared).map(([id, operation]) => ({
    id,
    label: operation.label ?? labelOf(id),
    icon: typeof operation.icon === 'string' ? operation.icon : undefined,
    doc: localized(isObject(operation.doc) ? (operation.doc.summary as string | undefined) : operation.doc, locale, locale),
    for: list(operation.for ?? 'diagram'),
    keys: [...new Set([
      operation.shortcut,
      ...Object.values(toolbox.tools).filter((tool) => tool.operation === id).map((tool) => tool.shortcut),
      ...[...toolbox.contextTools, ...toolbox.contextMenus].flatMap((set) => set.entries.filter((entry) => entry.operation === id).map((entry) => entry.shortcut)),
    ].filter((key): key is string => key !== undefined))],
  }));

  const availability = (model: Model, id: string, selection: readonly string[], situation?: Situation): Availability => {
    const operation = Object.hasOwn(declared, id) ? declared[id] : undefined;
    const known = operations.find((candidate) => candidate.id === id);
    if (!operation || !known) return { offered: false, available: false, label: labelOf(id) };
    const over = texts.world(model, situation?.env);
    const first = selection.length > 0 ? find(model, selection[0]) : undefined;
    const target = first && known.for.some((name) => isA(metamodel, first.type, name)) ? first.id : undefined;
    const whole = known.for.includes('selection') && selection.length > 0;
    const scope = target !== undefined ? over.scope(target, { position: null })
      : over.scope(undefined, { self: over.diagram, position: null, ...(whole ? { selection: selection.map((entry) => over.element(entry)) } : {}) });
    const label = worded(known.label, scope, labelOf(id));
    if (target === undefined && !whole && !known.for.includes('diagram')) return { offered: false, available: false, label };
    const reason = gate(model, situation) ?? applicable(operation.unavailable, scope);
    return {
      offered: true, available: reason === undefined && given(operation.enabled, scope), reason, label, target,
      confirm: question(operation.confirm, scope, false, label),
    };
  };

  const done = (outcome: Outcome): outcome is Exclude<Outcome, { readonly refused: string }> => outcome.refused === undefined;
  const domain = (model: Model, system: CoordinateSystem | undefined, at: Point): Point => {
    if (!system) return at;
    const scales = scalesOf(system, model.diagram);
    return { x: scales.x.toValue(at.x), y: scales.y.toValue(at.y) };
  };

  const operate: Behavior['operate'] = (model, id, selection, situation, at, args) => {
    const state = availability(model, id, selection, situation);
    const position = at ? domain(model, viewOf(situation, true).system, at) : null;
    if (!state.offered) return { refused: message('std.notApplicable', model, situation, { operationId: id, position }) ?? 'This cannot be done with what is selected.' };
    if (!state.available) return { refused: state.reason ?? `${state.label} cannot be done now.` };
    const run = open(model, situation, 'change');
    const whole = state.target === undefined && selection.length > 0 ? { selection: new Reference(selection) } : {};
    run.act(declared[id].actions ?? [], state.target ?? '', { position, p: args ?? {}, ...whole }, 'operation');
    return run.finish();
  };

  // ---- intents ----

  const create: Behavior['create'] = (model, id, at, situation) => {
    const tool = Object.hasOwn(toolbox.tools, id) ? toolbox.tools[id] : undefined;
    if (tool?.operation !== undefined) return operate(model, tool.operation, [], situation, at);
    if (!tool?.creates || tool.relation) return { refused: 'This tool places nothing where it is dropped.' };
    const run = open(model, situation, 'create');
    const node = nodeNotation(viewOf(situation, true).notation, metamodel, tool.creates);
    const system = coordinates.systems[node.placement.system ?? ''] ?? viewOf(situation, true).system;
    const { position, placed } = run.dropped(tool.creates, domain(model, system, at));
    const variables = { position, elementType: tool.creates, parent: null, dropTarget: null, tool: id };
    if (!run.check({ kind: 'create', values: variables })) return run.finish();
    const initial: Record<string, Value | null> = {};
    for (const [name, value] of Object.entries(tool.initial)) {
      const result = isCel(value) ? run.evaluated(value, run.scopeOf(undefined, variables)) : { value };
      if (!result) return run.finish();
      initial[name] = result.value;
    }
    const made = run.add(tool.creates, { ...placed, ...initial });
    // What follows a creation is the tool's to say (`after`, DISL 7.2); the new element is in `created` either way.
    if (made !== undefined && tool.after !== 'none') run.effects.push({ kind: tool.after, elements: [made] });
    return run.finish();
  };

  const connect: Behavior['connect'] = (model, type, source, target, ends, situation) => {
    const run = open(model, situation, 'create');
    run.related(type, source, target, ends ?? {});
    return run.finish();
  };

  const change: Behavior['change'] = (model, element, values, situation) => {
    const run = open(model, situation, 'change');
    run.write(element ?? '', values, 'user');
    return run.finish();
  };

  const edit: Behavior['edit'] = (model, element, item, input, situation) => {
    const stopped = gate(model, situation);
    if (stopped !== undefined) return { refused: stopped };
    const parsed = item.parse({ model, element, env: situation?.env }, input);
    if ('refused' in parsed) return parsed;
    const run = open(model, situation, 'change');
    if ('set' in parsed) run.write(element ?? '', parsed.set, 'user');
    else run.act(parsed.write, element ?? '', { value: parsed.value }, 'user');
    run.act(item.onChange, element ?? '', {}, 'operation');
    return run.finish();
  };

  const editLabel: Behavior['editLabel'] = (model, element, text, situation, name) => {
    const run = open(model, situation, 'change');
    const notation = viewOf(situation, false).notation;
    const type = typeOf(model, element);
    const labels: readonly Label[] = isRelation(metamodel.types[type]) ? edgeNotation(notation, metamodel, type).labels : nodeNotation(notation, metamodel, type).labels;
    const attributeOf = (label: Label): string | undefined => attributeIn(label.editText) ?? attributeIn(label.text);
    const label = labels.find((candidate) => (name === undefined ? candidate.editable !== false && (candidate.parse?.write !== undefined || attributeOf(candidate) !== undefined) : candidate.id === name));
    const attribute = label && attributeOf(label);
    if (!label || label.editable === false || (label.parse?.write === undefined && attribute === undefined)) run.refuse('This text cannot be changed here.');
    else if (label.parse?.write !== undefined) run.act(label.parse.write, element, { value: text }, 'user');
    else run.write(element, { [attribute!]: text }, 'user');
    return run.finish();
  };

  // What moving or resizing an element needs: its placement, its scales, and the rule that snaps a gesture along an axis.
  const placing = (model: Model, id: string, situation: Situation | undefined, gesture: string, run: ReturnType<typeof open>) => {
    const element = find(model, id);
    const view = viewOf(situation, false);
    const node = nodeNotation(view.notation, metamodel, element?.type ?? '');
    const system = coordinates.systems[node.placement.system ?? ''] ?? view.system;
    const scales = system ? scalesOf(system, model.diagram) : undefined;
    const attributes = attributesOf(metamodel, element?.type ?? '');
    const read = (name: string | undefined): number | undefined => {
      const value = name === undefined || !element ? undefined : element.attributes[name] ?? (Object.hasOwn(attributes, name) ? defaultOf(attributes[name]) : undefined);
      return typeof value === 'number' ? value : undefined;
    };
    const snap = (axis: 'x' | 'y', value: number): number => snapped(ruleFor(system, node.snapping, gesture, axis), value, system?.[axis], model.diagram, (cel, raw) => {
      const result = expressions.evaluate(cel, run.scopeOf(id, { value: raw }));
      return result.ok && typeof result.value === 'number' ? result.value : undefined;
    });
    // The bounds a placement constraint sees, as CEL holds the attributes they are bound to (DISL 8.4).
    const boundsOf = (values: Readonly<Record<string, Value | null>>): Record<string, unknown> => {
      const world = texts.world(model, situation?.env);
      const result: Record<string, unknown> = {};
      for (const key of ['x', 'y', 'x2', 'y2'] as const) {
        const source = bound(node.placement[key]);
        const value = source && (Object.hasOwn(values, source.attribute) ? values[source.attribute] : read(source.attribute));
        if (source && typeof value === 'number' && Object.hasOwn(attributes, source.attribute)) result[key] = world.toCel(value, attributes[source.attribute]);
      }
      for (const key of ['width', 'height'] as const) {
        const name = attributeIn(node.size[key]);
        const value = name === undefined ? undefined : Object.hasOwn(values, name) ? values[name] : read(name);
        if (typeof value === 'number') result[key] = value;
      }
      return result;
    };
    return { element, node, scales, read, snap, boundsOf };
  };

  const move: Behavior['move'] = (model, elements, by, situation) => {
    const run = open(model, situation, 'change');
    for (const id of elements) {
      const { element, node, scales, read, snap, boundsOf } = placing(model, id, situation, 'move', run);
      const values: Record<string, Value> = {};
      for (const axis of ['x', 'y'] as const) {
        const source = bound(node.placement[axis]);
        const current = read(source?.attribute);
        if (!element || !source || !scales || current === undefined || by[axis] === 0 || !allowed(node.placement.movable, axis)) continue;
        values[source.attribute] = snap(axis, current + source.offset + by[axis] / scales[axis].perUnit) - source.offset;
        // The opposite edge moves along, so that the extent stays what it is.
        const opposite = bound(node.placement[`${axis}2`]);
        const far = read(opposite?.attribute);
        if (opposite && far !== undefined) values[opposite.attribute] = far + (values[source.attribute] as number) - current;
      }
      if (Object.keys(values).length === 0) continue;
      if (!run.check({ kind: 'placement', self: id, values: { gesture: 'move', oldBounds: boundsOf({}), newBounds: boundsOf(values), newParent: null } })) break;
      run.write(id, values, 'user', false);
      run.fire('move', id, [], 'user');
    }
    return run.finish();
  };

  const resize: Behavior['resize'] = (model, id, by, situation) => {
    const run = open(model, situation, 'change');
    const { element, node, scales, read, snap, boundsOf } = placing(model, id, situation, 'resize', run);
    const values: Record<string, Value> = {};
    const anchor = node.placement.anchor ?? 'top-left';
    const fraction = (axis: 'x' | 'y'): number => {
      if (typeof anchor !== 'string') return anchor[axis === 'x' ? 0 : 1];
      return anchor.includes(axis === 'x' ? 'left' : 'top') ? 0 : anchor.includes(axis === 'x' ? 'right' : 'bottom') ? 1 : 0.5;
    };
    for (const [axis, near, far, extent, only] of [['x', by.left ?? 0, by.right ?? 0, 'width', 'vertical'], ['y', by.top ?? 0, by.bottom ?? 0, 'height', 'horizontal']] as const) {
      if (!element || !scales || (near === 0 && far === 0) || !allowed(node.placement.resizable, axis) || node.size.resizable === false || node.size.resizable === only) continue;
      const source = bound(node.placement[axis]);
      const current = read(source?.attribute);
      const opposite = bound(node.placement[`${axis}2`]);
      const edge = read(opposite?.attribute);
      const sized = attributeIn(node.size[extent]);
      const size = read(sized);
      const to = (from: number, offset: number, distance: number): number => snap(axis, from + offset + distance / scales[axis].perUnit) - offset;
      if (opposite && edge !== undefined) {
        // The extent lies between two bound coordinates: each dragged edge is one of them.
        if (source && current !== undefined && near !== 0) values[source.attribute] = to(current, source.offset, near);
        if (far !== 0) values[opposite.attribute] = to(edge, opposite.offset, far);
      } else if (sized !== undefined && size !== undefined) {
        // The extent is a size in canvas units, and the anchor moves with the edges by its place between them.
        const shift = near * (1 - fraction(axis)) + far * fraction(axis);
        if (source && current !== undefined && shift !== 0) values[source.attribute] = to(current, source.offset, shift);
        values[sized] = size - near + far;
      }
    }
    if (Object.keys(values).length > 0 && run.check({ kind: 'placement', self: id, values: { gesture: 'resize', oldBounds: boundsOf({}), newBounds: boundsOf(values), newParent: null } })) {
      run.write(id, values, 'user', false);
      run.fire('resize', id, [], 'user');
    }
    return run.finish();
  };

  const dragHandle: Behavior['dragHandle'] = (model, id, param, value, situation) => {
    const run = open(model, situation, 'handle');
    const notation = viewOf(situation, false).notation;
    const reference = nodeNotation(notation, metamodel, typeOf(model, id)).shape;
    const shape = typeof reference === 'string' ? reference : 'type' in reference ? reference.type : '';
    const handle = (Object.hasOwn(notation.shapes, shape) ? notation.shapes[shape].handles : []).find((candidate) => candidate.param === param);
    const scope = run.scopeOf(id);
    if (!handle || !find(model, id)) run.refuse('That cannot be dragged here.');
    else if (!given(handle.visible, scope)) run.refuse(applicable(handle.refusals?.move === undefined ? [] : [handle.refusals.move as Reason], scope) ?? 'That cannot be dragged here.');
    else {
      const landed = snapped(handle.snap as SnapRule | undefined, value, undefined, model.diagram, (cel, raw) => {
        const result = expressions.evaluate(cel, run.scopeOf(id, { value: raw }));
        return result.ok && typeof result.value === 'number' ? result.value : undefined;
      });
      // A parameter bound to an attribute writes it; one that is computed is written by the handle's own actions (DISL 6.8).
      const attribute = typeof reference === 'object' && 'params' in reference ? attributeIn(reference.params?.[param]) : undefined;
      if (attribute !== undefined) run.write(id, { [attribute]: landed }, 'user');
      else run.act(handle.write ?? [], id, { value: landed }, 'user');
    }
    return run.finish();
  };

  const reattach: Behavior['reattach'] = (model, relation, side, end, situation) => {
    const run = open(model, situation, 'change');
    const values = find(model, relation) ? run.attached(relation, { [side]: end }, false) : {};
    if (Object.keys(values).length === 0) run.refuse('This end cannot be moved.');
    else run.write(relation, values, 'user');
    return run.finish();
  };

  const remove: Behavior['remove'] = (model, selection, situation) => {
    const run = open(model, situation, 'change');
    run.drop(selection);
    return run.finish();
  };

  const deletion: Behavior['deletion'] = (model, selection, situation) => {
    const outcome = remove(model, selection, situation);
    if (!done(outcome)) return { removes: [], refused: outcome.refused };
    const over = texts.world(model, situation?.env);
    const all = selection.map((id) => over.element(id)).filter((element) => element !== null);
    // One removal asks at most once: the first element of the selection whose confirmation asks (DISL 9.5).
    for (const id of selection) {
      const type = typeOf(model, id);
      const confirm = question(policyOf(type).confirm, over.scope(id, { selection: all }), true, 'Delete');
      if (confirm) return { removes: outcome.changes.flatMap((entry) => (entry.kind === 'remove' ? [entry.id] : [])), confirm };
    }
    return { removes: outcome.changes.flatMap((entry) => (entry.kind === 'remove' ? [entry.id] : [])) };
  };

  const menu: Behavior['menu'] = (model, target, situation, sets = toolbox.contextMenus) => {
    const over = texts.world(model, situation?.env);
    const pending = typeof target === 'object' ? target : undefined;
    const id = typeof target === 'string' ? target : undefined;
    const name = pending ? 'connection' : id === undefined ? 'diagram' : typeOf(model, id);
    const scope = pending ? over.scope(undefined, { source: over.element(pending.source), target: over.element(pending.target), sourceAnchor: null, position: null })
      : id === undefined ? over.scope(undefined, { self: over.diagram, position: null }) : over.scope(id, { position: null });
    const stopped = gate(model, situation);
    const groups: OfferedEntry[][] = [];
    const offered = setsFor(sets, metamodel, name).filter((set) => given(set.when, scope));
    for (const set of offered) {
      let previous: string | undefined;
      let group: OfferedEntry[] | undefined;
      for (const entry of set.entries) {
        // The groups are those of the entries as declared, whichever of them are shown (DISL 7.3).
        if (!group || entry.group !== previous) groups.push(group = []);
        previous = entry.group;
        const state = entry.operation === undefined ? undefined : availability(model, entry.operation, id === undefined ? [] : [id], situation);
        if (!given(entry.visible, scope) || state?.offered === false) continue;
        const made = entry.via ?? entry.creates;
        const reason = applicable(entry.unavailable, scope) ?? state?.reason ?? (entry.kind === 'operation' ? undefined : stopped);
        group.push({
          kind: entry.kind,
          label: worded(entry.label, scope, state?.label ?? defaultLabels[entry.kind] ?? (made === undefined ? labelOf(entry.kind) : metamodel.types[made]?.label ?? labelOf(made))),
          icon: entry.icon, shortcut: entry.shortcut, operation: entry.operation, creates: entry.creates, via: entry.via,
          enabled: reason === undefined && given(entry.enabled, scope) && state?.available !== false,
          reason,
        });
      }
    }
    return { groups: groups.filter((group) => group.length > 0), standardEntries: offered.some((set) => set.standardEntries), runSingle: offered.some((set) => set.runSingle) };
  };

  return { value: { messages, message, operations, availability, menu, deletion, create, connect, change, edit, editLabel, move, resize, dragHandle, reattach, remove, operate }, findings };
}
