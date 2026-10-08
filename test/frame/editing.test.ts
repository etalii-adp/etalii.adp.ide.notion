import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/frame/parts/reading';
import '../../src/frame/parts/undoRedo';
import '../../src/frame/parts/editing';
import '../../src/frame/parts/panels';
import { start } from '../../src/frame/main';
import type { Page } from '../../src/frame/page';
import { shared } from '../../src/frame/parts/shared';
import { createNotionCalls } from '../../src/store/notion';
import { createRows, rowsOf, valueOf } from '../../src/store/rows';
import { prepare, storeSchema } from '../../src/store/schema';
import { createSession } from '../../src/store/session';
import { tool } from '../disl/tool';
import type { MemoryDatabase, MemoryPage } from '../support/memoryNotion';
import { createMemoryService, createMemoryStorage, type MemoryService } from '../support/memoryService';

// Editing in the page (etalii.adp spec 012, User Story 2; contracts/addon-address.md, "What a
// reader and a user can rely on"): from a gesture, the property grid or the toolbox through the
// real service to an in-memory Notion, and back to the canvas.

const addon = 'gartner-hype-cycle-graph';
const address = 'http://localhost:8787';
const local = `http://localhost:8080/${addon}/`;
const { binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);
const specification = JSON.parse(readFileSync(`addons/${addon}/${addon}.dis`, 'utf8'));
const token = JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' });

// Two trends with an influence between them, and a trend that stands alone.
const graph = `gartner-hypecycle-graph: 1
trends:
  - id: a
    name: Alpha
    start: 2000-01
    stop: 2010-01
    row: 0
    phases: 4
  - id: b
    name: Beta
    start: 2005-01
    stop: 2015-01
    row: 2
    phases: 4
  - id: c
    name: Gamma
    start: 2008-01
    stop: 2018-01
    row: 4
    phases: 4
influences:
  - id: i-ab
    from: a
    from-phase: slope
    from-edge: bottom
    from-at: 0.5
    to: b
    to-phase: peak
    to-edge: top
    to-at: 0.1
`;

const DRIFTED = 'Somebody else changed the database, so your edit was not stored. The database was read again.';
const FORBIDDEN = 'You may not change this database, so your edit was not stored.';

let service: MemoryService;
let pages: (Page | undefined)[];
let store: MemoryDatabase;
let page: Page;
/** What the page asked to be told of the size of, where the browser has a `ResizeObserver`. */
let resized: (() => void)[];
/** The width of the embed and of one open panel, which a browser lays out and jsdom does not. */
let widths: { embed: number; panel: number };

const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;

/** Calls that wait for nothing, for what a test puts into a store before the page opens it. */
function fastCalls() {
  const kept = createMemoryStorage();
  kept.setItem('adp-notion.token', token);
  const session = createSession({ service: address, storage: kept, fetch: service.fetch, open: () => null, listen: () => () => undefined });
  let clock = 0;
  return createNotionCalls({ service: address, session, fetch: service.fetch, now: () => clock, sleep: async (milliseconds) => void (clock += milliseconds) });
}

async function database(body: string = graph): Promise<MemoryDatabase> {
  const made = service.notion.createDatabase();
  const calls = fastCalls();
  await prepare(schema, await calls.dataSource(made.dataSourceId), calls);
  await createRows(rowsOf(new TextEncoder().encode(body), schema, binding).rows, made.dataSourceId, calls);
  return made;
}

/** Starts a page of a store with what `main` gives it; another `main` is another page beside the first. */
async function open(of: MemoryDatabase, begin: typeof start = start): Promise<Page> {
  const made = await begin({
    document,
    location: new URL(`${local}?store=${of.id}`),
    storage: window.localStorage,
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(address)) return service.fetch(input, init);
      return new Response(readFileSync(`addons/${addon}/${url}`));
    },
  });
  pages.push(made);
  const canvas = made!.regions.canvas;
  // A canvas of 800 by 600 pixels at the top left of the window.
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600, toJSON: () => ({}) });
  await vi.waitFor(() => expect(made!.state).toBe('ready'), { timeout: 4000 });
  return made!;
}

