import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../../src/fbl/documents/documentLoader';
import type { FblDocument } from '../../src/fbl/documents/types';
import { finding } from '../../src/disl/model';
import type { Command, CommandHandler } from '../../src/history/command';
import { CHANGE, openDocument, storeOf, type ChangeCommand, type DocumentEvent, type OpenDocument } from '../../src/store/document';
import { createNotionCalls, NotionError } from '../../src/store/notion';
import { createRows, readRows, rowsOf } from '../../src/store/rows';
import { prepare, storeSchema } from '../../src/store/schema';
import { createSession } from '../../src/store/session';
import { tool } from '../disl/tool';
import { createMemoryCalls, type MemoryCalls } from '../support/memoryCalls';
import type { MemoryDatabase, MemoryValue } from '../support/memoryNotion';
import { createMemoryStorage } from '../support/memoryService';

const { specification, binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);
const fbl = loadDocument(readFileSync('addons/gartner-hype-cycle-graph/gartner-hype-cycle-graph.fbl')).document!;
const example = (name: string): Uint8Array => readFileSync(`test/examples/gartner-hype-cycle-graph/${name}/${name}.ghg`);

const trend = (id: string, order: number, more: Record<string, MemoryValue> = {}): Record<string, MemoryValue> =>
  ({ id, Kind: 'trend', Order: order, name: id.toUpperCase(), start: '2000-01', stop: '2010-01', ...more });

interface Store extends MemoryCalls {
  readonly database: MemoryDatabase;
  open(binding?: FblDocument): Promise<OpenDocument>;
}

/** A database in the in-memory Notion; prepared unless told otherwise. */
async function store(options: { prepared?: boolean; dataSources?: number } = {}): Promise<Store> {
  const memory = createMemoryCalls();
  const database = memory.notion.createDatabase({ dataSources: options.dataSources });
  if (options.prepared !== false) await prepare(schema, await memory.calls.dataSource(database.dataSourceId), memory.calls);
  return { ...memory, database, open: (document = fbl) => openDocument({ specification, binding: document, database: database.id, notion: memory.calls }) };
}

const queries = (made: Store): string[] => made.service.requests.filter((request) => request.endsWith('/query'));

function heard(document: OpenDocument): DocumentEvent[] {
  const events: DocumentEvent[] = [];
  document.subscribe((event) => events.push(event));
  return events;
}

