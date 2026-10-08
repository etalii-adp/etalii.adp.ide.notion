// The service of the Notion add-ons: it completes Notion's grant of access and forwards the
// store's calls to the Notion API. It knows no platform, uses web standard APIs only, keeps no
// state and logs nothing, so that whatever runs it adds a few lines and no rule.

export interface ServiceConfig {
  clientId: string;
  clientSecret: string;
  /** The one origin whose pages may call the service and receive the token. */
  allowedOrigin: string;
  /** The service's own base address, for the grant's `redirect_uri`. */
  serviceAddress: string;
  fetch?: typeof fetch;
  notionBase?: string;
}

const NOTION_VERSION = '2026-03-11';
const STATE = /^[A-Za-z0-9_-]{32,128}$/;
const ID = '(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

// The calls the store makes. A call it comes to need is added to the service contract first.
const FORWARDED: [method: string, path: RegExp][] = [
  ['GET', /^v1\/users\/me$/],
  ['GET', new RegExp(`^v1/databases/${ID}$`)],
  ['GET', new RegExp(`^v1/data_sources/${ID}$`)],
  ['PATCH', new RegExp(`^v1/data_sources/${ID}$`)],
  ['POST', new RegExp(`^v1/data_sources/${ID}/query$`)],
  ['POST', /^v1\/pages$/],
  ['PATCH', new RegExp(`^v1/pages/${ID}$`)],
];

function json(status: number, body: unknown, headers: Headers = new Headers()): Response {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function refusal(status: number, code: string, message: string, headers: Headers): Response {
  return json(status, { object: 'error', status, code, message }, headers);
}

function cors(request: Request, config: ServiceConfig): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (request.headers.get('Origin') === config.allowedOrigin) headers.set('Access-Control-Allow-Origin', config.allowedOrigin);
  return headers;
}

/** Asks Notion's token endpoint; the only use of the client secret. */
async function exchange(config: ServiceConfig, grant: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const answer = await (config.fetch ?? fetch)(`${config.notionBase ?? 'https://api.notion.com'}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify(grant),
    });
    const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
    if (answer.ok && typeof body.access_token === 'string') return { status: 200, body };
    const error = typeof body.error === 'string' ? body.error : typeof body.code === 'string' ? body.code : 'invalid_grant';
    return { status: answer.ok ? 502 : answer.status, body: { error } };
  } catch {
    return { status: 502, body: { error: 'bad_gateway' } };
  }
}

/** The page of the window the add-on opened: it hands the message to its opener and closes. */
function messagePage(message: Record<string, unknown>, config: ServiceConfig): Response {
  // "<" is escaped so that nothing in a message can end the script.
  const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const script = `if (window.opener) window.opener.postMessage(${literal({ source: 'adp-notion', ...message })}, ${literal(config.allowedOrigin)}); window.close();`;
  return new Response(`<!doctype html><meta charset="utf-8"><title>ADP</title><script>${script}</script>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function callback(url: URL, config: ServiceConfig): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  if (!STATE.test(state)) return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  // Notion comes back with `error` and no code when the person refuses.
  const refused = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (refused || !code) return messagePage({ state, error: refused || 'invalid_request' }, config);
  const { status, body } = await exchange(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.serviceAddress.replace(/\/$/, '')}/callback`,
  });
  if (status !== 200) return messagePage({ state, error: body.error }, config);
  return messagePage({ state, token: body.access_token, refresh: body.refresh_token ?? null, workspace: body.workspace_name ?? '' }, config);
}

async function refresh(request: Request, config: ServiceConfig, headers: Headers): Promise<Response> {
  const asked = (await request.json().catch(() => null)) as { refresh?: unknown } | null;
  if (typeof asked?.refresh !== 'string' || asked.refresh === '') return json(400, { error: 'invalid_request' }, headers);
  const { status, body } = await exchange(config, { grant_type: 'refresh_token', refresh_token: asked.refresh });
  return json(status, status === 200 ? { token: body.access_token, refresh: body.refresh_token ?? null } : body, headers);
}

async function forward(request: Request, path: string, search: string, config: ServiceConfig, headers: Headers): Promise<Response> {
  if (search !== '' || !FORWARDED.some(([method, pattern]) => method === request.method && pattern.test(path))) {
    return refusal(403, 'restricted_resource', 'The service does not forward this call.', headers);
  }
  const authorization = request.headers.get('Authorization');
  if (!authorization) return refusal(401, 'unauthorized', 'The call carries no token.', headers);

  const sent = new Headers({ Authorization: authorization, 'Notion-Version': NOTION_VERSION });
  const type = request.headers.get('Content-Type');
  if (type) sent.set('Content-Type', type);
  let answer: Response;
  try {
    answer = await (config.fetch ?? fetch)(`${config.notionBase ?? 'https://api.notion.com'}/${path}`, {
      method: request.method,
      headers: sent,
      // Passed on as bytes: the service reads no body.
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });
  } catch {
    return refusal(502, 'bad_gateway', 'Notion could not be reached.', headers);
  }
  for (const name of ['Content-Type', 'Retry-After']) {
    const value = answer.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('Cache-Control', 'no-store');
  return new Response(answer.body, { status: answer.status, headers });
}

export async function handle(request: Request, config: ServiceConfig): Promise<Response> {
  const url = new URL(request.url);
  const base = new URL(config.serviceAddress).pathname.replace(/\/$/, '');
  const path = url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length) : '';
  const { method } = request;

  if (method === 'GET' && path === '/authorize') {
    const state = url.searchParams.get('state') ?? '';
    if (!STATE.test(state)) return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const to = new URL(`${config.notionBase ?? 'https://api.notion.com'}/v1/oauth/authorize`);
    to.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      owner: 'user',
      redirect_uri: `${config.serviceAddress.replace(/\/$/, '')}/callback`,
      state,
    }).toString();
    return new Response(null, { status: 302, headers: { Location: to.href, 'Cache-Control': 'no-store' } });
  }
  if (method === 'GET' && path === '/callback') return callback(url, config);

  const notion = path.startsWith('/notion/');
  if (notion || path === '/refresh') {
    const headers = cors(request, config);
    if (method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers });
    }
    if (notion) return forward(request, path.slice('/notion/'.length), url.search, config, headers);
    if (method === 'POST') return refresh(request, config, headers);
  }
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
