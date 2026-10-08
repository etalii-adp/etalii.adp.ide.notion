import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectError, createSession, type Session, type SessionOptions } from '../../src/store/session';
import { createMemoryService, createMemoryStorage, type MemoryService } from '../support/memoryService';

const KEY = 'adp-notion.token';

type Message = { origin: string; data: unknown };

let service: MemoryService;
let storage: Storage;
/** The addresses of the windows the session opened. */
let opened: string[];
let popup: { closed: boolean };
let listeners: Set<(message: Message) => void>;
let checks: Set<() => void>;

const post = (message: Message) => [...listeners].forEach((take) => take(message));
const tick = () => [...checks].forEach((check) => check());
const kept = () => JSON.parse(storage.getItem(KEY) ?? 'null') as { token: string; refresh: string; workspace: string } | null;

function session(options: Partial<SessionOptions> = {}): Session {
  return createSession({
    service: service.address,
    storage,
    fetch: service.fetch,
    open(url) {
      opened.push(url);
      return popup;
    },
    listen(take) {
      listeners.add(take);
      return () => void listeners.delete(take);
    },
    every(check) {
      checks.add(check);
      return () => void checks.delete(check);
    },
    ...options,
  });
}

/** The user grants access in the window the session opened last. */
const grant = async () => post(await service.grant(opened.at(-1)!));

async function reasonOf(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

beforeEach(() => {
  service = createMemoryService({ workspace: 'A workspace' });
  storage = createMemoryStorage();
  opened = [];
  popup = { closed: false };
  listeners = new Set();
  checks = new Set();
});

describe('asking for a token', () => {
  it('asks for none until a call needs one', () => {
    const made = session();
    expect(made.hasToken()).toBe(false);
    expect(made.workspace()).toBeNull();
    expect(opened).toEqual([]);
    expect(listeners.size).toBe(0);
  });

  it('opens the service\'s grant in a window of its own, with a random state', async () => {
    const made = session();
    const token = made.token();
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.origin + url.pathname).toBe(`${service.address}/authorize`);
    expect([...url.searchParams.keys()]).toEqual(['state']);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    await grant();
    expect(await token).toBe(kept()!.token);
    expect(Object.keys(kept()!).sort()).toEqual(['refresh', 'token', 'workspace']);
    expect(kept()!.workspace).toBe('A workspace');
    expect(made.hasToken()).toBe(true);
    expect(made.workspace()).toBe('A workspace');
    // Notion takes the token that was kept.
    const me = await service.fetch(`${service.address}/notion/v1/users/me`, { headers: { Authorization: `Bearer ${kept()!.token}` } });
    expect(me.status).toBe(200);
    // Nothing is listened or watched for once the grant is over.
    expect(listeners.size + checks.size).toBe(0);
  });

  it('answers the kept token without a second grant', async () => {
    const made = session();
    const first = made.token();
    await grant();
    expect(await made.token()).toBe(await first);
    expect(opened).toHaveLength(1);
  });

  it('opens one window for calls that ask at the same time', async () => {
    const made = session();
    const both = Promise.all([made.token(), made.token()]);
    expect(opened).toHaveLength(1);
    await grant();
    const [one, other] = await both;
    expect(one).toBe(other);
  });

  it('makes another state for each grant, from the random values it is given', async () => {
    const made = session();
    const first = made.token();
    popup.closed = true;
    tick();
    await reasonOf(first);
    popup = { closed: false };
    void made.token().catch(() => undefined);
    const states = opened.map((url) => new URL(url).searchParams.get('state'));
    expect(states[0]).not.toBe(states[1]);

    const fixed = session({ random: (bytes) => bytes.fill(255) });
    void fixed.token().catch(() => undefined);
    expect(new URL(opened[2]).searchParams.get('state')).toBe('_'.repeat(48));
  });

  it('takes a token another page of the origin was granted', async () => {
    storage.setItem(KEY, JSON.stringify({ token: 'memory-token', refresh: 'r', workspace: 'W' }));
    const made = session();
    expect(made.hasToken()).toBe(true);
    expect(await made.token()).toBe('memory-token');
    expect(opened).toEqual([]);
  });

  it('takes what is kept for no token when it cannot be read', () => {
    for (const text of ['{', '5', '{"token":""}', '{"refresh":"r"}']) {
      storage.setItem(KEY, text);
      expect(session().hasToken()).toBe(false);
    }
  });
});

