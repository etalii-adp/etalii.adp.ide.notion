import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { start, type Environment } from '../../src/frame/main';
import { onPage, type Page } from '../../src/frame/page';
import { createMemoryStorage } from '../support/memoryService';

const addon = 'gartner-hype-cycle-graph';
const store = '3f2be2fd05b680f5bfe1d89398eabb4e';
const local = `http://localhost:8080/${addon}/`;

let asked: string[];
let storage: Storage;
let pages: (Page | undefined)[];

/** Starts a page that the next test finds closed. */
async function open(...given: Parameters<typeof environment>): Promise<Page | undefined> {
  const page = await start(environment(...given));
  pages.push(page);
  return page;
}

/** The add-on's folder, served by relative address; `other` replaces or removes a file. */
function environment(address: string, other: Record<string, string | null> = {}, more: Partial<Environment> = {}): Partial<Environment> {
  return {
    document,
    location: new URL(address),
    storage,
    fetch: async (request) => {
      const name = String(request);
      asked.push(name);
      if (other[name] === null) return new Response('', { status: 404 });
      return new Response(other[name] ?? readFileSync(`addons/${addon}/${name}`));
    },
    ...more,
  };
}

function media(matches: boolean) {
  const listeners: ((event: MediaQueryListEvent) => void)[] = [];
  return {
    matchMedia: () => ({ matches, addEventListener: (_: string, listener: unknown) => void listeners.push(listener as (event: MediaQueryListEvent) => void) }),
    change: (now: boolean) => listeners.forEach((listener) => listener({ matches: now } as MediaQueryListEvent)),
  };
}

const ids = () => [...document.body.querySelectorAll('[id]')].map((element) => element.id).sort();
const message = () => document.getElementById('message')?.textContent ?? '';

beforeEach(() => {
  asked = [];
  pages = [];
  storage = createMemoryStorage();
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.addon;
});

afterEach(() => pages.forEach((page) => page?.close()));

describe('the address', () => {
  it('gives the add-on id and the state loading for a store', async () => {
    const page = await open(`${local}?store=${store}`);
    expect(document.documentElement.dataset.addon).toBe(addon);
    expect(document.body.dataset.state).toBe('loading');
    expect(page?.addon).toBe(addon);
    expect(page?.database).toBe(store);
  });

  it.each([
    ['with dashes', '3f2be2fd-05b6-80f5-bfe1-d89398eabb4e'],
    ['in capitals', store.toUpperCase()],
  ])('reads a database id %s', async (_, id) => {
    const page = await open(`${local}index.html?store=${id}&view=1`);
    expect(page?.database).toBe(id);
    expect(page?.addon).toBe(addon);
  });

  it.each([
    ['no store', ''],
    ['an empty store', '?store='],
    ['a store that is too short', `?store=${store.slice(1)}`],
    ['a store that is no id', `?store=${store.slice(1)}g`],
    ['a Notion address as the store', `?store=https://app.notion.com/p/${store}`],
  ])('is the state setup with %s', async (_, search) => {
    expect(await open(`${local}${search}`)).toBeUndefined();
    expect(document.body.dataset.state).toBe('setup');
  });

  it('ignores any other parameter', async () => {
    const page = await open(`${local}?v=1&store=${store}&theme=blue&x=y`, {}, media(false));
    expect(page?.database).toBe(store);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(message()).toBe('');
  });
});

