// The panels: the part of the page that shows the toolbox and the property grid (etalii.adp spec
// 012, FR-011, FR-016, FR-017, FR-021; contracts/addon-address.md, "States"). The grid shows the
// selection while a document can be read, and has controls only while it can be edited; the
// toolbox is there only then. Neither changes anything itself: what is entered or picked is asked
// of the editing part, which makes it one edit.

import type { Change, Effect, Outcome, Situation } from '../../disl/behavior';
import { formFor, rowsOf, type FormItem } from '../../disl/forms';
import type { Model, Value } from '../../disl/model';
import type { Panel } from '../../panels/panel';
import { createPropertyGrid, type PropertyGrid } from '../../panels/propertyGrid';
import { createToolbox } from '../../panels/toolbox';
import type { EditResult, OpenDocument } from '../../store/document';
import { onPage, type Page } from '../page';
import { interpretedOf, onShared, shared, type Editor } from './shared';

const COLLAPSED = 'collapsed';
const NOT_NOW = 'The diagram cannot be changed at the moment.';
const NO_ROW = 'This value cannot be changed here.';

function attach(page: Page): () => void {
  const { regions, specification, metamodel, expressions } = page;
  const document = regions.propertyGrid.ownerDocument;
  const window = document.defaultView;
  const { body } = document;

  let grid: { readonly panel: PropertyGrid; readonly of: OpenDocument; readonly readOnly: boolean } | undefined;
  let toolbox: { readonly panel: Panel; readonly editor: Editor } | undefined;
  let followed: OpenDocument | undefined;
  let stopEvents = (): void => undefined;
  // A press on a tool arms it, so that it can be dragged to the canvas; the click that follows is the same pick.
  let pressed: string | undefined;

  // ---- an embed narrower than both panels ----

  // A panel that is never shown, open: its width is what the stylesheet gives an open panel.
  const probe = document.createElement('div');
  probe.className = 'adp-panel adp-panels-probe';
  probe.dataset.collapsed = 'false';
  probe.setAttribute('aria-hidden', 'true');
  body.append(probe);
  let narrow = false;

  const keyOf = (id: string): string => `adp-notion.${document.documentElement.dataset.addon ?? ''}.panel.${id}`;
  // What the user chose last: null where nothing is kept, nothing where the browser refuses the storage.
  const chosen = (id: string): string | null | undefined => {
    try {
      return window?.localStorage.getItem(keyOf(id));
    } catch {
      return undefined;
    }
  };

  /** Collapses or opens a panel without that being the user's choice: what is kept of the choice stays as it was. */
  function set(id: string, panel: Panel, collapsed: boolean): void {
    if (panel.collapsed === collapsed) return;
    const kept = chosen(id);
    panel.collapsed = collapsed;
    try {
      if (kept === null) window?.localStorage.removeItem(keyOf(id));
      else if (kept !== undefined) window?.localStorage.setItem(keyOf(id), kept);
    } catch {
      // Nothing is kept, so nothing was overwritten.
    }
  }

  const panels = (): (readonly [string, Panel])[] => [...(toolbox ? [['toolbox', toolbox.panel] as const] : []), ...(grid ? [['property-grid', grid.panel] as const] : [])];

  // Only a change from wide to narrow or back acts: a panel the user opens in a narrow embed stays open.
  function fit(): void {
    const one = probe.offsetWidth;
    const next = one > 0 && body.clientWidth > 0 && body.clientWidth < 2 * one;
    if (next === narrow) return;
    narrow = next;
    for (const [id, panel] of panels()) set(id, panel, narrow || chosen(id) === COLLAPSED);
  }

  // ---- the property grid ----

  const itemOf = (model: Model, element: string | undefined, form: string, attribute: string): FormItem | undefined => {
    const type = element === undefined ? undefined : [...model.elements, ...model.relations].find((each) => each.id === element)?.type;
    const found = formFor(interpretedOf(page).forms, type);
    return found.id === form ? rowsOf(found.items).find((item) => (item.attribute ?? item.rowId({ model, element })) === attribute) : undefined;
  };

  /** A value entered for some elements, as one outcome: each is worked out on what the one before left. */
  function entered(elements: readonly string[], form: string, attribute: string, value: unknown): EditResult {
    const editor = shared(page).editor;
    if (!editor) return { done: false, sentence: NOT_NOW };
    const { behavior } = interpretedOf(page);
    return editor.run((model: Model, situation: Situation): Outcome => {
      let after = model;
      const changes: Change[] = [];
      const effects: Effect[] = [];
      for (const id of elements) {
        const element = id === '' ? undefined : id;
        const item = itemOf(after, element, form, attribute);
        const outcome: Outcome = item ? behavior.edit(after, element, item, value as Value, situation) : { refused: NO_ROW };
        if (outcome.refused !== undefined) return outcome;
        changes.push(...outcome.changes);
        effects.push(...outcome.effects);
        after = outcome.after;
      }
      return { changes, after, created: [], effects };
    });
  }

  function show(): void {
    if (grid) grid.panel.show(page.selection, grid.of.model);
  }

  // ---- the toolbox ----

  function mark(): void {
    const armed = toolbox?.editor.gestures.armed;
    for (const item of regions.toolbox.querySelectorAll<HTMLElement>('[data-tool]')) item.setAttribute('aria-pressed', String(item.dataset.tool === armed));
  }

  /** A tool that is armed and used on the canvas; one that runs an operation is no such tool. */
  const arms = (id: string): boolean => {
    const { tools } = interpretedOf(page).toolbox;
    return Object.hasOwn(tools, id) && tools[id].operation === undefined;
  };

  function onPick(id: string): void {
    const gestures = toolbox?.editor.gestures;
    const again = pressed === id;
    pressed = undefined;
    if (!gestures) return;
    if (!arms(id)) gestures.drop(id);
    else if (!again) gestures.arm(gestures.armed === id ? undefined : id);
    mark();
  }

  const toolOf = (event: Event): string | undefined => (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tool]')?.dataset.tool : undefined);

  function onToolPress(event: PointerEvent): void {
    const id = toolOf(event);
    const gestures = toolbox?.editor.gestures;
    pressed = undefined;
    if (id === undefined || !gestures || event.button !== 0 || gestures.armed === id || !arms(id)) return;
    gestures.arm(id);
    pressed = id;
    mark();
  }

  // Enter on a tool uses it without a pointer: its element goes to the centre of what the canvas shows.
  function onToolKey(event: KeyboardEvent): void {
    const id = toolOf(event);
    if (event.key !== 'Enter' || id === undefined || !toolbox) return;
    // The click a browser makes of Enter on a button would arm the tool as well.
    event.preventDefault();
    toolbox.editor.gestures.drop(id);
    mark();
  }

  // ---- which panels there are ----

  function build(): void {
    const open = page.state === 'ready' || page.state === 'read-only' ? page.document : undefined;
    const editor = page.state === 'ready' && open ? shared(page).editor : undefined;
    const readOnly = !editor;

    if (grid && (grid.of !== open || grid.readOnly !== readOnly)) {
      grid.panel.dispose();
      grid = undefined;
    }
    if (open && !grid) {
      const panel = createPropertyGrid(regions.propertyGrid, {
        specification, readOnly, forms: interpretedOf(page).forms, metamodel, expressions,
        onChange: (element, form, attribute, value) => entered([element], form, attribute, value),
        onChangeAll: entered,
        onOperate: (operation, selection) => shared(page).editor?.operate(operation, selection) ?? { done: false, sentence: NOT_NOW },
      });
      grid = { panel, of: open, readOnly };
      if (narrow) set('property-grid', panel, true);
    }
    if (toolbox && toolbox.editor !== editor) {
      toolbox.panel.dispose();
      toolbox = undefined;
    }
    if (editor && !toolbox) {
      const panel = createToolbox(regions.toolbox, { specification, readOnly: false, toolbox: interpretedOf(page).toolbox, metamodel, onPick });
      toolbox = { panel, editor };
      if (narrow) set('toolbox', panel, true);
    }
    // A region without its panel takes no room and shows no edge.
    regions.propertyGrid.hidden = !grid;
    regions.toolbox.hidden = !toolbox;

    if (followed !== open) {
      stopEvents();
      followed = open;
      stopEvents = open?.subscribe((event) => { if (event.kind !== 'status') show(); }) ?? (() => undefined);
    }
    show();
    mark();
  }

  const resized = window && 'ResizeObserver' in window ? new window.ResizeObserver(() => fit()) : undefined;
  resized?.observe(body);
  if (!resized) window?.addEventListener('resize', fit);
  regions.toolbox.addEventListener('pointerdown', onToolPress);
  regions.toolbox.addEventListener('keydown', onToolKey);
  const stops = [page.on('state', build), page.on('document', build), page.on('selection', show), onShared(page, build)];
  fit();
  build();

  return () => {
    stops.forEach((each) => each());
    stopEvents();
    resized?.disconnect();
    window?.removeEventListener('resize', fit);
    regions.toolbox.removeEventListener('pointerdown', onToolPress);
    regions.toolbox.removeEventListener('keydown', onToolKey);
    grid?.panel.dispose();
    toolbox?.panel.dispose();
    grid = toolbox = undefined;
    regions.propertyGrid.hidden = regions.toolbox.hidden = false;
    probe.remove();
  };
}

onPage(attach);
