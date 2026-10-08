// The page a part of the frame is given, and `onPage`, by which a module under src/frame/parts/
// attaches itself (etalii.adp spec 012, contracts/shared-parts.md and contracts/addon-address.md).

import type { Expressions } from '../disl/expressions';
import type { Metamodel } from '../disl/metamodel';
import type { Finding } from '../disl/model';
import type { InterpretedPersistence } from '../disl/persistence';
import type { Specification } from '../disl/specification';
import type { FblBinding, FblDocument } from '../fbl/documents/types';
import type { OpenDocument } from '../store/document';
import type { NotionCalls } from '../store/notion';
import type { Session } from '../store/session';

export type PageState = 'loading' | 'setup' | 'connect' | 'unshared' | 'unprepared' | 'ready' | 'read-only' | 'unreadable';
export type PageStatus = 'idle' | 'loading' | 'storing' | 'offline' | 'failed';

/** The regions of the page, with the identifiers of the address contract. */
export interface Regions {
  /** On top: undo, redo and what else a part puts there. It holds `status`. */
  readonly bar: HTMLElement;
  /** `id="canvas"` */
  readonly canvas: SVGSVGElement;
  /** `id="toolbox"` */
  readonly toolbox: HTMLElement;
  /** `id="property-grid"` */
  readonly propertyGrid: HTMLElement;
  /** `id="findings"`, a list */
  readonly findings: HTMLElement;
  /** `id="status"` */
  readonly status: HTMLElement;
  /** `id="message"` */
  readonly message: HTMLElement;
}

/** What a listener of each event is told: the new value. */
export interface PageEvents {
  state: PageState;
  status: PageStatus;
  /** The ids of the selected elements. */
  selection: readonly string[];
  /** The sentence shown, or '' when it was cleared. */
  message: string;
  /** The open document, or undefined when it was closed. */
  document: OpenDocument | undefined;
}

export interface Page {
  /** The add-on id: the name of the folder the page is served from. */
  readonly addon: string;
  /** The `store` of the address: the id of the Notion database. */
  readonly database: string;
  readonly specification: Specification;
  readonly metamodel: Metamodel;
  readonly persistence: InterpretedPersistence;
  readonly expressions: Expressions;
  /** The FBL document, as `openDocument` takes it. */
  readonly fbl: FblDocument;
  /** The binding of `fbl` that the specification names. */
  readonly binding: FblBinding;
  /** What loading and interpreting the specification found. */
  readonly findings: readonly Finding[];
  readonly regions: Regions;
  readonly session: Session;
  readonly notion: NotionCalls;

  readonly state: PageState;
  readonly status: PageStatus;
  readonly selection: readonly string[];
  readonly message: string;
  /** Set by the part that opens it; undefined until then. */
  readonly document: OpenDocument | undefined;

  /** Writes `data-state` on `<body>`. */
  setState(state: PageState): void;
  /** Writes `data-status` on `id="status"`. */
  setStatus(status: PageStatus): void;
  select(ids: readonly string[]): void;
  /** Shows a refusal or a failure in `id="message"`. */
  say(sentence: string): void;
  clearMessage(): void;
  open(document: OpenDocument | undefined): void;
  /** Hears an event; answers what stops it. */
  on<E extends keyof PageEvents>(event: E, listener: (value: PageEvents[E]) => void): () => void;
  /** Cleans every part up and lets the page go: a part attached afterwards is not given it. */
  close(): void;
}

export type PageOptions = Pick<
  Page,
  'addon' | 'database' | 'specification' | 'metamodel' | 'persistence' | 'expressions' | 'fbl' | 'binding' | 'findings' | 'regions' | 'session' | 'notion'
>;

const SVG = 'http://www.w3.org/2000/svg';

const statusText: Record<PageStatus, string> = { idle: '', loading: 'Loading', storing: 'Storing', offline: 'Offline', failed: 'Failed' };

/** Makes the regions, in no document yet: the entry lays them out. */
export function createRegions(document: Document): Regions {
  const element = (tag: string, id: string): HTMLElement => {
    const made = document.createElement(tag);
    made.id = id;
    made.className = `adp-${id}`;
    return made;
  };
  const bar = document.createElement('div');
  bar.className = 'adp-bar';
  const canvas = document.createElementNS(SVG, 'svg');
  canvas.id = 'canvas';
  canvas.setAttribute('class', 'adp-canvas');
  canvas.setAttribute('tabindex', '0');
  const status = element('span', 'status');
  status.setAttribute('role', 'status');
  bar.append(status);
  const message = element('p', 'message');
  message.setAttribute('role', 'alert');
  const regions = { bar, canvas, toolbox: element('section', 'toolbox'), propertyGrid: element('section', 'property-grid'), findings: element('ul', 'findings'), status, message };
  showStatus(status, 'loading');
  return regions;
}