async function ready(body?: string): Promise<void> {
  store = await database(body);
  page = await open(store);
}

const within = (of: Page = page) => ({
  drawn: () => [...of.regions.canvas.querySelectorAll('[data-element]')].map((element) => element.getAttribute('data-element')),
  element: (id: string) => of.regions.canvas.querySelector<SVGGElement>(`[data-element="${id}"]`)!,
  field: (attribute: string) => of.regions.propertyGrid.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-attribute="${attribute}"] :is(input, textarea)`)!,
  status: () => of.regions.status.dataset.status,
  message: () => of.regions.message.textContent,
});
const { drawn, element, field, status, message } = { drawn: () => within().drawn(), element: (id: string) => within().element(id), field: (attribute: string) => within().field(attribute), status: () => within().status(), message: () => within().message() };

const byId = (id: string) => document.getElementById(id);
const fire = (type: string, on: Element, more: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...more });
  on.dispatchEvent(event);
  return event;
};
const key = (name: string, on: Element): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  on.dispatchEvent(event);
  return event;
};
function select(ids: readonly string[], of: Page = page): void {
  ids.forEach((id, index) => {
    fire('pointerdown', within(of).element(id), { shiftKey: index > 0 });
    fire('pointerup', within(of).element(id), { shiftKey: index > 0 });
  });
}
/** Enters a value in a row of the property grid, as leaving the field does. */
function enter(attribute: string, value: string, of: Page = page): void {
  const input = within(of).field(attribute);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const idle = (of: Page = page) => vi.waitFor(() => expect(within(of).status()).toBe('idle'), { timeout: 8000 });
/** Whether the browser is asked to warn before the page is left. */
const warns = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const held = (row: MemoryPage, name: string): unknown => valueOf(schema.properties.find((property) => property.name === name)!, row.properties[name] as never);
const rows = (): MemoryPage[] => service.notion.rows(store.dataSourceId).filter((row) => !row.in_trash);
const row = (id: string): MemoryPage | undefined => rows().find((each) => held(each, schema.title) === id);
const kept = (): string[] => Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)!).sort();
const tools = () => [...document.querySelectorAll<HTMLButtonElement>('#toolbox [data-tool]')];
const narrow = (embed: number): void => {
  widths.embed = embed;
  resized.forEach((tell) => tell());
};

beforeEach(() => {
  service = createMemoryService({ address, origin: 'http://localhost:8080' });
  pages = [];
  resized = [];
  widths = { embed: 1200, panel: 264 };
  window.localStorage.clear();
  window.localStorage.setItem('adp-notion.token', token);
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
  delete document.documentElement.dataset.theme;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private readonly tell: () => void) {}
    observe(): void { resized.push(this.tell); }
    unobserve(): void { /* Nothing is laid out. */ }
    disconnect(): void { resized = resized.filter((each) => each !== this.tell); }
  };
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get(this: Element) { return this === document.body ? widths.embed : 0; } });
  // An open panel is as wide as the stylesheet says; whatever else is asked has no width here.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('adp-panel') && this.dataset.collapsed === 'false' ? widths.panel : 0; } });
});

afterEach(() => {
  pages.forEach((each) => each?.close());
  delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  Object.defineProperty(Element.prototype, 'clientWidth', clientWidth);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
  vi.resetModules();
});

describe('an edit', () => {
  it('is on the canvas in the same turn, and the status is storing until the store holds it', async () => {
    await ready();
    expect(warns()).toBe(false);
    select(['a']);
    expect(field('name').value).toBe('Alpha');
    enter('name', 'Renamed');

    expect(element('a').getAttribute('aria-label')).toContain('Renamed');
    expect(field('name').value).toBe('Renamed');
    expect(status()).toBe('storing');
    expect(page.regions.status.textContent).toBe('Storing');
    expect(page.regions.status.getAttribute('aria-busy')).toBe('true');
    expect(warns()).toBe(true);
    expect(held(row('a')!, 'name')).toBe('Alpha');

    await idle();
    expect(held(row('a')!, 'name')).toBe('Renamed');
    expect(page.regions.status.getAttribute('aria-busy')).not.toBe('true');
    expect(warns()).toBe(false);
    expect(message()).toBe('');
  });

  it('that is refused fills the message and changes nothing, until the next edit that succeeds', async () => {
    await ready();
    const before = JSON.stringify(rows());
    const asked = service.requests.length;
    select(['a']);
    // A trend that would end before it starts: the specification refuses it with its own sentence.
    enter('stop', '1990-01');
    expect(message()).not.toBe('');
    // The sentence is the specification's own.
    expect(readFileSync(`addons/${addon}/${addon}.dis`, 'utf8')).toContain(JSON.stringify(message()).slice(1, -1));
    expect(message()).toBe(byId('message')!.textContent);
    expect(byId('message')!.getAttribute('role')).toBe('alert');
    expect(page.document!.model.elements.find((each) => each.id === 'a')!.attributes.name).toBe('Alpha');
    expect(page.document!.canUndo).toBe(false);
    expect(status()).toBe('idle');
    expect(warns()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(service.requests).toHaveLength(asked);
    expect(JSON.stringify(rows())).toBe(before);

    enter('name', 'Renamed');
    expect(message()).toBe('');
    await idle();
  });

  it('made in the grid on two selected elements is one step of undo', async () => {
    await ready();
    select(['a', 'c']);
    expect(page.selection).toEqual(['a', 'c']);
    enter('description', 'Both');
    const described = () => ['a', 'c'].map((id) => page.document!.model.elements.find((each) => each.id === id)!.attributes.description);
    expect(described()).toEqual(['Both', 'Both']);
    await vi.waitFor(() => expect(byId('undo')).toHaveProperty('disabled', false));

    byId('undo')!.click();
    expect(described()).toEqual([undefined, undefined]);
    expect(page.document!.canUndo).toBe(false);
    await idle();
    expect([held(row('a')!, 'description'), held(row('c')!, 'description')].map((value) => value ?? '')).toEqual(['', '']);
  });

  it('made by dragging one of several selected elements moves them all, as one step of undo', async () => {
    await ready();
    const canvas = shared(page).canvas!;
    const starts = () => ['a', 'c'].map((id) => page.document!.model.elements.find((each) => each.id === id)!.attributes.start as number);
    const before = starts();
    select(['a', 'c']);
    const { box } = canvas.scene!.nodes.find((node) => node.id === 'c')!;
    // Inside its first phase: the middle of a trend is where a boundary between two phases is dragged.
    const at = canvas.toScreen({ x: box.x + box.width / 8, y: box.y + box.height / 2 });
    const far = 200;
    fire('pointerdown', element('c'), { clientX: at.x, clientY: at.y });
    expect(page.selection).toEqual(['a', 'c']);
    fire('pointermove', page.regions.canvas, { clientX: at.x + far / 2, clientY: at.y });
    fire('pointermove', page.regions.canvas, { clientX: at.x + far, clientY: at.y });
    fire('pointerup', page.regions.canvas, { clientX: at.x + far, clientY: at.y });

    const after = starts();
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1] - before[1]).toBe(after[0] - before[0]);
    expect(page.selection).toEqual(['a', 'c']);
    expect(status()).toBe('storing');
    expect(message()).toBe('');
    await vi.waitFor(() => expect(byId('undo')).toHaveProperty('disabled', false));
    byId('undo')!.click();
    expect(starts()).toEqual(before);
    expect(page.document!.canUndo).toBe(false);
    await idle();
  });

  it('leaves the token and the state of the panels in the storage of the browser, and nothing else', async () => {
    await ready();
    select(['a']);
    enter('name', 'Renamed');
    byId('toolbox-toggle')!.click();
    byId('property-grid-toggle')!.click();
    await idle();
    expect(kept()).toEqual([`adp-notion.${addon}.panel.property-grid`, `adp-notion.${addon}.panel.toolbox`, 'adp-notion.token']);
    expect(window.localStorage.getItem('adp-notion.token')).toBe(token);
    expect(window.localStorage.getItem(`adp-notion.${addon}.panel.toolbox`)).toBe('collapsed');
    expect(window.sessionStorage).toHaveLength(0);
    expect(document.cookie).toBe('');
  });
});

describe('the toolbox', () => {
  it('arms a picked tool, and a drop on the canvas is one row created in the store', async () => {
    await ready();
    const before = rows().length;
    const [first] = tools();
    expect(tools().map((each) => each.dataset.tool)).toEqual(specification.toolbox.groups.flatMap((group: { tools: { id: string }[] }) => group.tools.map((each) => each.id)));
    first.click();
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(tools().filter((each) => each.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(page.regions.canvas.hasAttribute('data-armed')).toBe(true);

    fire('pointerup', page.regions.canvas, { clientX: 400, clientY: 300 });
    expect(drawn()).toHaveLength(5);
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(page.regions.canvas.hasAttribute('data-armed')).toBe(false);
    expect(status()).toBe('storing');
    await idle();
    expect(rows()).toHaveLength(before + 1);
    expect(message()).toBe('');

    byId('undo')!.click();
    expect(drawn()).toHaveLength(4);
    await idle();
    expect(rows()).toHaveLength(before);
  });

  it('places the element of a tool at the centre of what the canvas shows on Enter', async () => {
    await ready();
    const before = rows().length;
    const [first] = tools();
    first.focus();
    expect(key('Enter', first).defaultPrevented).toBe(true);
    expect(drawn()).toHaveLength(5);
    expect(first.getAttribute('aria-pressed')).not.toBe('true');
    await idle();
    expect(rows()).toHaveLength(before + 1);

    // A tool whose element is named at once opens the editor of its label, as the specification says.
    const declared: { id: string; after?: string }[] = specification.toolbox.groups.flatMap((group: { tools: unknown[] }) => group.tools);
    key('Enter', tools().find((each) => each.dataset.tool === declared.find((each) => each.after === 'editLabel')!.id)!);
    expect(drawn()).toHaveLength(6);
    expect(document.querySelector('.adp-inplace :is(input, textarea)')).toBe(document.activeElement);
    await idle();
    expect(rows()).toHaveLength(before + 2);
  });

  it('uses a tool that is pressed in the toolbox and let go over the canvas, and keeps one armed that is let go where it was pressed', async () => {
    await ready();
    const [first, second] = tools();
    fire('pointerdown', first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    fire('pointerup', page.regions.canvas, { clientX: 400, clientY: 300 });
    expect(drawn()).toHaveLength(5);
    expect(first.getAttribute('aria-pressed')).toBe('false');

    // A press and its click are one pick; the next pick of the same tool disarms it, and another tool takes its place.
    fire('pointerdown', second);
    second.click();
    expect(second.getAttribute('aria-pressed')).toBe('true');
    fire('pointerdown', second);
    second.click();
    expect(second.getAttribute('aria-pressed')).toBe('false');
    second.click();
    first.click();
    expect([first, second].map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    // Escape on the canvas disarms, and the toolbox shows it.
    key('Escape', page.regions.canvas);
    expect(first.getAttribute('aria-pressed')).toBe('false');
    await idle();
  });
});

describe('a context menu', () => {
  const pick = (kind: string): void => {
    const declared = specification.toolbox.contextMenus.find((set: { for: string[] }) => set.for.includes(page.document!.model.elements[0].type));
    const label: string = declared.tools.find((entry: { kind: string }) => entry.kind === kind).label;
    [...document.querySelectorAll<HTMLElement>('.adp-menu [role="menuitem"]')].find((item) => item.getAttribute('aria-label') === label)!.click();
  };
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

  it('selects what it was asked on, and removes it only once the question is answered with yes', async () => {
    await ready();
    expect(fire('contextmenu', element('a'), { clientX: 100, clientY: 100 }).defaultPrevented).toBe(true);
    expect(page.selection).toEqual(['a']);
    expect(document.querySelector('.adp-menu')).not.toBeNull();
    pick('delete');
    expect(document.querySelector('.adp-menu')).toBeNull();

    // The specification asks first, because an influence goes with the trend.
    const question = specification.behavior.deletion[page.document!.model.elements[0].type].confirm;
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('1 influence');
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)!.textContent).toBe(question.title);
    expect(document.getElementById(dialog()!.getAttribute('aria-describedby')!)!.textContent).toContain('1 influence');
    const answers = [...dialog()!.querySelectorAll('button')];
    expect(answers).toHaveLength(2);
    expect(answers.some((answer) => answer === document.activeElement)).toBe(true);
    expect(drawn()).toContain('a');

    // No: with the keyboard.
    key('Escape', document.activeElement!);
    expect(dialog()).toBeNull();
    expect(drawn()).toEqual(['a', 'b', 'c', 'i-ab']);
    expect(page.document!.canUndo).toBe(false);

    // Yes.
    fire('contextmenu', element('a'), { clientX: 100, clientY: 100 });
    pick('delete');
    [...dialog()!.querySelectorAll('button')].find((answer) => answer.textContent === question.confirmLabel)!.click();
    expect(dialog()).toBeNull();
    expect(drawn()).toEqual(['b', 'c']);
    await idle();
    expect(rows().map((each) => held(each, schema.title))).toEqual(['b', 'c']);

    // The trend and its influence were one edit.
    byId('undo')!.click();
    expect(drawn()).toEqual(['a', 'b', 'c', 'i-ab']);
    await idle();
    expect(rows()).toHaveLength(4);
  });

  it('removes at once what the specification does not ask about', async () => {
    await ready();
    fire('contextmenu', element('c'), { clientX: 100, clientY: 100 });
    pick('delete');
    expect(dialog()).toBeNull();
    expect(drawn()).toEqual(['a', 'b', 'i-ab']);
    await idle();
  });
});

describe('a page that may not write', () => {
  it('is read-only with no toolbox and no editing control once Notion refuses the first write', async () => {
    await ready();
    expect(tools().length).toBeGreaterThan(0);
    service.notion.denyWrites(service.notion.me);
    select(['a']);
    enter('name', 'Renamed');
    await vi.waitFor(() => expect(document.body.dataset.state).toBe('read-only'), { timeout: 8000 });
    await vi.waitFor(() => expect(message()).toBe(FORBIDDEN), { timeout: 8000 });
    // The store was read again: the canvas shows what the database holds.
    await vi.waitFor(() => expect(element('a').getAttribute('aria-label')).toContain('Alpha'), { timeout: 8000 });

    expect(status()).toBe('failed');
    expect(held(row('a')!, 'name')).toBe('Alpha');
    expect(tools()).toEqual([]);
    expect(byId('toolbox-toggle')).toBeNull();
    expect(page.regions.toolbox.hidden).toBe(true);
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);

    // The grid shows the selection, without a control that changes it.
    select(['b']);
    expect(byId('property-grid-toggle')).not.toBeNull();
    expect(byId('property-grid')!.textContent).toContain('Beta');
    expect(byId('property-grid')!.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0);

    // Nothing of a gesture is left on the canvas.
    expect(page.regions.canvas.querySelector('.adp-gesture-grips')).toBeNull();
    fire('contextmenu', element('b'), { clientX: 100, clientY: 100 });
    expect(document.querySelector('.adp-menu')).toBeNull();
    fire('dblclick', element('b'));
    expect(document.querySelector('.adp-inplace')).toBeNull();
    key('Delete', element('b'));
    expect(drawn()).toEqual(['a', 'b', 'c', 'i-ab']);
    expect(warns()).toBe(false);
    }, 20_000);
});

describe('an embed narrower than both panels', () => {
  it('has both collapsed with the canvas usable, and leaves what the user chose alone', async () => {
    const keys = [`adp-notion.${addon}.panel.property-grid`, `adp-notion.${addon}.panel.toolbox`];
    await ready();
    const collapsed = () => [byId('toolbox')!.dataset.collapsed, byId('property-grid')!.dataset.collapsed];
    expect(collapsed()).toEqual(['false', 'false']);

    narrow(2 * widths.panel - 1);
    expect(collapsed()).toEqual(['true', 'true']);
    // Not a choice of the user: nothing is kept of it.
    expect(kept()).toEqual(['adp-notion.token']);
    expect([byId('toolbox-toggle'), byId('property-grid-toggle')].every((toggle) => toggle !== null)).toBe(true);
    select(['b']);
    expect(element('b').getAttribute('data-selected')).toBe('true');
    expect(page.selection).toEqual(['b']);

    // The user opens one: it stays open however often the embed says its size.
    byId('toolbox-toggle')!.click();
    narrow(2 * widths.panel - 2);
    expect(collapsed()).toEqual(['false', 'true']);
    expect(kept()).toEqual([keys[1], 'adp-notion.token']);

    // Wide again, each panel is as the user left it.
    narrow(1200);
    expect(collapsed()).toEqual(['false', 'false']);
    expect(kept()).toEqual([keys[1], 'adp-notion.token']);
  });

  it('opens narrow with both collapsed, and keeps a panel the user collapsed so when it widens', async () => {
    window.localStorage.setItem(`adp-notion.${addon}.panel.toolbox`, 'collapsed');
    widths.embed = 300;
    await ready();
    const collapsed = () => [byId('toolbox')!.dataset.collapsed, byId('property-grid')!.dataset.collapsed];
    expect(collapsed()).toEqual(['true', 'true']);
    narrow(1200);
    expect(collapsed()).toEqual(['true', 'false']);
    expect(window.localStorage.getItem(`adp-notion.${addon}.panel.property-grid`)).toBeNull();
  });
});

describe('a store that is read again', () => {
  it('says nothing when the page only regained the focus', async () => {
    await ready();
    service.notion.updateRow(row('a')!.id, { properties: { name: 'Elsewhere' } }, service.notion.addPerson('Somebody else'));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(element('a').getAttribute('aria-label')).toContain('Elsewhere'), { timeout: 4000 });
    await idle();
    expect(message()).toBe('');
    // The grid follows what was read.
    select(['a']);
    expect(field('name').value).toBe('Elsewhere');
  });

  it('opened in two pages: the edit of the second after the first is stopped, with the sentence that says why', async () => {
    await ready();
    // Another page of the same store: the parts and the store anew, as another tab has them.
    vi.resetModules();
    // In another order: no part depends on which was attached first.
    for (const part of ['panels', 'editing', 'undoRedo', 'reading']) await import(`../../src/frame/parts/${part}.ts`);
    const second = await open(store, (await import('../../src/frame/main')).start);
    expect(second).not.toBe(page);

    select(['a']);
    enter('name', 'First');
    await idle();
    expect(held(row('a')!, 'name')).toBe('First');

    select(['c'], second);
    enter('name', 'Second', second);
    // On the canvas at once, as any edit; then the store finds the first page's change.
    expect(within(second).element('c').getAttribute('aria-label')).toContain('Second');
    await vi.waitFor(() => expect(within(second).message()).toBe(DRIFTED), { timeout: 8000 });
    await vi.waitFor(() => expect(within(second).element('c').getAttribute('aria-label')).toContain('Gamma'), { timeout: 8000 });
    expect(within(second).status()).toBe('failed');
    expect(held(row('c')!, 'name')).toBe('Gamma');
    expect(within(second).element('a').getAttribute('aria-label')).toContain('First');
    expect(second.document!.canUndo).toBe(false);
    expect(message()).toBe('');

    // What was read again can be edited.
    enter('name', 'Second again', second);
    expect(within(second).message()).toBe('');
    await idle(second);
    expect(held(row('c')!, 'name')).toBe('Second again');
    }, 30_000);
});

describe('the styles of the two parts', () => {
  it('state no colour, size or spacing of their own, and have only classes that begin with adp-', () => {
    const stated = new Set([...readFileSync('src/panels/notion.css', 'utf8').matchAll(/(--notion-[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const sheet of ['editing', 'panels']) {
      const css = readFileSync(`src/frame/parts/${sheet}.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d*\.?\d+(?:px|pt|em|rem|ch)\b/gi) ?? []).toEqual([]);
      expect([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]).filter((name) => !stated.has(name))).toEqual([]);
      expect([...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))].filter((name) => !name.startsWith('adp-'))).toEqual([]);
    }
  });
});
