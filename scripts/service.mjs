// The local service: the handler of service/handler.ts behind node:http.
//
//   node scripts/service.mjs [--memory] [--port 8787]
//
// It reads NOTION_CLIENT_ID, NOTION_CLIENT_SECRET and ALLOWED_ORIGIN from the environment. With
// --memory it needs no account anywhere: an in-memory Notion answers the calls and grants access
// at once, and one empty database exists for an add-on to be pointed at. That database is on a
// page, and the page under it holds an embed block for each add-on that names no store yet, as a
// person leaves it before selecting the database in the add-on. In both modes the grants
// in progress are kept in memory, as the Worker keeps them in a Durable Object.
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { handle } from '../service/handler.ts';

const args = process.argv.slice(2);
const memory = args.includes('--memory');
const port = Number(args[args.indexOf('--port') + 1]) || 8787;
const address = `http://localhost:${port}`;
const notionBase = 'https://api.notion.com';
const MEMORY_DATABASE = '11111111-1111-4111-8111-111111111111';

// The grants in progress, as the Worker keeps them: for the seconds asked, and for one reading.
const kept = new Map();
const grants = {
  async put(key, value, seconds) {
    const grant = { value, expires: Date.now() + seconds * 1000 };
    kept.set(key, grant);
    setTimeout(() => kept.get(key) === grant && kept.delete(key), seconds * 1000).unref();
  },
  async take(key) {
    const grant = kept.get(key);
    kept.delete(key);
    return grant && grant.expires > Date.now() ? grant.value : undefined;
  },
};

const config = {
  clientId: process.env.NOTION_CLIENT_ID ?? '',
  clientSecret: process.env.NOTION_CLIENT_SECRET ?? '',
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:8080',
  serviceAddress: address,
  notionBase,
  grants,
};

let notion;
if (memory) {
  const { createMemoryNotion } = await import('../test/support/memoryNotion.ts');
  notion = createMemoryNotion({ clientId: 'memory-client', clientSecret: 'memory-secret' });
  const entry = notion.createPage({ title: 'Memory entry' });
  notion.createDatabase({ id: MEMORY_DATABASE, title: 'Memory store', parent: entry.id });
  const diagram = notion.createPage({ title: 'Diagram', parent: entry.id });
  const addons = new URL('../addons/', import.meta.url);
  for (const each of readdirSync(addons, { withFileTypes: true })) {
    if (each.isDirectory() && existsSync(new URL(`${each.name}/addon.json`, addons))) notion.addBlock(diagram.id, { embed: `${config.allowedOrigin}/${each.name}/` });
  }
  Object.assign(config, { clientId: 'memory-client', clientSecret: 'memory-secret', fetch: notion.fetch });
} else if (!config.clientId || !config.clientSecret) {
  console.error('Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET, or run with --memory.');
  process.exit(1);
}

createServer(async (incoming, outgoing) => {
  try {
    const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(await Array.fromAsync(incoming));
    let response = await handle(new Request(new URL(incoming.url, address), { method: incoming.method, headers: incoming.headers, body }), config);
    // The in-memory Notion has no page a browser could visit, so its grant is followed here.
    const location = response.headers.get('Location');
    if (notion && location?.startsWith(`${notionBase}/v1/oauth/authorize`)) response = await notion.fetch(location);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    // Nothing of the request is logged: it may carry a token.
    outgoing.writeHead(500).end();
  }
}).listen(port, () => {
  console.log(`The service answers at ${address} for pages of ${config.allowedOrigin}.`);
  if (memory) console.log(`Notion is in memory and grants access at once. Its database, empty with the title property Name: ${MEMORY_DATABASE}`);
});
