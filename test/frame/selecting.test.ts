import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { start } from '../../src/frame/main';
import type { Page } from '../../src/frame/page';
import { createNotionCalls } from '../../src/store/notion';
import { prepare, storeSchema } from '../../src/store/schema';
import { createSession } from '../../src/store/session';
import { tool } from '../disl/tool';
import type { MemoryDatabase } from '../support/memoryNotion';
import { createMemoryService, createMemoryStorage, type MemoryService } from '../support/memoryService';

// Selecting a store from the state setup (etalii.adp spec 012, FR-033 to FR-035;
// contracts/addon-address.md, "Selecting a store"), from the address without a store through the
// real service to an in-memory Notion.

const addon = 'gartner-hype-cycle-graph';
const address = 'http://localhost:8787';
const local = `http://localhost:8080/${addon}/`;
const { binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);

let service: MemoryService;
let storage: Storage;
let kept: Storage;
let pages: (Page | undefined)[];
let navigated: string[];
let copied: string[];
let openWindow: (url: string) => { closed: boolean } | null;
const windowOpen = window.open;

const notion = () => service.notion;
const hex = (id: string) => id.replaceAll('-', '');
const byId = (id: string) => document.getElementById(id);
const message = () => byId('message')?.textContent ?? '';
const stores = () => [...document.querySelectorAll<HTMLButtonElement>('#stores .adp-store')];
const titles = () => stores().map((store) => store.querySelector('.adp-store-title')!.textContent);
const properties = () => [...document.querySelectorAll('#properties > li')];
const writes = () => service.requests.filter((request) => request.includes('/notion/') && !request.startsWith('GET') && !request.endsWith('/search') && !request.endsWith('/query'));
const until = (check: () => void) => vi.waitFor(check, { timeout: 12000, interval: 20 });

function keepToken(): void {
  storage.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' }));
}

/** A database that is a store already, prepared by calls that wait for nothing. */
async function prepared(made: MemoryDatabase): Promise<MemoryDatabase> {
  const session = createSession({ service: address, storage: (() => {
    const own = createMemoryStorage();
    own.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' }));
    return own;
  })(), fetch: service.fetch, open: () => null, listen: () => () => undefined });
  let clock = 0;
  const calls = createNotionCalls({ service: address, session, fetch: service.fetch, now: () => clock, sleep: async (milliseconds) => void (clock += milliseconds) });
  await prepare(schema, await calls.dataSource(made.dataSourceId), calls);
  service.requests.length = 0;
  return made;
}

/** An entry as the Showcase has them: a page with the database and, under it, the page of the diagram. */
function entry(title = 'An entry') {
  const page = notion().createPage({ title });
  const diagram = notion().createPage({ title: 'Diagram', parent: page.id });
  const database = notion().createDatabase({ title: `${title} - Data`, parent: page.id });
  return { page, diagram, database };
}

async function open(search = '', more: { kept?: Storage } = {}): Promise<Page | undefined> {
  const page = await start({
    document,
    location: new URL(`${local}${search}`),
    storage,
    kept: more.kept ?? kept,
    navigate: (to) => void navigated.push(to),
    copy: async (text) => void copied.push(text),
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(address)) return service.fetch(input, init);
      return new Response(readFileSync(`addons/${addon}/${url}`));
    },
  });
  pages.push(page);
  return page;
}

async function choose(title: string): Promise<void> {
  byId('choose-store')!.click();
  await until(() => expect(titles()).toContain(title));
  stores().find((store) => store.textContent!.includes(title))!.click();
}

beforeEach(() => {
  service = createMemoryService({ address, origin: 'http://localhost:8080' });
  storage = createMemoryStorage();
  kept = createMemoryStorage();
  pages = [];
  navigated = [];
  copied = [];
  openWindow = () => null;
  window.open = ((url: string) => openWindow(url)) as unknown as typeof window.open;
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
});

afterEach(() => {
  pages.forEach((page) => page?.close());
  window.open = windowOpen;
});

