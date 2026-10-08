import { beforeEach, describe, expect, it } from 'vitest';
import { createNotionCalls, NotionError, type NotionCalls, type NotionStatus } from '../../src/store/notion';
import { ConnectError, createSession, type Session } from '../../src/store/session';
import type { MemoryDatabase } from '../support/memoryNotion';
import { createMemoryService, createMemoryStorage, type MemoryService } from '../support/memoryService';

const KEY = 'adp-notion.token';

let service: MemoryService;
let storage: Storage;
let session: Session;
let calls: NotionCalls;
let database: MemoryDatabase;
/** The clock, moved by the sleeps only: no test waits in real time. */
let clock: number;
let slept: number[];
/** When each request left for the service, by the clock. */
let sentAt: number[];
let statuses: NotionStatus[];

const notion = () => service.notion;
const title = (text: string) => ({ Name: { title: [{ text: { content: text } }] } });
const names = () =>
  notion()
    .rows(database.dataSourceId)
    .filter((row) => !row.in_trash)
    .map((row) => (row.properties.Name.title as { plain_text: string }[])[0].plain_text);

async function failure(promise: Promise<unknown>): Promise<NotionError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(NotionError);
  return error as NotionError;
}

function connect(kept: { token: string; refresh: string | null } = { token: 'memory-token', refresh: null }): void {
  storage.setItem(KEY, JSON.stringify({ ...kept, workspace: 'A workspace' }));
}

beforeEach(() => {
  service = createMemoryService({ workspace: 'A workspace' });
  storage = createMemoryStorage();
  connect();
  session = createSession({ service: service.address, storage, fetch: service.fetch, open: () => null, listen: () => () => undefined });
  clock = 0;
  slept = [];
  sentAt = [];
  statuses = [];
  calls = createNotionCalls({
    service: service.address,
    session,
    fetch: (input, init) => {
      sentAt.push(clock);
      return service.fetch(input, init);
    },
    now: () => clock,
    sleep: async (milliseconds) => {
      slept.push(milliseconds);
      clock += milliseconds;
    },
  });
  calls.onStatus((status) => statuses.push(status));
  database = notion().createDatabase({
    title: 'A store',
    properties: { Name: { title: {} }, Order: { number: {} }, Kind: { select: {} } },
  });
});

describe('reads', () => {
  it('says who the token is of', async () => {
    const me = await calls.me();
    expect(me.bot?.owner?.user?.id).toBe(notion().me.id);
    expect(me.bot?.workspace_name).toBe('A workspace');
    expect(service.requests).toEqual(['GET /notion/v1/users/me']);
  });

  it('reads the database with its data sources, and a data source\'s properties', async () => {
    const read = await calls.database(database.id);
    expect(read.title[0].plain_text).toBe('A store');
    expect(read.data_sources.map((each) => each.id)).toEqual([database.dataSourceId]);

    const source = await calls.dataSource(database.dataSourceId);
    expect(Object.fromEntries(Object.entries(source.properties).map(([name, property]) => [name, property.type]))).toEqual({
      Name: 'title',
      Order: 'number',
      Kind: 'select',
    });
    expect(statuses).toEqual([]);
  });

  it('reads the rows a page at a time, sorted, without those in the trash', async () => {
    const ids = notion().seedRows(database.dataSourceId, [
      { Name: 'c', Order: 3 },
      { Name: 'a', Order: 1 },
      { Name: 'trashed', Order: 0 },
      { Name: 'b', Order: 2 },
    ]);
    notion().updateRow(ids[2], { in_trash: true });

    const sorts = [{ property: 'Order', direction: 'ascending' as const }];
    const first = await calls.query(database.dataSourceId, { pageSize: 2, sorts });
    expect(first.results.map((row) => row.properties.Order.number)).toEqual([1, 2]);
    expect(first.has_more).toBe(true);
    const second = await calls.query(database.dataSourceId, { pageSize: 2, sorts, cursor: first.next_cursor! });
    expect(second.results.map((row) => row.properties.Order.number)).toEqual([3]);
    expect(second).toMatchObject({ has_more: false, next_cursor: null });
    expect(second.results[0]).toMatchObject({ id: ids[0], in_trash: false, last_edited_by: { id: notion().me.id } });
  });

  it('asks for 100 rows a call when it is told no size', async () => {
    notion().seedRows(database.dataSourceId, Array.from({ length: 101 }, (_, index) => ({ Name: `row ${index}` })));
    const first = await calls.query(database.dataSourceId);
    expect(first.results).toHaveLength(100);
    expect((await calls.query(database.dataSourceId, { cursor: first.next_cursor! })).results).toHaveLength(1);
  });

  it('asks for the rows edited or created since a time', async () => {
    const [old] = notion().seedRows(database.dataSourceId, [{ Name: 'old' }, { Name: 'still' }]);
    notion().advance(600_000);
    const since = notion().now();
    expect((await calls.query(database.dataSourceId, { editedSince: since })).results).toEqual([]);

    notion().updateRow(old, { properties: { Order: 5 } });
    const [made] = notion().seedRows(database.dataSourceId, [{ Name: 'new' }]);
    const found = await calls.query(database.dataSourceId, { editedSince: since });
    expect(found.results.map((row) => row.id).sort()).toEqual([old, made].sort());
  });

  it('tells a database that is not shared from one that is', async () => {
    notion().unshare(database.id);
    const error = await failure(calls.database(database.id));
    expect(error).toMatchObject({ kind: 'refused', status: 404, code: 'object_not_found' });
    expect(calls.status()).toBe('idle');
    expect(statuses).toEqual([]);
  });
});

