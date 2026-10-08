import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/frame/parts/reading';
import { start } from '../../src/frame/main';
import type { Page } from '../../src/frame/page';
import { storeOf } from '../../src/store/document';
import { createNotionCalls } from '../../src/store/notion';
import { prepare, storeSchema } from '../../src/store/schema';
import { createSession } from '../../src/store/session';
import { tool } from '../disl/tool';
import type { MemoryDatabase, MemoryValue } from '../support/memoryNotion';
import { createMemoryService, createMemoryStorage, type MemoryService } from '../support/memoryService';

// The page in each state of the address contract (etalii.adp spec 012, contracts/addon-address.md),
// from the address through the real service to an in-memory Notion.

const addon = 'gartner-hype-cycle-graph';
const address = 'http://localhost:8787';
const local = `http://localhost:8080/${addon}/`;
const { binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);

let service: MemoryService;
let storage: Storage;
let pages: (Page | undefined)[];
let opened: string[];
let openWindow: (url: string) => { closed: boolean } | null;
const windowOpen = window.open;

const trend = (id: string, order: number, more: Record<string, MemoryValue> = {}): Record<string, MemoryValue> =>
  ({ id, Kind: 'trend', Order: order, name: id.toUpperCase(), start: '2000-01', stop: '2010-01', ...more });

function keepToken(): void {
  storage.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' }));
}

/** Calls that wait for nothing, for what a test puts into a store before the page opens it. */
function fastCalls() {
  const kept = createMemoryStorage();
  kept.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' }));
  const session = createSession({ service: address, storage: kept, fetch: service.fetch, open: () => null, listen: () => () => undefined });
  let clock = 0;
  return createNotionCalls({ service: address, session, fetch: service.fetch, now: () => clock, sleep: async (milliseconds) => void (clock += milliseconds) });
}

async function database(rows: Record<string, MemoryValue>[] = [], prepared = true): Promise<MemoryDatabase> {
  const made = service.notion.createDatabase();
  if (prepared) {
    const calls = fastCalls();
    await prepare(schema, await calls.dataSource(made.dataSourceId), calls);
  }
  service.notion.seedRows(made.dataSourceId, rows);
  return made;
}

/** Starts the page of a store; `other` replaces a file of the add-on's folder. */
async function open(store: MemoryDatabase, other: Record<string, string> = {}): Promise<Page> {
  const page = await start({
    document,
    location: new URL(`${local}?store=${store.id}`),
    storage,
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(address)) return service.fetch(input, init);
      return new Response(other[url] ?? readFileSync(`addons/${addon}/${url}`));
    },
  });
  pages.push(page);
  return page!;
}

const state = () => document.body.dataset.state;
const settled = (wanted: string) => vi.waitFor(() => expect(state()).toBe(wanted), { timeout: 4000 });
const byId = (id: string) => document.getElementById(id);
const drawn = () => [...document.querySelectorAll('#canvas [data-element]')].map((element) => element.getAttribute('data-element'));
const findings = () => [...document.querySelectorAll('#findings > li')];
const status = () => byId('status')?.dataset.status;
const specificationFile = () => JSON.parse(readFileSync(`addons/${addon}/${addon}.dis`, 'utf8'));

beforeEach(() => {
  service = createMemoryService({ address, origin: 'http://localhost:8080' });
  storage = createMemoryStorage();
  pages = [];
  opened = [];
  openWindow = () => null;
  window.open = ((url: string) => (opened.push(url), openWindow(url))) as unknown as typeof window.open;
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  pages.forEach((page) => page?.close());
  window.open = windowOpen;
});

