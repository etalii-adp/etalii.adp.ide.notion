// An in-memory Notion at the level of HTTP: it answers as https://api.notion.com does, in API
// version 2026-03-11, for the calls the service forwards and for the two of the grant of access.
// It models what a store needs and nothing else; a call or a shape outside that is refused, so
// that a test never passes on something Notion would not do.

type Json = Record<string, unknown>;

export interface MemoryPerson {
  id: string;
  name: string;
  token: string;
}

export interface MemoryDatabase {
  id: string;
  /** The first data source, which is the only one unless more were asked for. */
  dataSourceId: string;
  dataSourceIds: string[];
}

/** A page as Notion answers it. */
export interface MemoryPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  created_by: { object: 'user'; id: string };
  last_edited_by: { object: 'user'; id: string };
  in_trash: boolean;
  parent: { type: 'data_source_id'; data_source_id: string; database_id: string };
  properties: Record<string, Json>;
  url: string;
}

/**
 * A property value: either as Notion takes it in a write (`{ number: 3 }`), or plain: a string
 * for title, rich text and select, a number, a boolean, and a list of strings for multi-select
 * (option names) and relation (row ids).
 */
export type MemoryValue = string | number | boolean | null | string[] | Json;

export type MemoryFailure = 'unauthorized' | 'rate-limited' | 'offline';

export interface MemoryNotionOptions {
  /** The clock's first reading. Default `2026-01-01T00:00:00.000Z`. */
  start?: string;
  /** Milliseconds the clock moves before each write. Default one minute, Notion's own precision. */
  tick?: number;
  workspace?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface MemoryNotion {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
  /** Every call that arrived, as `METHOD /path`, the refused and failed ones too. */
  readonly calls: string[];
  /** The first person, whose token is `memory-token`. */
  readonly me: MemoryPerson;
  addPerson(name: string): MemoryPerson;
  /** Makes a token that person's, whether it was valid before or not. */
  setPerson(token: string, person: MemoryPerson): void;
  revoke(token: string): void;
  /** A code that `v1/oauth/token` exchanges once for that person's tokens. */
  grantCode(person?: MemoryPerson): string;
  createDatabase(options?: {
    id?: string;
    title?: string;
    /** Property schemas by name, as Notion takes them. A relation without `data_source_id` relates to its own data source. */
    properties?: Record<string, Json>;
    dataSources?: number;
  }): MemoryDatabase;
  seedRows(dataSourceId: string, rows: Record<string, MemoryValue>[], by?: MemoryPerson): string[];
  updateRow(pageId: string, change: { properties?: Record<string, MemoryValue>; in_trash?: boolean }, by?: MemoryPerson): void;
  /** Every row in creation order, those in the trash too. */
  rows(dataSourceId: string): MemoryPage[];
  properties(dataSourceId: string): Record<string, Json>;
  now(): string;
  advance(milliseconds: number): void;
  denyWrites(person: MemoryPerson, denied?: boolean): void;
  unshare(databaseId: string, unshared?: boolean): void;
  /** The next calls, one unless `times` says more, answer `401`, `429` with `Retry-After`, or reject. */
  failNext(kind: MemoryFailure, options?: { times?: number; retryAfter?: number }): void;
}

interface Schema extends Json {
  id: string;
  name: string;
  type: string;
}

interface Source {
  id: string;
  databaseId: string;
  name: string;
  schemas: Schema[];
  pages: string[];
  created: string;
  edited: string;
}

interface Page {
  id: string;
  sourceId: string;
  created: string;
  edited: string;
  createdBy: string;
  editedBy: string;
  inTrash: boolean;
  /** By property id, so that a renamed property keeps its values. */
  values: Record<string, unknown>;
}

const TYPES = ['title', 'rich_text', 'number', 'checkbox', 'select', 'multi_select', 'relation'];
const DATE_CONDITIONS: Record<string, (row: number, asked: number) => boolean> = {
  after: (row, asked) => row > asked,
  on_or_after: (row, asked) => row >= asked,
  before: (row, asked) => row < asked,
  on_or_before: (row, asked) => row <= asked,
  equals: (row, asked) => row === asked,
};

interface Refusal extends Error {
  status: number;
  body: Json;
}

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, body: { object: 'error', status, code, message } });
}