describe('writes', () => {
  it('creates a row, changes it, and moves it to the trash and back', async () => {
    const row = await calls.edit((writes) => writes.createRow(database.dataSourceId, { ...title('one'), Order: { number: 1 } }));
    expect(notion().rows(database.dataSourceId)).toHaveLength(1);
    expect(row.properties.Order.number).toBe(1);

    const changed = await calls.edit((writes) => writes.updateRow(row.id, { Order: { number: 2 }, Kind: { select: { name: 'k' } } }));
    expect(changed.properties.Order.number).toBe(2);
    expect(notion().rows(database.dataSourceId)[0].properties.Kind.select).toMatchObject({ name: 'k' });

    expect((await calls.edit((writes) => writes.trashRow(row.id, true))).in_trash).toBe(true);
    expect(names()).toEqual([]);
    expect((await calls.edit((writes) => writes.trashRow(row.id, false))).in_trash).toBe(false);
    expect(names()).toEqual(['one']);
  });

  it('adds properties to a data source and renames one', async () => {
    const source = await calls.edit((writes) =>
      writes.updateProperties(database.dataSourceId, { Name: { name: 'id' }, text: { rich_text: {} }, done: { checkbox: {} } }),
    );
    expect(Object.keys(source.properties).sort()).toEqual(['Kind', 'Order', 'done', 'id', 'text']);
    expect(notion().properties(database.dataSourceId).id.type).toBe('title');
  });

  it('sends the edits in the order they were made, and the writes of one edit in the order given', async () => {
    // Neither the edits nor the writes inside them are awaited one by one.
    const edits = [
      calls.edit((writes) => Promise.all(['a1', 'a2', 'a3'].map((name) => writes.createRow(database.dataSourceId, title(name))))),
      calls.edit((writes) => Promise.all(['b1', 'b2'].map((name) => writes.createRow(database.dataSourceId, title(name))))),
      calls.edit((writes) => writes.createRow(database.dataSourceId, title('c1'))),
    ];
    expect(calls.status()).toBe('storing');
    expect(notion().calls).toEqual([]);
    await Promise.all(edits);
    expect(names()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'c1']);
    expect(calls.status()).toBe('idle');
    expect(statuses).toEqual(['storing', 'idle']);
  });

  it('gives a later write of an edit the answer of an earlier one', async () => {
    notion().createDatabase();
    const source = notion().createDatabase({ properties: { Name: { title: {} }, to: { relation: {} } } }).dataSourceId;
    const [first, second] = await calls.edit(async (writes) => {
      const target = await writes.createRow(source, title('target'));
      return [target, await writes.createRow(source, { ...title('holder'), to: { relation: [{ id: target.id }] } })];
    });
    expect(second.properties.to.relation).toEqual([{ id: first.id }]);
  });
});

