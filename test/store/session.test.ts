import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ConnectError, createSession, type Session, type SessionOptions, type Waiting } from '../../src/store/session';
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
/** The session's time, in milliseconds. */
let time: number;
/** The bodies the session posted to the service's `/grant`. */
let asked: string[];
/** The calls to the service that are not answered yet. */
let pending: Promise<unknown>[];
/** The digests asked of the platform, a session's states among them. */
let digests: MockInstance<SubtleCrypto['digest']>;

const post = (message: Message) => [...listeners].forEach((take) => take(message));
const kept = () => JSON.parse(storage.getItem(KEY) ?? 'null') as { token: string; refresh: string; workspace: string } | null;
const stateOf = (address: string) => new URL(address).searchParams.get('state')!;

/** Everything the session asked the service is answered, and the session has heard it. */
async function answered(): Promise<void> {
  while (pending.length > 0) {
    await Promise.allSettled(pending.splice(0));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Time passes, in the steps of the session's own look at it. */
async function pass(milliseconds: number): Promise<void> {
  for (let passed = 0; passed < milliseconds; passed += 500) {
    time += 500;
    [...checks].forEach((check) => check());
    await answered();
  }
}

function session(options: Partial<SessionOptions> = {}): Session {
  return createSession({
    service: service.address,
    storage,
    fetch(input, init) {
      if (String(input).endsWith('/grant')) asked.push(String(init?.body));
      const answer = service.fetch(input, init);
      pending.push(answer);
      return answer;
    },
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
    now: () => time,
    ...options,
  });
}

/** A session for which no window ever opens, as in an app that hands the address to a browser. */
const withoutWindow = () => session({ open: (url) => (opened.push(url), null) });

/** Every state asked for so far is made, and the session that asked has it. */
async function prepared(): Promise<void> {
  await Promise.all(digests.mock.results.map((result) => result.value as Promise<unknown>));
  await new Promise((resolve) => setImmediate(resolve));
}

/** The session has made its state and waits for the grant. */
const underWay = () => vi.waitFor(() => expect(listeners.size).toBe(1), { interval: 1 });

/** The user grants access in the window the session opened last. */
async function grant(): Promise<void> {
  await underWay();
  post(await service.grant(opened.at(-1)!));
}

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
  time = 0;
  asked = [];
  pending = [];
  digests = vi.spyOn(crypto.subtle, 'digest');
});

afterEach(() => void vi.restoreAllMocks());

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
    await underWay();
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.origin + url.pathname).toBe(`${service.address}/authorize`);
    expect([...url.searchParams.keys()]).toEqual(['state']);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);

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
    await grant();
    expect(opened).toHaveLength(1);
    const [one, other] = await both;
    expect(one).toBe(other);
  });

  it('opens the window in the turn of the call, the state having been made ahead', async () => {
    const made = session();
    await prepared();
    expect(opened).toEqual([]);
    const told: Waiting[] = [];
    const token = made.token({ onWaiting: (waiting) => told.push(waiting) });
    // Nothing was awaited: a browser opens a window only in the turn of the person's click.
    expect(opened).toHaveLength(1);
    expect(stateOf(opened[0])).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(told).toHaveLength(1);
    told[0].cancel();
    await reasonOf(token);

    // The pair of the next grant is made when this one starts, so the next opens at once too.
    await prepared();
    void made.token().catch(() => undefined);
    expect(opened).toHaveLength(2);
    expect(stateOf(opened[1])).not.toBe(stateOf(opened[0]));
  });

  it('waits for the state when a call comes before it is made', async () => {
    const made = session();
    const token = made.token();
    expect(opened).toEqual([]);
    await grant();
    expect(opened).toHaveLength(1);
    expect(await token).toBe(kept()!.token);
  });

  it('makes another verifier for each grant, from the random values it is given, and its SHA-256 as the state', async () => {
    const made = session();
    let waiting: Waiting | undefined;
    const first = made.token({ onWaiting: (told) => (waiting = told) });
    first.catch(() => undefined);
    await underWay();
    waiting!.cancel();
    await reasonOf(first);
    void made.token().catch(() => undefined);
    await vi.waitFor(() => expect(opened).toHaveLength(2), { interval: 1 });
    expect(stateOf(opened[0])).not.toBe(stateOf(opened[1]));

    const fixed = session({ random: (bytes) => bytes.fill(255) });
    void fixed.token().catch(() => undefined);
    await vi.waitFor(() => expect(opened).toHaveLength(3), { interval: 1 });
    expect(stateOf(opened[2])).toBe(createHash('sha256').update('_'.repeat(48)).digest('base64url'));
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
    await underWay();
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
    // None of them had the service asked for what it keeps.
    expect(asked).toEqual([]);

    post(real);
    expect(await token).toBe(data.token);
  });

  it('asks the service once for its copy, so that it is kept no longer', async () => {
    const made = session();
    const token = made.token();
    await grant();
    await token;
    await answered();
    expect(asked).toHaveLength(1);
    // The copy is gone: the same verifier is handed nothing.
    const again = await service.fetch(`${service.address}/grant`, { method: 'POST', body: asked[0] });
    expect(again.status).toBe(204);
  });

  it('rejects and keeps nothing when the user refuses', async () => {
    const made = session();
    const token = made.token();
    await underWay();
    post(await service.grant(opened[0], { refuse: 'access_denied' }));
    const error = await reasonOf(token);
    expect(error.reason).toBe('refused');
    expect(error.code).toBe('access_denied');
    expect(kept()).toBeNull();
    expect(made.hasToken()).toBe(false);
    expect(listeners.size + checks.size).toBe(0);
  });

  it('goes on waiting when the window is closed, or reads as closed from the start', async () => {
    popup.closed = true;
    const made = session();
    let settled = false;
    const token = made.token().finally(() => (settled = true));
    await underWay();
    await pass(60_000);
    expect(settled).toBe(false);
    expect(listeners.size).toBe(1);
    // The person grants in another window, which has no opener.
    await service.grant(opened[0]);
    await pass(2_000);
    expect(await token).toBe(kept()!.token);
  });

  it('starts a grant of its own for the next call after one that ended without a token', async () => {
    const made = session();
    const first = made.token();
    await underWay();
    post(await service.grant(opened[0], { refuse: 'access_denied' }));
    await reasonOf(first);
    const again = made.token();
    await grant();
    expect(opened).toHaveLength(2);
    expect(await again).toBe(kept()!.token);
  });
});