describe('opening a store', () => {
  it('opens an empty prepared store as an empty graph with no finding', async () => {
    const document = await (await store()).open();
    expect(document.state).toBe('ready');
    expect(document.model).toEqual({ diagram: {}, elements: [], relations: [] });
    expect(document.findings).toEqual([]);
    expect(document.canUndo).toBe(false);
    expect(document.canRedo).toBe(false);
  });

  it('reports a row that cannot be read and reads the rest', async () => {
    const made = await store();
    const [, odd] = made.notion.seedRows(made.database.dataSourceId, [trend('a', 1), { id: 'odd', Kind: 'gadget' }, trend('b', 2, { start: 'soon' })]);
    const document = await made.open();
    expect(document.state).toBe('ready');
    expect(document.model.elements.map((element) => element.id)).toEqual(['a', 'b']);
    expect(document.findings.map((found) => [found.code, found.detail?.rowId ?? found.element])).toEqual([
      ['store.unknown-kind', odd],
      ['std.unreadableEntry', 'b'],
    ]);
  });

  it('gives the findings of the constraints, which are handed what the reading found', async () => {
    const made = await store();
    made.notion.seedRows(made.database.dataSourceId, [trend('a', 1), { id: 'odd', Kind: 'gadget' }]);
    const seen: unknown[] = [];
    const document = await openDocument({
      specification, binding: fbl, database: made.database.id, notion: made.calls,
      constraints: (model, read) => {
        seen.push(model.elements.length, read.map((found) => found.code));
        return [finding('a.rule', 'error', 'A rule is broken.'), ...read];
      },
    });
    expect(seen).toEqual([1, ['store.unknown-kind']]);
    expect(document.findings.map((found) => found.code)).toEqual(['a.rule', 'store.unknown-kind']);
    expect(document.state).toBe('ready');
  });

  it('is unreadable when the document cannot be read at all', async () => {
    // A binding whose own template is no document: nothing the rows hold can be read through it.
    const broken: FblDocument = { ...fbl, bindings: new Map([[binding.name, { ...binding, template: { ...binding.template!, text: 'trends: [\n' } }]]) };
    const made = await store();
    made.notion.seedRows(made.database.dataSourceId, [trend('a', 1)]);
    const document = await made.open(broken);
    expect(document.state).toBe('unreadable');
    expect(document.model).toEqual({ diagram: {}, elements: [], relations: [] });
    expect(document.findings.length).toBeGreaterThan(0);
    expect(document.edit({ kind: 'remove', id: 'a' })).toEqual({ done: false, sentence: 'The document could not be read, so it cannot be edited.' });
  });

  it('is unprepared when the database lacks a property, and prepares it when asked', async () => {
    const made = await store({ prepared: false });
    const document = await made.open();
    expect(document.state).toBe('unprepared');
    expect(document.model.elements).toEqual([]);
    expect(document.findings.map((found) => found.code)).toContain('store.unprepared');
    expect(document.findings.map((found) => found.message).join(' ')).toContain('`Kind`');
    expect(queries(made)).toEqual([]);

    const events = heard(document);
    await document.prepare();
    expect(document.state).toBe('ready');
    expect(document.findings).toEqual([]);
    expect(Object.keys(made.notion.properties(made.database.dataSourceId))).toEqual(schema.properties.map((property) => property.name));
    expect(events.at(-1)).toEqual({ kind: 'changed' });
  });

  it('stays unprepared when a property exists with another type, which is left alone', async () => {
    const made = await store({ prepared: false });
    await made.calls.edit((writes) => writes.updateProperties(made.database.dataSourceId, { [schema.properties[3].name]: { checkbox: {} } }));
    const document = await made.open();
    await document.prepare();
    expect(document.state).toBe('unprepared');
    expect(document.findings).toHaveLength(1);
    expect(document.findings[0].message).toContain('checkbox');
  });

  it('is unprepared with a sentence when the database has two data sources', async () => {
    const made = await store({ prepared: false, dataSources: 2 });
    const document = await made.open();
    expect(document.state).toBe('unprepared');
    expect(document.findings.map((found) => found.message)).toEqual(['The database has 2 data sources, and a store has one.']);
    const before = [...made.service.requests];
    await document.prepare();
    expect(document.state).toBe('unprepared');
    expect(made.service.requests.filter((request) => request.startsWith('PATCH'))).toEqual(before.filter((request) => request.startsWith('PATCH')));
  });

  it('reads 518 rows in six calls, before anything is given', async () => {
    const made = await store();
    const put = rowsOf(example('technology-trends'), schema, binding);
    await createRows(put.rows, made.database.dataSourceId, made.calls);
    const document = await made.open();
    expect(queries(made)).toHaveLength(6);
    expect(document.state).toBe('ready');
    expect(document.model.elements.length + document.model.relations.length).toBe(518);
    expect(storeOf(document).rows.entries).toHaveLength(518);
  }, 30_000);

  it('rejects with the calls\' error when the database is not shared with the person', async () => {
    const made = await store();
    made.notion.unshare(made.database.id);
    const error = await made.open().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotionError);
    expect(error).toMatchObject({ kind: 'refused', status: 404, code: 'object_not_found' });
  });

  it('rejects with the calls\' error when there is no token', async () => {
    const made = await store();
    const session = createSession({ service: made.service.address, storage: createMemoryStorage(), fetch: made.service.fetch, open: () => null, listen: () => () => undefined });
    const calls = createNotionCalls({ service: made.service.address, session, fetch: made.service.fetch });
    const error = await openDocument({ specification, binding: fbl, database: made.database.id, notion: calls }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'NotionError', kind: 'connect' });
  });
});