describe('the limit', () => {
  function atMostThreeASecond(): void {
    for (let index = 3; index < sentAt.length; index++) expect(sentAt[index] - sentAt[index - 3]).toBeGreaterThanOrEqual(1000);
  }

  it('sends at most three writes a second', async () => {
    await calls.edit((writes) => Promise.all(Array.from({ length: 10 }, (_, index) => writes.createRow(database.dataSourceId, title(`row ${index}`)))));
    expect(sentAt).toHaveLength(10);
    expect(sentAt.slice(0, 4)).toEqual([0, 0, 0, 1000]);
    atMostThreeASecond();
    expect(clock).toBe(3000);
  });

  it('counts reads and writes against the same limit', async () => {
    await Promise.all([
      calls.me(),
      calls.edit((writes) => writes.createRow(database.dataSourceId, title('one'))),
      calls.database(database.id),
      calls.dataSource(database.dataSourceId),
      calls.query(database.dataSourceId),
      calls.edit((writes) => writes.createRow(database.dataSourceId, title('two'))),
      calls.me(),
    ]);
    expect(sentAt).toHaveLength(7);
    atMostThreeASecond();
    expect(names()).toEqual(['one', 'two']);
  });

  it('waits for nothing when the requests are far apart', async () => {
    for (let count = 0; count < 5; count++) {
      await calls.me();
      clock += 400;
    }
    expect(slept).toEqual([]);
  });

  it('waits out a 429 by its Retry-After and tries again, storing all the while', async () => {
    notion().failNext('rate-limited', { times: 2, retryAfter: 7 });
    const row = await calls.edit((writes) => writes.createRow(database.dataSourceId, title('one')));
    expect(row.id).toBe(notion().rows(database.dataSourceId)[0].id);
    expect(notion().calls).toEqual(['POST /v1/pages', 'POST /v1/pages', 'POST /v1/pages']);
    expect(sentAt).toEqual([0, 7000, 14000]);
    expect(statuses).toEqual(['storing', 'idle']);
  });

  it('holds every other request back while a Retry-After is waited out', async () => {
    notion().failNext('rate-limited', { retryAfter: 4 });
    await calls.me();
    await calls.me();
    expect(sentAt).toEqual([0, 4000, 4000]);
  });
});

