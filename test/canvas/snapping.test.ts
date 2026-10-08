import { describe, expect, it } from 'vitest';
import { arrangedRows, createScene, type SceneNode } from '../../src/canvas/scene';
import { createSnapping, snapRule, snapValue } from '../../src/canvas/snapping';
import { interpretBehavior } from '../../src/disl/behavior';
import { interpretConstraints } from '../../src/disl/constraints';
import type { Axis, CoordinateSystem, Snapping } from '../../src/disl/coordinates';
import type { Model } from '../../src/disl/model';
import { interpretToolbox } from '../../src/disl/toolbox';
import { canvasTool } from './tool';

const made = canvasTool();
const toolbox = interpretToolbox(made.specification, made.metamodel).value;
const behavior = interpretBehavior(made.specification, made.metamodel, made.expressions, {
  constraints: interpretConstraints(made.specification, made.metamodel, made.expressions).value,
  persistence: made.persistence, toolbox, layout: made.layout, coordinates: made.coordinates, notation: made.notation, viewpoints: made.viewpoints,
  rows: (config, model) => arrangedRows(made.sceneTool, model, createScene(made.sceneTool, model), config),
}).value;
const model = made.fixture('triggers-and-notes').value;
const scene = createScene(made.sceneTool, model);
const snapping = createSnapping(made.sceneTool, model);
const nodeIn = (from: Model, id: string): SceneNode => createScene(made.sceneTool, from).nodes.find((node) => node.id === id)!;

describe('the rule of a gesture along an axis', () => {
  const rule = (spacing: number) => ({ grid: { spacing } });
  const system = { snapping: { x: rule(1), y: rule(2), byGesture: { drop: { x: rule(3) } } } } as unknown as CoordinateSystem;
  const own: Snapping = { y: rule(4), byGesture: { drop: { y: rule(5) }, move: { x: rule(6) } } };

  it('is the most specific one declared: the node type before the coordinate system, and the gesture before its level', () => {
    expect(snapRule(system, undefined, 'move', 'x')).toEqual(rule(1));
    expect(snapRule(system, undefined, 'drop', 'x')).toEqual(rule(3));
    expect(snapRule(system, undefined, 'drop', 'y')).toEqual(rule(2));
    expect(snapRule(system, own, 'resize', 'y')).toEqual(rule(4));
    expect(snapRule(system, own, 'drop', 'y')).toEqual(rule(5));
    expect(snapRule(system, own, 'move', 'x')).toEqual(rule(6));
    // A node type that says nothing for an axis keeps the system's rule for the gesture.
    expect(snapRule(system, own, 'drop', 'x')).toEqual(rule(3));
    expect(snapRule(undefined, undefined, 'move', 'x')).toBeUndefined();
  });
});

