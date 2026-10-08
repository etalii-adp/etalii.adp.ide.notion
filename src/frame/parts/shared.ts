// What the parts of one page share beside the page itself (etalii.adp spec 012,
// contracts/shared-parts.md): the specification as it is interpreted, once per page and by whoever
// asks first, and what a part makes for the others: the canvas of the reading part, the editor of
// the editing part. A part reads what is shared when it attaches and hears the rest, so that no
// part depends on which was attached first. This module attaches nothing itself.

import type { Canvas } from '../../canvas/canvas';
import type { Gestures } from '../../canvas/gestures';
import { arrangedRows, createScene, type SceneTool } from '../../canvas/scene';
import { interpretBehavior, type Behavior, type Outcome, type Situation } from '../../disl/behavior';
import { interpretConstraints, type Constraints } from '../../disl/constraints';
import { interpretCoordinates } from '../../disl/coordinates';
import { interpretForms, type Forms } from '../../disl/forms';
import { interpretLayout } from '../../disl/layout';
import type { Finding, Model } from '../../disl/model';
import { interpretNotation } from '../../disl/notation';
import { interpretToolbox, type Toolbox } from '../../disl/toolbox';
import { interpretViewpoints } from '../../disl/viewpoints';
import type { EditResult } from '../../store/document';
import type { Page } from '../page';

export interface Interpreted {
  /** What a canvas and its gestures are made with. */
  readonly tool: SceneTool;
  readonly constraints: Constraints;
  readonly toolbox: Toolbox;
  readonly forms: Forms;
  readonly behavior: Behavior;
  /** What interpreting found, beside what the page already holds. */
  readonly findings: readonly Finding[];
}

/** How the editing part changes the open document, for a part that offers another way to ask for a change. */
export interface Editor {
  readonly gestures: Gestures;
  /** One intent, worked out on the model as it is now, made as one edit: one step of undo. */
  run(intent: (model: Model, situation: Situation) => Outcome): EditResult;
  /** An operation on a selection. One that asks first answers done at once, and runs on yes. */
  operate(operation: string, selection: readonly string[]): EditResult;
}

export interface Shared {
  /** The reading part's, while it is attached. */
  readonly canvas?: Canvas;
  /** The editing part's, while the page can be edited. */
  readonly editor?: Editor;
  /** The tool a gesture or a key armed or disarmed last; `editor.gestures.armed` says which is armed now. */
  readonly armed?: string;
}

const interpreted = new WeakMap<Page, Interpreted>();
const held = new WeakMap<Page, { shared: Shared; readonly listeners: Set<() => void> }>();

export function interpretedOf(page: Page): Interpreted {
  const known = interpreted.get(page);
  if (known) return known;
  const { specification, metamodel, expressions, persistence } = page;
  const coordinates = interpretCoordinates(specification, metamodel);
  const notation = interpretNotation(specification, metamodel);
  const layout = interpretLayout(specification);
  const viewpoints = interpretViewpoints(specification, metamodel, { notation: notation.value, coordinates: coordinates.value, layout: layout.value });
  const constraints = interpretConstraints(specification, metamodel, expressions);
  const toolbox = interpretToolbox(specification, metamodel);
  const forms = interpretForms(specification, metamodel, expressions);
  const tool: SceneTool = { metamodel, expressions, coordinates: coordinates.value, viewpoints: viewpoints.value };
  const behavior = interpretBehavior(specification, metamodel, expressions, {
    constraints: constraints.value, layout: layout.value, coordinates: coordinates.value, persistence, toolbox: toolbox.value, notation: notation.value, viewpoints: viewpoints.value,
    rows: (config, model) => arrangedRows(tool, model, createScene(tool, model), config),
  });
  const made: Interpreted = {
    tool, constraints: constraints.value, toolbox: toolbox.value, forms: forms.value, behavior: behavior.value,
    findings: [coordinates, notation, layout, viewpoints, constraints, toolbox, forms, behavior].flatMap((each) => each.findings),
  };
  interpreted.set(page, made);
  return made;
}

function of(page: Page) {
  let mine = held.get(page);
  if (!mine) held.set(page, mine = { shared: {}, listeners: new Set() });
  return mine;
}

export const shared = (page: Page): Shared => of(page).shared;

/** Shares something, or takes it back with `undefined`, and tells every part that listens. */
export function share(page: Page, change: Partial<Shared>): void {
  const mine = of(page);
  mine.shared = { ...mine.shared, ...change };
  for (const listener of [...mine.listeners]) listener();
}

/** Hears every change of what is shared; answers what stops it. */
export function onShared(page: Page, listener: () => void): () => void {
  const { listeners } = of(page);
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
