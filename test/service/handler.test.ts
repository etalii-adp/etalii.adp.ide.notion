import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type ServiceConfig } from '../../service/handler';
import { createMemoryNotion, type MemoryNotion } from '../support/memoryNotion';
import { createMemoryGrants } from '../support/memoryService';

const SERVICE = 'https://service.example';
const ORIGIN = 'https://etalii.net';
const VERIFIER = 'a-verifier_of-48-characters-0123456789-ABCDEFGHIJ';
/** The SHA-256 of the verifier in base64url without padding, as the add-on makes its state. */
const STATE = createHash('sha256').update(VERIFIER).digest('base64url');

let notion: MemoryNotion;
let config: ServiceConfig;
/** The time of the grants, in milliseconds. */
let clock: number;

beforeEach(() => {
  notion = createMemoryNotion({ workspace: 'A workspace' });
  clock = 0;
  config = {
    clientId: 'memory-client', clientSecret: 'memory-secret', allowedOrigin: ORIGIN, serviceAddress: SERVICE,
    grants: createMemoryGrants(() => clock), fetch: notion.fetch,
  };
});

function ask(method: string, path: string, options: { token?: string | null; origin?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  if (options.token !== null) headers.set('Authorization', `Bearer ${options.token ?? 'memory-token'}`);
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return handle(new Request(`${SERVICE}${path}`, { method, headers, body }), config);
}

/** The message and the target origin of the page the callback answers. */
async function posted(response: Response): Promise<{ message: Record<string, unknown>; target: string }> {
  const found = /postMessage\((\{.*?\}), ("[^"]*")\); window\.close\(\); \}<\/script>$/.exec(await response.text());
  expect(found).not.toBeNull();
  return { message: JSON.parse(found![1]), target: JSON.parse(found![2]) };
}

describe('GET /authorize', () => {
  it('redirects to Notion with the client, the callback and the same state', async () => {
    const response = await ask('GET', `/authorize?state=${STATE}`, { token: null });
    expect(response.status).toBe(302);
    const to = new URL(response.headers.get('Location')!);
    expect(to.origin + to.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(Object.fromEntries(to.searchParams)).toEqual({
      client_id: 'memory-client',
      response_type: 'code',
      owner: 'user',
      redirect_uri: `${SERVICE}/callback`,
      state: STATE,
    });
    expect(notion.calls).toEqual([]);
  });

  it.each([
    ['no state', '/authorize'],
    ['31 characters', `/authorize?state=${'a'.repeat(31)}`],
    ['129 characters', `/authorize?state=${'a'.repeat(129)}`],
    ['another character', `/authorize?state=${'a'.repeat(40)}%22`],
  ])('answers 400 for %s', async (_, path) => {
    expect((await ask('GET', path, { token: null })).status).toBe(400);
  });

  it('takes a state of 32 and of 128 characters', async () => {
    expect((await ask('GET', `/authorize?state=${'a'.repeat(32)}`)).status).toBe(302);
    expect((await ask('GET', `/authorize?state=${'a'.repeat(128)}`)).status).toBe(302);
  });
});

describe('GET /callback', () => {
  it('exchanges the code and posts the token to the allowed origin only', async () => {
    const response = await ask('GET', `/callback?code=${notion.grantCode()}&state=${STATE}`, { token: null, origin: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const { message, target } = await posted(response);
    expect(target).toBe(ORIGIN);
    expect(Object.keys(message).sort()).toEqual(['refresh', 'source', 'state', 'token', 'workspace']);
    expect(message).toMatchObject({ source: 'adp-notion', state: STATE, workspace: 'A workspace' });
    expect(notion.calls).toEqual(['POST /v1/oauth/token']);

    // The token it handed over is one Notion takes.
    const me = await ask('GET', '/notion/v1/users/me', { token: message.token as string });
    expect(me.status).toBe(200);
  });

  it('posts Notion\'s error code when the exchange fails', async () => {
    const response = await ask('GET', `/callback?code=never-granted&state=${STATE}`, { token: null });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await posted(response)).toEqual({ message: { source: 'adp-notion', state: STATE, error: 'invalid_grant' }, target: ORIGIN });
  });

  it('posts the refusal when the person refuses, and asks Notion nothing', async () => {
    const response = await ask('GET', `/callback?error=access_denied&state=${STATE}`, { token: null });
    expect(await posted(response)).toEqual({ message: { source: 'adp-notion', state: STATE, error: 'access_denied' }, target: ORIGIN });
    expect(notion.calls).toEqual([]);
  });

  it('posts an error when the client secret is wrong, and when Notion cannot be reached', async () => {
    const code = notion.grantCode();
    config.clientSecret = 'wrong';
    expect((await posted(await ask('GET', `/callback?code=${code}&state=${STATE}`))).message).toMatchObject({ error: 'invalid_client' });
    config.clientSecret = 'memory-secret';
    notion.failNext('offline');
    expect((await posted(await ask('GET', `/callback?code=${code}&state=${STATE}`))).message).toMatchObject({ error: 'bad_gateway' });
  });

  it('writes nothing into the page that could end its script', async () => {
    const response = await ask('GET', `/callback?error=${encodeURIComponent('</script><script>alert(1)')}&state=${STATE}`);
    const text = await response.text();
    expect(text.match(/<\/script>/g)).toHaveLength(1);
    expect(text).not.toContain('<script>alert');
  });

  it('answers 400 without a valid state, and no page', async () => {
    const response = await ask('GET', `/callback?code=${notion.grantCode()}&state=short`);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(notion.calls).toEqual([]);
  });
});

describe('a window without an opener', () => {
  it('stays open with one sentence, and loads nothing from another host', async () => {
    const granted = await (await ask('GET', `/callback?code=${notion.grantCode()}&state=${STATE}`, { token: null })).text();
    // The message is posted, and the window closed, only where there is an opener.
    expect(granted).toMatch(/<script>if \(window\.opener\) \{ window\.opener\.postMessage\(.*\); window\.close\(\); \}<\/script>$/);
    expect(granted).toContain('<p>Access is granted. Go back to Notion: the diagram opens by itself. You can close this window.</p>');
    expect(granted).toContain('<meta name="color-scheme" content="light dark">');
    expect(granted).not.toMatch(/https?:\/\/(?!etalii\.net")|<link|<style|src=/);

    const refused = await (await ask('GET', `/callback?error=access_denied&state=${STATE}`, { token: null })).text();
    expect(refused).toContain('<p>Access was not granted. Go back to Notion to try again. You can close this window.</p>');
  });
});

describe('POST /grant', () => {
  const grant = (verifier: unknown = VERIFIER, origin?: string) => ask('POST', '/grant', { token: null, origin, body: { verifier } });
  const complete = () => ask('GET', `/callback?code=${notion.grantCode()}&state=${STATE}`, { token: null, origin: null });

  it('answers 204 before the grant, the message once after it, and 204 again', async () => {
    const before = await grant();
    expect(before.status).toBe(204);
    expect(await before.text()).toBe('');
    expect(before.headers.get('Cache-Control')).toBe('no-store');
    expect(before.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const { message } = await posted(await complete());
    const once = await grant();
    expect(once.status).toBe(200);
    expect(once.headers.get('Content-Type')).toContain('application/json');
    expect(once.headers.get('Cache-Control')).toBe('no-store');
    expect(once.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(once.headers.get('Vary')).toBe('Origin');
    // The same object the page posts to its opener.
    const handed = await once.json();
    expect(handed).toEqual(message);
    expect(Object.keys(handed).sort()).toEqual(['refresh', 'source', 'state', 'token', 'workspace']);

    expect((await grant()).status).toBe(204);
  });

  it('hands a refusal and a failed exchange over as an error', async () => {
    await ask('GET', `/callback?error=access_denied&state=${STATE}`, { token: null });
    expect(await (await grant()).json()).toEqual({ source: 'adp-notion', state: STATE, error: 'access_denied' });
    await ask('GET', `/callback?code=never-granted&state=${STATE}`, { token: null });
    expect(await (await grant()).json()).toEqual({ source: 'adp-notion', state: STATE, error: 'invalid_grant' });
    expect((await grant()).status).toBe(204);
  });

  it('gives the state alone, or another verifier, nothing, and leaves the grant for its verifier', async () => {
    await complete();
    expect((await grant(STATE)).status).toBe(204);
    expect((await grant(`${VERIFIER.slice(0, -1)}K`)).status).toBe(204);
    expect((await grant()).status).toBe(200);
  });

  it.each([
    ['no body', undefined],
    ['no verifier', {}],
    ['a verifier that is no text', { verifier: 5 }],
    ['31 characters', { verifier: 'a'.repeat(31) }],
    ['129 characters', { verifier: 'a'.repeat(129) }],
    ['another character', { verifier: `${'a'.repeat(40)}"` }],
  ])('answers 400 for %s, and takes nothing', async (_, body) => {
    await complete();
    const response = await ask('POST', '/grant', { token: null, body });
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await grant()).status).toBe(200);
  });

  it('keeps a grant for 120 seconds and no longer', async () => {
    await complete();
    clock = 119_999;
    expect((await grant()).status).toBe(200);
    await complete();
    clock += 120_000;
    expect((await grant()).status).toBe(204);
  });

  it('keeps nothing for a callback without a valid state', async () => {
    const kept: string[] = [];
    config.grants = { put: async (key) => void kept.push(key), take: async () => undefined };
    await ask('GET', `/callback?code=${notion.grantCode()}&state=short`);
    expect(kept).toEqual([]);
    await complete();
    expect(kept).toEqual([STATE]);
  });

  it('still answers the page when the grant cannot be kept', async () => {
    config.grants = { put: () => Promise.reject(new Error('out')), take: async () => undefined };
    expect((await posted(await complete())).message).toMatchObject({ state: STATE, workspace: 'A workspace' });
  });

  it('answers another origin without the header that lets it read', async () => {
    await complete();
    const response = await grant(VERIFIER, 'https://elsewhere.example');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('answers 404 to another method', async () => {
    expect((await ask('GET', '/grant')).status).toBe(404);
  });
});

describe('POST /refresh', () => {
  async function granted(): Promise<{ token: string; refresh: string }> {
    const { message } = await posted(await ask('GET', `/callback?code=${notion.grantCode()}&state=${STATE}`));
    return { token: message.token as string, refresh: message.refresh as string };
  }

  it('answers a new token and a new refresh token, and the old refresh token stops working', async () => {
    const first = await granted();
    const response = await ask('POST', '/refresh', { token: null, body: { refresh: first.refresh } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Vary')).toBe('Origin');

    const second = await response.json();
    expect(Object.keys(second).sort()).toEqual(['refresh', 'token']);
    expect(second.token).not.toBe(first.token);
    expect(second.refresh).not.toBe(first.refresh);
    expect((await ask('GET', '/notion/v1/users/me', { token: second.token })).status).toBe(200);

    const again = await ask('POST', '/refresh', { token: null, body: { refresh: first.refresh } });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'invalid_grant' });
    expect(again.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 400 for a body without a refresh token, and asks Notion nothing', async () => {
    for (const body of [{}, { refresh: 5 }, 'text']) {
      const response = await ask('POST', '/refresh', { body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(notion.calls).toEqual([]);
  });

  it('answers another origin without the header that lets it read', async () => {
    const { refresh } = await granted();
    const response = await ask('POST', '/refresh', { origin: 'https://elsewhere.example', body: { refresh } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });
});

describe('the preflight', () => {
  it.each(['/notion/v1/pages', '/notion/v1/users/me', '/refresh', '/grant'])('allows the methods and headers of %s for a day', async (path) => {
    const response = await ask('OPTIONS', path, { token: null });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(notion.calls).toEqual([]);
  });

  it('allows another origin nothing', async () => {
    const response = await ask('OPTIONS', '/notion/v1/pages', { token: null, origin: 'https://elsewhere.example' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('/notion/<path>', () => {
  it('forwards each call of the table, with the token and the version', async () => {
    const { id, dataSourceId } = notion.createDatabase();
    const seen: Request[] = [];
    config.fetch = ((input: Request | string | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return notion.fetch(input, init);
    }) as typeof fetch;

    expect((await ask('GET', '/notion/v1/users/me')).status).toBe(200);
    expect((await ask('GET', `/notion/v1/databases/${id}`)).status).toBe(200);
    expect((await ask('GET', `/notion/v1/databases/${id.replaceAll('-', '').toUpperCase()}`)).status).toBe(200);
    expect((await ask('GET', `/notion/v1/data_sources/${dataSourceId}`)).status).toBe(200);
    expect((await ask('PATCH', `/notion/v1/data_sources/${dataSourceId}`, { body: { properties: { Order: { number: {} } } } })).status).toBe(200);
    const created = await ask('POST', '/notion/v1/pages', {
      body: { parent: { data_source_id: dataSourceId }, properties: { Name: { title: [{ text: { content: 'a' } }] }, Order: { number: 1 } } },
    });
    expect(created.status).toBe(200);
    const row = (await created.json()).id as string;
    expect((await ask('PATCH', `/notion/v1/pages/${row}`, { body: { in_trash: true } })).status).toBe(200);
    const query = await ask('POST', `/notion/v1/data_sources/${dataSourceId}/query`, { body: { page_size: 100 } });
    expect(await query.json()).toMatchObject({ object: 'list', results: [], has_more: false });

    expect(notion.rows(dataSourceId)).toMatchObject([{ id: row, in_trash: true, properties: { Order: { number: 1 } } }]);
    expect(seen).toHaveLength(8);
    for (const request of seen) {
      expect(request.url.startsWith('https://api.notion.com/v1/')).toBe(true);
      expect(request.headers.get('Authorization')).toBe('Bearer memory-token');
      expect(request.headers.get('Notion-Version')).toBe('2026-03-11');
      expect(request.headers.get('Origin')).toBeNull();
    }
  });

  it('answers 401 without the header and forwards nothing', async () => {
    const response = await ask('GET', '/notion/v1/users/me', { token: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ object: 'error', status: 401, code: 'unauthorized' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(notion.calls).toEqual([]);
  });

  it.each([
    ['DELETE', '/notion/v1/pages/00000000000040008000000000000001'],
    ['PUT', '/notion/v1/pages/00000000000040008000000000000001'],
    ['GET', '/notion/v1/pages/00000000000040008000000000000001'],
    ['POST', '/notion/v1/users/me'],
    ['DELETE', '/notion/v1/databases/00000000000040008000000000000001'],
    ['PATCH', '/notion/v1/databases/00000000000040008000000000000001'],
    ['POST', '/notion/v1/databases'],
    ['POST', '/notion/v1/search'],
    ['GET', '/notion/v1/users'],
    ['GET', '/notion/v1/blocks/00000000000040008000000000000001/children'],
    ['POST', '/notion/v1/oauth/token'],
    ['GET', '/notion/v1/databases/not-an-id'],
    ['GET', '/notion/v1/databases/0000000000004000800000000000000'],
    ['GET', '/notion/v1/data_sources/00000000000040008000000000000001/query'],
    ['GET', '/notion/v1/users/me/../../v1/search'],
    ['GET', '/notion/v1/users/me/'],
    ['GET', '/notion//v1/users/me'],
    ['GET', '/notion/v1/users/me?page_size=1'],
    ['GET', '/notion/'],
  ])('answers 403 to %s %s, which never reaches Notion', async (method, path) => {
    const response = await ask(method, path, { body: method === 'GET' ? undefined : {} });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ object: 'error', status: 403, code: 'restricted_resource' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(notion.calls).toEqual([]);
  });

  it('passes the request body and Notion\'s status and body on unchanged', async () => {
    const { dataSourceId } = notion.createDatabase();
    const sent = '{ "parent": { "data_source_id": "' + dataSourceId + '" },\n  "properties": { "Missing": { "number": 1 } } }';
    let forwarded = '';
    config.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
      forwarded = await new Request(input, init).clone().text();
      return notion.fetch(input, init);
    }) as typeof fetch;

    const response = await handle(
      new Request(`${SERVICE}/notion/v1/pages`, { method: 'POST', headers: { Authorization: 'Bearer memory-token', Origin: ORIGIN, 'Content-Type': 'application/json' }, body: sent }),
      config,
    );
    expect(forwarded).toBe(sent);
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ object: 'error', status: 400, code: 'validation_error', message: 'Missing is not a property that exists.' });
  });

  it('passes on 401, 403 and 404 as Notion answers them', async () => {
    const { id, dataSourceId } = notion.createDatabase();
    expect((await ask('GET', '/notion/v1/users/me', { token: 'not-valid' })).status).toBe(401);

    notion.denyWrites(notion.me);
    const refused = await ask('POST', '/notion/v1/pages', { body: { parent: { data_source_id: dataSourceId }, properties: {} } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'restricted_resource', message: 'Insufficient permissions for this endpoint.' });

    notion.unshare(id);
    const missing = await ask('GET', `/notion/v1/databases/${id}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'object_not_found' });
  });

  it('passes on 429 with its Retry-After', async () => {
    notion.failNext('rate-limited', { retryAfter: 4 });
    const response = await ask('GET', '/notion/v1/users/me');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('4');
    expect(await response.json()).toMatchObject({ code: 'rate_limited' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('answers 502 when Notion cannot be reached', async () => {
    notion.failNext('offline');
    const response = await ask('GET', '/notion/v1/users/me');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ object: 'error', code: 'bad_gateway' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('gives the allowed origin its header, and another origin or none no such header', async () => {
    const allowed = await ask('GET', '/notion/v1/users/me');
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(allowed.headers.get('Vary')).toBe('Origin');

    for (const origin of ['https://elsewhere.example', 'https://etalii.net.elsewhere.example', 'http://etalii.net', null]) {
      const response = await ask('GET', '/notion/v1/users/me', { origin });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Vary')).toBe('Origin');
    }
  });

  it('allows the origin of its configuration, as a local build needs', async () => {
    config.allowedOrigin = 'http://localhost:8080';
    expect((await ask('GET', '/notion/v1/users/me', { origin: 'http://localhost:8080' })).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8080');
    expect((await ask('GET', '/notion/v1/users/me')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('anything else', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/notion'],
    ['GET', '/refresh'],
    ['POST', '/authorize'],
    ['POST', '/callback'],
    ['GET', '/v1/users/me'],
    ['GET', '/authorize/more'],
    ['DELETE', '/refresh'],
  ])('answers 404 to %s %s, with no body', async (method, path) => {
    const response = await ask(method, path);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(notion.calls).toEqual([]);
  });
});

describe('what the service keeps', () => {
  it('answers under a base address with a path of its own', async () => {
    config.serviceAddress = 'https://host.example/service/';
    const authorize = await handle(new Request(`https://host.example/service/authorize?state=${STATE}`), config);
    expect(new URL(authorize.headers.get('Location')!).searchParams.get('redirect_uri')).toBe('https://host.example/service/callback');
    const me = await handle(new Request('https://host.example/service/notion/v1/users/me', { headers: { Authorization: 'Bearer memory-token' } }), config);
    expect(me.status).toBe(200);
    expect((await handle(new Request('https://host.example/notion/v1/users/me'), config)).status).toBe(404);
  });

  it('sets no cookie and names no secret in an answer', async () => {
    const answers = [
      await ask('GET', `/authorize?state=${STATE}`),
      await ask('GET', `/callback?code=never-granted&state=${STATE}`),
      await ask('POST', '/refresh', { body: { refresh: 'never-granted' } }),
      await ask('POST', '/grant', { body: { verifier: VERIFIER } }),
      await ask('GET', '/notion/v1/users/me'),
      await ask('GET', '/nothing'),
    ];
    for (const answer of answers) {
      expect(answer.headers.get('Set-Cookie')).toBeNull();
      const text = (await answer.text()) + JSON.stringify([...answer.headers]);
      expect(text).not.toContain('memory-secret');
      expect(text).not.toContain(btoa('memory-client:memory-secret'));
    }
  });
});