describe('the state connect', () => {
  it('invites to connect and asks for no token by itself', async () => {
    const store = await database([trend('a', 1)]);
    const asked = service.requests.length;
    await open(store);
    await settled('connect');
    expect(byId('connect')).not.toBeNull();
    expect(byId('disconnect')).toBeNull();
    expect(byId('prepare')).toBeNull();
    expect(opened).toEqual([]);
    expect(service.requests).toHaveLength(asked);
    expect(drawn()).toEqual([]);
  });

  it('says while it waits that the sign-in is in a browser window, with a link to it and a way to stop', async () => {
    await open(await database());
    await settled('connect');
    expect(byId('open-in-tab')).toBeNull();
    byId('connect')!.click();
    await vi.waitFor(() => expect(byId('open-in-tab')).not.toBeNull());
    expect(opened).toHaveLength(1);
    // The link is the sign-in itself, for when no window opened.
    const link = byId('open-in-tab')!;
    expect(link.getAttribute('href')).toBe(opened[0]);
    expect(new URL(opened[0]).pathname).toBe('/authorize');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.textContent).toContain('No window opened?');
    expect(document.querySelector('.adp-notice p')!.textContent).toBe('The sign-in continues in a browser window. Once access is granted there, the diagram opens here by itself.');
    expect(byId('connect')).toBeNull();
    expect(state()).toBe('connect');

    byId('cancel-connect')!.click();
    await vi.waitFor(() => expect(byId('connect')).not.toBeNull());
    expect(byId('open-in-tab')).toBeNull();
    expect(byId('cancel-connect')).toBeNull();
    expect(document.body.textContent).not.toContain('Connecting to Notion failed');
    expect(state()).toBe('connect');

    // Another click starts a grant of its own.
    byId('connect')!.click();
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    expect(opened[1]).not.toBe(opened[0]);
  });

  it('opens the store when the service hands the grant over, no window having opened', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      await open(await database([trend('a', 1)]));
      await settled('connect');
      byId('connect')!.click();
      await vi.waitFor(() => expect(byId('open-in-tab')).not.toBeNull());
      // The person grants in a window that has no opener: nothing is posted to the page.
      await service.grant(byId('open-in-tab')!.getAttribute('href')!);
      expect(state()).toBe('connect');
      await vi.advanceTimersByTimeAsync(2000);
      await settled('ready');
      expect(drawn()).toEqual(['a']);
      expect(byId('open-in-tab')).toBeNull();
      expect(byId('cancel-connect')).toBeNull();
      expect(byId('disconnect')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to the invitation with a sentence when access is refused', async () => {
    openWindow = (url) => {
      void service.grant(url, { refuse: 'access_denied' }).then((message) => window.dispatchEvent(new MessageEvent('message', message)));
      return { closed: false };
    };
    await open(await database());
    await settled('connect');
    byId('connect')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Access was not granted.'));
    expect(byId('connect')).not.toBeNull();
    expect(byId('open-in-tab')).toBeNull();
  });

  it('opens the store once access is granted from the click', async () => {
    openWindow = (url) => {
      void service.grant(url).then((message) => window.dispatchEvent(new MessageEvent('message', message)));
      return { closed: false };
    };
    await open(await database([trend('a', 1)]));
    await settled('connect');
    byId('connect')!.click();
    await settled('ready');
    expect(drawn()).toEqual(['a']);
    expect(byId('connect')).toBeNull();
    expect(byId('disconnect')).not.toBeNull();
  });
});