describe('a value snapped by a rule', () => {
  const axis = { origin: 0 } as Axis;

  it('lands on the grid, counted from its offset', () => {
    expect(snapValue({ grid: { spacing: 5 } }, 12, axis, {})).toBe(10);
    expect(snapValue({ grid: { spacing: 5 } }, 13, axis, {})).toBe(15);
    expect(snapValue({ grid: { spacing: 5, offset: 2 } }, 13, axis, {})).toBe(12);
    expect(snapValue({ grid: { spacing: 5 }, direction: 'floor' }, 14.9, axis, {})).toBe(10);
    expect(snapValue({ grid: { spacing: 5 }, direction: 'ceil' }, 10.1, axis, {})).toBe(15);
    expect(snapValue({ grid: { spacing: 5 }, direction: 'ceil' }, 10, axis, {})).toBe(10);
  });

  it('breaks a tie as the rule says, away from the origin of the axis when it says nothing', () => {
    const tie = (ties: string | undefined, value: number, origin = 0) => snapValue({ grid: { spacing: 2 }, ...(ties === undefined ? {} : { ties }) }, value, { origin } as Axis, {});
    expect([tie(undefined, 1), tie(undefined, -1), tie(undefined, 1, 10)]).toEqual([2, -2, 0]);
    expect([tie('toward-zero', 1), tie('toward-zero', -1)]).toEqual([0, 0]);
    expect([tie('up', -1), tie('down', 1)]).toEqual([0, 0]);
    expect([tie('even', 1), tie('even', 3), tie('even', 5)]).toEqual([0, 4, 4]);
  });

  it('lands on the nearest of a list of values, within its least and its most', () => {
    expect(snapValue({ values: [0, 12.5, 25, 50] }, 20, axis, {})).toBe(25);
    expect(snapValue({ grid: { spacing: 1 }, min: 3, max: 6 }, 1.2, axis, {})).toBe(3);
    expect(snapValue({ grid: { spacing: 1 }, min: 3, max: 6 }, 9, axis, {})).toBe(6);
  });

  it('lands on a step of a calendar unit, which a diagram attribute may hold', () => {
    const calendar = { calendar: { unit: { attribute: 'step' } } };
    expect(snapValue(calendar, 17, axis, { step: 'year' })).toBe(12);
    expect(snapValue(calendar, 18, axis, { step: 'year' })).toBe(24);
    expect(snapValue(calendar, 17, axis, { step: 'quarter' })).toBe(18);
    expect(snapValue(calendar, 17.4, { origin: 0, fallbackUnit: 'year' } as Axis, {})).toBe(12);
    expect(snapValue({ calendar: { unit: 'month', step: 2 } }, 17.4, axis, {})).toBe(18);
  });

  it('is what an expression gives, and the value itself when that fails or there is no rule', () => {
    expect(snapValue({ cel: 'x' }, 4, axis, {}, (source, value) => (source === 'x' ? value * 2 : undefined))).toBe(8);
    expect(snapValue({ cel: 'x' }, 4, axis, {}, () => undefined)).toBe(4);
    expect(snapValue(undefined, 4.3, axis, {})).toBe(4.3);
    expect(snapValue('none' as never, 4.3, axis, {})).toBe(4.3);
  });

  it('gives a snapped value back as it is', () => {
    for (const rule of [{ grid: { spacing: 0.7, offset: 0.2 } }, { calendar: { unit: 'year' as const } }, { values: [1, 4, 9] }]) {
      for (let value = -30; value <= 30; value += 1.37) {
        const once = snapValue(rule, value, axis, {});
        expect(snapValue(rule, once, axis, {})).toBeCloseTo(once, 9);
      }
    }
  });
});