describe('a person who may not write', () => {
  it('opens ready, and is read-only from the first write Notion refuses with 403, which changes nothing', async () => {
    const made = await store();
    made.notion.seedRows(made.database.dataSourceId, [trend('a', 1)]);
    made.notion.denyWrites(made.notion.me);
    const document = await made.open();
    // Nothing says before a write that the person may not write.
    expect(document.state).toBe('ready');

    const internal = storeOf(document);
    const events = heard(document);
    const refused = await made.calls.edit((writes) => writes.createRow(internal.dataSourceId!, { [schema.title]: { title: [{ text: { content: 'b' } }] } })).catch((caught: unknown) => caught);
    expect(refused).toMatchObject({ kind: 'refused', status: 403 });
    internal.markReadOnly();

    expect(document.state).toBe('read-only');
    expect(events).toContainEqual({ kind: 'changed' });
    expect(made.notion.rows(made.database.dataSourceId)).toHaveLength(1);
    expect(document.edit({ kind: 'remove', id: 'a' })).toEqual({ done: false, sentence: 'You may not change this database, so the diagram cannot be edited.' });

    await document.reload();
    expect(document.state).toBe('read-only');
    expect(document.model.elements.map((element) => element.id)).toEqual(['a']);
  });

  it('cannot prepare a database: the write changes nothing, and the store is read-only once it is prepared', async () => {
    const made = await store({ prepared: false });
    const before = made.notion.properties(made.database.dataSourceId);
    made.notion.denyWrites(made.notion.me);
    const document = await made.open();
    expect(document.state).toBe('unprepared');
    await expect(document.prepare()).rejects.toMatchObject({ kind: 'refused', status: 403 });
    expect(document.state).toBe('unprepared');
    expect(made.notion.properties(made.database.dataSourceId)).toEqual(before);

    // Somebody who may prepares it.
    made.notion.denyWrites(made.notion.me, false);
    await prepare(schema, await made.calls.dataSource(made.database.dataSourceId), made.calls);
    made.notion.denyWrites(made.notion.me);
    await document.reload();
    expect(document.state).toBe('read-only');
  });
});

