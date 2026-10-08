import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { Grant } from '../../service/worker';
import { createMemoryNotion } from '../support/memoryNotion';

// The Worker adds to the handler its settings and the Durable Object that keeps a grant in
// progress; the handler's own test covers the rest. Cloudflare's storage and alarm are small
// fakes here: an alarm is rung by the test.

interface Kept {
  values: Map<string, unknown>;
  alarm: number | undefined;
}

function storageOf(kept: Kept) {
  return {
    get: async <T>(key: string) => kept.values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => void kept.values.set(key, value),
    deleteAll: async () => kept.values.clear(),
    setAlarm: async (time: number) => void (kept.alarm = time),
  };
}

/** A namespace that makes one object per name, as Cloudflare does, and tells which were asked for. */
function namespace() {
  const objects = new Map<string, { kept: Kept; grant: Grant }>();
  return {
    objects,
    idFromName: (name: string) => name,
    get(id: unknown) {
      const name = id as string;
      if (!objects.has(name)) {
        const kept: Kept = { values: new Map(), alarm: undefined };
        objects.set(name, { kept, grant: new Grant({ storage: storageOf(kept) }) });
      }
      return { fetch: (address: string, init?: RequestInit) => objects.get(name)!.grant.fetch(new Request(address, init)) };
    },
  };
}

const settings = () => ({ NOTION_CLIENT_ID: 'id', NOTION_CLIENT_SECRET: 'secret', ALLOWED_ORIGIN: 'https://etalii.net', GRANTS: namespace() });
const SERVICE = 'https://adp-notion.example.workers.dev';

describe('the service as a Cloudflare Worker', () => {
  it('answers the preflight for the origin its settings allow', async () => {
    const request = new Request(`${SERVICE}/notion/v1/users/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://etalii.net', 'Access-Control-Request-Method': 'GET' },
    });
    const answer = await worker.fetch(request, settings());
    expect(answer.headers.get('Access-Control-Allow-Origin')).toBe('https://etalii.net');
  });

  it('redirects a grant to Notion with its own address as where to come back', async () => {
    const state = 'a'.repeat(32);
    const answer = await worker.fetch(new Request(`${SERVICE}/authorize?state=${state}`), settings());
    expect(answer.status).toBe(302);
    const to = new URL(answer.headers.get('Location') ?? '');
    expect(to.searchParams.get('redirect_uri')).toBe(`${SERVICE}/callback`);
    expect(to.searchParams.get('client_id')).toBe('id');
  });

  it('answers 404 to anything else', async () => {
    const answer = await worker.fetch(new Request(`${SERVICE}/else`), settings());
    expect(answer.status).toBe(404);
  });

  it('keeps the outcome of a grant in the object named by its state, and hands it over once', async () => {
    const verifier = 'v'.repeat(48);
    const state = createHash('sha256').update(verifier).digest('base64url');
    const set = settings();
    const grant = () => worker.fetch(new Request(`${SERVICE}/grant`, { method: 'POST', body: JSON.stringify({ verifier }) }), set);

    expect((await grant()).status).toBe(204);
    // The person refuses, so that Notion is asked nothing.
    await worker.fetch(new Request(`${SERVICE}/callback?error=access_denied&state=${state}`), set);
    expect([...set.GRANTS.objects.keys()]).toEqual([state]);
    const once = await grant();
    expect(once.status).toBe(200);
    expect(await once.json()).toEqual({ source: 'adp-notion', state, error: 'access_denied' });
    expect((await grant()).status).toBe(204);
    expect(set.GRANTS.objects.get(state)!.kept.values.size).toBe(0);
  });
});

describe('the Durable Object of a grant', () => {
  let kept: Kept;
  let grant: Grant;
  const put = (value: string, seconds = 120) => grant.fetch(new Request(`https://grant/?seconds=${seconds}`, { method: 'PUT', body: value }));
  const take = () => grant.fetch(new Request('https://grant/', { method: 'POST' }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    kept = { values: new Map(), alarm: undefined };
    grant = new Grant({ storage: storageOf(kept) });
  });

  afterEach(() => void vi.useRealTimers());

  it('answers nothing before a put', async () => {
    const answer = await take();
    expect(answer.status).toBe(204);
    expect(await answer.text()).toBe('');
  });

  it('answers what was put once, and keeps nothing after', async () => {
    expect((await put('{"token":"t"}')).status).toBe(204);
    const answer = await take();
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('{"token":"t"}');
    expect(kept.values.size).toBe(0);
    expect((await take()).status).toBe(204);
  });

  it('sets an alarm for the seconds asked, which removes what is kept', async () => {
    await put('{"token":"t"}');
    expect(kept.alarm).toBe(1_000_000 + 120_000);
    expect(kept.values.size).toBe(1);
    await grant.alarm();
    expect(kept.values.size).toBe(0);
    expect((await take()).status).toBe(204);
  });

  it('answers nothing once the time is over, though the alarm has not rung, and removes it', async () => {
    await put('{"token":"t"}');
    vi.setSystemTime(1_000_000 + 119_999);
    expect((await take()).status).toBe(200);
    await put('{"token":"t"}');
    vi.setSystemTime(1_000_000 + 119_999 + 120_000);
    expect((await take()).status).toBe(204);
    expect(kept.values.size).toBe(0);
  });

  it('keeps the last of two puts', async () => {
    await put('one');
    await put('other');
    expect(await (await take()).text()).toBe('other');
  });
});

describe('the Worker and a grant Notion completes', () => {
  it('hands the token over through the object', async () => {
    const notion = createMemoryNotion({ clientId: 'id', clientSecret: 'secret', workspace: 'A workspace' });
    const real = globalThis.fetch;
    globalThis.fetch = notion.fetch;
    try {
      const verifier = 'w'.repeat(48);
      const state = createHash('sha256').update(verifier).digest('base64url');
      const set = settings();
      await worker.fetch(new Request(`${SERVICE}/callback?code=${notion.grantCode()}&state=${state}`), set);
      const answer = await worker.fetch(new Request(`${SERVICE}/grant`, { method: 'POST', body: JSON.stringify({ verifier }) }), set);
      expect(await answer.json()).toMatchObject({ source: 'adp-notion', state, workspace: 'A workspace', token: expect.any(String) });
    } finally {
      globalThis.fetch = real;
    }
  });
});