describe('a write that fails', () => {
  it('stops the queue on a refusal and sends nothing that is queued behind it', async () => {
    const [kept] = notion().seedRows(database.dataSourceId, [{ Name: 'kept' }]);
    const first = calls.edit(async (writes) => {
      await writes.updateRow(kept, { Order: { number: 1 } });
      // Notion refuses this one: the property does not exist.
      const refused = writes.updateRow(kept, { Missing: { number: 2 } });
      const behind = writes.updateRow(kept, { Order: { number: 3 } });
      return Promise.all([refused, behind.catch((error: unknown) => error)]);
    });
    const second = calls.edit((writes) => writes.createRow(database.dataSourceId, title('never')));
    const third = calls.edit((writes) => writes.trashRow(kept, true));

    expect(await failure(first)).toMatchObject({ kind: 'refused', status: 400, code: 'validation_error' });
    expect(await failure(second)).toMatchObject({ kind: 'discarded' });
    expect(await failure(third)).toMatchObject({ kind: 'discarded' });

    // The write stored before the refusal is not taken back, and nothing behind it arrived.
    expect(notion().calls.filter((call) => !call.startsWith('GET'))).toHaveLength(2);
    expect(notion().rows(database.dataSourceId)[0].properties.Order.number).toBe(1);
    expect(names()).toEqual(['kept']);
    expect(calls.status()).toBe('failed');
    expect(statuses).toEqual(['storing', 'failed']);
  });

  it('rejects the edit with the refusal even where the edit took it for an answer', async () => {
    const edit = calls.edit(async (writes) => {
      await writes.updateRow(notion().seedRows(database.dataSourceId, [{ Name: 'one' }])[0], { Missing: { number: 2 } }).catch(() => undefined);
      return writes.createRow(database.dataSourceId, title('never'));
    });
    expect(await failure(edit)).toMatchObject({ kind: 'refused', code: 'validation_error' });
    expect(names()).toEqual(['one']);
    expect(calls.status()).toBe('failed');
  });

  it('tells a write the user may not make from one Notion cannot take', async () => {
    notion().denyWrites(notion().me);
    const error = await failure(calls.edit((writes) => writes.createRow(database.dataSourceId, title('one'))));
    expect(error).toMatchObject({ kind: 'refused', status: 403, code: 'restricted_resource' });
    expect(notion().rows(database.dataSourceId)).toEqual([]);
  });

  it('takes the next edit after a failure, and is idle again when it is stored', async () => {
    notion().denyWrites(notion().me);
    await failure(calls.edit((writes) => writes.createRow(database.dataSourceId, title('one'))));
    notion().denyWrites(notion().me, false);
    await calls.edit((writes) => writes.createRow(database.dataSourceId, title('two')));
    expect(names()).toEqual(['two']);
    expect(statuses).toEqual(['storing', 'failed', 'storing', 'idle']);
  });

  it('stops the queue when the edit itself fails', async () => {
    const first = calls.edit(() => {
      throw new RangeError('not a write');
    });
    const second = calls.edit((writes) => writes.createRow(database.dataSourceId, title('never')));
    await expect(first).rejects.toBeInstanceOf(RangeError);
    expect(await failure(second)).toMatchObject({ kind: 'discarded' });
    expect(calls.status()).toBe('failed');
  });
});

describe('the service out of reach', () => {
  it('is offline when a write cannot reach the service, and discards what is queued behind it', async () => {
    service.unreachable();
    const first = calls.edit((writes) => writes.createRow(database.dataSourceId, title('one')));
    const second = calls.edit((writes) => writes.createRow(database.dataSourceId, title('two')));
    expect(await failure(first)).toMatchObject({ kind: 'offline', status: 0 });
    expect(await failure(second)).toMatchObject({ kind: 'discarded' });
    expect(notion().calls).toEqual([]);
    expect(statuses).toEqual(['storing', 'offline']);
  });

  it('is offline when the service cannot reach Notion', async () => {
    notion().failNext('offline');
    expect(await failure(calls.edit((writes) => writes.createRow(database.dataSourceId, title('one'))))).toMatchObject({
      kind: 'offline',
      status: 502,
      code: 'bad_gateway',
    });
    expect(calls.status()).toBe('offline');
  });

  it('is offline when a read finds it so, and idle when the next call is answered', async () => {
    service.unreachable();
    expect(await failure(calls.me())).toMatchObject({ kind: 'offline' });
    expect(calls.status()).toBe('offline');
    await calls.me();
    expect(statuses).toEqual(['offline', 'idle']);
  });
});

