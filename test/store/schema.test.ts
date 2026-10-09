import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../../src/fbl/documents/documentLoader';
import type { FblBinding } from '../../src/fbl/documents/types';
import { hide, missing, prepare, projectable, storeSchema, ViewsError, type StoreSchema } from '../../src/store/schema';
import { tool } from '../disl/tool';
import { createMemoryCalls } from '../support/memoryCalls';

const { binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);

// The table of contracts/store.md, "The Gartner hype cycle graph": each property, its type, and
// the kinds whose rows use it.
const phases = ['peak', 'trough', 'slope', 'plateau'];
const edges = ['top', 'bottom'];
const table: [name: string, type: string, more: { options?: string[]; kinds?: string[] }, usedBy: string[]][] = [
  ['name', 'rich_text', {}, ['trend', 'trigger']],
  ['description', 'rich_text', {}, ['trend', 'trigger', 'influence']],
  ['tags', 'multi_select', {}, ['trend', 'trigger']],
  ['row', 'number', {}, ['trend', 'trigger', 'note']],
  ['start', 'rich_text', {}, ['trend']],
  ['stop', 'rich_text', {}, ['trend']],
  ['phases', 'number', {}, ['trend']],
  ['peak-end', 'rich_text', {}, ['trend']],
  ['trough-end', 'rich_text', {}, ['trend']],
  ['slope-end', 'rich_text', {}, ['trend']],
  ['date', 'rich_text', {}, ['trigger']],
  ['text', 'rich_text', {}, ['note']],
  ['at', 'rich_text', {}, ['note']],
  ['width', 'number', {}, ['note']],
  ['height', 'number', {}, ['note']],
  ['from', 'relation', { kinds: ['trend', 'trigger'] }, ['influence']],
  ['from-phase', 'select', { options: phases }, ['influence']],
  ['from-edge', 'select', { options: edges }, ['influence']],
  ['from-at', 'number', {}, ['influence']],
  ['to', 'relation', { kinds: ['trend'] }, ['influence']],
  ['to-phase', 'select', { options: phases }, ['influence']],
  ['to-edge', 'select', { options: edges }, ['influence']],
  ['to-at', 'number', {}, ['influence']],
  ['unit', 'select', { options: ['month', 'year', 'decade', 'century'] }, ['unit']],
];

/** The binding with one change made to its document. */
function changed(change: (rules: Record<string, unknown>[]) => void): FblBinding {
  const document = JSON.parse(readFileSync('addons/gartner-hype-cycle-graph/gartner-hype-cycle-graph.fbl', 'utf8')) as { bindings: Record<string, { elements: Record<string, unknown>[] }> };
  change(document.bindings.ghg.elements);
  const loaded = loadDocument(new TextEncoder().encode(JSON.stringify(document)));
  expect(loaded.problems).toEqual([]);
  return loaded.document!.bindings.get('ghg')!;
}

/** Gives the key of one attribute of one rule another name, in `insert.keys` too. */
const rekeyed = (rule: string, attribute: string, key: string): FblBinding => changed((rules) => {
  const found = rules.find((each) => each.name === rule) as { attributes: Record<string, { key: string }>; insert: { keys: string[] } };
  found.insert.keys = found.insert.keys.map((each) => (each === found.attributes[attribute].key ? key : each));
  found.attributes[attribute].key = key;
});

const messages = (computed: StoreSchema): string[] => computed.findings.map((finding) => `${finding.severity}: ${finding.message}`);

