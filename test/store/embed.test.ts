import { describe, expect, it } from 'vitest';
import { namesNoStore, nameStore, withStore } from '../../src/store/embed';
import { createMemoryCalls } from '../support/memoryCalls';

// Making the embed block name the store that was selected (etalii.adp spec 012, FR-033).

const own = 'https://etalii.net/adp-notion/an-addon/';
const store = '11111111111141118111111111111111';

describe('an address that names no store', () => {
  it.each([
    own,
    'https://etalii.net/adp-notion/an-addon',
    `${own}?theme=dark`,
    `${own}?store=`,
    `${own}?v=1&store=%20`,
    `${own}#top`,
  ])('is %s', (address) => {
    expect(namesNoStore(address, own)).toBe(true);
    expect(namesNoStore(address, `${own}?theme=light`)).toBe(true);
  });

  it.each([
    `${own}?store=${store}`,
    `${own}?theme=dark&store=x`,
    'https://etalii.net/adp-notion/another-addon/',
    'https://etalii.net/adp-notion/',
    'https://example.org/adp-notion/an-addon/',
    'http://etalii.net/adp-notion/an-addon/',
    'not an address',
    '',
  ])('is not %s', (address) => {
    expect(namesNoStore(address, own)).toBe(false);
  });

  it('is given its store beside the parameters it has', () => {
    expect(withStore(own, store)).toBe(`${own}?store=${store}`);
    expect(withStore(`${own}?theme=dark`, store)).toBe(`${own}?theme=dark&store=${store}`);
    expect(withStore(`${own}?store=&theme=dark`, store)).toBe(`${own}?store=${store}&theme=dark`);
  });
});

describe('the embed block of a selected store', () => {
  function entry() {
    const memory = createMemoryCalls();
    const page = memory.notion.createPage({ title: 'An entry' });
    const diagram = memory.notion.createPage({ title: 'Diagram', parent: page.id });
    const database = memory.notion.createDatabase({ title: 'An entry - Data', parent: page.id });
    const name = () => nameStore(memory.calls, database.id, own, store);
    const address = (pageId: string, index: number) => (memory.notion.blocks(pageId)[index] as { embed: { url: string } }).embed.url;
    const writes = () => memory.service.requests.filter((request) => request.startsWith('PATCH'));
    return { ...memory, page, diagram, database, name, address, writes };
  }

  it('is set when it is the one on a page directly under the page of the database, and keeps its other parameters', async () => {
    const { notion, diagram, name, address, writes } = entry();
    notion.addBlock(diagram.id);
    notion.addBlock(diagram.id, { embed: `${own}?theme=dark` });
    expect(await name()).toEqual({ set: true });
    expect(address(diagram.id, 1)).toBe(`${own}?theme=dark&store=${store}`);
    expect(writes()).toHaveLength(1);
  });

  it('is set when it is the one on the page of the database itself, behind more blocks than one answer holds', async () => {
    const { notion, page, name, address, service } = entry();
    for (let count = 0; count < 120; count++) notion.addBlock(page.id);
    notion.addBlock(page.id, { embed: own });
    expect(await name()).toEqual({ set: true });
    expect(address(page.id, 122)).toBe(`${own}?store=${store}`);
    expect(service.requests.filter((request) => request === `GET /notion/v1/blocks/${page.id}/children`)).toHaveLength(2);
  });

  it('is not looked for among the blocks that name a store, that are another add-on\'s, or that are deeper', async () => {
    const { notion, page, diagram, name, writes } = entry();
    const deeper = notion.createPage({ parent: diagram.id });
    notion.addBlock(deeper.id, { embed: own });
    notion.addBlock(page.id, { embed: `${own}?store=22222222222242228222222222222222` });
    notion.addBlock(diagram.id, { embed: 'https://etalii.net/adp-notion/another-addon/' });
    expect(await name()).toEqual({ set: false, refused: false, sentence: expect.stringMatching(/^No embed block of this add-on that names no database was found/) });
    expect(writes()).toEqual([]);
  });

  it('is not set when there are several, and none of them is changed', async () => {
    const { notion, page, diagram, name, address, writes } = entry();
    notion.addBlock(page.id, { embed: own });
    notion.addBlock(diagram.id, { embed: own });
    expect(await name()).toEqual({ set: false, refused: false, sentence: '2 embed blocks of this add-on that name no database were found, so none of them was changed.' });
    expect(address(diagram.id, 0)).toBe(own);
    expect(writes()).toEqual([]);
  });

  it('cannot be looked for when the database is on no page', async () => {
    const memory = createMemoryCalls();
    const database = memory.notion.createDatabase();
    expect(await nameStore(memory.calls, database.id, own, store)).toEqual({ set: false, refused: true, sentence: expect.stringMatching(/^The database is on no page/) });
    expect(memory.service.requests.filter((request) => request.includes('/blocks/'))).toEqual([]);
  });

  it('is not set when Notion does not show the page, or refuses the change', async () => {
    const memory = createMemoryCalls();
    const unshared = memory.notion.createPage({ shared: false });
    const database = memory.notion.createDatabase({ parent: unshared.id });
    expect(await nameStore(memory.calls, database.id, own, store)).toMatchObject({ set: false, refused: true, sentence: expect.stringMatching(/^The embed block of this add-on could not be found or changed: Could not find/) });

    const { notion, page, name, address } = entry();
    notion.addBlock(page.id, { embed: own });
    notion.denyWrites(notion.me);
    expect(await name()).toMatchObject({ set: false, refused: true, sentence: expect.stringMatching(/could not be found or changed: Insufficient permissions/) });
    expect(address(page.id, 2)).toBe(own);
  });
});
