import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPage, createRegions, handOver, onPage, type Page, type PageEvents, type Regions } from '../../src/frame/page';
import type { OpenDocument } from '../../src/store/document';
import type { NotionCalls } from '../../src/store/notion';
import type { Session } from '../../src/store/session';
import { tool } from '../disl/tool';

const { specification, metamodel, persistence, expressions, binding } = tool();
const fbl = { version: '0.1', bindings: new Map([[binding.name, binding]]) };

let regions: Regions;
let detach: (() => void)[];

function page(): Page {
  return createPage({
    addon: 'gartner-hype-cycle-graph', database: '3f2be2fd05b680f5bfe1d89398eabb4e',
    specification, metamodel, persistence, expressions, fbl, binding, findings: [],
    regions, session: {} as Session, notion: {} as NotionCalls,
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
  regions = createRegions(document);
  document.body.append(regions.bar, regions.toolbox, regions.canvas, regions.propertyGrid, regions.findings, regions.message);
  detach = [];
});

afterEach(() => detach.forEach((stop) => stop()));

describe('the regions', () => {
  it('carry the identifiers of the address contract', () => {
    expect(document.getElementById('canvas')).toBe(regions.canvas);
    expect(regions.canvas.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(regions.canvas.getAttribute('tabindex')).toBe('0');
    expect(document.getElementById('toolbox')).toBe(regions.toolbox);
    expect(document.getElementById('property-grid')).toBe(regions.propertyGrid);
    expect(document.getElementById('findings')).toBe(regions.findings);
    expect(regions.findings.children).toHaveLength(0);
    expect(document.getElementById('status')).toBe(regions.status);
    expect(regions.bar.contains(regions.status)).toBe(true);
    expect(regions.status.dataset.status).toBe('loading');
    expect(document.getElementById('message')).toBe(regions.message);
    expect(regions.message.getAttribute('role')).toBe('alert');
    expect(regions.message.textContent).toBe('');
  });

  it('have classes that begin with adp-', () => {
    const classes = [...document.body.querySelectorAll('*')].flatMap((element) => [...element.classList]);
    expect(classes.length).toBeGreaterThanOrEqual(7);
    expect(classes.filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });
});

describe('the page', () => {
  it('holds what the entry loaded', () => {
    const made = page();
    expect(made.addon).toBe('gartner-hype-cycle-graph');
    expect(made.database).toBe('3f2be2fd05b680f5bfe1d89398eabb4e');
    expect(made.specification).toBe(specification);
    expect(made.fbl.bindings.get(binding.name)).toBe(made.binding);
    expect(made.regions).toBe(regions);
  });

  it('keeps the one state, on <body>', () => {
    const made = page();
    const told: string[] = [];
    made.on('state', (state) => told.push(state));
    expect(made.state).toBe('loading');
    made.setState('ready');
    made.setState('ready');
    made.setState('read-only');
    expect(document.body.dataset.state).toBe('read-only');
    expect(made.state).toBe('read-only');
    expect(told).toEqual(['ready', 'read-only']);
  });

  it('shows the status in data-status', () => {
    const made = page();
    const told: string[] = [];
    made.on('status', (status) => told.push(status));
    made.setStatus('storing');
    expect(regions.status.dataset.status).toBe('storing');
    made.setStatus('idle');
    expect(regions.status.dataset.status).toBe('idle');
    expect(regions.status.textContent).toBe('');
    expect(told).toEqual(['storing', 'idle']);
  });

  it('shows and clears the message', () => {
    const made = page();
    const told: string[] = [];
    made.on('message', (sentence) => told.push(sentence));
    made.say('Somebody else changed the store.');
    expect(regions.message.textContent).toBe('Somebody else changed the store.');
    expect(made.message).toBe('Somebody else changed the store.');
    made.clearMessage();
    expect(regions.message.textContent).toBe('');
    expect(told).toEqual(['Somebody else changed the store.', '']);
  });

  it('tells a change of the selection, and no change that is none', () => {
    const made = page();
    const told: (readonly string[])[] = [];
    made.on('selection', (ids) => told.push(ids));
    const ids = ['a', 'b'];
    made.select(ids);
    made.select(['a', 'b']);
    ids.push('c');
    expect(made.selection).toEqual(['a', 'b']);
    made.select([]);
    expect(told).toEqual([['a', 'b'], []]);
  });

  it('tells when the open document is set', () => {
    const made = page();
    const told: (OpenDocument | undefined)[] = [];
    made.on('document', (open) => told.push(open));
    const open = { state: 'ready' } as OpenDocument;
    expect(made.document).toBeUndefined();
    made.open(open);
    expect(made.document).toBe(open);
    made.open(undefined);
    expect(told).toEqual([open, undefined]);
  });

  it('stops telling a listener that unsubscribed', () => {
    const made = page();
    const told: string[] = [];
    const stop = made.on('state', (state) => told.push(state));
    made.setState('connect');
    stop();
    made.setState('ready');
    expect(told).toEqual(['connect']);
  });
});

describe('onPage', () => {
  // Two parts: one opens the document and says so, the other hears it. Whichever is attached
  // first, the other hears the same.
  function parts(heard: Partial<PageEvents>[]) {
    const open = { state: 'ready' } as OpenDocument;
    const opener = (made: Page) => {
      made.open(open);
      made.setState('ready');
      made.select(['a']);
    };
    const hearer = (made: Page) => {
      made.on('document', (document) => heard.push({ document }));
      made.on('state', (state) => heard.push({ state }));
      made.on('selection', (selection) => heard.push({ selection }));
    };
    return { open, opener, hearer };
  }

  it.each(['opener first', 'hearer first'])('tells every part the same, with the %s', (order) => {
    const heard: Partial<PageEvents>[] = [];
    const { open, opener, hearer } = parts(heard);
    for (const part of order === 'opener first' ? [opener, hearer] : [hearer, opener]) detach.push(onPage(part));
    const made = page();
    detach.push(handOver(made));
    expect(heard).toEqual([{ document: open }, { state: 'ready' }, { selection: ['a'] }]);
    expect(made.document).toBe(open);
  });

  it('gives the page at once to a part that attaches after it was handed over', () => {
    const made = page();
    detach.push(handOver(made));
    made.setState('ready');
    let given: Page | undefined;
    detach.push(onPage((late) => void (given = late)));
    expect(given).toBe(made);
    expect(given?.state).toBe('ready');
  });

  it('runs the clean-up a part answered, once', () => {
    let cleaned = 0;
    detach.push(onPage(() => () => void cleaned++));
    const cleanUp = handOver(page());
    expect(cleaned).toBe(0);
    cleanUp();
    cleanUp();
    expect(cleaned).toBe(1);
  });

  it('cleans every part up when the page is closed, and gives it to no part afterwards', () => {
    let cleaned = 0;
    let given = 0;
    detach.push(onPage(() => () => void cleaned++));
    const made = page();
    handOver(made);
    made.close();
    made.close();
    detach.push(onPage(() => void given++));
    expect(cleaned).toBe(1);
    expect(given).toBe(0);
  });

  it('gives no page to a part that detached itself', () => {
    let given = 0;
    onPage(() => void given++)();
    detach.push(handOver(page()));
    expect(given).toBe(0);
  });
});
