// Where a dragged value lands (DISL 5.9, 5.10): the rule of a gesture along an axis, declared with
// the coordinate system and overridden for a node type and for one gesture, applied in the values
// of the axis and given back in canvas units. It says where a gesture would land before it ends.
//
// The behavior snaps again when the gesture ends in its intent (../disl/behavior.ts, `ruleFor` and
// `snapped`, which that module keeps to itself). `snapRule` and `snapValue` follow those two step
// for step, and test/canvas/snapping.test.ts compares a snapped point with where the behavior
// lands the same move, drop and handle: a change to either that the other does not follow fails there.

import type { Box, Point } from './geometry';
import type { SceneTool } from './scene';
import { monthsIn, scalesOf, unitOf, type Axis, type CoordinateSystem, type SnapRule, type Snapping } from '../disl/coordinates';
import type { Scope } from '../disl/expressions';
import type { Attributes, Model } from '../disl/model';
import { nodeNotation, type NodeNotation } from '../disl/notation';
import { isObject } from '../disl/specification';

/** The gestures a rule may be declared for (DISL 5.9, `byGesture`). */
export type SnapGesture = 'move' | 'resize' | 'drop' | 'paste' | 'handle';

/** The rule of a gesture along an axis: the most specific declaration wins, and one for the gesture is more specific than its level. */
export const snapRule = (system: CoordinateSystem | undefined, own: Snapping | undefined, gesture: string, axis: 'x' | 'y'): SnapRule | undefined =>
  own?.byGesture?.[gesture]?.[axis] ?? own?.[axis] ?? system?.snapping?.byGesture?.[gesture]?.[axis] ?? system?.snapping?.[axis];

/**
 * A value of an axis on the nearest one its rule allows. A tie goes by `ties`: away from the
 * origin of the axis unless the rule says otherwise. `cel` evaluates a rule that is an expression,
 * and gives nothing when it fails; the value is then left as it is.
 */
export function snapValue(rule: SnapRule | undefined, value: number, axis: Axis | undefined, diagram: Attributes, cel: (source: string, value: number) => number | undefined = () => undefined): number {
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

/** Where gestures on one model land, in one viewpoint. */
export interface Snapper {
  /**
   * A canvas point on the place the rules of a gesture allow for an element of a type. The point
   * is that of the element's placement anchor. `element` is the one that is dragged: a rule that
   * is an expression sees it as `self`.
   */
  point(type: string, gesture: SnapGesture, at: Point, element?: string): Point;
  /** The share along its axis, from 0 to 1, a handle of an element's shape lands on. */
  share(type: string, element: string, param: string, value: number): number;
  /**
   * The distance in canvas units from an element's anchor to the next place a move allows, along
   * each axis `direction` is not 0 on and towards its sign. An axis without a rule has a short
   * distance of its own.
   */
  step(type: string, element: string, anchor: Point, direction: Point): Point;
  /** The placement anchor of an element of a type, in its box. */
  anchor(type: string, box: Box): Point;
}

const fractions: Readonly<Record<string, number>> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
// What Alt and an arrow key move an element by along an axis that snaps to nothing, in canvas units.
const free = 8;

/** The snapping of a model as a specification's coordinates and notation declare it, in a viewpoint: the default one when none is named. */
export function createSnapping(tool: SceneTool, model: Model, view: { readonly viewpoint?: string; readonly env?: Scope } = {}): Snapper {
  const { metamodel, expressions, coordinates } = tool;
  const all = tool.viewpoints.all;
  const own = all[view.viewpoint ?? ''] ?? all[tool.viewpoints.default];
  let world: ReturnType<typeof expressions.over> | undefined;

  // What is dropped is placed as the viewpoint a variant varies places it.
  const placed = (type: string, gesture: string): { readonly node: NodeNotation; readonly system: CoordinateSystem | undefined } => {
    const viewpoint = gesture === 'drop' && own.variantOf !== undefined ? all[own.variantOf] ?? own : own;
    const node = nodeNotation(viewpoint.notation, metamodel, type);
    return { node, system: coordinates.systems[node.placement.system ?? ''] ?? coordinates.systems[viewpoint.coordinateSystem] ?? coordinates.systems[coordinates.default] };
  };
  const evaluated = (element: string | undefined) => (source: string, value: number): number | undefined => {
    world ??= expressions.over(model, { env: { viewpoint: own.name, ...view.env } });
    const result = expressions.evaluate(source, world.scope(element, { value }));
    return result.ok && typeof result.value === 'number' ? result.value : undefined;
  };

  const point: Snapper['point'] = (type, gesture, at, element) => {
    const { node, system } = placed(type, gesture);
    if (!system) return at;
    const scales = scalesOf(system, model.diagram);
    const along = (axis: 'x' | 'y'): number =>
      scales[axis].toCanvas(snapValue(snapRule(system, node.snapping, gesture, axis), scales[axis].toValue(at[axis]), system[axis], model.diagram, evaluated(element)));
    return { x: along('x'), y: along('y') };
  };

  const share: Snapper['share'] = (type, element, param, value) => {
    const { node } = placed(type, 'handle');
    const reference = node.shape;
    const shape = typeof reference === 'string' ? reference : 'type' in reference ? reference.type : '';
    const shapes = own.notation.shapes;
    const handle = (Object.hasOwn(shapes, shape) ? shapes[shape].handles : []).find((candidate) => candidate.param === param);
    return snapValue(handle?.snap as SnapRule | undefined, value, undefined, model.diagram, evaluated(element));
  };

  const step: Snapper['step'] = (type, element, anchor, direction) => {
    const { node, system } = placed(type, 'move');
    const along = (axis: 'x' | 'y'): number => {
      const towards = Math.sign(direction[axis]);
      const rule = system && snapRule(system, node.snapping, 'move', axis);
      if (towards === 0) return 0;
      if (!system || !isObject(rule)) return towards * free;
      const scale = scalesOf(system, model.diagram)[axis];
      const snap = (value: number): number => snapValue(rule, value, system[axis], model.diagram, evaluated(element));
      const from = scale.toValue(anchor[axis]);
      const sign = towards * Math.sign(scale.perUnit || 1);
      const here = snap(from);
      // An anchor that is on no allowed place goes to the one beside it first.
      if ((here - from) * sign > 1e-9) return (here - from) * scale.perUnit;
      // The rule may be an expression, so the next place is found by asking: ever further, until the answer changes.
      let next = here;
      for (let reach = 1 / Math.abs(scale.perUnit || 1), tries = 0; next === here && tries < 64; reach *= 2, tries++) next = snap(from + sign * reach);
      return (next - from) * scale.perUnit;
    };
    return { x: along('x'), y: along('y') };
  };

  const anchor: Snapper['anchor'] = (type, box) => {
    const named = placed(type, 'move').node.placement.anchor ?? 'top-left';
    const [fx, fy] = typeof named === 'string'
      ? [fractions[named.split('-').find((word) => word === 'left' || word === 'right') ?? 'center'], fractions[named.split('-').find((word) => word === 'top' || word === 'bottom') ?? 'center']]
      : named;
    return { x: box.x + fx * box.width, y: box.y + fy * box.height };
  };

  return { point, share, step, anchor };
}
