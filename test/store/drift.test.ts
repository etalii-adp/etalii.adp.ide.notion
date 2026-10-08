import { describe, expect, it } from 'vitest';
import type { DocumentEvent } from '../../src/store/document';
import { findDrift, minuteOf, type RowEdit } from '../../src/store/drift';
import type { NotionCalls, NotionQuery, NotionRow } from '../../src/store/notion';
import type { MemoryPage } from '../support/memoryNotion';
import { openExample, type OpenExample } from '../support/openExample';

const QUERY = 'POST /v1/data_sources/store/query';
const update = (title: string): string => `PATCH /v1/pages/${title}`;
// What reading the store again asks.
const READ = [expect.stringMatching(/^GET \/v1\/databases\//), 'GET /v1/data_sources/store', QUERY];

const DRIFTED = 'Somebody else changed the database, so your edit was not stored. The database was read again.';
const PARTLY = 'Your edit was stored in part. The database was read again, and the diagram shows what it holds.';
const NOT_STORED = 'Your edit could not be stored. The database was read again, and the diagram shows what it holds.';
const FORBIDDEN = 'You may not change this database, so your edit was not stored.';
const NOT_READ = 'Your edit was not stored, and the database could not be read again. Nothing can be changed until it is.';

const rowOf = (made: OpenExample, title: string): MemoryPage => made.rows().find((page) => (page.properties.id.title as { plain_text: string }[])[0]?.plain_text === title)!;
const nameOf = (made: OpenExample, id: string): unknown => made.document.model.elements.find((element) => element.id === id)?.attributes.name;
const statuses = (events: readonly DocumentEvent[]): string[] => events.map((event) => (event.kind === 'status' ? event.status : event.kind));
const rename = (id: string, name: string) => ({ kind: 'set', id, attributes: { name } }) as const;

describe('somebody else\'s change', () => {
  it('to a row since the last read stops the write, tells the user, reads the store again and empties the history', async () => {
    const made = await openExample('electric-vehicles');
    const other = made.notion.addPerson('Somebody else');
    expect(await made.apply(rename('fuel-cell-cars', 'Fuel cells'))).toEqual({ done: true });
    expect(made.document.canUndo).toBe(true);
    made.sent();
    made.events.length = 0;

    made.notion.updateRow(rowOf(made, 'gigafactories').id, { properties: { name: 'Theirs' } }, other);
    const before = made.rows();
    // The edit is answered at once, with the model changed; that it could not be stored is told afterwards.
    expect(made.document.edit(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(nameOf(made, 'hybrid-cars')).toBe('Mine');
    await made.settled();

    expect(made.sent()).toEqual([QUERY, ...READ]);
    expect(made.written(before)).toEqual({});
    expect(statuses(made.events)).toEqual(['changed', 'storing', 'failed', 'loading', 'failed', 'reloaded']);
    expect(made.events.at(-1)).toEqual({ kind: 'reloaded', sentence: DRIFTED });
    expect([nameOf(made, 'hybrid-cars'), nameOf(made, 'gigafactories'), nameOf(made, 'fuel-cell-cars')]).toEqual(['Hybrid cars', 'Theirs', 'Fuel cells']);
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, false]);

    // The store was read again, so the next edit is stored.
    expect(await made.apply(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
    expect(made.events.at(-1)).toEqual({ kind: 'status', status: 'idle' });
  });

  it('that created a row stops the write as well, in a store that had none too', async () => {
    const made = await openExample('electric-vehicles');
    const other = made.notion.addPerson('Somebody else');
    made.notion.seedRows(made.database.dataSourceId, [{ id: 'theirs', Kind: 'trend', Order: 99, name: 'Theirs', start: '2000-01', stop: '2010-01' }], other);
    made.sent();
    expect(await made.apply(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, ...READ]);
    expect(made.events.at(-1)).toEqual({ kind: 'reloaded', sentence: DRIFTED });
    expect([nameOf(made, 'hybrid-cars'), nameOf(made, 'theirs')]).toEqual(['Hybrid cars', 'Theirs']);

    const empty = await openExample();
    empty.notion.seedRows(empty.database.dataSourceId, [{ id: 'theirs', Kind: 'trend', Order: 1, name: 'Theirs', start: '2000-01', stop: '2010-01' }], other);
    expect(await empty.apply({ kind: 'add', type: 'Trend', id: 'mine', attributes: { name: 'Mine', start: '2000-01', stop: '2010-01' } })).toEqual({ done: true });
    expect(empty.events.at(-1)).toEqual({ kind: 'reloaded', sentence: DRIFTED });
    expect(empty.document.model.elements.map((element) => element.id)).toEqual(['theirs']);
  });

  it('is not what the store wrote itself, nor what it read', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    // The newest rows of the read come back from the first check, and each write from the next.
    for (const name of ['One', 'Two', 'Three']) expect(await made.apply(rename('hybrid-cars', name))).toEqual({ done: true });
    expect(await made.apply({ kind: 'add', type: 'Trend', id: 'mine', attributes: { name: 'Mine', start: '2000-01', stop: '2010-01' } })).toEqual({ done: true });
    expect(await made.apply(rename('mine', 'Still mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars'), QUERY, update('hybrid-cars'), QUERY, update('hybrid-cars'), QUERY, 'POST /v1/pages', QUERY, update('mine')]);
    expect(made.events.some((event) => event.kind === 'reloaded')).toBe(false);
    expect(made.document.canUndo).toBe(true);
  });

  it('that moved a row to the trash is found by the refused write, which reads the store again', async () => {
    const made = await openExample('electric-vehicles');
    const other = made.notion.addPerson('Somebody else');
    made.notion.updateRow(rowOf(made, 'prius-unveiled--hybrid-cars').id, { in_trash: true }, other);
    made.sent();
    made.events.length = 0;
    const before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'prius-unveiled--hybrid-cars', attributes: { toAt: 0.75 } })).toEqual({ done: true });
    // A query does not return a row in the trash, so the check finds nothing and the write is sent.
    expect(made.sent()).toEqual([QUERY, update('prius-unveiled--hybrid-cars'), ...READ]);
    expect(made.written(before)).toEqual({});
    expect(statuses(made.events)).toEqual(['changed', 'storing', 'failed', 'loading', 'failed', 'reloaded']);
    expect(made.events.at(-1)).toEqual({ kind: 'reloaded', sentence: NOT_STORED });
    expect(made.document.model.relations.some((relation) => relation.id === 'prius-unveiled--hybrid-cars')).toBe(false);
    expect(made.document.canUndo).toBe(false);
  });
});