describe('a store that cannot be opened', () => {
  it('is unshared with its sentence, and offers to grant again', async () => {
    keepToken();
    const store = await database([trend('a', 1)]);
    service.notion.unshare(store.id);
    await open(store);
    await settled('unshared');
    expect(document.body.textContent).toContain('not shared');
    expect(byId('connect')).not.toBeNull();
    expect(byId('disconnect')).not.toBeNull();
    expect(drawn()).toEqual([]);
  });

  it('is unprepared with what is missing, and is prepared from the page', async () => {
    keepToken();
    const store = await database([], false);
    await open(store);
    await settled('unprepared');
    expect(document.body.textContent).toContain('The database lacks');
    expect(byId('disconnect')).not.toBeNull();
    byId('prepare')!.click();
    await settled('ready');
    expect(byId('prepare')).toBeNull();
    expect(findings()).toEqual([]);
  });

  it('is unreadable with an empty canvas and the sentence the specification gives', async () => {
    keepToken();
    const fbl = JSON.parse(readFileSync(`addons/${addon}/${addon}.fbl`, 'utf8'));
    // A template that is no document: nothing the rows hold can be read through it.
    fbl.bindings[binding.name].template.text = 'trends: [\n';
    const specification = specificationFile();
    const sentence: string = specification.behavior.messages['std.readOnly'];
    await open(await database([trend('a', 1)]), { [`${addon}.fbl`]: JSON.stringify(fbl) });
    await settled('unreadable');
    expect(sentence).toBe('The graph could not be read, so it cannot be edited.');
    expect(document.body.textContent).toContain(sentence);
    expect(drawn()).toEqual([]);
    expect(byId('prepare')).toBeNull();
    expect(byId('disconnect')).not.toBeNull();
    for (const file of ['src/frame/parts/reading.ts', 'src/canvas/canvas.ts']) expect(readFileSync(file, 'utf8')).not.toContain(sentence);
  });

  it('shows the sentence of a changed specification', async () => {
    keepToken();
    const fbl = JSON.parse(readFileSync(`addons/${addon}/${addon}.fbl`, 'utf8'));
    fbl.bindings[binding.name].template.text = 'trends: [\n';
    const specification = specificationFile();
    specification.behavior.messages['std.readOnly'] = 'Nothing could be read here.';
    await open(await database([trend('a', 1)]), { [`${addon}.fbl`]: JSON.stringify(fbl), [`${addon}.dis`]: JSON.stringify(specification) });
    await settled('unreadable');
    expect(document.body.textContent).toContain('Nothing could be read here.');
    expect(document.body.textContent).not.toContain('The graph could not be read');
  });
});

describe('a store that is read', () => {
  it('is ready with the canvas drawn, the status idle and disconnect', async () => {
    keepToken();
    const page = await open(await database([trend('a', 1), trend('b', 2, { start: '2005-01', stop: '2015-01' })]));
    await settled('ready');
    expect(drawn()).toEqual(['a', 'b']);
    expect(document.querySelector('#canvas [data-element="a"]')?.getAttribute('data-type')).toBe(page.document?.model.elements[0].type);
    expect(status()).toBe('idle');
    expect(byId('disconnect')).not.toBeNull();
    expect(byId('connect')).toBeNull();
    expect(page.document?.state).toBe('ready');
  });

  it('is ready with an empty graph and no finding for an empty store', async () => {
    keepToken();
    await open(await database());
    await settled('ready');
    expect(drawn()).toEqual([]);
    expect(findings()).toEqual([]);
    expect(byId('message')?.textContent).toBe('');
  });

  it('lists one item per finding, with its severity, its sentence and its element', async () => {
    keepToken();
    const page = await open(await database([trend('a', 1), { id: 'odd', Kind: 'gadget' }, trend('b', 2, { phases: 9 })]));
    await settled('ready');
    const found = page.document!.findings;
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(findings().map((item) => [item.getAttribute('data-severity'), item.getAttribute('data-element')])).toEqual(
      found.map((finding) => [finding.severity, finding.element ?? null]),
    );
    findings().forEach((item, index) => expect(item.textContent).toContain(found[index].message));
    expect(found.some((finding) => finding.element === undefined)).toBe(true);
    expect(drawn()).toEqual(['a', 'b']);
  });

  it('selects the element of a chosen finding on the canvas, and tells the page a selection made there', async () => {
    keepToken();
    const page = await open(await database([trend('a', 1), trend('b', 2, { phases: 9 })]));
    await settled('ready');
    const item = findings().find((entry) => entry.getAttribute('data-element') === 'b')!;
    (item.querySelector('button') ?? (item as HTMLElement)).click();
    expect(page.selection).toEqual(['b']);
    expect(document.querySelector('#canvas [data-element="b"]')?.getAttribute('data-selected')).toBe('true');
    document.querySelector('#canvas [data-element="a"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(page.selection).toEqual(['a']);
    expect(document.querySelector('#canvas [data-element="b"]')?.getAttribute('data-selected')).not.toBe('true');
  });

  it('is read-only with the canvas drawn once Notion refuses this person a write', async () => {
    keepToken();
    const page = await open(await database([trend('a', 1)]));
    await settled('ready');
    storeOf(page.document!).markReadOnly();
    expect(state()).toBe('read-only');
    expect(drawn()).toEqual(['a']);
    expect(byId('disconnect')).not.toBeNull();
  });

  it('draws again when the document changes, and reads again when the page regains the focus', async () => {
    keepToken();
    const store = await database([trend('a', 1)]);
    const page = await open(store);
    await settled('ready');
    service.notion.seedRows(store.dataSourceId, [trend('b', 2)]);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(drawn()).toEqual(['a', 'b']), { timeout: 4000 });
    expect(page.document?.model.elements).toHaveLength(2);
    expect(status()).toBe('idle');
  });

  it('follows the status of the document', async () => {
    keepToken();
    const store = await database([trend('a', 1)]);
    await open(store);
    await settled('ready');
    expect(status()).toBe('idle');
    service.unreachable(10);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(status()).toBe('offline'), { timeout: 4000 });
    expect(byId('message')?.textContent).not.toBe('');
    expect(drawn()).toEqual(['a']);
  });

  it('removes the token and returns to connect on disconnect', async () => {
    keepToken();
    const page = await open(await database([trend('a', 1)]));
    await settled('ready');
    byId('disconnect')!.click();
    expect(state()).toBe('connect');
    expect(storage.getItem('adp-notion.token')).toBeNull();
    expect(byId('disconnect')).toBeNull();
    expect(byId('connect')).not.toBeNull();
    expect(drawn()).toEqual([]);
    expect(findings()).toEqual([]);
    expect(page.document).toBeUndefined();
  });
});

