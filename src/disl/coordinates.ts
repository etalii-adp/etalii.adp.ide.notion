// The coordinate systems of a specification (DISL 5): axes that map domain values to canvas units
// and back, the systems that pair them, and the rows of a ruler as data. Placement and snapping
// are declared with them and are carried as they are written, for the scene and the gestures.

import { formatPattern } from './expressions';
import { defaultOf, parseYearMonth, type Metamodel } from './metamodel';
import { finding, type Attributes, type Finding, type Loaded } from './model';
import { isObject, type CelValue, type Doc, type LocalizedText, type Specification } from './specification';

// ---- as the schema has them ----

/** The time units of DISL (5.5). On a month axis only `month` and coarser are allowed (DISL 5.5). */
export type UnitOfTime = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'decade' | 'century' | 'millennium';

/** A unit, or the attribute of the diagram that holds one (DISL 5.5, bound unit). */
export type BoundUnit = UnitOfTime | { readonly attribute: string };

/** One row of a ruler (DISL 5.13). */
export interface RulerLevel {
  readonly unit: UnitOfTime;
  readonly step?: number;
  readonly format?: string;
  readonly minSpacingPx?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export interface Ruler {
  readonly visible?: boolean;
  readonly position?: 'top' | 'bottom' | 'left' | 'right';
  readonly size?: number;
  readonly levels?: readonly RulerLevel[];
  readonly attach?: 'view' | 'canvas';
  readonly minUnit?: BoundUnit;
  readonly [name: string]: unknown;
}

/** `$defs/SnapRule`, as far as it is declared with a coordinate system or a node (DISL 5.10). */
export interface SnapRule {
  readonly grid?: { readonly spacing: number | { readonly unit: UnitOfTime }; readonly offset?: number };
  readonly calendar?: { readonly unit: BoundUnit; readonly step?: number };
  readonly values?: readonly number[];
  readonly cel?: string;
  readonly direction?: 'nearest' | 'floor' | 'ceil';
  readonly ties?: string;
  readonly [name: string]: unknown;
}

/** `$defs/Snapping` (DISL 5.9): a rule for each axis, and the rules of single gestures. */
export interface Snapping {
  readonly x?: SnapRule;
  readonly y?: SnapRule;
  readonly reference?: string;
  readonly byGesture?: Readonly<Record<string, { readonly x?: SnapRule; readonly y?: SnapRule }>>;
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

/** `$defs/PlacementSource` (DISL 5.8): where one coordinate of an element comes from. */
export type PlacementSource =
  | 'free'
  | { readonly attribute: string; readonly offset?: number | string; readonly doc?: Doc }
  | (CelValue & { readonly write?: unknown })
  | { readonly layout: true };

export type AnchorName = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

/** `$defs/Placement` (DISL 5.8). */
export interface Placement {
  readonly system?: string;
  readonly x?: PlacementSource;
  readonly y?: PlacementSource;
  readonly x2?: PlacementSource;
  readonly y2?: PlacementSource;
  readonly width?: PlacementSource;
  readonly height?: PlacementSource;
  readonly anchor?: AnchorName | readonly [number, number];
  readonly movable?: boolean | { readonly x?: boolean; readonly y?: boolean };
  readonly resizable?: boolean | { readonly x?: boolean; readonly y?: boolean };
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

// ---- interpreted ----

export interface Axis {
  readonly name: string;
  /** `linear`, or `time` over months; another kind is read as `linear` and reported. */
  readonly kind: 'linear' | 'time';
  readonly label?: LocalizedText;
  /** The domain value at canvas 0: a number, or the month index of a month axis. */
  readonly origin: number;
  /** Canvas units for one domain unit of a linear axis, or for one step of `unit` on a month axis. */
  readonly size: number;
  /** The step of a month axis, and the unit it falls back on when the diagram's attribute holds none. */
  readonly unit?: BoundUnit;
  readonly fallbackUnit?: UnitOfTime;
  readonly reversed: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly ruler?: Ruler;
}

export interface CoordinateSystem {
  readonly name: string;
  readonly x: Axis;
  readonly y: Axis;
  readonly orientation: 'y-down' | 'y-up';
  readonly infinite: boolean;
  readonly grid: Readonly<Record<string, unknown>>;
  readonly snapping?: Snapping;
  readonly label?: LocalizedText;
}

export interface Coordinates {
  readonly axes: Readonly<Record<string, Axis>>;
  readonly systems: Readonly<Record<string, CoordinateSystem>>;
  /** The system of a viewpoint that names none. */
  readonly default: string;
}

/** An axis for one diagram: domain values to canvas units at zoom 1, and back. */
export interface Scale {
  /** The step a month axis is drawn in, and how many months it spans. */
  readonly unit?: UnitOfTime;
  readonly months?: number;
  /** Canvas units for one domain unit: a number of a linear axis, a month of a month axis. Negative when reversed. */
  readonly perUnit: number;
  toCanvas(value: number): number;
  toValue(canvas: number): number;
}

export interface RulerTick {
  /** The domain value the tick stands at, and where that is in canvas units. */
  readonly value: number;
  readonly at: number;
  readonly label: string;
}

export interface RulerRow {
  readonly unit: UnitOfTime;
  readonly step: number;
  readonly format: string;
  /** Canvas units between two ticks. */
  readonly spacing: number;
  readonly ticks: readonly RulerTick[];
}

// ---- time units ----

const monthsByUnit: Partial<Record<UnitOfTime, number>> = { month: 1, quarter: 3, year: 12, decade: 120, century: 1200, millennium: 12000 };

/** The months in one step of a unit, or nothing for a unit finer than a month. */
export const monthsIn = (unit: unknown): number | undefined => (typeof unit === 'string' && Object.hasOwn(monthsByUnit, unit) ? monthsByUnit[unit as UnitOfTime] : undefined);

/** The unit a bound unit stands for in a diagram: the attribute's value, else the fallback. */
export function unitOf(unit: BoundUnit | undefined, diagram: Attributes, fallback: UnitOfTime = 'month'): UnitOfTime {
  const value = isObject(unit) ? diagram[unit.attribute] : unit;
  return monthsIn(value) === undefined ? fallback : (value as UnitOfTime);
}

// ---- reading ----

const linear = (name: string): Axis => ({ name, kind: 'linear', origin: 0, size: 1, reversed: false });
const canvas: CoordinateSystem = { name: 'canvas', x: linear('px'), y: linear('px'), orientation: 'y-down', infinite: true, grid: {} };

/** With no `coordinates`, one cartesian system `canvas` of two linear pixel axes (DISL 5.2). */
export const defaultCoordinates: Coordinates = { axes: { px: linear('px') }, systems: { canvas }, default: 'canvas' };

/** Interprets `coordinates`. What is not supported is read as the nearest thing that is, and reported. */
export function interpretCoordinates(specification: Specification, metamodel: Metamodel): Loaded<Coordinates> {
  const section = specification.coordinates;
  if (!section) return { value: defaultCoordinates, findings: [] };
  const findings: Finding[] = [];
  const report = (message: string): void => void findings.push(finding('disl.coordinates', 'warning', message));
  const number = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

  const axis = (name: string, declared: unknown): Axis => {
    if (!isObject(declared)) {
      report(`The axis \`${name}\` is not an object, so it is read as a linear axis.`);
      return linear(name);
    }
    const common = {
      name,
      label: declared.label as LocalizedText | undefined,
      reversed: declared.reversed === true,
      ruler: isObject(declared.ruler) ? (declared.ruler as Ruler) : undefined,
    };
    if (declared.kind === 'time' && declared.valueType === 'yearMonth') {
      const scale = isObject(declared.scale) ? declared.scale : {};
      const month = (value: unknown): number | undefined => (typeof value === 'string' ? parseYearMonth(value) : undefined);
      const bound = isObject(scale.unit) && typeof scale.unit.attribute === 'string' ? scale.unit.attribute : undefined;
      const unit = (bound === undefined ? scale.unit : { attribute: bound }) as BoundUnit | undefined;
      if (bound === undefined && monthsIn(unit ?? 'month') === undefined) report(`The axis \`${name}\` places by month, and the unit \`${String(scale.unit)}\` of its scale is finer than a month; it is drawn in months.`);
      if (bound !== undefined && !Object.hasOwn(metamodel.diagram, bound)) report(`The axis \`${name}\` takes its unit from the diagram's attribute \`${bound}\`, which the metamodel does not declare; it is drawn in months.`);
      const fallback = bound === undefined ? undefined : defaultOf(metamodel.diagram[bound] ?? { type: 'string' });
      if (declared.origin !== undefined && month(declared.origin) === undefined) report(`The origin of the axis \`${name}\` is not a year and a month, so the axis starts at year 0.`);
      return {
        ...common, kind: 'time', origin: month(declared.origin) ?? 0, size: number(scale.size, 1),
        unit: bound === undefined ? unitOf(unit, {}) : unit,
        fallbackUnit: unitOf(fallback as UnitOfTime | undefined, {}),
        min: month(declared.min), max: month(declared.max),
      };
    }
    if (declared.kind !== 'linear') {
      const kind = declared.kind === 'time' ? `time axis of \`${String(declared.valueType ?? 'datetime')}\` values` : `\`${String(declared.kind)}\` axis`;
      report(`The axis \`${name}\` is a ${kind}, which this add-on does not draw; it is read as a linear axis.`);
    }
    return {
      ...common, kind: 'linear', origin: number(declared.origin, 0), size: number(declared.scale, 1),
      min: typeof declared.min === 'number' ? declared.min : undefined, max: typeof declared.max === 'number' ? declared.max : undefined,
    };
  };

  const axes: Record<string, Axis> = {};
  for (const [name, declared] of Object.entries(isObject(section.axes) ? section.axes : {})) axes[name] = axis(name, declared);
  const profiles = isObject(section.snapProfiles) ? section.snapProfiles : {};

  const systems: Record<string, CoordinateSystem> = {};
  for (const [name, declared] of Object.entries(isObject(section.systems) ? section.systems : {})) {
    if (!isObject(declared)) continue;
    if (declared.kind !== 'cartesian') report(`The coordinate system \`${name}\` is \`${String(declared.kind)}\`, which this add-on does not draw; it is read as cartesian.`);
    const along = (key: 'x' | 'y'): Axis => {
      const value = declared[key];
      if (typeof value !== 'string') return value === undefined ? linear('px') : axis(`${name}.${key}`, value);
      if (!Object.hasOwn(axes, value)) report(`The coordinate system \`${name}\` names the axis \`${value}\`, which is not declared; a linear axis is used.`);
      return axes[value] ?? linear(value);
    };
    const snapping = typeof declared.snapping === 'string' ? profiles[declared.snapping] : declared.snapping;
    if (typeof declared.snapping === 'string' && !isObject(snapping)) report(`The coordinate system \`${name}\` names the snap profile \`${declared.snapping}\`, which is not declared.`);
    systems[name] = {
      name, x: along('x'), y: along('y'),
      orientation: declared.orientation === 'y-up' ? 'y-up' : 'y-down',
      infinite: declared.infinite !== false && declared.bounds === undefined,
      grid: isObject(declared.grid) ? declared.grid : {},
      snapping: isObject(snapping) ? (snapping as Snapping) : undefined,
      label: declared.label as LocalizedText | undefined,
    };
  }
  if (Object.keys(systems).length === 0) return { value: { ...defaultCoordinates, axes: { ...defaultCoordinates.axes, ...axes } }, findings };

  let chosen = typeof section.default === 'string' ? section.default : Object.keys(systems)[0];
  if (!Object.hasOwn(systems, chosen)) {
    report(`The default coordinate system \`${chosen}\` is not declared; \`${Object.keys(systems)[0]}\` is used.`);
    chosen = Object.keys(systems)[0];
  }
  return { value: { axes, systems, default: chosen }, findings };
}

// ---- mapping ----

/** An axis as one diagram draws it: a bound unit is read from the diagram's attributes. */
export function scaleOf(axis: Axis, diagram: Attributes = {}): Scale {
  const unit = axis.kind === 'time' ? unitOf(axis.unit, diagram, axis.fallbackUnit) : undefined;
  const months = monthsIn(unit);
  const perUnit = (axis.reversed ? -1 : 1) * (axis.size / (months ?? 1));
  return {
    unit, months, perUnit,
    toCanvas: (value) => (value - axis.origin) * perUnit,
    toValue: (at) => (perUnit === 0 ? axis.origin : at / perUnit + axis.origin),
  };
}

/** The two axes of a system for one diagram. With y upwards, the y axis runs against the canvas. */
export function scalesOf(system: CoordinateSystem, diagram: Attributes = {}): { readonly x: Scale; readonly y: Scale } {
  const y = scaleOf(system.y, diagram);
  if (system.orientation === 'y-down') return { x: scaleOf(system.x, diagram), y };
  return { x: scaleOf(system.x, diagram), y: { ...y, perUnit: -y.perUnit, toCanvas: (value) => -y.toCanvas(value), toValue: (at) => y.toValue(-at) } };
}

// ---- rulers ----

const most = 2000;

/**
 * The rows of an axis's ruler between two canvas positions at a zoom, the finest first (DISL 5.13).
 * A row is shown while its labels are far enough apart on screen and its step is no shorter than
 * the ruler's `minUnit`. A tick stands on a round boundary of its unit, counted from year 0.
 */
export function rulerRows(axis: Axis, diagram: Attributes, view: { readonly from: number; readonly to: number; readonly zoom: number }, locale = 'en'): RulerRow[] {
  const ruler = axis.ruler;
  if (axis.kind !== 'time' || !ruler || ruler.visible === false) return [];
  const scale = scaleOf(axis, diagram);
  const least = ruler.minUnit === undefined ? 0 : monthsIn(unitOf(ruler.minUnit, diagram, axis.fallbackUnit)) ?? 0;
  const perMonth = Math.abs(scale.perUnit);
  const rows: RulerRow[] = [];
  for (const level of ruler.levels ?? []) {
    const step = Math.max(1, level.step ?? 1);
    const months = (monthsIn(level.unit) ?? 0) * step;
    const spacing = months * perMonth;
    if (months === 0 || months < least || spacing * view.zoom < (level.minSpacingPx ?? 0)) continue;
    if (view.zoom < (level.minZoom ?? 0) || view.zoom > (level.maxZoom ?? Infinity)) continue;
    const [low, high] = [scale.toValue(view.from), scale.toValue(view.to)].sort((a, b) => a - b);
    const ticks: RulerTick[] = [];
    for (let value = Math.ceil(low / months) * months || 0; value <= high && ticks.length < most; value += months) {
      ticks.push({ value, at: scale.toCanvas(value), label: formatPattern(value, level.format ?? 'uuuu-MM', locale) });
    }
    rows.push({ unit: level.unit, step, format: level.format ?? 'uuuu-MM', spacing, ticks });
  }
  return rows;
}