describe('a write that fails', () => {
  it('with 403 changes nothing and makes the document read-only', async () => {
    const made = await openExample('electric-vehicles');
    made.notion.denyWrites(made.notion.me);
    made.sent();
    made.events.length = 0;
    const before = made.rows();
    expect(made.document.state).toBe('ready');
    expect(await made.apply(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars'), ...READ]);
    expect(made.written(before)).toEqual({});
    expect(made.document.state).toBe('read-only');
    expect(made.events.at(-1)).toEqual({ kind: 'reloaded', sentence: FORBIDDEN });
    expect(nameOf(made, 'hybrid-cars')).toBe('Hybrid cars');
    expect(made.document.canUndo).toBe(false);
    expect(made.document.edit(rename('hybrid-cars', 'Mine'))).toEqual({ done: false, sentence: 'You may not change this database, so the diagram cannot be edited.' });
  });

  it('after others of the same edit were stored sends nothing later, takes nothing back and says so', async () => {
    const made = await openExample('electric-vehicles');
    const other = made.notion.addPerson('Somebody else');
    const taken = made.document.model.relations.filter((relation) => relation.source === 'battery-electric-cars' || relation.target === 'battery-electric-cars').map((relation) => relation.id);
    expect(taken.length).toBeGreaterThan(3);
    // Somebody else removed the second of its influences already.
    made.notion.updateRow(rowOf(made, taken[1]).id, { in_trash: true }, other);
    made.sent();
    made.events.length = 0;
    const before = made.rows();

    expect(made.document.edit({ kind: 'remove', id: 'battery-electric-cars' })).toEqual({ done: true });
    // An edit behind it is never sent.
    expect(made.document.edit(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    await made.settled();

    expect(made.sent()).toEqual([QUERY, update('battery-electric-cars'), update(taken[0]), update(taken[1]), ...READ]);
    expect(made.written(before)).toEqual({ 'battery-electric-cars': ['in_trash'], [taken[0]]: ['in_trash'] });
    expect(made.events.filter((event) => event.kind === 'reloaded')).toEqual([{ kind: 'reloaded', sentence: PARTLY }]);
    expect(statuses(made.events).slice(-4)).toEqual(['failed', 'loading', 'failed', 'reloaded']);
    // The diagram shows what the database holds: the trend is gone, its other influences are not.
    expect(made.document.model.elements.some((element) => element.id === 'battery-electric-cars')).toBe(false);
    expect(made.document.model.relations.map((relation) => relation.id)).toEqual(expect.arrayContaining(taken.slice(2)));
    expect(nameOf(made, 'hybrid-cars')).toBe('Hybrid cars');
    expect(made.document.canUndo).toBe(false);
  });

  it('because the connection is lost shows offline, and no edit is lost unseen', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    made.events.length = 0;
    const before = made.rows();
    // Neither the edit nor the reading that follows it reaches the service.
    made.service.unreachable(2);
    expect(await made.apply(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([]);
    expect(made.written(before)).toEqual({});
    expect(statuses(made.events)).toEqual(['changed', 'storing', 'offline', 'loading', 'offline']);
    // The diagram still shows the edit, so nothing more is taken until the database is read.
    expect(made.document.edit(rename('gigafactories', 'More'))).toEqual({ done: false, sentence: NOT_READ });
    expect(made.document.undo()).toEqual({ done: false, sentence: NOT_READ });

    await made.document.reload();
    expect(made.events.at(-1)).toEqual({ kind: 'reloaded', sentence: 'The database was read again.' });
    expect(nameOf(made, 'hybrid-cars')).toBe('Hybrid cars');
    expect(made.document.canUndo).toBe(false);
    expect(await made.apply(rename('gigafactories', 'More'))).toEqual({ done: true });
    expect(made.written(before)).toEqual({ gigafactories: ['name'] });
    expect(made.events.at(-1)).toEqual({ kind: 'status', status: 'idle' });
  });
});

describe('the queue of writes', () => {
  it('writes an edit made while writes are queued behind them', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    made.events.length = 0;
    const before = made.rows();
    expect(made.document.edit(rename('hybrid-cars', 'First'))).toEqual({ done: true });
    expect(made.document.edit({ kind: 'remove', id: 'prius-unveiled--hybrid-cars' })).toEqual({ done: true });
    expect(made.document.edit(rename('hybrid-cars', 'Third'))).toEqual({ done: true });
    expect(made.calls.status()).toBe('storing');
    await made.settled();
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars'), QUERY, update('prius-unveiled--hybrid-cars'), QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['name'], 'prius-unveiled--hybrid-cars': ['in_trash'] });
    // Storing from the first edit to the last write, with no moment in between that says otherwise.
    expect(statuses(made.events)).toEqual(['changed', 'storing', 'changed', 'changed', 'idle']);
  });

  it('sends nothing of the edits behind one that somebody else\'s change stopped, and tells it once', async () => {
    const made = await openExample('electric-vehicles');
    const other = made.notion.addPerson('Somebody else');
    made.notion.updateRow(rowOf(made, 'gigafactories').id, { properties: { name: 'Theirs' } }, other);
    made.sent();
    const before = made.rows();
    expect(made.document.edit(rename('hybrid-cars', 'First'))).toEqual({ done: true });
    expect(made.document.edit(rename('fuel-cell-cars', 'Second'))).toEqual({ done: true });
    await made.settled();
    expect(made.sent()).toEqual([QUERY, ...READ]);
    expect(made.written(before)).toEqual({});
    expect(made.events.filter((event) => event.kind === 'reloaded')).toEqual([{ kind: 'reloaded', sentence: DRIFTED }]);
  });

  it('waits out a 429', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    made.events.length = 0;
    const before = made.rows();
    made.notion.failNext('rate-limited', { times: 2, retryAfter: 3 });
    expect(await made.apply(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, QUERY, QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['name'] });
    expect(statuses(made.events)).toEqual(['changed', 'storing', 'idle']);
  });

  it('refuses an edit while the store is read, and a reading waits for the writes that are queued', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    expect(made.document.edit(rename('hybrid-cars', 'Mine'))).toEqual({ done: true });
    const reading = made.document.reload();
    expect(made.document.edit(rename('hybrid-cars', 'Again'))).toEqual({ done: false, sentence: 'The database is being read, so nothing can be changed for a moment.' });
    await reading;
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars'), ...READ]);
    expect(nameOf(made, 'hybrid-cars')).toBe('Mine');
    expect(await made.apply(rename('hybrid-cars', 'Again'))).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
  });
});

describe('the check for somebody else\'s change', () => {
  const row = (id: string, time: string, editor: string): NotionRow => ({ id, created_time: time, last_edited_time: time, last_edited_by: { id: editor }, in_trash: false, properties: {} });
  function asked(pages: NotionRow[][]): { notion: NotionCalls; queries: NotionQuery[] } {
    const queries: NotionQuery[] = [];
    const query: NotionCalls['query'] = (_id, options = {}) => {
      queries.push(options);
      const results = pages[queries.length - 1] ?? [];
      const more = queries.length < pages.length;
      return Promise.resolve({ results, has_more: more, next_cursor: more ? `page-${queries.length}` : null });
    };
    return { notion: { query } as NotionCalls, queries };
  }
  const own = new Map<string, RowEdit>([['a', { time: '2026-01-01T00:05:00.000Z', editor: 'me' }], ['b', { time: '2026-01-01T00:04:00.000Z', editor: 'me' }]]);

  it('asks from the minute of the last read on, for every page', async () => {
    expect(minuteOf('2026-01-01T00:05:42.123Z')).toBe('2026-01-01T00:05:00.000Z');
    const { notion, queries } = asked([[row('a', '2026-01-01T00:05:00.000Z', 'me')], []]);
    expect(await findDrift(notion, 'store', '2026-01-01T00:05:42.123Z', own)).toEqual({ changed: false, rows: [], newest: '2026-01-01T00:05:00.000Z' });
    expect(queries).toEqual([{ cursor: undefined, editedSince: '2026-01-01T00:05:00.000Z' }, { cursor: 'page-1', editedSince: '2026-01-01T00:05:00.000Z' }]);
    // A store that had no row asks for every row.
    const all = asked([[]]);
    expect(await findDrift(all.notion, 'store', undefined, new Map())).toEqual({ changed: false, rows: [], newest: undefined });
    expect(all.queries).toEqual([{ cursor: undefined, editedSince: undefined }]);
  });

  it('sets aside a row whose edit time and editor are those of the store\'s own last write, and no other', async () => {
    const found = async (...rows: NotionRow[]) => (await findDrift(asked([rows]).notion, 'store', '2026-01-01T00:05:00.000Z', own)).rows;
    expect(await found(row('a', '2026-01-01T00:05:00.000Z', 'me'))).toEqual([]);
    // In the same minute, by somebody else.
    expect(await found(row('a', '2026-01-01T00:05:00.000Z', 'them'))).toEqual(['a']);
    // By the same person, later: from another page of theirs.
    expect(await found(row('a', '2026-01-01T00:06:00.000Z', 'me'))).toEqual(['a']);
    expect(await found(row('b', '2026-01-01T00:05:00.000Z', 'me'))).toEqual(['b']);
    // A row the store never saw.
    expect(await found(row('a', '2026-01-01T00:05:00.000Z', 'me'), row('c', '2026-01-01T00:05:00.000Z', 'me'))).toEqual(['c']);
  });
});
