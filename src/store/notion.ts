// The calls the store makes to Notion, through the service (etalii.adp spec 012,
// contracts/service.md). Reads are answered directly; writes go through one queue, so that the
// database receives the edits in the order they were made.

import { ConnectError, type Session } from './session';

/** Notion allows about three requests a second (research R2). */
const LIMIT = 3;
const WINDOW = 1000;

/** What the calls are doing, for the status the frame shows. */
export type NotionStatus = 'idle' | 'storing' | 'offline' | 'failed';

/**
 * Why a call gave no result. `refused`: Notion, or the service, answered with an error.
 * `offline`: the service or Notion could not be reached. `connect`: the user must connect.
 * `discarded`: a write that was never sent, because one before it failed.
 */
export type NotionErrorKind = 'refused' | 'offline' | 'connect' | 'discarded';

export class NotionError extends Error {
  override readonly name = 'NotionError';

  constructor(
    readonly kind: NotionErrorKind,
    /** The HTTP status of the answer; 0 when there was none. */
    readonly status: number,
    /** Notion's code, such as `object_not_found`, `restricted_resource` or `validation_error`. */
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

// Notion's own shapes, with the members a store reads and no other.

export interface NotionRichText {
  plain_text: string;
}

export interface NotionMe {
  id: string;
  bot?: {
    owner?: { type: string; user?: { id: string; name?: string | null } };
    workspace_name?: string | null;
  };
}

export interface NotionDatabase {
  id: string;
  title: NotionRichText[];
  data_sources: { id: string; name: string }[];
}

/** A property of a data source: `type` names the member that holds its configuration. */
export interface NotionProperty {
  id: string;
  name: string;
  type: string;
  [configuration: string]: unknown;
}

export interface NotionDataSource {
  id: string;
  properties: Record<string, NotionProperty>;
}

/** A property of a row: `type` names the member that holds its value. */
export interface NotionValue {
  id: string;
  type: string;
  [value: string]: unknown;
}

export interface NotionRow {
  id: string;
  created_time: string;
  last_edited_time: string;
  last_edited_by: { id: string };
  in_trash: boolean;
  properties: Record<string, NotionValue>;
}

export interface NotionRows {
  results: NotionRow[];
  next_cursor: string | null;
  has_more: boolean;
}

export type NotionSort = { direction: 'ascending' | 'descending' } & ({ property: string } | { timestamp: 'created_time' | 'last_edited_time' });

export interface NotionQuery {
  /** The `next_cursor` of the page before. */
  cursor?: string;
  /** Up to 100, which is also what is asked for when it is left out. */
  pageSize?: number;
  sorts?: NotionSort[];
  /** Only the rows edited or created at or after this time. */
  editedSince?: string;
}

/** Property values by name, as Notion takes them in a write, such as `{ number: 3 }`. */
export type NotionValues = Record<string, Record<string, unknown>>;

/** The writes of one edit. Each is sent after the one before it, awaited or not. */
export interface NotionWrites {
  /** Adds the properties that are missing, and renames one where `name` is given. */
  updateProperties(dataSourceId: string, properties: Record<string, Record<string, unknown>>): Promise<NotionDataSource>;
  createRow(dataSourceId: string, values: NotionValues): Promise<NotionRow>;
  updateRow(rowId: string, values: NotionValues): Promise<NotionRow>;
  /** Moves a row to the trash, or out of it. */
  trashRow(rowId: string, inTrash: boolean): Promise<NotionRow>;
}

export interface NotionCalls {
  me(): Promise<NotionMe>;
  database(databaseId: string): Promise<NotionDatabase>;
  dataSource(dataSourceId: string): Promise<NotionDataSource>;
  /** One page of rows; a row in the trash is never among them. */
  query(dataSourceId: string, query?: NotionQuery): Promise<NotionRows>;
  /**
   * Queues the writes of one edit and answers when all of them are stored. The first write that
   * fails stops the queue: the edit is rejected with that failure, and its later writes and
   * every edit queued behind it are rejected as `discarded` and never sent.
   */
  edit<T>(write: (writes: NotionWrites) => T | Promise<T>): Promise<T>;
  status(): NotionStatus;
  /** Tells a listener each change of the status; answers what stops it. */
  onStatus(listener: (status: NotionStatus) => void): () => void;
}

export interface NotionCallsOptions {
  /** The service's base address. */
  service: string;
  session: Session;
  fetch?: typeof fetch;
  /** The clock, in milliseconds. */
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function discarded(): NotionError {
  return new NotionError('discarded', 0, 'discarded', 'The write was not sent, because a write before it failed.');
}

export function createNotionCalls(options: NotionCallsOptions): NotionCalls {
  const service = options.service.replace(/\/$/, '');
  const { session } = options;
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const listeners = new Set<(status: NotionStatus) => void>();
  let queued = 0;
  let resting: Exclude<NotionStatus, 'storing'> = 'idle';
  let told: NotionStatus = 'idle';

  const status = (): NotionStatus => (queued > 0 ? 'storing' : resting);
  function tell(): void {
    if (status() === told) return;
    told = status();
    for (const listener of listeners) listener(told);
  }

  // The limit, for reads and writes alike: each request waits for its turn, and a turn is given
  // when fewer than three were sent in the last second and no `Retry-After` is being waited out.
  const sent: number[] = [];
  let notBefore = 0;
  let turns: Promise<void> = Promise.resolve();
  function turn(): Promise<void> {
    turns = turns.then(async () => {
      for (;;) {
        const wait = Math.max(notBefore - now(), sent.length < LIMIT ? 0 : sent[0] + WINDOW - now());
        if (wait <= 0) break;
        await sleep(wait);
      }
      sent.push(now());
      if (sent.length > LIMIT) sent.shift();
    });
    return turns;
  }

  function mustConnect(cause: unknown): NotionError {
    if (cause instanceof ConnectError && cause.reason === 'unreachable') {
      return new NotionError('offline', 0, 'unreachable', 'The service could not be reached.', { cause });
    }
    return new NotionError('connect', 401, 'unauthorized', 'The user must connect to Notion.', { cause });
  }

  async function ask<T>(method: string, path: string, body?: unknown): Promise<T> {
    let renewed = false;
    for (;;) {
      // Before the turn, so that a grant the user takes a minute over holds nothing up.
      const token = await session.token().catch((cause: unknown) => {
        throw mustConnect(cause);
      });
      await turn();
      let answer: Response;
      try {
        answer = await send(`${service}/notion/${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        resting = 'offline';
        throw new NotionError('offline', 0, 'unreachable', 'The service could not be reached.', { cause });
      }

      if (answer.status === 429) {
        const seconds = Number(answer.headers.get('Retry-After'));
        notBefore = now() + (seconds > 0 ? seconds : 1) * 1000;
        continue;
      }
      if (answer.status === 401 && !renewed) {
        renewed = true;
        // Another call may have renewed the token since this one took it.
        const kept = session.hasToken() ? await session.token() : token;
        if (kept === token) {
          await session.refresh().catch((cause: unknown) => {
            throw mustConnect(cause);
          });
        }
        continue;
      }

      const data = (await answer.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      if (answer.ok && data !== null) {
        if (resting === 'offline') resting = 'idle';
        return data as T;
      }
      const code = typeof data?.code === 'string' ? data.code : '';
      const message = typeof data?.message === 'string' ? data.message : `The service answered ${answer.status}.`;
      if (answer.status === 401) {
        // The renewed token is refused too: nothing kept is of use.
        session.disconnect();
        throw mustConnect(undefined);
      }
      if (answer.status === 502) {
        resting = 'offline';
        throw new NotionError('offline', 502, code, message);
      }
      throw new NotionError('refused', answer.status, code, message);
    }
  }

  /** A read: it changes the status only by finding the service out of reach, or in reach again. */
  async function read<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await ask<T>(method, path, body);
    } finally {
      tell();
    }
  }

  // The queue. Edits queued together stop together: one that fails marks the run it is in, and
  // an edit queued after that starts a run of its own.
  let run = { stopped: false };
  let last: Promise<unknown> = Promise.resolve();

  function edit<T>(write: (writes: NotionWrites) => T | Promise<T>): Promise<T> {
    const mine = run;
    queued++;
    tell();
    const stored = last.then(async () => {
      if (mine.stopped) throw discarded();
      let failure: { error: unknown } | undefined;
      let before: Promise<unknown> = Promise.resolve();
      const queue = <R>(method: string, path: string, body: unknown): Promise<R> => {
        const answer = before.then(() => {
          if (failure) throw discarded();
          return ask<R>(method, path, body).catch((error: unknown) => {
            failure = { error };
            throw error;
          });
        });
        before = answer.catch(() => undefined);
        return answer;
      };
      try {
        const value = await write({
          updateProperties: (id, properties) => queue('PATCH', `v1/data_sources/${id}`, { properties }),
          createRow: (id, properties) => queue('POST', 'v1/pages', { parent: { type: 'data_source_id', data_source_id: id }, properties }),
          updateRow: (id, properties) => queue('PATCH', `v1/pages/${id}`, { properties }),
          trashRow: (id, inTrash) => queue('PATCH', `v1/pages/${id}`, { in_trash: inTrash }),
        });
        await before;
        if (failure) throw failure.error;
        return value;
      } catch (error) {
        // The failure is the write's own, whatever the edit made of it, and the writes already
        // asked for are not left running behind it.
        failure ??= { error };
        await before;
        mine.stopped = true;
        if (run === mine) run = { stopped: false };
        throw failure.error;
      }
    });
    // The status is told before the edit is answered, so that whoever awaits the edit sees it.
    const answered = stored.then(
      (value) => {
        resting = 'idle';
        return value;
      },
      (error: unknown) => {
        if (!(error instanceof NotionError)) resting = 'failed';
        else if (error.kind === 'offline') resting = 'offline';
        else if (error.kind !== 'discarded') resting = 'failed';
        throw error;
      },
    ).finally(() => {
      queued--;
      tell();
    });
    last = answered.catch(() => undefined);
    return answered;
  }

  return {
    me: () => read('GET', 'v1/users/me'),
    database: (id) => read('GET', `v1/databases/${id}`),
    dataSource: (id) => read('GET', `v1/data_sources/${id}`),
    query: (id, { cursor, pageSize, sorts, editedSince } = {}) =>
      read('POST', `v1/data_sources/${id}/query`, {
        page_size: pageSize ?? 100,
        ...(cursor === undefined ? {} : { start_cursor: cursor }),
        ...(sorts === undefined ? {} : { sorts }),
        ...(editedSince === undefined ? {} : { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: editedSince } } }),
      }),
    edit,
    status,
    onStatus(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
