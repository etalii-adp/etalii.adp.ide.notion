// The entry of an add-on's page (etalii.adp spec 012, contracts/addon-address.md). The build's
// generated entry imports every module under src/frame/parts/ and then calls `start`.

import { createExpressions } from '../disl/expressions';
import { interpretMetamodel } from '../disl/metamodel';
import { bindingOf, interpretPersistence } from '../disl/persistence';
import { localized, loadSpecification, type Specification } from '../disl/specification';
import { unsupportedFeatures } from '../disl/support';
import { loadDocument } from '../fbl/documents/documentLoader';
import { createNotionCalls } from '../store/notion';
import { createSession, type SessionOptions } from '../store/session';
import { serviceAddress } from './config';
import { createPage, createRegions, handOver, showMessage, showStatus, type Page } from './page';

export interface Environment {
  document: Document;
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hostname'>;
  fetch: typeof fetch;
  /** Where the session keeps the token; the browser's local storage when left out. */
  storage?: SessionOptions['storage'];
  /** Absent where the browser has none: the appearance is then light. */
  matchMedia?: (query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener'>;
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
    'Share the database with the connection of this add-on, under Connections in the menu of the database.',
    'Copy the id of the database: the 32 characters of its Notion address before "?v=".',
    `On a Notion page, add an embed block with the address ${location.origin}${location.pathname}?store= followed by that id.`,
    'Open that page and grant access to Notion once, when the add-on asks for it.',
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
  if (!database) {
    // No store: nothing is opened, so there is no session, no call and no part at work.
    document.body.insertBefore(setUpHelp(environment, tool?.specification), regions.message);
    return failure ? fail(failure) : undefined;
  }
  if (!tool) return fail(failure);

  let calls: Pick<Page, 'session' | 'notion'>;
  try {
    const service = serviceAddress(location);
    const session = createSession({ service, storage: environment.storage, fetch: environment.fetch });
    calls = { session, notion: createNotionCalls({ service, session, fetch: environment.fetch }) };
  } catch {
    // The session refuses an address that is none: the service is not deployed for this host.
    return fail('The add-on cannot reach Notion: it has no service to ask yet.');
  }
  const page = createPage({ addon, database, ...tool, regions, ...calls });
  handOver(page);
  return page;
}