describe('the schema of the Gartner hype cycle graph', () => {
  it('can be stored', () => {
    expect(schema.findings).toEqual([]);
  });

  it('has the kinds of the contract, and one row at most for the one that reads one place', () => {
    expect(schema.kinds.map((kind) => kind.name).sort()).toEqual(['influence', 'note', 'trend', 'trigger', 'unit']);
    expect(schema.kinds.filter((kind) => kind.single).map((kind) => kind.name)).toEqual(['unit']);
  });

  it('has the title named after the id key, then Kind and Order', () => {
    expect(schema.title).toBe('id');
    expect(schema.properties.slice(0, 3)).toEqual([
      { name: 'id', type: 'title' },
      { name: 'Kind', type: 'select', options: schema.kinds.map((kind) => kind.name) },
      { name: 'Order', type: 'number' },
    ]);
  });

  it.each(table)('has %s as %s', (name, type, more, usedBy) => {
    expect(schema.properties.find((property) => property.name === name)).toEqual({ name, type, ...more });
    expect(schema.kinds.filter((kind) => kind.values.some((value) => value.property === name)).map((kind) => kind.name).sort()).toEqual([...usedBy].sort());
  });

  it('has no property the table does not have', () => {
    expect(schema.properties.map((property) => property.name).sort()).toEqual(['id', 'Kind', 'Order', ...table.map(([name]) => name)].sort());
  });

  it('reads each value with the attribute of the binding that has its key', () => {
    const trend = schema.kinds.find((kind) => kind.name === 'trend')!;
    expect(trend.values.map((value) => [value.property, value.attribute])).toEqual([
      ['name', 'name'], ['start', 'start'], ['stop', 'stop'], ['row', 'row'], ['phases', 'phases'],
      ['peak-end', 'peakEnd'], ['trough-end', 'troughEnd'], ['slope-end', 'slopeEnd'], ['tags', 'tags'], ['description', 'description'],
    ]);
    expect(schema.kinds.find((kind) => kind.name === 'unit')!.values.map((value) => [value.property, value.attribute])).toEqual([['unit', 'value']]);
  });
});

describe('a binding that cannot be stored', () => {
  it('is one where two kinds read a key as different types', () => {
    const found = messages(storeSchema(rekeyed('note', 'width', 'name'), metamodel, persistence));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^error: The key `name` is read as rich_text by one rule and as number by `note`/);
  });

  it('is one with a key that is one of the store\'s own properties', () => {
    expect(messages(storeSchema(rekeyed('note', 'at', 'Kind'), metamodel, persistence))).toEqual(['error: The key `Kind` of `note` is the store\'s own property `Kind`.']);
  });

  it('is one with a key Notion takes for another property', () => {
    expect(messages(storeSchema(rekeyed('note', 'at', 'order'), metamodel, persistence))).toEqual(['error: Notion takes the key `order` of `note` for the property `Order`.']);
    expect(messages(storeSchema(rekeyed('note', 'at', 'Row'), metamodel, persistence))).toEqual(['error: Notion takes the key `Row` of `note` for the property `row`.']);
  });

  it('is one whose lists read their ids from different keys', () => {
    const other = changed((rules) => {
      const note = rules.find((each) => each.name === 'note') as { id: unknown; attributes: Record<string, { key: string }>; insert: { keys: string[] } };
      note.id = { from: { key: 'key' } };
      note.attributes.storedId.key = 'key';
      note.insert.keys[0] = 'key';
    });
    expect(messages(storeSchema(other, metamodel, persistence))[0]).toMatch(/a store has one title property/);
  });

  it('leaves out a rule that reads the whole document, and one that reads what is not a mapping', () => {
    expect(binding.elements.map((rule) => rule.name).filter((name) => !schema.kinds.some((kind) => kind.name === name)))
      .toEqual(['graph', 'trend-not-a-mapping', 'trigger-not-a-mapping', 'note-not-a-mapping', 'influence-not-a-mapping']);
  });
});

