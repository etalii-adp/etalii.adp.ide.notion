import { describe, expect, it } from 'vitest';
import { createMemoryNotion, type MemoryNotion } from './memoryNotion';

const BASE = 'https://api.notion.com';

async function call(notion: MemoryNotion, method: string, path: string, body?: unknown, token = 'memory-token') {
  const response = await notion.fetch(`${BASE}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function store(notion: MemoryNotion) {
  return notion.createDatabase({
    properties: {
      name: { title: {} },
      Kind: { select: { options: [{ name: 'first' }] } },
      Order: { number: {} },
      text: { rich_text: {} },
      done: { checkbox: {} },
      labels: { multi_select: {} },
      to: { relation: {} },
    },
  });
}

describe('the in-memory Notion', () => {
  it('answers a database with its data sources, and a data source with its properties', async () => {
    const notion = createMemoryNotion();
    const one = store(notion);
    const two = notion.createDatabase({ dataSources: 2 });

    const database = await call(notion, 'GET', `v1/databases/${one.id.replaceAll('-', '')}`);
    expect(database.body.data_sources).toEqual([{ id: one.dataSourceId, name: 'Memory database' }]);
    expect((await call(notion, 'GET', `v1/databases/${two.id}`)).body.data_sources).toHaveLength(2);

    const source = await call(notion, 'GET', `v1/data_sources/${one.dataSourceId}`);
    expect(source.body.object).toBe('data_source');
    expect(source.body.properties.name).toMatchObject({ id: 'title', name: 'name', type: 'title', title: {} });
    expect(source.body.properties.Order).toMatchObject({ type: 'number', number: { format: 'number' } });
    expect(source.body.properties.Kind.select.options).toMatchObject([{ name: 'first', color: 'default' }]);
    expect(source.body.properties.to.relation).toEqual({
      database_id: one.id,
      data_source_id: one.dataSourceId,
      type: 'single_property',
      single_property: {},
    });
  });

  it('adds and renames properties, and keeps the values of a renamed one', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = notion.createDatabase();
    const [row] = notion.seedRows(dataSourceId, [{ Name: 'a' }]);

    const changed = await call(notion, 'PATCH', `v1/data_sources/${dataSourceId}`, {
      properties: { Name: { name: 'name' }, Order: { number: {} }, Kind: { type: 'select', select: {} } },
    });
    expect(changed.status).toBe(200);
    expect(Object.keys(changed.body.properties)).toEqual(['name', 'Order', 'Kind']);
    expect(notion.rows(dataSourceId)[0]).toMatchObject({ id: row, properties: { name: { title: [{ plain_text: 'a' }] }, Order: { number: null } } });

    const second = await call(notion, 'PATCH', `v1/data_sources/${dataSourceId}`, { properties: { More: { title: {} } } });
    expect(second.body).toMatchObject({ object: 'error', status: 400, code: 'validation_error' });
  });

  it('creates and changes rows, with every value as Notion answers it', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId, id } = store(notion);
    const [target] = notion.seedRows(dataSourceId, [{ name: 'a', Kind: 'first', Order: 1 }]);

    const created = await call(notion, 'POST', 'v1/pages', {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: {
        name: { title: [{ type: 'text', text: { content: 'b' } }] },
        Kind: { select: { name: 'second' } },
        Order: { number: 2 },
        text: { rich_text: [{ text: { content: 'one ' } }, { text: { content: 'two' } }] },
        done: { checkbox: true },
        labels: { multi_select: [{ name: 'x' }, { name: 'y' }] },
        to: { relation: [{ id: target.replaceAll('-', '') }] },
      },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      object: 'page',
      in_trash: false,
      parent: { type: 'data_source_id', data_source_id: dataSourceId, database_id: id },
      created_by: { object: 'user', id: notion.me.id },
      properties: {
        name: { id: 'title', type: 'title', title: [{ type: 'text', text: { content: 'b', link: null }, plain_text: 'b' }] },
        Kind: { type: 'select', select: { name: 'second', color: 'default' } },
        Order: { type: 'number', number: 2 },
        text: { type: 'rich_text', rich_text: [{ plain_text: 'one ' }, { plain_text: 'two' }] },
        done: { type: 'checkbox', checkbox: true },
        labels: { type: 'multi_select', multi_select: [{ name: 'x' }, { name: 'y' }] },
        to: { type: 'relation', relation: [{ id: target }], has_more: false },
      },
    });
    // An option written by name becomes an option of the property.
    expect(notion.properties(dataSourceId).Kind).toMatchObject({ select: { options: [{ name: 'first' }, { name: 'second' }] } });

    const emptied = await call(notion, 'PATCH', `v1/pages/${created.body.id}`, {
      properties: { Kind: { select: null }, text: { rich_text: [] }, to: { relation: [] } },
    });
    expect(emptied.body.properties).toMatchObject({ Kind: { select: null }, text: { rich_text: [] }, to: { relation: [] }, Order: { number: 2 } });
  });

  it('refuses a value its property cannot hold, and changes nothing', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    const [row] = notion.seedRows(dataSourceId, [{ name: 'a', Order: 1 }]);
    const before = notion.rows(dataSourceId);

    for (const properties of [
      { Order: { number: 2 }, missing: { number: 1 } },
      { Order: { rich_text: [] } },
      { labels: { multi_select: [{ name: 'x, y' }] } },
      { text: { rich_text: [{ text: { content: 'x'.repeat(2001) } }] } },
    ]) {
      const refused = await call(notion, 'PATCH', `v1/pages/${row}`, { properties });
      expect(refused.body).toMatchObject({ object: 'error', status: 400, code: 'validation_error' });
      expect(typeof refused.body.message).toBe('string');
    }
    expect(notion.rows(dataSourceId)).toEqual(before);
  });

  it('answers 100 rows a call, with a cursor to the next', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    notion.seedRows(dataSourceId, Array.from({ length: 250 }, (_, index) => ({ name: `row ${index}`, Order: index })));

    const sizes: number[] = [];
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, cursor ? { start_cursor: cursor } : {});
      expect(page.body).toMatchObject({ object: 'list', type: 'page_or_data_source', has_more: page.body.next_cursor !== null });
      sizes.push(page.body.results.length);
      names.push(...page.body.results.map((row: { properties: { name: { title: { plain_text: string }[] } } }) => row.properties.name.title[0].plain_text));
      cursor = page.body.next_cursor ?? undefined;
    } while (cursor);

    expect(sizes).toEqual([100, 100, 50]);
    expect(names[0]).toBe('row 0');
    expect(names[249]).toBe('row 249');
    expect((await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, { page_size: 101 })).status).toBe(400);
    expect((await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, { page_size: 2 })).body).toMatchObject({ has_more: true });
  });

  it('sorts by a property and by a timestamp', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    notion.seedRows(dataSourceId, [{ name: 'a', Order: 2 }, { name: 'b', Order: 1 }, { name: 'c', Order: 2 }]);
    const order = async (sorts: unknown) =>
      (await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, { sorts })).body.results.map(
        (row: { properties: { name: { title: { plain_text: string }[] } } }) => row.properties.name.title[0].plain_text,
      );

    expect(await order([{ property: 'Order', direction: 'ascending' }, { timestamp: 'created_time', direction: 'ascending' }])).toEqual(['b', 'a', 'c']);
    expect(await order([{ timestamp: 'last_edited_time', direction: 'descending' }])).toEqual(['c', 'b', 'a']);
  });

  it('answers the rows edited since a time, and who edited them', async () => {
    const notion = createMemoryNotion({ start: '2026-01-01T00:00:00.000Z' });
    const other = notion.addPerson('Somebody else');
    const { dataSourceId } = store(notion);
    const [first, second] = notion.seedRows(dataSourceId, [{ name: 'a' }, { name: 'b' }]);
    const read = notion.now();
    expect(read).toBe('2026-01-01T00:02:00.000Z');

    const since = { filter: { timestamp: 'last_edited_time', last_edited_time: { after: read } } };
    expect((await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, since)).body.results).toEqual([]);

    notion.advance(3_600_000);
    await call(notion, 'PATCH', `v1/pages/${second}`, { properties: { Order: { number: 5 } } }, other.token);
    const edited = (await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, since)).body.results;
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({
      id: second,
      created_time: '2026-01-01T00:02:00.000Z',
      last_edited_time: '2026-01-01T01:03:00.000Z',
      created_by: { id: notion.me.id },
      last_edited_by: { id: other.id },
    });
    expect(notion.rows(dataSourceId)[0]).toMatchObject({ id: first, last_edited_time: '2026-01-01T00:01:00.000Z' });

    const unknown = await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, { filter: { property: 'Order', number: { equals: 5 } } });
    expect(unknown.status).toBe(400);
  });

  it('keeps a row in the trash out of a query, and takes the same row out again', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    const [first, second] = notion.seedRows(dataSourceId, [{ name: 'a' }, { name: 'b', to: [] }]);
    notion.updateRow(second, { properties: { to: [first] } });

    const trashed = await call(notion, 'PATCH', `v1/pages/${first}`, { in_trash: true });
    expect(trashed.body).toMatchObject({ id: first, in_trash: true });
    const found = (await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, {})).body.results;
    expect(found.map((row: { id: string }) => row.id)).toEqual([second]);
    expect(found[0].properties.to.relation).toEqual([{ id: first }]);
    expect(notion.rows(dataSourceId).map((row) => row.in_trash)).toEqual([true, false]);

    expect((await call(notion, 'PATCH', `v1/pages/${first}`, { properties: { Order: { number: 1 } } })).status).toBe(400);
    const restored = await call(notion, 'PATCH', `v1/pages/${first}`, { in_trash: false });
    expect(restored.body).toMatchObject({ id: first, in_trash: false, properties: { name: { title: [{ plain_text: 'a' }] } } });
  });

  it('knows which tokens are valid, and whose they are', async () => {
    const notion = createMemoryNotion({ workspace: 'A workspace' });
    const other = notion.addPerson('Somebody else');

    expect((await call(notion, 'GET', 'v1/users/me')).body).toMatchObject({
      object: 'user',
      type: 'bot',
      bot: { owner: { type: 'user', user: { id: notion.me.id, name: 'Memory person' } }, workspace_name: 'A workspace' },
    });
    expect((await call(notion, 'GET', 'v1/users/me', undefined, other.token)).body.bot.owner.user.id).toBe(other.id);
    expect((await call(notion, 'GET', 'v1/users/me', undefined, 'unknown')).body).toEqual({
      object: 'error',
      status: 401,
      code: 'unauthorized',
      message: 'API token is invalid.',
    });

    notion.setPerson('memory-token', other);
    expect((await call(notion, 'GET', 'v1/users/me')).body.bot.owner.user.id).toBe(other.id);
    notion.revoke('memory-token');
    expect((await call(notion, 'GET', 'v1/users/me')).status).toBe(401);

    const unversioned = await notion.fetch(`${BASE}/v1/users/me`, { headers: { Authorization: `Bearer ${other.token}` } });
    expect(await unversioned.json()).toMatchObject({ status: 400, code: 'missing_version' });
  });

  it('refuses the writes of a person who may only read', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    const [row] = notion.seedRows(dataSourceId, [{ name: 'a' }]);
    notion.denyWrites(notion.me);

    expect((await call(notion, 'POST', `v1/data_sources/${dataSourceId}/query`, {})).status).toBe(200);
    for (const [method, path, body] of [
      ['PATCH', `v1/pages/${row}`, { in_trash: true }],
      ['POST', 'v1/pages', { parent: { data_source_id: dataSourceId }, properties: {} }],
      ['PATCH', `v1/data_sources/${dataSourceId}`, { properties: { more: { number: {} } } }],
    ] as const) {
      expect((await call(notion, method, path, body)).body).toMatchObject({ object: 'error', status: 403, code: 'restricted_resource' });
    }
    expect(notion.rows(dataSourceId)).toMatchObject([{ in_trash: false }]);

    notion.denyWrites(notion.me, false);
    expect((await call(notion, 'PATCH', `v1/pages/${row}`, { in_trash: true })).status).toBe(200);
  });

  it('does not find a database that is not shared', async () => {
    const notion = createMemoryNotion();
    const { id, dataSourceId } = store(notion);
    const [row] = notion.seedRows(dataSourceId, [{ name: 'a' }]);
    notion.unshare(id);

    for (const [method, path, body] of [
      ['GET', `v1/databases/${id}`, undefined],
      ['GET', `v1/data_sources/${dataSourceId}`, undefined],
      ['POST', `v1/data_sources/${dataSourceId}/query`, {}],
      ['PATCH', `v1/pages/${row}`, { in_trash: true }],
    ] as const) {
      expect((await call(notion, method, path, body)).body).toMatchObject({ object: 'error', status: 404, code: 'object_not_found' });
    }
    expect((await call(notion, 'GET', 'v1/databases/22222222222222222222222222222222')).status).toBe(404);
  });

  it('fails the next calls as it is switched to, and then answers again', async () => {
    const notion = createMemoryNotion();

    notion.failNext('unauthorized');
    expect((await call(notion, 'GET', 'v1/users/me')).body).toMatchObject({ status: 401, code: 'unauthorized' });
    expect((await call(notion, 'GET', 'v1/users/me')).status).toBe(200);

    notion.failNext('rate-limited', { times: 2, retryAfter: 7 });
    for (let count = 0; count < 2; count++) {
      const limited = await call(notion, 'GET', 'v1/users/me');
      expect(limited.body).toMatchObject({ status: 429, code: 'rate_limited' });
      expect(limited.headers.get('Retry-After')).toBe('7');
    }
    expect((await call(notion, 'GET', 'v1/users/me')).status).toBe(200);

    notion.failNext('offline');
    await expect(call(notion, 'GET', 'v1/users/me')).rejects.toThrow(TypeError);
    expect((await call(notion, 'GET', 'v1/users/me')).status).toBe(200);
    expect(notion.calls).toHaveLength(7);
    expect(notion.calls[0]).toBe('GET /v1/users/me');
  });

  it('answers no call outside the ones it models', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    const [row] = notion.seedRows(dataSourceId, [{ name: 'a' }]);

    for (const [method, path] of [['GET', `v1/pages/${row}`], ['POST', 'v1/databases'], ['DELETE', `v1/blocks/${row}`], ['GET', `v1/blocks/${row}`], ['POST', 'v1/views'], ['GET', 'v1/users']] as const) {
      expect((await call(notion, method, path, method === 'GET' ? undefined : {})).body).toMatchObject({ status: 400, code: 'invalid_request_url' });
    }
  });
});

describe('the in-memory Notion, for the selection of a store', () => {
  const wanted = { filter: { property: 'object', value: 'data_source' } };

  it('finds the data sources a person reaches, by a part of the title, with the database and where it is', async () => {
    const notion = createMemoryNotion();
    const page = notion.createPage({ title: 'An entry' });
    const one = notion.createDatabase({ title: 'First - Data', parent: page.id });
    const two = notion.createDatabase({ title: 'Second' });
    const hidden = notion.createDatabase({ title: 'First, unshared' });
    notion.unshare(hidden.id);

    const all = await call(notion, 'POST', 'v1/search', wanted);
    expect(all.body).toMatchObject({ object: 'list', has_more: false, next_cursor: null });
    expect(all.body.results).toMatchObject([
      { object: 'data_source', id: one.dataSourceId, title: [{ plain_text: 'First - Data' }], parent: { type: 'database_id', database_id: one.id }, database_parent: { type: 'page_id', page_id: page.id } },
      { object: 'data_source', id: two.dataSourceId, parent: { database_id: two.id }, database_parent: { type: 'workspace', workspace: true } },
    ]);
    expect((await call(notion, 'POST', 'v1/search', { ...wanted, query: 'first' })).body.results.map((found: { id: string }) => found.id)).toEqual([one.dataSourceId]);
    expect((await call(notion, 'GET', `v1/databases/${one.id}`)).body.parent).toEqual({ type: 'page_id', page_id: page.id });
  });

  it('pages a search, and searches for nothing but data sources', async () => {
    const notion = createMemoryNotion();
    const made = ['a', 'b', 'c'].map((title) => notion.createDatabase({ title }));
    const first = await call(notion, 'POST', 'v1/search', { ...wanted, page_size: 2 });
    expect(first.body).toMatchObject({ has_more: true, next_cursor: made[2].dataSourceId });
    const second = await call(notion, 'POST', 'v1/search', { ...wanted, page_size: 2, start_cursor: first.body.next_cursor });
    expect(second.body.results.map((found: { id: string }) => found.id)).toEqual([made[2].dataSourceId]);
    expect(second.body.has_more).toBe(false);
    expect((await call(notion, 'POST', 'v1/search', {})).status).toBe(400);
    expect((await call(notion, 'POST', 'v1/search', { filter: { property: 'object', value: 'page' } })).status).toBe(400);
  });

  it('answers the blocks of a page: a page under it by the id of that page, a database, an embed with its address', async () => {
    const notion = createMemoryNotion();
    const page = notion.createPage();
    const under = notion.createPage({ title: 'Diagram', parent: page.id });
    const database = notion.createDatabase({ title: 'Data', parent: page.id });
    const embed = notion.addBlock(page.id, { embed: 'https://example.org/a/' });
    notion.addBlock(page.id);

    const children = await call(notion, 'GET', `v1/blocks/${page.id}/children`);
    expect(children.body.results).toMatchObject([
      { object: 'block', id: under.id, type: 'child_page', child_page: { title: 'Diagram' } },
      { id: database.id, type: 'child_database', child_database: { title: 'Data' } },
      { id: embed, type: 'embed', embed: { url: 'https://example.org/a/' } },
      { type: 'paragraph' },
    ]);
    expect((await call(notion, 'GET', `v1/blocks/${under.id}/children`)).body.results).toEqual([]);
    const paged = await call(notion, 'GET', `v1/blocks/${page.id}/children?page_size=3`);
    expect(paged.body).toMatchObject({ has_more: true });
    expect((await call(notion, 'GET', `v1/blocks/${page.id}/children?start_cursor=${paged.body.next_cursor}`)).body.results).toHaveLength(1);
  });

  it('gives an embed block another address, and no other block, and not to a person who may not write', async () => {
    const notion = createMemoryNotion();
    const page = notion.createPage();
    const embed = notion.addBlock(page.id, { embed: 'https://example.org/a/' });
    const paragraph = notion.addBlock(page.id);

    expect((await call(notion, 'PATCH', `v1/blocks/${embed}`, { type: 'embed', embed: { url: 'https://example.org/a/?store=1' } })).body.embed.url).toBe('https://example.org/a/?store=1');
    expect((await call(notion, 'PATCH', `v1/blocks/${paragraph}`, { embed: { url: 'https://example.org/' } })).status).toBe(400);
    expect((await call(notion, 'PATCH', `v1/blocks/${embed}`, { embed: {} })).status).toBe(400);
    notion.denyWrites(notion.me);
    expect((await call(notion, 'PATCH', `v1/blocks/${embed}`, { embed: { url: 'https://example.org/b/' } })).status).toBe(403);
    expect(notion.blocks(page.id)[0]).toMatchObject({ embed: { url: 'https://example.org/a/?store=1' } });
  });

  it('does not find the blocks of a page that is not shared', async () => {
    const notion = createMemoryNotion();
    const page = notion.createPage({ shared: false });
    const embed = notion.addBlock(page.id, { embed: 'https://example.org/a/' });
    expect((await call(notion, 'GET', `v1/blocks/${page.id}/children`)).body).toMatchObject({ status: 404, code: 'object_not_found' });
    expect((await call(notion, 'PATCH', `v1/blocks/${embed}`, { embed: { url: 'https://example.org/b/' } })).status).toBe(404);
  });
});

describe('the in-memory Notion, for the views of a database', () => {
  it('lists the views of a data source by id only, and answers each with what it shows', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId, id } = store(notion);
    const board = notion.addView(dataSourceId, 'board');
    const form = notion.addView(dataSourceId, 'form');

    const listed = await call(notion, 'GET', `v1/views?data_source_id=${dataSourceId}`);
    expect(listed.body.results).toHaveLength(3);
    expect(listed.body.results[1]).toEqual({ object: 'view', id: board });
    expect((await call(notion, 'GET', 'v1/views')).status).toBe(400);

    const table = await call(notion, 'GET', `v1/views/${listed.body.results[0].id}`);
    expect(table.body).toMatchObject({ object: 'view', type: 'table', data_source_id: dataSourceId, parent: { type: 'database_id', database_id: id }, configuration: { type: 'table' } });
    // A view that was never configured lists no property: it shows them all.
    expect(table.body.configuration.properties).toBeUndefined();
    expect((await call(notion, 'GET', `v1/views/${form}`)).body.configuration).toEqual({ type: 'form' });
  });

  it('replaces what a view says of its properties by what is given, and refuses what Notion would', async () => {
    const notion = createMemoryNotion();
    const { dataSourceId } = store(notion);
    const [view] = notion.views(dataSourceId) as { id: string }[];
    const order = (notion.properties(dataSourceId).Order as { id: string }).id;
    const change = (configuration: unknown) => call(notion, 'PATCH', `v1/views/${view.id}`, { configuration });

    const changed = await change({ type: 'table', properties: [{ property_id: 'title', visible: true, width: 300 }, { property_id: order, visible: false }] });
    const said = changed.body.configuration.properties as { property_name: string; visible: boolean }[];
    expect(said.slice(0, 2)).toEqual([
      { property_id: 'title', property_name: 'name', visible: true, width: 300 },
      { property_id: order, property_name: 'Order', visible: false },
    ]);
    // Every property the list leaves out is hidden, as Notion does.
    expect(said).toHaveLength(Object.keys(notion.properties(dataSourceId)).length);
    expect(said.slice(2).every((each) => each.visible === false)).toBe(true);
    expect((await change({ type: 'board', properties: [] })).status).toBe(400);
    expect((await change({ type: 'table', properties: [{ property_id: 'none', visible: false }] })).status).toBe(400);
    expect((await change({ type: 'table', properties: [{ property_id: order, property_name: 'Order', visible: false }] })).status).toBe(400);
    notion.denyWrites(notion.me);
    expect((await change({ type: 'table', properties: [] })).status).toBe(403);
    expect((notion.views(dataSourceId)[0] as { configuration: { properties: unknown[] } }).configuration.properties).toHaveLength(Object.keys(notion.properties(dataSourceId)).length);
  });
});