describe('a token Notion refuses', () => {
  /** A session whose token comes from a grant, so that it has a refresh token Notion takes. */
  async function granted(): Promise<void> {
    storage.removeItem(KEY);
    let take: (message: { origin: string; data: unknown }) => void = () => undefined;
    const fresh = createSession({
      service: service.address,
      storage,
      fetch: service.fetch,
      open: (url) => {
        void service.grant(url).then((message) => take(message));
        return { closed: false };
      },
      listen: (taker) => {
        take = taker;
        return () => undefined;
      },
      every: () => () => undefined,
    });
    await fresh.token();
    service.requests.length = 0;
  }
  const kept = () => JSON.parse(storage.getItem(KEY) ?? 'null') as { token: string; refresh: string } | null;

  it('renews the token once and makes the call again with the new one', async () => {
    await granted();
    const before = kept()!;
    notion().revoke(before.token);
    const me = await calls.me();
    expect(me.bot?.owner?.user?.id).toBe(notion().me.id);
    expect(service.requests).toEqual(['GET /notion/v1/users/me', 'POST /refresh', 'GET /notion/v1/users/me']);
    expect(kept()!.token).not.toBe(before.token);
    expect(kept()!.refresh).not.toBe(before.refresh);
  });

  it('renews once for calls refused at the same time, and for a write in the queue', async () => {
    await granted();
    notion().revoke(kept()!.token);
    await Promise.all([calls.me(), calls.me(), calls.edit((writes) => writes.createRow(database.dataSourceId, title('one')))]);
    expect(service.requests.filter((request) => request === 'POST /refresh')).toHaveLength(1);
    expect(names()).toEqual(['one']);
    expect(statuses).toEqual(['storing', 'idle']);
  });

  it('says the user must connect when the token cannot be renewed, and keeps nothing', async () => {
    connect({ token: 'never-given', refresh: 'never-given' });
    const error = await failure(calls.me());
    expect(error).toMatchObject({ kind: 'connect', status: 401, code: 'unauthorized' });
    expect(error.cause).toMatchObject({ reason: 'expired', code: 'invalid_grant' });
    expect(session.hasToken()).toBe(false);
  });

  it('says the user must connect when the renewed token is refused as well', async () => {
    await granted();
    notion().failNext('unauthorized', { times: 2 });
    // The second refusal comes after the token endpoint's answer, which is the second call.
    notion().failNext('unauthorized');
    notion().revoke(kept()!.token);
    const error = await failure(calls.me());
    expect(error).toMatchObject({ kind: 'connect' });
    expect(service.requests.filter((request) => request === 'POST /refresh').length).toBeLessThanOrEqual(1);
    expect(session.hasToken()).toBe(false);
  });

  it('is offline, with the token kept, when the service cannot be reached to renew it', async () => {
    await granted();
    const before = kept();
    notion().revoke(before!.token);
    const request = service.fetch;
    let count = 0;
    service.fetch = (input, init) => {
      if (++count === 2) service.unreachable();
      return request(input, init);
    };
    session = createSession({ service: service.address, storage, fetch: (input, init) => service.fetch(input, init) });
    calls = createNotionCalls({ service: service.address, session, fetch: (input, init) => service.fetch(input, init), now: () => clock, sleep: async () => undefined });
    expect(await failure(calls.me())).toMatchObject({ kind: 'offline' });
    expect(kept()).toEqual(before);
  });

  it('says the user must connect, and why, when no token is kept and the grant is not completed', async () => {
    storage.removeItem(KEY);
    // No window opens and nobody grants: the session's time is over at its first look.
    let time = 0;
    session = createSession({
      service: service.address, storage, fetch: service.fetch, open: () => null, listen: () => () => undefined,
      every: (check) => (queueMicrotask(check), () => undefined), now: () => (time += 300_000),
    });
    calls = createNotionCalls({ service: service.address, session, fetch: service.fetch, now: () => clock, sleep: async () => undefined });
    const error = await failure(calls.edit((writes) => writes.createRow(database.dataSourceId, title('one'))));
    expect(error).toMatchObject({ kind: 'connect' });
    expect(error.cause).toBeInstanceOf(ConnectError);
    expect(error.cause).toMatchObject({ reason: 'timeout' });
    expect(service.requests).toEqual([]);
    expect(calls.status()).toBe('failed');
  });
});

describe('the status', () => {
  it('stops telling a listener that asked to be left alone', async () => {
    const heard: NotionStatus[] = [];
    const stop = calls.onStatus((status) => heard.push(status));
    await calls.edit((writes) => writes.createRow(database.dataSourceId, title('one')));
    stop();
    await calls.edit((writes) => writes.createRow(database.dataSourceId, title('two')));
    expect(heard).toEqual(['storing', 'idle']);
    expect(statuses).toEqual(['storing', 'idle', 'storing', 'idle']);
  });
});