describe('an open document', () => {
  // A handler as the store's later brings them: it changes what is read and names its inverse.
  function counting(document: OpenDocument): { handled: Command[]; handler: CommandHandler<ChangeCommand> } {
    const handled: Command[] = [];
    return {
      handled,
      handler: {
        type: CHANGE,
        handle(command) {
          handled.push(command);
          if (command.change.kind === 'save') return { done: true };
          if (command.change.kind !== 'set') return { done: false, sentence: 'Only a set is carried out here.' };
          storeOf(document).replace(storeOf(document).rows);
          return { done: true, inverse: { type: CHANGE, change: { ...command.change, attributes: {} } } as ChangeCommand };
        },
      },
    };
  }
  const set = { kind: 'set', id: 'a', attributes: { name: 'B' } } as const;

  it('answers the dispatcher\'s refusal while no handler is registered', async () => {
    const document = await (await store()).open();
    expect(document.edit(set)).toEqual({ done: false, sentence: `Nothing can carry out the command '${CHANGE}'.` });
    expect(document.canUndo).toBe(false);
  });

  it('runs an edit, an undo and a redo through its own history, as dispatches to the registered handler', async () => {
    const document = await (await store()).open();
    const { handled, handler } = counting(document);
    document.register(handler);
    const events = heard(document);

    expect(document.edit(set)).toEqual({ done: true });
    expect(events).toEqual([{ kind: 'changed' }]);
    expect([document.canUndo, document.canRedo]).toEqual([true, false]);
    expect(document.undo()).toEqual({ done: true });
    expect([document.canUndo, document.canRedo]).toEqual([false, true]);
    expect(document.redo()).toEqual({ done: true });
    expect(handled).toEqual([
      { type: CHANGE, change: set },
      { type: CHANGE, change: { ...set, attributes: {} } },
      { type: CHANGE, change: set },
    ]);

    // Refused, or nothing changed: not recorded.
    expect(document.edit({ kind: 'remove', id: 'a' })).toEqual({ done: false, sentence: 'Only a set is carried out here.' });
    expect(document.edit({ kind: 'save' })).toEqual({ done: true });
    expect(document.undo()).toEqual({ done: true });
    expect(document.undo()).toEqual({ done: true });
    expect(handled).toHaveLength(6);
  });

  it('reads the store again on a reload, empties the history and says so', async () => {
    const made = await store();
    made.notion.seedRows(made.database.dataSourceId, [trend('a', 1)]);
    const document = await made.open();
    document.register(counting(document).handler);
    document.edit(set);
    expect(document.canUndo).toBe(true);

    made.notion.seedRows(made.database.dataSourceId, [trend('b', 2)]);
    const events = heard(document);
    await document.reload();
    expect(document.model.elements.map((element) => element.id)).toEqual(['a', 'b']);
    expect(document.canUndo).toBe(false);
    expect(events).toEqual([
      { kind: 'status', status: 'loading' },
      { kind: 'status', status: 'idle' },
      { kind: 'reloaded', sentence: 'The database was read again.' },
    ]);

    await storeOf(document).reload('Somebody else changed the database, so it was read again.');
    expect(events.at(-1)).toEqual({ kind: 'reloaded', sentence: 'Somebody else changed the database, so it was read again.' });
  });

  it('relays the status of the calls, until it is closed', async () => {
    const made = await store();
    const document = await made.open();
    const events = heard(document);
    await made.calls.edit((writes) => writes.createRow(made.database.dataSourceId, {}));
    expect(events).toEqual([{ kind: 'status', status: 'storing' }, { kind: 'status', status: 'idle' }]);

    made.service.unreachable();
    await expect(document.reload()).rejects.toMatchObject({ kind: 'offline' });
    expect(events.at(-1)).toEqual({ kind: 'status', status: 'offline' });

    const count = events.length;
    document.close();
    await made.calls.edit((writes) => writes.createRow(made.database.dataSourceId, {}));
    expect(events).toHaveLength(count);
  });

  it('stops telling a listener that unsubscribed', async () => {
    const document = await (await store()).open();
    const events: DocumentEvent[] = [];
    const stop = document.subscribe((event) => events.push(event));
    stop();
    await document.reload();
    expect(events).toEqual([]);
  });

  it('gives the store\'s own code what a write needs', async () => {
    const made = await store();
    const [a] = made.notion.seedRows(made.database.dataSourceId, [trend('a', 1)]);
    const document = await made.open();
    const internal = storeOf(document);
    expect(internal.dataSourceId).toBe(made.database.dataSourceId);
    expect(internal.schema.properties.map((property) => property.name)).toEqual(schema.properties.map((property) => property.name));
    expect(internal.rows.entries).toEqual([{ kind: 'trend', position: 0, rowId: a }]);
    expect(new TextDecoder().decode(internal.rows.body)).toContain('  - id: a\r\n');
    // The time of the newest row edit the read saw, as Notion gives it.
    expect(internal.lastRead).toBe(made.notion.rows(made.database.dataSourceId)[0].last_edited_time);

    // After a change, the store's code hands over what the rows now read as.
    const [b] = made.notion.seedRows(made.database.dataSourceId, [trend('b', 2)]);
    const events = heard(document);
    internal.replace(readRows(await made.allRows(made.database.dataSourceId), schema, binding));
    expect(document.model.elements.map((element) => element.id)).toEqual(['a', 'b']);
    expect(internal.rows.entries.map((entry) => entry.rowId)).toEqual([a, b]);
    expect(events).toEqual([{ kind: 'changed' }]);
  });

  it('has no last read for a store without rows', async () => {
    expect(storeOf(await (await store()).open()).lastRead).toBeUndefined();
  });
});
