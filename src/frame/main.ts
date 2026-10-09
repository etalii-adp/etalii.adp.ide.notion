// The entry of an add-on's page (etalii.adp spec 012, contracts/addon-address.md). The build's
// generated entry imports every module under src/frame/parts/ and then calls `start`.

import { createExpressions } from '../disl/expressions';
import { interpretMetamodel } from '../disl/metamodel';
import { bindingOf, interpretPersistence } from '../disl/persistence';
import { localized, loadSpecification, type Specification } from '../disl/specification';
import { unsupportedFeatures } from '../disl/support';
import { loadDocument } from '../fbl/documents/documentLoader';
import { withStore } from '../store/embed';
import { createNotionCalls } from '../store/notion';
import { createSession, type SessionOptions } from '../store/session';
import { serviceAddress } from './config';
import { createPage, createRegions, handOver, showMessage, showStatus, type Page } from './page';
import { actionButton } from './parts/notices';
import { offerSelection, storeAddressNotice, type Carried } from './parts/selecting';

export interface Environment {
  document: Document;
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hostname'>;
  fetch: typeof fetch;
  /** Where the session keeps the token; the browser's local storage when left out. */
  storage?: SessionOptions['storage'];
  /** Absent where the browser has none: the appearance is then light. */
  matchMedia?: (query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener'>;
  /** What lasts from the selection of a store to the page of that store; the browser's session storage when left out. */
  kept?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Goes to an address of this page's own; the browser's `location.replace` when left out. */
  navigate?: (address: string) => void;
  /** Puts a text on the clipboard; the browser's when left out. */
  copy?: (text: string) => Promise<void>;
}

const DATABASE = /^[0-9a-f]{32}$|^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ADDON = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// A file beside the page: the page asks for nothing outside its own folder.
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class LoadError extends Error {}

/** The folder the page is served from, with or without `index.html` behind it. */
function addonOf(pathname: string): string {
  const folders = pathname.split('/').filter((folder) => folder !== '' && folder !== 'index.html');
  const last = folders.at(-1) ?? '';
  return ADDON.test(last) ? last : '';
}

function followAppearance(environment: Environment, theme: string | null): void {
  const root = environment.document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
    return;
  }
  const dark = environment.matchMedia?.('(prefers-color-scheme: dark)');
  const show = (matches: boolean): void => void (root.dataset.theme = matches ? 'dark' : 'light');
  show(dark?.matches ?? false);
  dark?.addEventListener('change', (event) => show(event.matches));
}

async function file(send: typeof fetch, name: string): Promise<Uint8Array> {
  let answer: Response | undefined;
  try {
    answer = await send(name);
  } catch {
    // No answer and an answer that is not the file are told to the user alike.
  }
  if (!answer?.ok) throw new LoadError(`The add-on could not be loaded: ${name} cannot be read.`);
  return new Uint8Array(await answer.arrayBuffer());
}

function json(bytes: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LoadError(`The add-on could not be loaded: ${name} is not JSON.`);
  }
}

async function load(send: typeof fetch) {
  const addon = json(await file(send, 'addon.json'), 'addon.json') as { specification?: unknown; binding?: unknown } | null;
  const names = [addon?.specification, addon?.binding];
  if (!names.every((name): name is string => typeof name === 'string' && FILE.test(name))) {
    throw new LoadError('The add-on could not be loaded: addon.json does not name its specification and its binding as files beside it.');
  }
  const [specificationBytes, bindingBytes] = await Promise.all(names.map((name) => file(send, name)));

  const loaded = loadSpecification(json(specificationBytes, names[0]));
  const refused = loaded.findings.find((finding) => finding.severity === 'error');
  if (refused) throw new LoadError(`The add-on could not be loaded: ${names[0]} is not a specification this add-on reads. ${refused.message}`);
  const specification = loaded.value;
  const metamodel = interpretMetamodel(specification);
  const persistence = interpretPersistence(specification, metamodel.value);

  const document = loadDocument(bindingBytes, names[1]);
  if (!document.document) {
    throw new LoadError(`The add-on could not be loaded: ${names[1]} is not an FBL document. ${document.problems[0]?.message ?? ''}`.trim());
  }
  const binding = bindingOf(persistence.value, document.document);
  if (!binding) {
    const why = persistence.findings.find((finding) => finding.severity === 'error')?.message ?? `${names[1]} does not hold the binding the specification names.`;
    throw new LoadError(`The add-on could not be loaded: ${why}`);
  }
  const expressions = createExpressions(specification, metamodel.value);
  return {
    specification,
    metamodel: metamodel.value,
    persistence: persistence.value,
    expressions,
    fbl: document.document,
    binding,
    findings: [...loaded.findings, ...unsupportedFeatures(specification), ...metamodel.findings, ...persistence.findings, ...expressions.findings],
  };
}

const hex = (id: string): string => id.replaceAll('-', '').toLowerCase();

/** What the selection of a store left for the page of that store: read once, and only by that page. */
function carriedFor(environment: Environment, key: string, store: string): Carried | undefined {
  try {
    const kept = environment.kept ?? globalThis.sessionStorage;
    const text = kept.getItem(key);
    if (text === null) return undefined;
    kept.removeItem(key);
    const carried = JSON.parse(text) as Partial<Carried> | null;
    return carried && typeof carried.store === 'string' && hex(carried.store) === hex(store) && typeof carried.sentence === 'string' ? (carried as Carried) : undefined;
  } catch {
    // A browser that refuses the storage, or something else kept there: nothing was carried.
    return undefined;
  }
}