function refuseGrant(status: number, error: string): never {
  throw Object.assign(new Error(error), { status, body: { error, error_description: error } });
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(id: string): string {
  const hex = id.replaceAll('-', '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : id;
}

function richText(content: string): Json {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    plain_text: content,
    href: null,
  };
}

function empty(type: string): unknown {
  return type === 'checkbox' ? false : type === 'number' || type === 'select' ? null : [];
}

export function createMemoryNotion(options: MemoryNotionOptions = {}): MemoryNotion {
  const tick = options.tick ?? 60_000;
  const workspace = options.workspace ?? 'Memory workspace';
  const credentials = btoa(`${options.clientId ?? 'memory-client'}:${options.clientSecret ?? 'memory-secret'}`);
  let clock = Date.parse(options.start ?? '2026-01-01T00:00:00.000Z');
  let counter = 0;

  const persons = new Map<string, MemoryPerson>();
  const tokens = new Map<string, string>();
  const codes = new Map<string, string>();
  const refreshes = new Map<string, string>();
  const readOnly = new Set<string>();
  const databases = new Map<string, { id: string; title: string; sources: string[]; unshared: boolean }>();
  const sources = new Map<string, Source>();
  const pages = new Map<string, Page>();
  const failures: { kind: MemoryFailure; retryAfter: number }[] = [];
  const calls: string[] = [];

  const nextId = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
  const now = () => new Date(clock).toISOString();
  const write = () => {
    clock += tick;
    return now();
  };

  function addPerson(name: string, token?: string): MemoryPerson {
    const id = nextId();
    const person = { id, name, token: token ?? `memory-token-${persons.size + 1}` };
    persons.set(id, person);
    tokens.set(person.token, id);
    return person;
  }
  const me = addPerson('Memory person', 'memory-token');

  // Lookups for the calls: what is not shared is not found, as Notion answers it.
  function sourceOf(id: string, shared = true): Source {
    const source = sources.get(canonical(id));
    if (!source || (shared && databases.get(source.databaseId)!.unshared)) {
      fail(404, 'object_not_found', `Could not find data source with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`);
    }
    return source;
  }

  function pageOf(id: string, shared = true): Page {
    const page = pages.get(canonical(id));
    if (!page || (shared && databases.get(sources.get(page.sourceId)!.databaseId)!.unshared)) {
      fail(404, 'object_not_found', `Could not find page with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`);
    }
    return page;
  }

  function option(schema: Schema, name: unknown): Json {
    if (typeof name !== 'string' || name === '') fail(400, 'validation_error', `${schema.name} is expected to be ${schema.type}.`);
    if (name.includes(',')) fail(400, 'validation_error', `Invalid ${schema.type} option, commas not allowed: ${name}`);
    const known = (schema[schema.type] as { options: Json[] }).options;
    let found = known.find((candidate) => candidate.name === name);
    if (!found) {
      found = { id: nextId(), name, color: 'default', description: null };
      known.push(found);
    }
    return { id: found.id, name, color: found.color };
  }

  function toSchema(name: string, input: unknown, source: Source): Schema {
    if (!isObject(input)) fail(400, 'validation_error', `body.properties.${name} should be an object.`);
    const type = typeof input.type === 'string' ? input.type : TYPES.find((candidate) => candidate in input);
    if (!type || !TYPES.includes(type)) fail(400, 'validation_error', `body.properties.${name} has no type the memory Notion models.`);
    const given = isObject(input[type]) ? (input[type] as Json) : {};
    const schema: Schema = { id: type === 'title' ? 'title' : `p${(++counter).toString(36)}`, name, description: null, type };
    if (type === 'number') schema.number = { format: given.format ?? 'number' };
    else if (type === 'select' || type === 'multi_select') {
      schema[type] = { options: [] };
      for (const each of Array.isArray(given.options) ? (given.options as Json[]) : []) option(schema, each.name);
    } else if (type === 'relation') {
      const target = typeof given.data_source_id === 'string' ? sourceOf(given.data_source_id) : source;
      schema.relation = { database_id: target.databaseId, data_source_id: target.id, type: 'single_property', single_property: {} };
    } else schema[type] = {};
    return schema;
  }

  function toStored(schema: Schema, input: MemoryValue): unknown {
    const { name, type } = schema;
    const wrong = (): never => fail(400, 'validation_error', `${name} is expected to be ${type}.`);
    if (isObject(input) && !(type in input)) wrong();
    const value = isObject(input) ? input[type] : input;
    switch (type) {
      case 'title':
      case 'rich_text': {
        const items = typeof value === 'string' ? (value === '' ? [] : [{ text: { content: value } }]) : value;
        if (!Array.isArray(items)) return wrong();
        return items.map((item: unknown) => {
          const content = isObject(item) && isObject(item.text) ? item.text.content : undefined;
          if (typeof content !== 'string') return wrong();
          if (content.length > 2000) fail(400, 'validation_error', `${name}.text.content.length should be ≤ 2000, instead was ${content.length}.`);
          return richText(content);
        });
      }
      case 'number':
        return value === null || typeof value === 'number' ? value : wrong();
      case 'checkbox':
        return typeof value === 'boolean' ? value : wrong();
      case 'select':
        return value === null ? null : option(schema, isObject(value) ? value.name : value);
      case 'multi_select':
        return Array.isArray(value) ? value.map((each: unknown) => option(schema, isObject(each) ? each.name : each)) : wrong();
      default:
        if (!Array.isArray(value)) return wrong();
        return value.map((each: unknown) => {
          const id = isObject(each) ? each.id : each;
          return typeof id === 'string' ? { id: pageOf(id).id } : wrong();
        });
    }
  }

  function setValues(page: Page, source: Source, properties: unknown): void {
    if (properties === undefined) return;
    if (!isObject(properties)) fail(400, 'validation_error', 'body.properties should be an object.');
    // Checked in full before anything is kept: a refused write changes nothing.
    const stored = Object.entries(properties).map(([name, value]) => {
      const schema = source.schemas.find((candidate) => candidate.name === name);
      if (!schema) return fail(400, 'validation_error', `${name} is not a property that exists.`);
      return [schema.id, toStored(schema, value as MemoryValue)] as const;
    });
    for (const [id, value] of stored) page.values[id] = value;
  }

  function createRow(source: Source, properties: unknown, by: MemoryPerson): Page {
    const page: Page = { id: nextId(), sourceId: source.id, created: '', edited: '', createdBy: by.id, editedBy: by.id, inTrash: false, values: {} };
    setValues(page, source, properties);
    page.created = page.edited = write();
    pages.set(page.id, page);
    source.pages.push(page.id);
    return page;
  }

  function changeRow(page: Page, change: Json, by: MemoryPerson): void {
    if (change.in_trash !== undefined && typeof change.in_trash !== 'boolean') fail(400, 'validation_error', 'body.in_trash should be a boolean.');
    if (page.inTrash && change.in_trash !== false) fail(400, 'validation_error', "Can't edit a page that is in the trash. Restore it first.");
    setValues(page, sources.get(page.sourceId)!, change.properties);
    if (typeof change.in_trash === 'boolean') page.inTrash = change.in_trash;
    page.edited = write();
    page.editedBy = by.id;
  }

  function showPage(page: Page): MemoryPage {
    const source = sources.get(page.sourceId)!;
    const properties: Record<string, Json> = {};
    for (const schema of source.schemas) {
      const value = structuredClone(page.values[schema.id] ?? empty(schema.type));
      properties[schema.name] = { id: schema.id, type: schema.type, [schema.type]: value, ...(schema.type === 'relation' ? { has_more: false } : {}) };
    }
    return {
      object: 'page',
      id: page.id,
      created_time: page.created,
      last_edited_time: page.edited,
      created_by: { object: 'user', id: page.createdBy },
      last_edited_by: { object: 'user', id: page.editedBy },
      in_trash: page.inTrash,
      parent: { type: 'data_source_id', data_source_id: source.id, database_id: source.databaseId },
      properties,
      url: `https://www.notion.so/${page.id.replaceAll('-', '')}`,
    };
  }

  function showProperties(source: Source): Record<string, Json> {
    return Object.fromEntries(source.schemas.map((schema) => [schema.name, structuredClone(schema)]));
  }

  function showSource(source: Source): Json {
    const parent = { type: 'database_id', database_id: source.databaseId };
    return {
      object: 'data_source',
      id: source.id,
      title: [richText(source.name)],
      parent,
      database_parent: { type: 'workspace', workspace: true },
      properties: showProperties(source),
      in_trash: false,
      created_time: source.created,
      last_edited_time: source.edited,
    };
  }

  function changeSource(source: Source, body: Json): void {
    if (!isObject(body.properties)) fail(400, 'validation_error', 'body.properties should be an object.');
    const next = source.schemas.map((schema) => ({ ...schema }));
    for (const [key, input] of Object.entries(body.properties)) {
      const index = next.findIndex((schema) => schema.name === key || schema.id === key);
      if (index < 0) {
        if (input === null) continue;
        const schema = toSchema(isObject(input) && typeof input.name === 'string' ? input.name : key, input, source);
        if (schema.type === 'title') fail(400, 'validation_error', 'A data source has one title property.');
        next.push(schema);
      } else if (input === null) {
        if (next[index].type === 'title') fail(400, 'validation_error', 'The title property cannot be removed.');
        next.splice(index, 1);
      } else {
        if (!isObject(input)) fail(400, 'validation_error', `body.properties.${key} should be an object.`);
        // A store renames and adds; it never changes a type, so that is not modelled.
        const type = typeof input.type === 'string' ? input.type : TYPES.find((candidate) => candidate in input);
        if (type && type !== next[index].type) fail(400, 'validation_error', `The memory Notion does not change the type of ${key}.`);
        if (typeof input.name === 'string') next[index].name = input.name;
      }
    }
    if (new Set(next.map((schema) => schema.name)).size < next.length) fail(400, 'validation_error', 'Two properties cannot have the same name.');
    source.schemas = next;
    source.edited = write();
  }

  function sortValue(page: Page, source: Source, sort: Json): unknown {
    if (sort.timestamp === 'created_time') return page.created;
    if (sort.timestamp === 'last_edited_time') return page.edited;
    const schema = source.schemas.find((candidate) => candidate.name === sort.property || candidate.id === sort.property);
    if (!schema) return fail(400, 'validation_error', `Could not find sort property with name or id: ${String(sort.property)}`);
    const value = page.values[schema.id] ?? empty(schema.type);
    if (schema.type === 'title' || schema.type === 'rich_text') return (value as { plain_text: string }[]).map((item) => item.plain_text).join('');
    if (schema.type === 'select') return (value as { name: string } | null)?.name ?? null;
    return schema.type === 'number' || schema.type === 'checkbox' ? value : null;
  }

  function query(source: Source, body: Json): Json {
    const size = body.page_size ?? 100;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 100) {
      fail(400, 'validation_error', 'body.page_size should be an integer from 1 to 100.');
    }
    let found = source.pages.map((id) => pages.get(id)!).filter((page) => !page.inTrash);

    if (body.filter !== undefined) {
      const filter = body.filter;
      const stamp = isObject(filter) ? filter.timestamp : undefined;
      const condition = isObject(filter) && typeof stamp === 'string' ? filter[stamp] : undefined;
      const [name, asked] = isObject(condition) ? (Object.entries(condition)[0] ?? []) : [];
      const test = name === undefined ? undefined : DATE_CONDITIONS[name];
      if ((stamp !== 'last_edited_time' && stamp !== 'created_time') || !test || typeof asked !== 'string' || Number.isNaN(Date.parse(asked))) {
        fail(400, 'validation_error', 'The memory Notion filters on the created_time and last_edited_time timestamps only.');
      }
      found = found.filter((page) => test(Date.parse(stamp === 'created_time' ? page.created : page.edited), Date.parse(asked)));
    }

    const sorts = body.sorts ?? [];
    if (!Array.isArray(sorts) || !sorts.every(isObject)) fail(400, 'validation_error', 'body.sorts should be an array of objects.');
    const keyed = found.map((page) => ({ page, keys: (sorts as Json[]).map((sort) => sortValue(page, source, sort)) }));
    keyed.sort((left, right) => {
      for (let index = 0; index < sorts.length; index++) {
        const a = left.keys[index] as string | number | null;
        const b = right.keys[index] as string | number | null;
        if (a === b) continue;
        if (a === null) return 1;
        if (b === null) return -1;
        return (a < b ? -1 : 1) * ((sorts as Json[])[index].direction === 'descending' ? -1 : 1);
      }
      return 0;
    });
    found = keyed.map((each) => each.page);

    // The cursor is the id of the first row of the next page.
    let from = 0;
    if (body.start_cursor !== undefined && body.start_cursor !== null) {
      from = found.findIndex((page) => page.id === body.start_cursor);
      if (from < 0) fail(400, 'validation_error', 'The start_cursor provided is invalid.');
    }
    const next = found[from + size];
    return {
      object: 'list',
      results: found.slice(from, from + size).map(showPage),
      next_cursor: next ? next.id : null,
      has_more: next !== undefined,
      type: 'page_or_data_source',
      page_or_data_source: {},
    };
  }

  async function bodyOf(request: Request): Promise<Json> {
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      fail(400, 'invalid_json', 'Error parsing JSON body.');
    }
    return isObject(body) ? body : fail(400, 'validation_error', 'body should be an object.');
  }

  function issue(personId: string): Json {
    const access = `memory-access-${++counter}`;
    const refresh = `memory-refresh-${counter}`;
    tokens.set(access, personId);
    refreshes.set(refresh, personId);
    return {
      access_token: access,
      token_type: 'bearer',
      refresh_token: refresh,
      bot_id: nextId(),
      workspace_id: '00000000-0000-4000-8000-ffffffffffff',
      workspace_name: workspace,
      workspace_icon: null,
      owner: { type: 'user', user: { object: 'user', id: personId } },
      duplicated_template_id: null,
    };
  }

  function grantCode(person: MemoryPerson = me): string {
    const code = `memory-code-${++counter}`;
    codes.set(code, person.id);
    return code;
  }

  async function grant(request: Request, url: URL): Promise<Response | Json> {
    if (request.method === 'GET' && url.pathname === '/v1/oauth/authorize') {
      // Where Notion asks the person, this grants at once, to the first person.
      const back = new URL(url.searchParams.get('redirect_uri') ?? refuseGrant(400, 'invalid_request'));
      back.searchParams.set('code', grantCode());
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      return new Response(null, { status: 302, headers: { Location: back.href } });
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/oauth/token') fail(400, 'invalid_request_url', 'Invalid request URL.');
    if (request.headers.get('Authorization') !== `Basic ${credentials}`) refuseGrant(401, 'invalid_client');
    const body = await bodyOf(request);
    const kept = body.grant_type === 'authorization_code' ? codes : body.grant_type === 'refresh_token' ? refreshes : refuseGrant(400, 'unsupported_grant_type');
    const key = String(body.grant_type === 'authorization_code' ? body.code : body.refresh_token);
    const personId = kept.get(key) ?? refuseGrant(400, 'invalid_grant');
    kept.delete(key);
    return issue(personId);
  }

  async function route(request: Request, url: URL): Promise<Response | Json> {
    const { method } = request;
    const path = url.pathname;
    if (path.startsWith('/v1/oauth/')) return grant(request, url);

    if (!request.headers.get('Notion-Version')) fail(400, 'missing_version', 'Notion-Version header failed validation: Notion-Version header should be defined.');
    const bearer = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    const person = persons.get(tokens.get(bearer ?? '') ?? '');
    if (!person) return fail(401, 'unauthorized', 'API token is invalid.');
    const mayWrite = () => {
      if (readOnly.has(person.id)) fail(403, 'restricted_resource', 'Insufficient permissions for this endpoint.');
    };

    if (method === 'GET' && path === '/v1/users/me') {
      return {
        object: 'user',
        id: nextId(),
        name: 'ADP',
        avatar_url: null,
        type: 'bot',
        bot: {
          owner: { type: 'user', user: { object: 'user', id: person.id, name: person.name, avatar_url: null, type: 'person', person: {} } },
          workspace_id: '00000000-0000-4000-8000-ffffffffffff',
          workspace_name: workspace,
        },
      };
    }

    let match = /^\/v1\/databases\/([^/]+)$/.exec(path);
    if (match && method === 'GET') {
      const database = databases.get(canonical(match[1]));
      if (!database || database.unshared) {
        return fail(404, 'object_not_found', `Could not find database with ID: ${match[1]}. Make sure the relevant pages and databases are shared with your integration.`);
      }
      return {
        object: 'database',
        id: database.id,
        title: [richText(database.title)],
        parent: { type: 'workspace', workspace: true },
        is_inline: false,
        in_trash: false,
        url: `https://www.notion.so/${database.id.replaceAll('-', '')}`,
        data_sources: database.sources.map((id) => ({ id, name: sources.get(id)!.name })),
      };
    }

    match = /^\/v1\/data_sources\/([^/]+)$/.exec(path);
    if (match && method === 'GET') return showSource(sourceOf(match[1]));
    if (match && method === 'PATCH') {
      const source = sourceOf(match[1]);
      mayWrite();
      changeSource(source, await bodyOf(request));
      return showSource(source);
    }

    match = /^\/v1\/data_sources\/([^/]+)\/query$/.exec(path);
    if (match && method === 'POST') return query(sourceOf(match[1]), await bodyOf(request));

    if (method === 'POST' && path === '/v1/pages') {
      const body = await bodyOf(request);
      const parent = isObject(body.parent) ? body.parent.data_source_id : undefined;
      if (typeof parent !== 'string') return fail(400, 'validation_error', 'body.parent.data_source_id should be defined.');
      const source = sourceOf(parent);
      mayWrite();
      return showPage(createRow(source, body.properties, person)) as unknown as Json;
    }

    match = /^\/v1\/pages\/([^/]+)$/.exec(path);
    if (match && method === 'PATCH') {
      const page = pageOf(match[1]);
      mayWrite();
      changeRow(page, await bodyOf(request), person);
      return showPage(page) as unknown as Json;
    }

    return fail(400, 'invalid_request_url', 'Invalid request URL.');
  }

  const json = (status: number, body: Json, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

  return {
    calls,
    me,
    addPerson: (name) => addPerson(name),
    setPerson: (token, person) => void tokens.set(token, person.id),
    revoke: (token) => void tokens.delete(token),
    grantCode,
    now,
    advance: (milliseconds) => void (clock += milliseconds),
    denyWrites: (person, denied = true) => void (denied ? readOnly.add(person.id) : readOnly.delete(person.id)),
    properties: (dataSourceId) => showProperties(sourceOf(dataSourceId, false)),
    rows: (dataSourceId) => sourceOf(dataSourceId, false).pages.map((id) => showPage(pages.get(id)!)),
    seedRows: (dataSourceId, rows, by = me) => rows.map((properties) => createRow(sourceOf(dataSourceId, false), properties, by).id),
    updateRow: (pageId, change, by = me) => changeRow(pageOf(pageId, false), change, by),

    unshare(databaseId, unshared = true) {
      const database = databases.get(canonical(databaseId));
      if (!database) throw new Error(`No database ${databaseId}`);
      database.unshared = unshared;
    },

    failNext(kind, { times = 1, retryAfter = 1 } = {}) {
      for (let count = 0; count < times; count++) failures.push({ kind, retryAfter });
    },

    createDatabase({ id, title = 'Memory database', properties = { Name: { title: {} } }, dataSources = 1 } = {}) {
      const database = { id: id ? canonical(id) : nextId(), title, sources: [] as string[], unshared: false };
      databases.set(database.id, database);
      for (let count = 0; count < dataSources; count++) {
        const source: Source = { id: nextId(), databaseId: database.id, name: count === 0 ? title : `${title} ${count + 1}`, schemas: [], pages: [], created: now(), edited: now() };
        sources.set(source.id, source);
        database.sources.push(source.id);
        source.schemas = Object.entries(properties).map(([name, input]) => toSchema(name, input, source));
        if (!source.schemas.some((schema) => schema.type === 'title')) source.schemas.unshift(toSchema('Name', { title: {} }, source));
      }
      return { id: database.id, dataSourceId: database.sources[0], dataSourceIds: [...database.sources] };
    },

    async fetch(input, init) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      const failure = failures.shift();
      if (failure?.kind === 'offline') throw new TypeError('fetch failed');
      if (failure?.kind === 'unauthorized') return json(401, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' });
      if (failure) {
        return json(429, { object: 'error', status: 429, code: 'rate_limited', message: 'You have been rate limited. Please try again in a few minutes.' }, { 'Retry-After': String(failure.retryAfter) });
      }
      try {
        const answer = await route(request, url);
        return answer instanceof Response ? answer : json(200, answer);
      } catch (error) {
        const refusal = error as Partial<Refusal>;
        if (typeof refusal.status !== 'number' || !refusal.body) throw error;
        return json(refusal.status, refusal.body);
      }
    },
  };
}
