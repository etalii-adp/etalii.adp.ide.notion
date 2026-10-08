import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/frame/parts/undoRedo';
import { createPage, createRegions, handOver, type Page, type PageState, type Regions } from '../../src/frame/page';
import type { OpenDocument } from '../../src/store/document';
import type { NotionCalls } from '../../src/store/notion';
import type { Session } from '../../src/store/session';
import { tool } from '../disl/tool';
import { openExample, type OpenExample } from '../support/openExample';

// Undo and redo on the page (etalii.adp spec 012, contracts/addon-address.md, "Keys"; FR-023,
// FR-025), with a document of the in-memory Notion behind it.

const { specification, metamodel, persistence, expressions, binding } = tool();
const fbl = { version: '0.1', bindings: new Map([[binding.name, binding]]) };

let regions: Regions;
let page: Page;
let example: OpenExample;
let cleanUp: () => void;

const byId = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
const nameOf = (id = example.document.model.elements[0].id) => example.document.model.elements.find((element) => element.id === id)?.attributes.name;
const rename = (name: string) => example.apply({ kind: 'set', id: example.document.model.elements[0].id, attributes: { name } });
const enabled = () => [!byId('undo')!.disabled, !byId('redo')!.disabled];
const shown = (...wanted: boolean[]) => vi.waitFor(() => expect(enabled()).toEqual(wanted));

interface Keys { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
/** Presses a key with the focus on `target`; answers whether the page took it. */
function press(key: string, keys: Keys, target: Element = regions.canvas): boolean {
  const event = new KeyboardEvent('keydown', { key, ...keys, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function open(state: PageState = 'ready', held: OpenDocument = example.document): void {
  page.open(held);
  page.setState(state);
}

beforeEach(async () => {
  document.body.replaceChildren();
  document.body.dataset.state = 'loading';
  regions = createRegions(document);
  document.body.append(regions.bar, regions.toolbox, regions.canvas, regions.propertyGrid, regions.findings, regions.message);
  example = await openExample('electric-vehicles');
  page = createPage({
    addon: 'gartner-hype-cycle-graph', database: example.database.id,
    specification, metamodel, persistence, expressions, fbl, binding, findings: [],
    regions, session: {} as Session, notion: {} as NotionCalls,
  });
  cleanUp = handOver(page);
});

afterEach(() => cleanUp());

describe('the two buttons', () => {
  it('are in the bar of a page that is ready, each with an accessible name, and disabled while there is nothing to take', async () => {
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
    open();
    const [undo, redo] = [byId('undo')!, byId('redo')!];
    expect([regions.bar.contains(undo), regions.bar.contains(redo)]).toEqual([true, true]);
    expect([undo.type, redo.type]).toEqual(['button', 'button']);
    expect([undo.getAttribute('aria-label'), redo.getAttribute('aria-label')]).toEqual(['Undo the last edit', 'Redo the last undone edit']);
    expect(enabled()).toEqual([false, false]);
    expect([...undo.classList, ...redo.classList].filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });

  it('are enabled as the history says, and do what they say', async () => {
    open();
    const was = nameOf();
    await rename('Changed');
    await shown(true, false);

    byId('undo')!.click();
    expect(nameOf()).toBe(was);
    await shown(false, true);

    byId('redo')!.click();
    expect(nameOf()).toBe('Changed');
    await shown(true, false);
    await example.settled();
    expect((await example.reopen()).model.elements[0].attributes.name).toBe('Changed');
  });

  it('lose what could be redone to a new edit', async () => {
    open();
    await rename('One');
    byId('undo')!.click();
    await shown(false, true);
    await rename('Two');
    await shown(true, false);
  });

  it('are disabled again once the store is read again', async () => {
    open();
    await rename('Changed');
    await shown(true, false);
    await example.document.reload();
    await shown(false, false);
  });
});

describe('the keys, with the focus inside the page', () => {
  it('CTRL+Z undoes, CTRL+Y and CTRL+SHIFT+Z redo', async () => {
    open();
    const was = nameOf();
    await rename('Changed');

    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(nameOf()).toBe(was);
    expect(press('y', { ctrlKey: true })).toBe(true);
    expect(nameOf()).toBe('Changed');
    expect(press('z', { ctrlKey: true }, document.body)).toBe(true);
    expect(nameOf()).toBe(was);
    // With SHIFT held the key arrives as a capital.
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(nameOf()).toBe('Changed');
    await shown(true, false);
  });

  it('Command+Z undoes and Shift+Command+Z redoes', async () => {
    open();
    const was = nameOf();
    await rename('Changed');

    expect(press('z', { metaKey: true })).toBe(true);
    expect(nameOf()).toBe(was);
    expect(press('Z', { metaKey: true, shiftKey: true })).toBe(true);
    expect(nameOf()).toBe('Changed');
  });

  it('change and show nothing when there is nothing to take', async () => {
    open();
    const before = example.contents();
    const told = example.events.length;
    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    press('Z', { ctrlKey: true, shiftKey: true });
    byId('undo')!.click();
    byId('redo')!.click();
    await example.settled();
    expect(example.events).toHaveLength(told);
    expect(example.contents()).toEqual(before);
    expect(regions.message.textContent).toBe('');
    expect(enabled()).toEqual([false, false]);
  });

  it('are another key with ALT, or without CTRL or Command', async () => {
    open();
    await rename('Changed');
    expect(press('z', {})).toBe(false);
    expect(press('z', { ctrlKey: true, altKey: true })).toBe(false);
    expect(press('y', { metaKey: true })).toBe(false);
    expect(nameOf()).toBe('Changed');
  });

  it('are left to a text input or a textarea of the page, which undoes its own typing', async () => {
    open();
    await rename('Changed');
    for (const tag of ['input', 'textarea']) {
      const field = document.createElement(tag);
      regions.propertyGrid.append(field);
      expect(press('z', { ctrlKey: true }, field)).toBe(false);
      expect(press('y', { ctrlKey: true }, field)).toBe(false);
    }
    expect(nameOf()).toBe('Changed');
  });
});

describe('a refusal', () => {
  it('is shown in the message, and taken back by the next step that is taken', async () => {
    let refuse = true;
    const held = {
      state: 'ready', canUndo: true, canRedo: true,
      undo: () => (refuse ? { done: false, sentence: 'The database is being read, so nothing can be changed for a moment.' } : { done: true }),
      redo: () => ({ done: true }),
      subscribe: () => () => undefined,
    } as unknown as OpenDocument;
    open('ready', held);
    byId('undo')!.click();
    expect(regions.message.textContent).toBe('The database is being read, so nothing can be changed for a moment.');
    refuse = false;
    press('z', { ctrlKey: true });
    expect(regions.message.textContent).toBe('');
  });
});

describe('a page that cannot be edited', () => {
  it.each(['read-only', 'unreadable', 'unprepared', 'loading', 'connect'] as const)('has neither button in the state %s, and takes no key', async (state) => {
    await rename('Changed');
    open(state);
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
    expect(press('z', { ctrlKey: true })).toBe(false);
    expect(nameOf()).toBe('Changed');
  });

  it('has neither button without a document, and loses them when the state changes or the document is closed', async () => {
    page.setState('ready');
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
    page.open(example.document);
    expect(byId('undo')).not.toBeNull();
    page.setState('read-only');
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
    page.setState('ready');
    expect(byId('redo')).not.toBeNull();
    page.open(undefined);
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
  });

  it('has neither button once the part is detached', async () => {
    open();
    cleanUp();
    expect([byId('undo'), byId('redo')]).toEqual([null, null]);
    expect(press('z', { ctrlKey: true })).toBe(false);
  });
});