describe('the appearance', () => {
  it.each(['light', 'dark'])('is the theme of the address: %s', async (theme) => {
    const browser = media(theme === 'light');
    await open(`${local}?store=${store}&theme=${theme}`, {}, browser);
    expect(document.documentElement.dataset.theme).toBe(theme);
    browser.change(theme !== 'light');
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('is what the browser prefers otherwise, and follows a change of it', async () => {
    const browser = media(true);
    await open(`${local}?store=${store}`, {}, browser);
    expect(document.documentElement.dataset.theme).toBe('dark');
    browser.change(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    browser.change(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('is light where the browser says nothing', async () => {
    await open(`${local}?store=${store}`);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('a page with a store', () => {
  it('asks for addon.json and the two files it names, and for nothing else', async () => {
    await open(`${local}?store=${store}`);
    expect(asked).toEqual(['addon.json', `${addon}.dis`, `${addon}.fbl`]);
  });

  it('lays the regions out and shows the status loading', async () => {
    await open(`${local}?store=${store}`);
    expect(ids()).toEqual(['canvas', 'findings', 'message', 'property-grid', 'status', 'toolbox']);
    expect(document.getElementById('status')?.dataset.status).toBe('loading');
    expect(document.querySelector('.adp-setup')).toBeNull();
  });

  it('hands the loaded tool type to every part, and leaves the state to them', async () => {
    const given: Page[] = [];
    const detach = [onPage((page) => void given.push(page)), onPage((page) => void given.push(page))];
    const page = await open(`${local}?store=${store}`);
    detach.forEach((stop) => stop());
    expect(given).toEqual([page, page]);
    expect(page?.specification.language.id).toBeTruthy();
    expect(Object.keys(page?.metamodel.types ?? {}).length).toBeGreaterThan(0);
    expect(page?.fbl.bindings.get(page.persistence.binding!.name)).toBe(page?.binding);
    expect(page?.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(page?.state).toBe('loading');
    expect(page?.session.hasToken()).toBe(false);
    expect(asked).toHaveLength(3);
    expect(storage.length).toBe(0);
  });

  it.each([
    ['addon.json is missing', { 'addon.json': null }, 'addon.json cannot be read'],
    ['addon.json is not JSON', { 'addon.json': 'no' }, 'addon.json is not JSON'],
    ['addon.json names a file elsewhere', { 'addon.json': '{"specification":"https://example.org/a.dis","binding":"a.fbl"}' }, 'does not name'],
    ['the specification is missing', { [`${addon}.dis`]: null }, `${addon}.dis cannot be read`],
    ['the specification is not one', { [`${addon}.dis`]: '{"a":1}' }, 'is not a specification'],
    ['the binding is missing', { [`${addon}.fbl`]: null }, `${addon}.fbl cannot be read`],
    ['the binding is not an FBL document', { [`${addon}.fbl`]: '{"fbl":"0.1"}' }, 'is not an FBL document'],
  ])('shows the sentence and stays out of ready when %s', async (_, other, sentence) => {
    let given = 0;
    const detach = onPage(() => void given++);
    expect(await open(`${local}?store=${store}`, other)).toBeUndefined();
    detach();
    expect(message()).toContain(sentence);
    expect(document.getElementById('message')?.getAttribute('role')).toBe('alert');
    expect(document.body.dataset.state).toBe('loading');
    expect(document.getElementById('status')?.dataset.status).toBe('failed');
    expect(given).toBe(0);
  });

  it('hands a page over on a host that is not local too, where the deployed service answers', async () => {
    expect(await open(`https://example.org/${addon}/?store=${store}`)).toBeDefined();
    expect(message()).toBe('');
  });
});

describe('the state setup', () => {
  it('shows the steps under the name of the tool type, and no region of the frame', async () => {
    await open(`https://etalii.net/adp-notion/${addon}/`);
    const help = document.querySelector('.adp-setup');
    expect(help?.querySelector('h1')?.textContent).toBe('Gartner hype cycle graph');
    expect(help?.querySelectorAll('ol > li').length).toBeGreaterThanOrEqual(4);
    expect(help?.textContent).toContain(`https://etalii.net/adp-notion/${addon}/?store=`);
    expect(ids()).toEqual(['choose-store', 'message']);
    expect(message()).toBe('');
  });

  it('makes no call, asks for no token and attaches no part', async () => {
    let given = 0;
    const detach = onPage(() => void given++);
    const opened: unknown[] = [];
    const windowOpen = window.open;
    window.open = (...request) => (opened.push(request), null);
    await open(`${local}?store=nothing`);
    window.open = windowOpen;
    detach();
    expect(asked).toEqual(['addon.json', `${addon}.dis`, `${addon}.fbl`]);
    expect(opened).toEqual([]);
    expect(storage.length).toBe(0);
    expect(given).toBe(0);
  });

  it('still shows the steps when the add-on could not be loaded, with the sentence', async () => {
    await open(local, { 'addon.json': null });
    expect(document.body.dataset.state).toBe('setup');
    expect(document.querySelectorAll('.adp-setup ol > li').length).toBeGreaterThanOrEqual(4);
    expect(message()).toContain('addon.json cannot be read');
    // Without the tool type there is nothing to check a database against.
    expect(document.getElementById('choose-store')).toBeNull();
  });
});

describe('frame.css', () => {
  const css = readFileSync('src/frame/frame.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('states no colour, size or spacing of its own', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d*\.?\d+(?:px|pt|em|rem|ch)\b/gi) ?? []).toEqual([]);
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !name.startsWith('--notion-'))).toEqual([]);
    expect(css).not.toMatch(/(^|[\s{;])--[\w-]+\s*:/);
  });

  it('uses only properties that notion.css states', () => {
    const stated = new Set([...readFileSync('src/panels/notion.css', 'utf8').matchAll(/(--notion-[\w-]+)\s*:/g)].map((match) => match[1]));
    expect([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]).filter((name) => !stated.has(name))).toEqual([]);
  });

  it('has only classes that begin with adp-, one for each region', () => {
    const classes = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))];
    expect(classes.filter((name) => !name.startsWith('adp-'))).toEqual([]);
    for (const region of ['bar', 'canvas', 'toolbox', 'property-grid', 'findings', 'status', 'message', 'setup']) expect(classes).toContain(`adp-${region}`);
  });

  it('follows data-theme', () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
  });
});