describe('a database', () => {
  const start = async (properties?: Record<string, Record<string, unknown>>) => {
    const memory = createMemoryCalls();
    const database = memory.notion.createDatabase({ properties });
    return { ...memory, database, dataSource: () => memory.calls.dataSource(database.dataSourceId) };
  };
  const types = (properties: Record<string, { type?: unknown }>) => Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, property.type]));

  it('with one title property lacks everything, and its title has another name', async () => {
    const { dataSource } = await start();
    const lacking = missing(schema, await dataSource());
    expect(lacking.prepared).toBe(false);
    expect(lacking.rename).toEqual({ from: 'Name', to: 'id' });
    expect(lacking.add.map((property) => property.name)).toEqual(schema.properties.slice(1).map((property) => property.name));
    expect(lacking.wrong).toEqual([]);
  });

  it('is prepared in one write, which touches no row', async () => {
    const { notion, calls, service, database, dataSource } = await start();
    const [kept] = notion.seedRows(database.dataSourceId, [{ Name: 'kept' }]);
    const before = notion.rows(database.dataSourceId)[0];

    const lacking = await prepare(schema, await dataSource(), calls);
    expect(lacking).toEqual({ rename: undefined, add: [], wrong: [], prepared: true });
    expect(service.requests.filter((request) => request.startsWith('PATCH'))).toHaveLength(1);

    const properties = notion.properties(database.dataSourceId) as Record<string, { type: string; relation?: { data_source_id: string }; select?: { options: { name: string }[] } }>;
    expect(types(properties)).toEqual(Object.fromEntries(schema.properties.map((property) => [property.name, property.type])));
    expect(properties.from.relation?.data_source_id).toBe(database.dataSourceId);
    expect(properties.Kind.select?.options.map((option) => option.name)).toEqual(schema.kinds.map((kind) => kind.name));
    expect(properties['to-phase'].select?.options.map((option) => option.name)).toEqual(phases);

    const after = notion.rows(database.dataSourceId)[0];
    expect(after).toMatchObject({ id: kept, last_edited_time: before.last_edited_time, in_trash: false });
    expect((after.properties.id.title as { plain_text: string }[])[0].plain_text).toBe('kept');
    expect(missing(schema, await dataSource()).prepared).toBe(true);
  });

  it('that is a store is not written to again', async () => {
    const { calls, service, dataSource } = await start();
    await prepare(schema, await dataSource(), calls);
    const writes = service.requests.filter((request) => request.startsWith('PATCH')).length;
    expect((await prepare(schema, await dataSource(), calls)).prepared).toBe(true);
    expect(service.requests.filter((request) => request.startsWith('PATCH'))).toHaveLength(writes);
  });

  it('keeps a property it has with another type, which is reported, and gets the rest', async () => {
    const { notion, calls, database, dataSource } = await start({ Name: { title: {} }, row: { rich_text: {} }, Mine: { checkbox: {} }, Order: { number: {} } });
    const lacking = await prepare(schema, await dataSource(), calls);
    expect(lacking.prepared).toBe(false);
    expect(lacking.add).toEqual([]);
    expect(lacking.rename).toBeUndefined();
    expect(lacking.wrong).toEqual([{ property: { name: 'row', type: 'number' }, has: 'rich_text' }]);
    const properties = types(notion.properties(database.dataSourceId));
    expect(properties).toMatchObject({ id: 'title', row: 'rich_text', Mine: 'checkbox', Order: 'number', phases: 'number' });
    expect(Object.keys(properties)).toHaveLength(schema.properties.length + 1);
  });

  it('whose title cannot take its name, because another property has it, stays as it is', async () => {
    const { notion, calls, database, dataSource } = await start({ Name: { title: {} }, id: { rich_text: {} } });
    const lacking = await prepare(schema, await dataSource(), calls);
    expect(lacking.wrong).toEqual([{ property: { name: 'id', type: 'title' }, has: 'rich_text' }]);
    expect(lacking.rename).toBeUndefined();
    expect(types(notion.properties(database.dataSourceId))).toMatchObject({ Name: 'title', id: 'rich_text', Kind: 'select' });
  });

  it('with a relation to another database holds it with another type', async () => {
    const memory = createMemoryCalls();
    const other = memory.notion.createDatabase();
    const database = memory.notion.createDatabase({ properties: { Name: { title: {} }, from: { relation: { data_source_id: other.dataSourceId } } } });
    const lacking = missing(schema, await memory.calls.dataSource(database.dataSourceId));
    expect(lacking.wrong.map((each) => [each.property.name, each.has])).toEqual([['from', 'relation to another database']]);
  });
});

