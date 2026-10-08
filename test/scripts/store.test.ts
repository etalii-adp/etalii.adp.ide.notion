import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readBody } from '../../src/fbl/rules/bodyReading';
import { readModel } from '../../src/disl/persistence';
// @ts-expect-error The script is plain JavaScript, with no declarations.
import { main } from '../../scripts/store.mjs';
import { tool } from '../disl/tool';
import { createMemoryService, type MemoryService } from '../support/memoryService';

const { binding, metamodel, persistence } = tool();
const folder = mkdtempSync(join(tmpdir(), 'adp-notion-store-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const example = (name: string): string => `test/examples/gartner-hype-cycle-graph/${name}/${name}.ghg`;
const fixture = (name: string): string => `test/fixtures/gartner-hype-cycle-graph/${name}.ghg`;

// What SC-003 compares: the elements and relations in their order, with their attributes and ends.
function compared(file: string) {
  const loaded = readModel(readBody(readFileSync(file), binding).toModel(), binding, metamodel, persistence);
  return {
    diagram: loaded.value.diagram,
    elements: loaded.value.elements.map(({ id, type, attributes, parent }) => ({ id, type, attributes, parent })),
    relations: loaded.value.relations.map(({ id, type, attributes, source, target }) => ({ id, type, attributes, source, target })),
    findings: loaded.findings.map((finding) => `${finding.code} ${finding.element ?? ''}`.trim()),
  };
}

interface Run {
  code: number;
  out: string[];
  errors: string[];
}

function setting(token = 'memory-token') {
  const service: MemoryService = createMemoryService();
  const database = service.notion.createDatabase();
  let clock = 0;
  const run = async (...args: string[]): Promise<Run> => {
    const out: string[] = [];
    const errors: string[] = [];
    const code: number = await main([...args, '--service', service.address], {
      env: { NOTION_TOKEN: token },
      fetch: service.fetch,
      // Only the sleeps move the clock: no test waits out Notion's limit.
      now: () => clock,
      sleep: async (milliseconds: number) => void (clock += milliseconds),
      log: (line: string) => out.push(line),
      error: (line: string) => errors.push(line),
    });
    return { code, out, errors };
  };
  const rows = () => service.notion.rows(database.dataSourceId).filter((row) => !row.in_trash);
  return { service, database, run, rows };
}

describe('scripts/store.mjs', () => {
  it('puts an example into an unprepared database and takes the same document out', async () => {
    const { database, run, rows, service } = setting();
    const put = await run('put', database.id, example('electric-vehicles'));
    expect(put.errors).toEqual([]);
    expect(put.code).toBe(0);
    expect(put.out.filter((line) => line.startsWith('Not kept'))).toHaveLength(3);
    expect(put.out.at(-1)).toBe('Stored 82 rows.');
    expect(rows()).toHaveLength(82);
    expect(Object.keys(service.notion.properties(database.dataSourceId))).toContain('Kind');

    const file = join(folder, 'taken.ghg');
    const taken = await run('take', database.id, file);
    expect(taken).toMatchObject({ code: 0, errors: [] });
    expect(compared(file)).toEqual(compared(example('electric-vehicles')));
  });

  it('takes the database by its Notion address, and the add-on by name', async () => {
    const { database, run, rows } = setting();
    const address = `https://app.notion.com/p/A-graph-${database.id.replaceAll('-', '')}?v=3f2be2fd05b6807cbf5a000c8f2809c0`;
    expect((await run('put', address, fixture('triggers-and-notes'), '--addon', 'gartner-hype-cycle-graph')).code).toBe(0);
    expect(rows()).toHaveLength(8);
    expect(await run('put', database.id, fixture('rules-clean'), '--addon', 'another')).toMatchObject({ code: 2 });
    expect(await run('put', 'no-database', fixture('rules-clean'))).toMatchObject({ code: 2 });
  });

  it('refuses a database that has rows, unless --replace moves them to the trash first', async () => {
    const { database, run, rows, service } = setting();
    expect((await run('put', database.id, fixture('triggers-and-notes'))).code).toBe(0);
    const first = rows().map((row) => row.id);

    const again = await run('put', database.id, fixture('rules-clean'));
    expect(again.code).toBe(1);
    expect(again.errors).toEqual(['Nothing was put in: the database has 8 rows. Give --replace to move them to the trash first.']);
    expect(rows().map((row) => row.id)).toEqual(first);

    const replaced = await run('put', database.id, fixture('rules-clean'), '--replace');
    expect(replaced.code).toBe(0);
    expect(replaced.out[0]).toBe('Moved 8 rows to the trash.');
    expect(rows().some((row) => first.includes(row.id))).toBe(false);
    expect(service.notion.rows(database.dataSourceId).filter((row) => row.in_trash).map((row) => row.id)).toEqual(first);

    const file = join(folder, 'replaced.ghg');
    expect((await run('take', database.id, file)).code).toBe(0);
    expect(compared(file)).toEqual(compared(fixture('rules-clean')));
  });

  it('reports what a store does not keep, and puts nothing in when Notion cannot hold a value', async () => {
    const { database, run, rows, service } = setting();
    const dangling = await run('put', database.id, fixture('rule-dangling-reference'));
    expect(dangling.code).toBe(0);
    expect(dangling.out.filter((line) => line.startsWith('Not kept')).map((line) => line.replace(/^Not kept, line \d+: /, ''))).toContain(
      'The `to` of `influence` `ax` names `x`, which is in no list it may name; a relation cannot hold that id, so it is not kept.',
    );
    const held = rows().length;

    const refused = await run('put', database.id, fixture('malformed-entries'), '--replace');
    expect(refused.code).toBe(1);
    expect(refused.errors.filter((line) => line.startsWith('Refused, line'))).toHaveLength(2);
    expect(refused.errors.at(-1)).toBe('Nothing was put in: Notion cannot hold the above.');
    expect(rows()).toHaveLength(held);
    expect(service.requests.filter((request) => request.startsWith('PATCH /notion/v1/pages'))).toEqual([]);

    expect((await run('put', database.id, fixture('not-yaml'), '--replace')).code).toBe(1);
    expect(rows()).toHaveLength(held);
  });

  it('overwrites a file only with --force', async () => {
    const { database, run } = setting();
    await run('put', database.id, fixture('triggers-and-notes'));
    const file = join(folder, 'kept.ghg');
    writeFileSync(file, 'mine');

    const kept = await run('take', database.id, file);
    expect(kept.code).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('mine');

    expect((await run('take', database.id, file, '--force')).code).toBe(0);
    expect(compared(file)).toEqual(compared(fixture('triggers-and-notes')));
  });

  it('writes what could be read and exits with 1 when a row could not', async () => {
    const { database, run, service } = setting();
    await run('put', database.id, fixture('triggers-and-notes'));
    service.notion.seedRows(database.dataSourceId, [{ id: 'odd', Kind: 'gadget' }]);
    const file = join(folder, 'partial.ghg');
    const taken = await run('take', database.id, file);
    expect(taken.code).toBe(1);
    expect(taken.errors).toEqual(['The row `odd` is of the kind `gadget`, which this store does not have, so it is not read.', 'The file does not hold the whole store.']);
    expect(compared(file)).toEqual(compared(fixture('triggers-and-notes')));
  });

  it('takes nothing from a database that is not a store', async () => {
    const { database, run } = setting();
    const file = join(folder, 'none.ghg');
    expect(await run('take', database.id, file)).toMatchObject({ code: 1, errors: ['Nothing was written: the database is not prepared as a store.'] });
    expect(() => readFileSync(file)).toThrow();
  });

  it('needs the token of the environment, and says what Notion answers', async () => {
    expect(await setting('').run('put', '11111111111141118111111111111111', fixture('rules-clean'))).toMatchObject({ code: 2, errors: ['Set the environment variable NOTION_TOKEN to a Notion token.'] });
    const stranger = setting('not-a-token');
    expect(await stranger.run('put', stranger.database.id, fixture('rules-clean'))).toMatchObject({ code: 1, errors: ['Notion refuses the token of NOTION_TOKEN.'] });

    const { database, run, service } = setting();
    service.notion.unshare(database.id);
    const unshared = await run('put', database.id, fixture('rules-clean'));
    expect(unshared.code).toBe(1);
    expect(unshared.errors[0]).toMatch(/^Notion answered 404 object_not_found: /);

    expect(await run('copy', database.id, 'a.ghg')).toMatchObject({ code: 2 });
    expect(await run('put', database.id)).toMatchObject({ code: 2 });
  });
});
