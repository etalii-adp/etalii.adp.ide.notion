// Moves a document between a file and a store, with the code of src/store/ (etalii.adp spec
// 012-notion-hype-cycle-addon, contracts/store.md, "scripts/store.mjs"; research D14).
//
//   node scripts/store.mjs put <database> <file> [--replace] [--addon <id>] [--service <address>]
//   node scripts/store.mjs take <database> <file> [--force] [--addon <id>] [--service <address>]
//
// <database> is a database id or its Notion address; <file> is a document of the add-on's tool type.
// The Notion token is read from the environment variable NOTION_TOKEN and from nowhere else.
// --addon names the folder under addons/; with one add-on in the repository it may be left out.
//
// `put` prepares the database, then stores the document as its rows. It refuses a database that has
// rows unless --replace is given, which moves those rows to the trash first. It reports what a store
// cannot hold and does not keep, and puts nothing in when Notion cannot hold a value of the document.
// `take` writes the document the rows give, through the binding, and overwrites <file> only with --force.
//
// The script reaches Notion through the service, as the add-on does: --service names its address,
// by default the local one, http://localhost:8787 (`node scripts/service.mjs`). The service only
// forwards a call with the token it is given, so the token of an internal integration works with
// it as well as one a grant of access gave.
//
// Exit code 0: the whole document is stored, or written. 1: it is not, and the store or the file is
// not to be relied on. 2: the command line or the environment is not as above.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_SERVICE = 'http://localhost:8787';
const ID = /([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const USAGE = 'Usage: node scripts/store.mjs put|take <database> <file> [--replace] [--force] [--addon <id>] [--service <address>]';

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parse(args) {
  const given = { positional: [], replace: false, force: false, addon: undefined, service: LOCAL_SERVICE };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--replace' || arg === '--force') given[arg.slice(2)] = true;
    else if (arg === '--addon' || arg === '--service') {
      given[arg.slice(2)] = args[++index];
      if (!given[arg.slice(2)]) throw new Stop(2, `${arg} takes a value.\n${USAGE}`);
    } else if (arg.startsWith('--')) throw new Stop(2, `${arg} is not an option.\n${USAGE}`);
    else given.positional.push(arg);
  }
  const [command, database, file] = given.positional;
  if (given.positional.length !== 3 || (command !== 'put' && command !== 'take')) throw new Stop(2, USAGE);
  // An address ends in the id, before `?v=`; a page's name may stand before it.
  const id = ID.exec(database.split(/[?#]/)[0].replace(/\/$/, ''))?.[1];
  if (!id) throw new Stop(2, `${database} is not a database id or the Notion address of a database.`);
  return { ...given, command, database: id, file: resolve(file) };
}

/** The specification and the binding of an add-on, interpreted as the add-on's page does it. */
async function tool(addon) {
  const folders = readdirSync(resolve(root, 'addons'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(root, 'addons', entry.name, 'addon.json')))
    .map((entry) => entry.name);
  const id = addon ?? (folders.length === 1 ? folders[0] : undefined);
  if (!id) throw new Stop(2, `Name the add-on with --addon: ${folders.join(', ')}.`);
  if (!folders.includes(id)) throw new Stop(2, `There is no add-on ${id}. There is: ${folders.join(', ')}.`);

  const { loadSpecification } = await import('../src/disl/specification.ts');
  const { interpretMetamodel } = await import('../src/disl/metamodel.ts');
  const { bindingOf, interpretPersistence } = await import('../src/disl/persistence.ts');
  const { loadDocument } = await import('../src/fbl/documents/documentLoader.ts');
  const { storeSchema } = await import('../src/store/schema.ts');

  const folder = resolve(root, 'addons', id);
  const names = JSON.parse(readFileSync(resolve(folder, 'addon.json'), 'utf8'));
  const specification = loadSpecification(JSON.parse(readFileSync(resolve(folder, names.specification), 'utf8'))).value;
  const metamodel = interpretMetamodel(specification).value;
  const persistence = interpretPersistence(specification, metamodel).value;
  const document = loadDocument(readFileSync(resolve(folder, names.binding)), names.binding).document;
  const binding = document && bindingOf(persistence, document);
  if (!binding) throw new Stop(1, `The add-on ${id} has no binding its specification names.`);
  const schema = storeSchema(binding, metamodel, persistence);
  const unstorable = schema.findings.filter((found) => found.severity === 'error');
  if (unstorable.length > 0) throw new Stop(1, unstorable.map((found) => found.message).join('\n'));
  return { binding, schema };
}

/** The calls of src/store/, with a session that has the token already and never opens a window. */
async function notionCalls(token, service, environment) {
  const { createSession } = await import('../src/store/session.ts');
  const { createNotionCalls } = await import('../src/store/notion.ts');
  const kept = new Map([['adp-notion.token', JSON.stringify({ token, refresh: null, workspace: '' })]]);
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value), removeItem: (key) => void kept.delete(key) };
  const session = createSession({ service, storage, fetch: environment.fetch, open: () => null, listen: () => () => undefined });
  return createNotionCalls({ service, session, fetch: environment.fetch, now: environment.now, sleep: environment.sleep });
}

async function dataSourceOf(calls, database) {
  const found = await calls.database(database);
  if (found.data_sources.length !== 1) throw new Stop(1, `The database has ${found.data_sources.length} data sources, and a store has one.`);
  return calls.dataSource(found.data_sources[0].id);
}

async function put({ file, replace }, calls, dataSource, { binding, schema }, say) {
  const { allRows } = await import('../src/store/document.ts');
  const { createRows, rowsOf } = await import('../src/store/rows.ts');
  const { prepare } = await import('../src/store/schema.ts');

  if (!existsSync(file)) throw new Stop(1, `${file} does not exist.`);
  const document = rowsOf(readFileSync(file), schema, binding);
  if (document.refused.length > 0) {
    for (const each of document.refused) say.error(`Refused, line ${each.line}: ${each.message}`);
    throw new Stop(1, 'Nothing was put in: Notion cannot hold the above.');
  }

  const lacking = await prepare(schema, dataSource, calls);
  if (!lacking.prepared) {
    for (const { property, has } of lacking.wrong) say.error(`The property ${property.name} of the database is ${has}, and a store holds it as ${property.type}.`);
    throw new Stop(1, 'Nothing was put in: the database cannot be prepared as a store.');
  }

  const held = await allRows(calls, dataSource.id);
  if (held.length > 0 && !replace) throw new Stop(1, `Nothing was put in: the database has ${held.length} rows. Give --replace to move them to the trash first.`);
  if (held.length > 0) {
    await calls.edit((writes) => Promise.all(held.map((row) => writes.trashRow(row.id, true))));
    say.log(`Moved ${held.length} rows to the trash.`);
  }

  await createRows(document.rows, dataSource.id, calls);
  for (const each of document.notKept) say.log(`Not kept, line ${each.line}: ${each.message}`);
  say.log(`Stored ${document.rows.length} rows.`);
}

async function take({ file, force }, calls, dataSource, { binding, schema }, say) {
  const { allRows } = await import('../src/store/document.ts');
  const { readRows } = await import('../src/store/rows.ts');
  const { missing } = await import('../src/store/schema.ts');

  if (existsSync(file) && !force) throw new Stop(1, `Nothing was written: ${file} exists. Give --force to overwrite it.`);
  if (!missing(schema, dataSource).prepared) throw new Stop(1, 'Nothing was written: the database is not prepared as a store.');

  const read = readRows(await allRows(calls, dataSource.id), schema, binding);
  for (const found of read.findings) say.error(found.message);
  if (read.reading.unreadable || read.findings.some((found) => found.severity === 'error')) throw new Stop(1, 'Nothing was written: the rows could not be read as a document.');
  writeFileSync(file, read.body);
  say.log(`Wrote ${read.entries.length} rows to ${file}.`);
  // A row that was not read is not in the file.
  if (read.findings.length > 0) throw new Stop(1, 'The file does not hold the whole store.');
}

/**
 * Runs one command and answers its exit code. `environment` gives what a test replaces: the
 * variables, `fetch`, the clock of Notion's limit, and where the lines go.
 */
export async function main(args, environment = {}) {
  const say = { log: environment.log ?? console.log, error: environment.error ?? console.error };
  try {
    const given = parse(args);
    const token = (environment.env ?? process.env).NOTION_TOKEN;
    if (!token) throw new Stop(2, 'Set the environment variable NOTION_TOKEN to a Notion token.');
    const loaded = await tool(given.addon);
    const calls = await notionCalls(token, given.service, environment);
    const dataSource = await dataSourceOf(calls, given.database);
    await (given.command === 'put' ? put : take)(given, calls, dataSource, loaded, say);
    return 0;
  } catch (error) {
    if (error instanceof Stop) {
      say.error(error.message);
      return error.code;
    }
    if (error?.name !== 'NotionError') throw error;
    say.error({
      offline: `The service could not be reached. Is it running? (node scripts/service.mjs)`,
      connect: 'Notion refuses the token of NOTION_TOKEN.',
    }[error.kind] ?? `Notion answered ${error.status} ${error.code}: ${error.message}`);
    return 1;
  }
}

// Run as a command, not imported by a test.
if (process.argv[1] && relative(fileURLToPath(import.meta.url), resolve(process.argv[1])) === '') {
  // The sources of src/ are TypeScript that names its modules without an extension, which Node
  // does not run by itself: esbuild, which the build uses too, turns each into JavaScript as it is
  // loaded.
  const { registerHooks } = await import('node:module');
  const { transformSync } = await import('esbuild');
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (!/^\.{1,2}\//.test(specifier)) throw error;
        for (const suffix of ['.ts', '/index.ts']) {
          try {
            return next(specifier + suffix, context);
          } catch {
            // The next suffix, or the first error.
          }
        }
        throw error;
      }
    },
    load(url, context, next) {
      if (!url.endsWith('.ts')) return next(url, context);
      return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'ts', format: 'esm', sourcefile: url }).code };
    },
  });
  process.exitCode = await main(process.argv.slice(2));
}