describe('projecting a property', () => {
  const start = async (properties: Record<string, Record<string, unknown>>) => {
    const memory = createMemoryCalls();
    const other = memory.notion.createDatabase();
    const database = memory.notion.createDatabase({ properties: { Name: { title: {} }, ...properties, Elsewhere: { relation: { data_source_id: other.dataSourceId } } } });
    return { ...memory, database, dataSource: () => memory.calls.dataSource(database.dataSourceId) };
  };
  const ids = (properties: Record<string, unknown>) => Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, (property as { id: string }).id]));

  it('offers, for each property that is missing, the properties of its type under a name no property of the schema has', async () => {
    const { dataSource } = await start({ Sequence: { number: {} }, Level: { number: {} }, row: { number: {} }, Notes: { rich_text: {} }, Source: { relation: {} }, KIND: { select: {} }, Labels: { multi_select: {} } });
    const offered = projectable(schema, await dataSource());
    expect(Object.keys(offered)).toEqual(missing(schema, await dataSource()).add.map((property) => property.name));
    expect(offered.Order).toEqual(['Sequence', 'Level']);
    expect(offered.width).toEqual(['Sequence', 'Level']);
    expect(offered.name).toEqual(['Notes']);
    expect(offered.tags).toEqual(['Labels']);
    // A relation to another database is none of this store's, and a name Notion takes for a needed one is claimed.
    expect(offered.from).toEqual(['Source']);
    expect(offered.unit).toEqual([]);
    expect(offered.row).toBeUndefined();
  });

  it('gives the chosen property the name that is needed and adds the rest, in one write that touches no row', async () => {
    const { notion, calls, service, database, dataSource } = await start({ Sequence: { number: {} }, Level: { number: {} }, Notes: { rich_text: {} } });
    const [kept] = notion.seedRows(database.dataSourceId, [{ Name: 'kept', Sequence: 4, Notes: 'a note' }]);
    const before = ids(notion.properties(database.dataSourceId));
    const edited = notion.rows(database.dataSourceId)[0].last_edited_time;

    const lacking = await prepare(schema, await dataSource(), calls, { Order: 'Sequence', description: 'Notes' });
    expect(lacking.prepared).toBe(true);
    expect(service.requests.filter((request) => request.startsWith('PATCH'))).toHaveLength(1);

    const after = ids(notion.properties(database.dataSourceId));
    expect(after.Order).toBe(before.Sequence);
    expect(after.description).toBe(before.Notes);
    expect(after.Level).toBe(before.Level);
    expect(after.Elsewhere).toBe(before.Elsewhere);
    expect(Object.keys(after).sort()).toEqual(['Elsewhere', 'Level', ...schema.properties.map((property) => property.name)].sort());
    expect(notion.rows(database.dataSourceId)[0]).toMatchObject({ id: kept, last_edited_time: edited, properties: { Order: { number: 4 }, description: { rich_text: [{ plain_text: 'a note' }] } } });
  });

  it('adds a property whose choice is not one that was offered, or was taken by another', async () => {
    const { notion, calls, database, dataSource } = await start({ Sequence: { number: {} }, Notes: { rich_text: {} } });
    const before = ids(notion.properties(database.dataSourceId));
    const lacking = await prepare(schema, await dataSource(), calls, { Order: 'Sequence', row: 'Sequence', width: 'Notes', height: 'Nothing', name: 'Elsewhere' });
    expect(lacking.prepared).toBe(true);
    const after = ids(notion.properties(database.dataSourceId));
    expect(after.Order).toBe(before.Sequence);
    expect(after.Notes).toBe(before.Notes);
    expect(Object.keys(after).sort()).toEqual(['Elsewhere', 'Notes', ...schema.properties.map((property) => property.name)].sort());
  });

  it('changes nothing of a database until it is prepared', async () => {
    const { service, dataSource } = await start({ Sequence: { number: {} } });
    missing(schema, await dataSource());
    projectable(schema, await dataSource());
    expect(service.requests.filter((request) => !request.startsWith('GET'))).toEqual([]);
  });
});