/** Shows a status in `id="status"`; the entry uses it before there is a page. */
export function showStatus(element: HTMLElement, status: PageStatus): void {
  element.dataset.status = status;
  element.textContent = statusText[status];
}

/** Shows a sentence in `id="message"`; the entry uses it before there is a page. */
export function showMessage(element: HTMLElement, sentence: string): void {
  element.textContent = sentence;
}

// While a page is handed to its parts, what it has to tell is kept until every part listens.
const held = new WeakMap<Page, { hold(): void; release(): void; closing(cleanUp: () => void): void }>();

const same = (one: readonly string[], other: readonly string[]): boolean => one.length === other.length && one.every((id, index) => id === other[index]);

export function createPage(options: PageOptions): Page {
  const body = options.regions.canvas.ownerDocument.body;
  const listeners: { [E in keyof PageEvents]: Set<(value: PageEvents[E]) => void> } = {
    state: new Set(), status: new Set(), selection: new Set(), message: new Set(), document: new Set(),
  };
  let waiting: (() => void)[] | undefined;
  let state = (body.dataset.state as PageState | undefined) ?? 'loading';
  let status = (options.regions.status.dataset.status as PageStatus | undefined) ?? 'loading';
  let selection: readonly string[] = [];
  let message = options.regions.message.textContent ?? '';
  let open: OpenDocument | undefined;
  let cleanUps: (() => void)[] = [];

  function tell<E extends keyof PageEvents>(event: E, value: PageEvents[E]): void {
    // A copy: a listener may stop listening, or another may start, while they are told.
    const now = (): void => [...listeners[event]].forEach((listener) => listener(value));
    if (waiting) waiting.push(now);
    else now();
  }

  const page: Page = {
    ...options,
    get state() { return state; },
    get status() { return status; },
    get selection() { return selection; },
    get message() { return message; },
    get document() { return open; },
    setState(next) {
      if (next === state) return;
      state = next;
      body.dataset.state = next;
      tell('state', next);
    },
    setStatus(next) {
      if (next === status) return;
      status = next;
      showStatus(options.regions.status, next);
      tell('status', next);
    },
    select(ids) {
      if (same(ids, selection)) return;
      selection = [...ids];
      tell('selection', selection);
    },
    say(sentence) {
      if (sentence === message) return;
      message = sentence;
      showMessage(options.regions.message, sentence);
      tell('message', sentence);
    },
    clearMessage() {
      page.say('');
    },
    open(document) {
      if (document === open) return;
      open = document;
      tell('document', document);
    },
    on(event, listener) {
      listeners[event].add(listener);
      return () => void listeners[event].delete(listener);
    },
    close() {
      const mine = cleanUps;
      cleanUps = [];
      mine.forEach((cleanUp) => cleanUp());
    },
  };
  body.dataset.state = state;
  held.set(page, {
    hold: () => void (waiting ??= []),
    release() {
      const told = waiting ?? [];
      waiting = undefined;
      told.forEach((now) => now());
    },
    closing: (cleanUp) => void cleanUps.push(cleanUp),
  });
  return page;
}

/** What a part does with the page. It may answer its clean-up. */
export type Attach = (page: Page) => void | (() => void);

const parts = new Set<Attach>();
let handed: { readonly page: Page; readonly cleanUps: Map<Attach, () => void> } | undefined;

function attachTo(target: NonNullable<typeof handed>, attach: Attach): void {
  const cleanUp = attach(target.page);
  if (cleanUp) target.cleanUps.set(attach, cleanUp);
}

/**
 * Attaches a part, at the time its module is imported. A part reads what the page holds when it
 * is attached and hears the rest as events, so that no part depends on which was attached first:
 * a part attached after the page was handed over is given it at once. Answers what detaches it.
 */
export function onPage(attach: Attach): () => void {
  parts.add(attach);
  if (handed) attachTo(handed, attach);
  return () => {
    parts.delete(attach);
    handed?.cleanUps.get(attach)?.();
    handed?.cleanUps.delete(attach);
  };
}

/**
 * Hands the page to every part. What a part makes the page tell while the others are still being
 * attached is told when all of them listen. Answers what cleans every part up.
 */
export function handOver(page: Page): () => void {
  handed?.cleanUps.forEach((cleanUp) => cleanUp());
  const mine = { page, cleanUps: new Map<Attach, () => void>() };
  handed = mine;
  const events = held.get(page);
  events?.hold();
  try {
    for (const attach of [...parts]) attachTo(mine, attach);
  } finally {
    events?.release();
  }
  const cleanUp = (): void => {
    mine.cleanUps.forEach((cleanUp) => cleanUp());
    mine.cleanUps.clear();
    if (handed === mine) handed = undefined;
  };
  events?.closing(cleanUp);
  return cleanUp;
}