describe('a changed specification', () => {
  it('shows a changed label and a changed default, with no other change', async () => {
    keepToken();
    const rows = [trend('a', 1), { id: 'n', Kind: 'note', Order: 2, text: 'A remark', at: '2001-01', row: 3 }];
    const widthOf = () => Number(document.querySelector('#canvas [data-element="n"] rect:not([class])')?.getAttribute('width'));

    await open(await database(rows));
    await settled('ready');
    const before = { drawn: drawn(), width: widthOf(), findings: findings().length, toggles: [...document.querySelectorAll('[data-viewpoint]')].map((toggle) => toggle.textContent) };
    pages.pop()?.close();
    document.body.replaceChildren();
    document.body.dataset.state = 'loading';

    const specification = specificationFile();
    const viewpoint = Object.keys(specification.viewpoints).find((name) => specification.viewpoints[name].toggle)!;
    specification.viewpoints[viewpoint].toggle.label = 'Packed tightly';
    specification.metamodel.types.Note.attributes.width.default = before.width + 40;
    await open(await database(rows), { [`${addon}.dis`]: JSON.stringify(specification) });
    await settled('ready');

    expect(before.toggles).toHaveLength(1);
    expect([...document.querySelectorAll('[data-viewpoint]')].map((toggle) => toggle.textContent)).toEqual(['Packed tightly']);
    expect(widthOf()).toBe(before.width + 40);
    expect(drawn()).toEqual(before.drawn);
    expect(findings()).toHaveLength(before.findings);
  });
});

describe('reading.css', () => {
  const css = readFileSync('src/frame/parts/reading.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('states no colour, size or spacing of its own, and has only classes that begin with adp-', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d*\.?\d+(?:px|pt|em|rem|ch)\b/gi) ?? []).toEqual([]);
    const stated = new Set([...readFileSync('src/panels/notion.css', 'utf8').matchAll(/(--notion-[\w-]+)\s*:/g)].map((match) => match[1]));
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !stated.has(name))).toEqual([]);
    expect([...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))].filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });
});