describe('hiding properties in the views', () => {
  type Shown = { configuration: { properties?: { property_name: string; visible: boolean; width?: number }[] } };
  const start = async () => {
    const memory = createMemoryCalls();
    const database = memory.notion.createDatabase({ properties: { Name: { title: {} }, Mine: { rich_text: {} } } });
    const dataSource = async () => memory.calls.dataSource(database.dataSourceId);
    await prepare(schema, await dataSource(), memory.calls);
    const views = () => memory.notion.views(database.dataSourceId) as Shown[];
    const hidden = (view: Shown) => (view.configuration.properties ?? []).filter((each) => !each.visible).map((each) => each.property_name);
    return { ...memory, database, dataSource, views, hidden };
  };
  const patches = (requests: readonly string[]) => requests.filter((request) => request.startsWith('PATCH /notion/v1/views'));

  it('hides them in every view that shows properties, and leaves what a view says of the others', async () => {
    const { notion, calls, database, dataSource, views, hidden } = await start();
    notion.addView(database.dataSourceId, 'board');
    notion.addView(database.dataSourceId, 'form');
    // Neither view was configured yet: each lists nothing and shows every property.
    expect(views()[0].configuration.properties).toBeUndefined();

    await hide(await dataSource(), ['Order', 'row', 'nothing'], calls);
    const [table, board, form] = views();
    // The whole list is sent, since Notion hides what a list leaves out: only the two are hidden.
    expect(hidden(table).sort()).toEqual(['Order', 'row']);
    expect(table.configuration.properties).toHaveLength(Object.keys(notion.properties(database.dataSourceId)).length);
    expect(table.configuration.properties![0]).toMatchObject({ property_name: schema.title, visible: true });
    expect(table.configuration.properties!.find((each) => each.property_name === 'Mine')).toMatchObject({ visible: true });
    expect(table.configuration.properties!.slice(-2).map((each) => each.property_name).sort()).toEqual(['Order', 'row']);
    expect(hidden(board).sort()).toEqual(['Order', 'row']);
    expect(form.configuration.properties).toBeUndefined();
  });

  it('keeps what a configured view said of the other properties', async () => {
    const { notion, calls, service, database, dataSource, views, hidden } = await start();
    const [view] = notion.views(database.dataSourceId) as { id: string }[];
    const ids = Object.fromEntries(Object.entries(notion.properties(database.dataSourceId)).map(([name, property]) => [name, (property as { id: string }).id]));
    const others = Object.keys(ids).filter((name) => !['Mine', schema.title].includes(name));
    await service.fetch(`${service.address}/notion/v1/views/${view.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${notion.me.token}`, 'Content-Type': 'application/json', Origin: service.origin },
      body: JSON.stringify({ configuration: { type: 'table', properties: [{ property_id: ids.Mine, visible: false, width: 240 }, { property_id: 'title', visible: true }, ...others.map((name) => ({ property_id: ids[name], visible: true }))] } }),
    });

    await hide(await dataSource(), ['Order'], calls);
    const [table] = views();
    expect(hidden(table).sort()).toEqual(['Mine', 'Order']);
    expect(table.configuration.properties![0]).toMatchObject({ property_name: 'Mine', visible: false, width: 240 });
  });

  it('writes to no view that hides them already, and to none when there is nothing to hide', async () => {
    const { calls, service, dataSource } = await start();
    await hide(await dataSource(), ['Order'], calls);
    expect(patches(service.requests)).toHaveLength(1);
    await hide(await dataSource(), ['Order'], calls);
    await hide(await dataSource(), [], calls);
    await hide(await dataSource(), ['nothing'], calls);
    expect(patches(service.requests)).toHaveLength(1);
  });

  it('rejects with a sentence where Notion refuses, and leaves the views as they were', async () => {
    const { notion, calls, dataSource, views, hidden } = await start();
    notion.denyWrites(notion.me);
    const refused = await hide(await dataSource(), ['Order'], calls).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ViewsError);
    expect((refused as Error).message).toMatch(/^The internal properties could not be hidden in the views of the database: /);
    expect(hidden(views()[0])).toEqual([]);
  });
});