describe('the state setup', () => {
  it('offers to choose a database beside its steps, and asks the service nothing until then', async () => {
    notion().createDatabase();
    await open();
    expect(document.body.dataset.state).toBe('setup');
    const control = byId('choose-store') as HTMLButtonElement;
    expect(control.tagName).toBe('BUTTON');
    expect(control.textContent).toBe('Choose a database');
    expect(byId('stores')).toBeNull();
    expect(service.requests).toEqual([]);
    expect(storage.length).toBe(0);
    expect(kept.length).toBe(0);
  });

  it('asks for access where none is kept, with the notice of a grant under way, and lists the databases once it is granted', async () => {
    notion().createDatabase({ title: 'A store' });
    await open();
    byId('choose-store')!.click();
    await until(() => expect(byId('open-in-tab')).not.toBeNull());
    expect(document.querySelector('.adp-selection p')!.textContent).toBe('The sign-in continues in a browser window. Once access is granted there, the databases are listed here by itself.');
    expect(byId('cancel-connect')).not.toBeNull();
    expect(service.requests.filter((request) => request.includes('/notion/'))).toEqual([]);

    byId('cancel-connect')!.click();
    await until(() => expect(byId('open-in-tab')).toBeNull());
    expect(message()).toBe('');

    openWindow = (url) => {
      void service.grant(url).then((posted) => window.dispatchEvent(new MessageEvent('message', posted)));
      return { closed: false };
    };
    byId('choose-store')!.click();
    await until(() => expect(titles()).toEqual(['A store']));
    expect(storage.getItem('adp-notion.token')).not.toBeNull();
  });

  it('says so when access is refused', async () => {
    openWindow = (url) => {
      void service.grant(url, { refuse: 'access_denied' }).then((posted) => window.dispatchEvent(new MessageEvent('message', posted)));
      return { closed: false };
    };
    await open();
    byId('choose-store')!.click();
    await until(() => expect(message()).toBe('Access was not granted.'));
    expect(byId('stores')).toBeNull();
    expect(byId('choose-store')).not.toBeNull();
  });
});