describe('the message of the grant', () => {
  it('drops a message from another origin, with another state or from another source', async () => {
    const made = session();
    let settled = false;
    const token = made.token().finally(() => (settled = true));
    const real = await service.grant(opened[0]);
    const data = real.data as Record<string, unknown>;

    post({ origin: 'https://evil.example', data });
    post({ origin: service.origin, data });
    post({ origin: real.origin, data: { ...data, state: 'a'.repeat(48) } });
    post({ origin: real.origin, data: { ...data, source: 'another' } });
    post({ origin: real.origin, data: 'text' });
    post({ origin: real.origin, data: null });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(kept()).toBeNull();

    post(real);
    expect(await token).toBe(data.token);
  });

  it('rejects and keeps nothing when the user refuses', async () => {
    const made = session();
    const token = made.token();
    post(await service.grant(opened[0], { refuse: 'access_denied' }));
    const error = await reasonOf(token);
    expect(error.reason).toBe('refused');
    expect(error.code).toBe('access_denied');
    expect(kept()).toBeNull();
    expect(made.hasToken()).toBe(false);
    expect(listeners.size + checks.size).toBe(0);
  });

  it('rejects and keeps nothing when the window is closed', async () => {
    const made = session();
    const token = made.token();
    tick();
    popup.closed = true;
    tick();
    expect((await reasonOf(token)).reason).toBe('closed');
    expect(kept()).toBeNull();
    expect(listeners.size + checks.size).toBe(0);

    // The next call that needs a token starts a grant of its own.
    popup = { closed: false };
    const again = made.token();
    expect(opened).toHaveLength(2);
    await grant();
    expect(await again).toBe(kept()!.token);
  });

  it('says so when the browser opens no window', async () => {
    const made = session({ open: () => null });
    const error = await reasonOf(made.token());
    expect(error.reason).toBe('blocked');
    expect(kept()).toBeNull();
    expect(listeners.size + checks.size).toBe(0);
  });
});

describe('refresh', () => {
  async function granted(options: Partial<SessionOptions> = {}): Promise<Session> {
    const made = session(options);
    const token = made.token();
    await grant();
    await token;
    service.requests.length = 0;
    return made;
  }

  it('replaces the token and the refresh token, and keeps the workspace', async () => {
    const made = await granted();
    const before = kept()!;
    const token = await made.refresh();
    expect(service.requests).toEqual(['POST /refresh']);
    expect(token).not.toBe(before.token);
    expect(kept()).toEqual({ token, refresh: expect.not.stringMatching(`^${before.refresh}$`), workspace: 'A workspace' });
    expect(await made.token()).toBe(token);
    // The new refresh token is one Notion takes.
    expect(await made.refresh()).not.toBe(token);
  });

  it('posts once for calls that ask at the same time', async () => {
    const made = await granted();
    const [one, other] = await Promise.all([made.refresh(), made.refresh()]);
    expect(one).toBe(other);
    expect(service.requests).toEqual(['POST /refresh']);
  });

  it('removes the key when Notion refuses the refresh token', async () => {
    const made = await granted();
    storage.setItem(KEY, JSON.stringify({ ...kept()!, refresh: 'never-given' }));
    const error = await reasonOf(made.refresh());
    expect(error.reason).toBe('expired');
    expect(error.code).toBe('invalid_grant');
    expect(storage.getItem(KEY)).toBeNull();
    expect(made.hasToken()).toBe(false);
  });

  it('removes the key, and posts nothing, when no refresh token is kept', async () => {
    storage.setItem(KEY, JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'W' }));
    const made = session();
    expect((await reasonOf(made.refresh())).reason).toBe('expired');
    expect(storage.getItem(KEY)).toBeNull();
    expect(service.requests).toEqual([]);
  });

  it('keeps what it has when the service or Notion cannot be reached', async () => {
    const made = await granted();
    const before = kept();
    service.unreachable();
    expect((await reasonOf(made.refresh())).reason).toBe('unreachable');
    service.notion.failNext('offline');
    expect((await reasonOf(made.refresh())).reason).toBe('unreachable');
    expect(kept()).toEqual(before);
    expect(await made.refresh()).toBe(kept()!.token);
  });
});

describe('disconnect', () => {
  it('removes the key', async () => {
    storage.setItem(KEY, JSON.stringify({ token: 'memory-token', refresh: 'r', workspace: 'W' }));
    const made = session();
    made.disconnect();
    expect(storage.getItem(KEY)).toBeNull();
    expect(made.hasToken()).toBe(false);
    expect(opened).toEqual([]);
  });
});

describe('storage the browser refuses', () => {
  it('keeps the session in memory for the life of the page', async () => {
    const made = session({ storage: createMemoryStorage(true) });
    expect(made.hasToken()).toBe(false);
    const token = made.token();
    await grant();
    const first = await token;
    expect(made.hasToken()).toBe(true);
    expect(await made.token()).toBe(first);
    expect(opened).toHaveLength(1);

    expect(await made.refresh()).not.toBe(first);
    made.disconnect();
    expect(made.hasToken()).toBe(false);
    // Another page starts with nothing.
    expect(session({ storage: createMemoryStorage(true) }).hasToken()).toBe(false);
  });
});