describe('a grant handed over by the service', () => {
  it('completes with no window and no message, by asking every two seconds', async () => {
    const made = withoutWindow();
    const token = made.token();
    await underWay();
    await pass(1_500);
    expect(asked).toEqual([]);
    await pass(4_500);
    expect(asked).toHaveLength(3);

    // The person grants in a window that has no opener: the message is never posted.
    await service.grant(opened[0]);
    await pass(2_000);
    expect(await token).toBe(kept()!.token);
    expect(kept()).toMatchObject({ workspace: 'A workspace', refresh: expect.any(String) });
    expect(asked).toHaveLength(4);
    expect(listeners.size + checks.size).toBe(0);
    const me = await service.fetch(`${service.address}/notion/v1/users/me`, { headers: { Authorization: `Bearer ${kept()!.token}` } });
    expect(me.status).toBe(200);
  });

  it('rejects when the service hands a refusal over', async () => {
    const made = withoutWindow();
    const token = made.token();
    token.catch(() => undefined);
    await underWay();
    await service.grant(opened[0], { refuse: 'access_denied' });
    await pass(2_000);
    const error = await reasonOf(token);
    expect(error).toMatchObject({ reason: 'refused', code: 'access_denied' });
    expect(kept()).toBeNull();
  });

  it('goes on asking while the service cannot be reached', async () => {
    const made = withoutWindow();
    const token = made.token();
    await underWay();
    await service.grant(opened[0]);
    service.unreachable();
    await pass(2_000);
    expect(kept()).toBeNull();
    await pass(2_000);
    expect(await token).toBe(kept()!.token);
  });

  it('tells its caller where the person signs in, and whether a window opened', async () => {
    const told: Waiting[] = [];
    const made = withoutWindow();
    const token = made.token({ onWaiting: (waiting) => told.push(waiting) });
    expect(told).toEqual([]);
    await underWay();
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ address: opened[0], opened: false });
    // A second caller of the same grant is told of it too, and no caller twice.
    void made.token({ onWaiting: (waiting) => told.push(waiting) });
    expect(told).toHaveLength(2);
    expect(told[1]).toBe(told[0]);
    await service.grant(opened[0]);
    await pass(2_000);
    await token;

    const other = session();
    storage.removeItem(KEY);
    void other.token({ onWaiting: (waiting) => told.push(waiting) }).catch(() => undefined);
    await underWay();
    expect(told[2]).toMatchObject({ address: opened[1], opened: true });
    // A kept token is answered with no grant to tell of.
    storage.setItem(KEY, JSON.stringify({ token: 'memory-token', refresh: 'r', workspace: 'W' }));
    await other.token({ onWaiting: (waiting) => told.push(waiting) });
    expect(told).toHaveLength(3);
  });

  it('stops when its caller cancels', async () => {
    let waiting: Waiting | undefined;
    const made = withoutWindow();
    const token = made.token({ onWaiting: (told) => (waiting = told) });
    token.catch(() => undefined);
    await underWay();
    await pass(4_000);
    waiting!.cancel();
    expect((await reasonOf(token)).reason).toBe('cancelled');
    expect(listeners.size + checks.size).toBe(0);
    const before = asked.length;
    await pass(4_000);
    expect(asked).toHaveLength(before);
    // Cancelling again, after the end, does nothing.
    waiting!.cancel();
  });

  it('gives up after five minutes without an answer', async () => {
    const made = withoutWindow();
    let settled = false;
    const token = made.token().finally(() => (settled = true));
    token.catch(() => undefined);
    await underWay();
    await pass(299_500);
    expect(settled).toBe(false);
    await pass(500);
    expect((await reasonOf(token)).reason).toBe('timeout');
    expect(kept()).toBeNull();
    expect(listeners.size + checks.size).toBe(0);
  });

  it('puts the verifier in no address: only the body of its own call holds it', async () => {
    const made = withoutWindow();
    let waiting: Waiting | undefined;
    const token = made.token({ onWaiting: (told) => (waiting = told) });
    await underWay();
    await pass(2_000);
    const { verifier } = JSON.parse(asked[0]) as { verifier: string };
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(stateOf(opened[0])).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(opened.join(' ') + waiting!.address).not.toContain(verifier);
    expect(service.requests.filter((request) => request !== 'POST /grant')).toEqual([]);
    await service.grant(opened[0]);
    await pass(2_000);
    await token;
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