describe('the databases a person reaches', () => {
  it('are listed once each with their title and where they are, and those that are not shared are not', async () => {
    keepToken();
    const { database } = entry('Coal');
    const top = notion().createDatabase({ title: 'At the top' });
    notion().createDatabase({ title: 'Twice', dataSources: 2 });
    notion().unshare(notion().createDatabase({ title: 'Not shared' }).id);
    await open();
    byId('choose-store')!.click();
    await until(() => expect(stores()).toHaveLength(3));
    expect(stores().map((store) => [store.dataset.store, store.querySelector('.adp-store-title')!.textContent, store.querySelector('.adp-store-where')!.textContent])).toEqual([
      [database.id, 'Coal - Data', 'On a page'],
      [top.id, 'At the top', 'At the top of the workspace'],
      [expect.any(String), 'Twice', 'At the top of the workspace'],
    ]);
    expect(byId('stores')!.getAttribute('aria-label')).toBe('Databases');
    expect(stores().every((store) => store.tagName === 'BUTTON')).toBe(true);
    expect(byId('more-stores')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('are listed 25 at a time, and found by a part of their name', async () => {
    keepToken();
    for (let count = 1; count <= 30; count++) notion().createDatabase({ title: `Store ${String(count).padStart(2, '0')}` });
    notion().createDatabase({ title: 'Coal technologies - Data' });
    await open();
    byId('choose-store')!.click();
    await until(() => expect(stores()).toHaveLength(25));
    byId('more-stores')!.click();
    await until(() => expect(stores()).toHaveLength(31));
    expect(byId('more-stores')).toBeNull();

    const find = byId('find-store') as HTMLInputElement;
    expect(find.getAttribute('aria-label')).toBe('Find a database by name');
    find.value = 'coal';
    find.form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await until(() => expect(titles()).toEqual(['Coal technologies - Data']));
    expect((byId('find-store') as HTMLInputElement).value).toBe('coal');

    (byId('find-store') as HTMLInputElement).value = 'nothing of the kind';
    (byId('find-store') as HTMLInputElement).form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await until(() => expect(document.querySelector('.adp-selection')!.textContent).toContain('No database with "nothing of the kind" in its name is shared with this add-on.'));
    expect(stores()).toEqual([]);
  });

  it('are none: the page says how one is shared, and offers to grant again', async () => {
    keepToken();
    await open();
    byId('choose-store')!.click();
    await until(() => expect(document.querySelector('.adp-selection')!.textContent).toContain('No database is shared with this add-on yet.'));
    byId('connect')!.click();
    await until(() => expect(byId('open-in-tab')).not.toBeNull());
    expect(storage.getItem('adp-notion.token')).toBeNull();
    byId('cancel-connect')!.click();
  });
});

describe('a chosen database', () => {
  it('is checked, changed only once the person agrees, prepared with the projection chosen, and named by the embed block', async () => {
    keepToken();
    const { page, diagram } = entry('Other');
    const database = notion().createDatabase({ title: 'Coal - Data', parent: page.id, properties: { Name: { title: {} }, Sequence: { number: {} }, Level: { number: {} }, Mine: { rich_text: {} } } });
    const embed = notion().addBlock(diagram.id, { embed: `${local}?theme=dark` });
    const [row] = notion().seedRows(database.dataSourceId, [{ Name: 'kept', Sequence: 3 }]);
    const sequence = (notion().properties(database.dataSourceId).Sequence as { id: string }).id;
    await open('?theme=dark');
    await choose('Coal - Data');

    await until(() => expect(byId('prepare')).not.toBeNull());
    expect(document.querySelector('.adp-selection')!.textContent).toContain('Coal - Data is not prepared as a store yet.');
    const items = properties();
    expect(items).toHaveLength(schema.properties.length);
    expect(items[0].textContent).toBe('id (title)The title property Name is given this name.');
    const choiceOf = (name: string) => document.querySelector<HTMLSelectElement>(`#properties select[data-property="${name}"]`);
    const order = choiceOf('Order')!;
    expect([...order.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'Add a new property'],
      ['Sequence', 'Use the existing property Sequence, which is given this name'],
      ['Level', 'Use the existing property Level, which is given this name'],
    ]);
    expect(order.value).toBe('');
    expect(order.getAttribute('aria-label')).toBe('Where the property Order comes from');
    expect(choiceOf('Kind')).toBeNull();
    expect(items[1].textContent).toBe('Kind (select)A new property is added.');
    expect([...choiceOf('name')!.options].map((option) => option.value)).toEqual(['', 'Mine']);
    expect(writes()).toEqual([]);
    expect(Object.keys(notion().properties(database.dataSourceId))).toEqual(['Name', 'Sequence', 'Level', 'Mine']);

    // One property cannot be given two names: the choice made last takes it.
    const row2 = choiceOf('row')!;
    row2.value = 'Sequence';
    row2.dispatchEvent(new Event('change'));
    order.value = 'Sequence';
    order.dispatchEvent(new Event('change'));
    expect(row2.value).toBe('');
    expect(writes()).toEqual([]);

    byId('prepare')!.click();
    await until(() => expect(navigated).toHaveLength(1));
    const target = `${local}?theme=dark&store=${hex(database.id)}`;
    expect(navigated).toEqual([target]);
    expect(notion().blocks(diagram.id)[0]).toMatchObject({ id: embed, embed: { url: target } });
    expect(kept.length).toBe(0);
    expect(byId('store-address')).toBeNull();
    expect(message()).toBe('');

    const now = notion().properties(database.dataSourceId) as Record<string, { id: string }>;
    expect(now.Order.id).toBe(sequence);
    expect(Object.keys(now).sort()).toEqual(['Level', 'Mine', ...schema.properties.map((property) => property.name)].sort());
    expect(notion().rows(database.dataSourceId)).toMatchObject([{ id: row, in_trash: false, properties: { Order: { number: 3 } } }]);
    expect(writes().filter((request) => request.includes('/data_sources/'))).toHaveLength(1);
    // The internal properties are hidden in the view of the database.
    const [view] = notion().views(database.dataSourceId) as { configuration: { properties: { property_name: string; visible: boolean }[] } }[];
    expect(view.configuration.properties.filter((each) => !each.visible).map((each) => each.property_name)).toEqual(expect.arrayContaining(['Order', 'row', 'width', 'height']));
  }, 30000);

  it('that is a store already is asked nothing, and where no embed block is found the page of the store shows the address to copy', async () => {
    keepToken();
    const { database } = entry('Coal');
    await prepared(database);
    await open();
    await choose('Coal - Data');
    await until(() => expect(navigated).toHaveLength(1));
    const target = `${local}?store=${hex(database.id)}`;
    expect(navigated).toEqual([target]);
    expect(byId('properties')).toBeNull();
    expect(writes()).toEqual([]);
    expect(kept.length).toBe(1);

    // The page the navigation leads to.
    pages.forEach((each) => each?.close());
    document.body.replaceChildren();
    const page = await open(`?store=${hex(database.id)}`);
    expect(page?.database).toBe(hex(database.id));
    const field = byId('store-address') as HTMLInputElement;
    expect(field.value).toBe(target);
    expect(field.readOnly).toBe(true);
    expect(field.closest('.adp-bar')).not.toBeNull();
    expect(field.closest('.adp-store-address')!.textContent).toContain('No embed block of this add-on that names no database was found');
    expect(message()).toBe('');
    byId('copy-store-address')!.click();
    await until(() => expect(byId('copy-store-address')!.textContent).toBe('Copied'));
    expect(copied).toEqual([target]);
    // Carried once: the next opening of the page shows no address.
    expect(kept.length).toBe(0);
    [...document.querySelectorAll<HTMLButtonElement>('.adp-store-address button')].find((button) => button.textContent === 'Done')!.click();
    expect(byId('store-address')).toBeNull();
  }, 30000);

  it('on no page has its reason in the message of the page of the store, with the address', async () => {
    keepToken();
    const database = await prepared(notion().createDatabase({ title: 'At the top' }));
    await open();
    await choose('At the top');
    await until(() => expect(navigated).toHaveLength(1));
    pages.forEach((each) => each?.close());
    document.body.replaceChildren();
    await open(`?store=${database.id}`);
    expect(message()).toMatch(/^The database is on no page/);
    expect((byId('store-address') as HTMLInputElement).value).toBe(`${local}?store=${hex(database.id)}`);
  }, 30000);

  it('shows the address where it is, with the way on, when the browser keeps nothing for the page of the store', async () => {
    keepToken();
    const { page, database } = entry('Coal');
    await prepared(database);
    notion().addBlock(page.id, { embed: local });
    notion().addBlock(page.id, { embed: `${local}?theme=light` });
    await open('', { kept: createMemoryStorage(true) });
    await choose('Coal - Data');
    await until(() => expect(byId('store-address')).not.toBeNull());
    const target = `${local}?store=${hex(database.id)}`;
    expect((byId('store-address') as HTMLInputElement).value).toBe(target);
    expect(document.querySelector('.adp-selection')!.textContent).toContain('2 embed blocks of this add-on that name no database were found');
    expect(document.querySelector<HTMLAnchorElement>('.adp-selection a')!.href).toBe(target);
    expect(navigated).toEqual([]);
    expect(writes()).toEqual([]);
    byId('copy-store-address')!.click();
    await until(() => expect(copied).toEqual([target]));
  }, 30000);

  it('that the person may not change is not prepared, and the page says so', async () => {
    keepToken();
    entry('Coal');
    notion().denyWrites(notion().me);
    await open();
    await choose('Coal - Data');
    await until(() => expect(byId('prepare')).not.toBeNull());
    byId('prepare')!.click();
    await until(() => expect(message()).toBe('You may not change this database, so it cannot be prepared from here. Ask somebody who may.'));
    expect(navigated).toEqual([]);
    expect(byId('properties')).not.toBeNull();
  }, 30000);

  it('that holds a property with another type says so, and another can be chosen', async () => {
    keepToken();
    notion().createDatabase({ title: 'Wrong', properties: { Name: { title: {} }, Order: { rich_text: {} } } });
    await open();
    await choose('Wrong');
    await until(() => expect(document.querySelector('.adp-selection')!.textContent).toContain('The property `Order` of the database is rich text'));
    [...document.querySelectorAll<HTMLButtonElement>('.adp-selection button')].find((button) => button.textContent === 'Choose another database')!.click();
    await until(() => expect(titles()).toEqual(['Wrong']));
  }, 30000);
});

describe('selecting.css', () => {
  it('has only classes that begin with adp-, each one the selection writes', () => {
    const css = readFileSync('src/frame/parts/selecting.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))];
    expect(classes.filter((name) => !name.startsWith('adp-'))).toEqual([]);
    const written = readFileSync('src/frame/parts/selecting.ts', 'utf8') + readFileSync('src/frame/parts/notices.ts', 'utf8') + readFileSync('src/frame/main.ts', 'utf8');
    expect(classes.filter((name) => !written.includes(name))).toEqual([]);
  });
});