// The behavior snaps again when a gesture ends in its intent. These compare the two over the
// tool type the add-on ships, so that what a preview shows is where the element lands.
describe('a point snapped for a gesture, beside what the behavior does with the same gesture', () => {
  const movable = scene.nodes.filter((node) => node.movable.x || node.movable.y);
  const offsets = [-200, -57, -28.5, -28, -14, -2.01, -2, -1.99, 0.4, 2, 6, 24, 27.99, 28, 28.01, 83.9, 84, 140, 301];

  it('lands a moved element where the behavior moves it to', () => {
    expect(new Set(movable.map((node) => node.type)).size).toBeGreaterThan(1);
    let compared = 0;
    for (const node of movable) {
      const anchor = snapping.anchor(node.type, node.box);
      for (const [index, dx] of offsets.entries()) {
        const by = { x: node.movable.x ? dx : 0, y: node.movable.y ? offsets[(index * 7 + 3) % offsets.length] : 0 };
        const outcome = behavior.move(model, [node.id], by);
        if (outcome.refused !== undefined) continue;
        const landed = snapping.anchor(node.type, nodeIn(outcome.after, node.id).box);
        const shown = snapping.point(node.type, 'move', { x: anchor.x + by.x, y: anchor.y + by.y }, node.id);
        expect(shown.x).toBeCloseTo(landed.x, 6);
        expect(shown.y).toBeCloseTo(landed.y, 6);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(offsets.length);
  });

  it('lands a dropped element where the behavior creates it', () => {
    const tools = Object.values(toolbox.tools).filter((tool) => tool.creates !== undefined && !tool.relation);
    expect(tools.length).toBeGreaterThan(1);
    for (const tool of tools) {
      for (const [index, dx] of offsets.entries()) {
        const at = { x: 400 + dx, y: 120 + offsets[(index * 5 + 1) % offsets.length] };
        const outcome = behavior.create(model, tool.id, at);
        if (outcome.refused !== undefined) throw new Error(outcome.refused);
        const landed = snapping.anchor(tool.creates!, nodeIn(outcome.after, outcome.created[0]).box);
        const shown = snapping.point(tool.creates!, 'drop', at);
        expect(shown.x).toBeCloseTo(landed.x, 6);
        expect(shown.y).toBeCloseTo(landed.y, 6);
      }
    }
  });

  it('lands a dragged handle where the behavior puts it', () => {
    const node = scene.nodes.find((candidate) => candidate.handles.some((handle) => handle.visible))!;
    const handle = node.handles.find((candidate) => candidate.visible)!;
    let compared = 0;
    for (const value of [0.02, 0.11, 0.26, 0.3, 0.47, 0.5, 0.74, 0.99]) {
      const outcome = behavior.dragHandle(model, node.id, handle.param, value, { env: { viewpoint: scene.viewpoint } });
      if (outcome.refused !== undefined) continue;
      const moved = nodeIn(outcome.after, node.id);
      const landed = (moved.handles.find((candidate) => candidate.param === handle.param)!.x - moved.box.x) / moved.box.width;
      expect(snapping.share(node.type, node.id, handle.param, value)).toBeCloseTo(landed, 6);
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
  });

  it('snaps a drop in a variant of a viewpoint as the viewpoint it varies does', () => {
    const variant = Object.values(made.viewpoints.all).find((viewpoint) => viewpoint.variantOf !== undefined)!;
    const tool = Object.values(toolbox.tools).find((candidate) => candidate.creates !== undefined)!;
    const at = { x: 411, y: 77 };
    expect(createSnapping(made.sceneTool, model, { viewpoint: variant.name }).point(tool.creates!, 'drop', at)).toEqual(snapping.point(tool.creates!, 'drop', at));
  });
});

describe('one step of an element along an axis', () => {
  it('is the distance to the next place the element may be moved to, each way', () => {
    for (const node of scene.nodes.filter((candidate) => candidate.movable.x && candidate.movable.y)) {
      const anchor = snapping.anchor(node.type, node.box);
      for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const by = snapping.step(node.type, node.id, anchor, direction);
        expect(Math.sign(by.x)).toBe(direction.x);
        expect(Math.sign(by.y)).toBe(direction.y);
        const outcome = behavior.move(model, [node.id], by);
        if (outcome.refused !== undefined) continue;
        const landed = snapping.anchor(node.type, nodeIn(outcome.after, node.id).box);
        expect(landed.x - anchor.x).toBeCloseTo(by.x, 6);
        expect(landed.y - anchor.y).toBeCloseTo(by.y, 6);
        // Nothing nearer, for an element that is on an allowed place: a move of half the step changes nothing, or lands on the same place.
        const on = snapping.point(node.type, 'move', anchor, node.id);
        if (Math.abs(on.x - anchor.x) + Math.abs(on.y - anchor.y) > 1e-6) continue;
        const half = behavior.move(model, [node.id], { x: by.x * 0.45, y: by.y * 0.45 });
        const nearer = half.refused !== undefined || half.changes.length === 0 ? anchor : snapping.anchor(node.type, nodeIn(half.after, node.id).box);
        expect([0, by.x + by.y]).toContainEqual(expect.closeTo(nearer.x - anchor.x + nearer.y - anchor.y, 6));
      }
    }
  });

  it('is a short distance of its own along an axis that has no rule', () => {
    const free = createSnapping({ ...made.sceneTool, coordinates: { ...made.coordinates, systems: Object.fromEntries(Object.entries(made.coordinates.systems).map(([name, system]) => [name, { ...system, snapping: undefined }])) } }, model);
    const node = scene.nodes.find((candidate) => candidate.movable.x)!;
    const by = free.step(node.type, node.id, free.anchor(node.type, node.box), { x: -1, y: 0 });
    expect(by.x).toBeLessThan(0);
    expect(by.y).toBe(0);
  });

  it('places the anchor of an element in its box as its placement says', () => {
    const box = { x: 10, y: 20, width: 100, height: 40 };
    const points = new Set(scene.nodes.map((node) => JSON.stringify(snapping.anchor(node.type, box))));
    expect(points).toContain(JSON.stringify({ x: 10, y: 20 }));
    expect(points).toContain(JSON.stringify({ x: 60, y: 40 }));
  });
});