async function copy(text: string): Promise<void> {
  await globalThis.navigator.clipboard.writeText(text);
}

/** The steps of docs/set-up-a-graph.md in short, under the tool type's own name. */
function setUpHelp(environment: Environment, specification: Specification | undefined): HTMLElement {
  const { document, location } = environment;
  const help = document.createElement('main');
  help.className = 'adp-setup';
  const title = document.createElement('h1');
  title.textContent = (specification && localized(specification.language.label, 'en', specification.language.defaultLocale)) || document.title;
  const lead = document.createElement('p');
  lead.textContent = 'This Notion add-on shows what a Notion database holds. This address names no database yet. To set one up:';
  const steps = document.createElement('ol');
  for (const text of [
    'In Notion, create a database. It becomes the store of one diagram.',
    `On a Notion page, add an embed block with the address ${location.origin}${location.pathname} of this add-on. You are looking at it if this is that block.`,
    'Choose the database below. Notion asks once which pages this add-on may reach: include the database and its page.',
    'Agree to the properties the database gets. The add-on then makes the embed block name the database, and shows the diagram.',
    `A database can be named by hand too: the address is ${location.origin}${location.pathname}?store= followed by the 32 characters of the database's Notion address before "?v=".`,
  ]) {
    const step = document.createElement('li');
    step.textContent = text;
    steps.append(step);
  }
  help.append(title, lead, steps);
  return help;
}

/**
 * Builds the page and hands it to every part that attached itself with `onPage`. Answers the page,
 * or nothing when there is none to hand over: in the state `setup`, and when the add-on could not
 * be loaded.
 */
export async function start(given: Partial<Environment> = {}): Promise<Page | undefined> {
  const environment: Environment = {
    document: given.document ?? globalThis.document,
    location: given.location ?? globalThis.location,
    fetch: given.fetch ?? ((...request) => globalThis.fetch(...request)),
    storage: given.storage,
    matchMedia: given.matchMedia ?? (globalThis.matchMedia ? (query) => globalThis.matchMedia(query) : undefined),
    kept: given.kept,
    navigate: given.navigate,
    copy: given.copy,
  };
  const { document, location } = environment;
  const parameters = new URLSearchParams(location.search);
  const store = parameters.get('store')?.trim() ?? '';
  const database = DATABASE.test(store) ? store : undefined;
  const addon = addonOf(location.pathname);

  followAppearance(environment, parameters.get('theme'));
  document.documentElement.dataset.addon = addon;
  document.body.dataset.state = database ? 'loading' : 'setup';

  // The frame is there from the first paint; what it is of arrives with the files.
  const regions = createRegions(document);
  if (database) document.body.append(regions.bar, regions.toolbox, regions.canvas, regions.propertyGrid, regions.findings, regions.message);
  else document.body.append(regions.message);

  const fail = (sentence: string): undefined => {
    showMessage(regions.message, sentence);
    showStatus(regions.status, 'failed');
    return undefined;
  };

  let tool: Awaited<ReturnType<typeof load>> | undefined;
  let failure = '';
  try {
    tool = await load(environment.fetch);
  } catch (error) {
    if (!(error instanceof LoadError)) throw error;
    failure = error.message;
  }
  const connect = (): { session: ReturnType<typeof createSession>; notion: ReturnType<typeof createNotionCalls> } => {
    const service = serviceAddress(location);
    const session = createSession({ service, storage: environment.storage, fetch: environment.fetch });
    return { session, notion: createNotionCalls({ service, session, fetch: environment.fetch }) };
  };
  const address = `${location.origin}${location.pathname}${location.search}`;
  const carriedKey = `adp-notion.${addon}.store-address`;

  if (!database) {
    // No store: nothing is opened, so there is no session, no call and no part at work, until the person chooses a database.
    const help = setUpHelp(environment, tool?.specification);
    document.body.insertBefore(help, regions.message);
    if (!tool) return fail(failure);
    offerSelection({
      document,
      host: help,
      say: (sentence) => showMessage(regions.message, sentence),
      address,
      specification: tool.specification,
      binding: tool.fbl,
      connect,
      carry(carried) {
        try {
          (environment.kept ?? globalThis.sessionStorage).setItem(carriedKey, JSON.stringify(carried));
          return true;
        } catch {
          return false;
        }
      },
      // The one navigation the page makes: to its own address, with the store just selected.
      navigate: environment.navigate ?? ((to) => globalThis.location.replace(to)),
      copy: environment.copy ?? copy,
    });
    return undefined;
  }
  if (!tool) return fail(failure);

  // The embed block could not be made to name this store: the address is shown for the person to put there.
  const carried = carriedFor(environment, carriedKey, database);
  if (carried) {
    const notice = document.createElement('div');
    notice.className = 'adp-store-address';
    notice.setAttribute('role', 'group');
    notice.setAttribute('aria-label', 'The address of this diagram');
    const done = actionButton(document, '', 'Done', () => notice.remove());
    done.classList.add('adp-action-quiet');
    notice.append(...storeAddressNotice(document, withStore(address, hex(database)), carried.refused ? '' : carried.sentence, environment.copy ?? copy), done);
    regions.bar.append(notice);
    if (carried.refused) showMessage(regions.message, carried.sentence);
  }

  const page = createPage({ addon, database, ...tool, regions, ...connect() });
  handOver(page);
  return page;
}
