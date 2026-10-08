import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBody } from '../../src/fbl/rules/bodyReading';
import { readModel } from '../../src/disl/persistence';
import type { Loaded, Model } from '../../src/disl/model';
import { createRows, readRows, rowsOf, type DocumentRows, type NewRow, type RowsRead } from '../../src/store/rows';
import { prepare, storeSchema } from '../../src/store/schema';
import { tool } from '../disl/tool';
import { createMemoryCalls, type MemoryCalls } from '../support/memoryCalls';
import type { MemoryValue } from '../support/memoryNotion';

const { binding, metamodel, persistence } = tool();
const schema = storeSchema(binding, metamodel, persistence);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (read: RowsRead): string => new TextDecoder().decode(read.body);

const example = (name: string): Uint8Array => readFileSync(`test/examples/gartner-hype-cycle-graph/${name}/${name}.ghg`);
const fixture = (name: string): Uint8Array => readFileSync(`test/fixtures/gartner-hype-cycle-graph/${name}.ghg`);

const model = (body: Uint8Array): Loaded<Model> => readModel(readBody(body, binding).toModel(), binding, metamodel, persistence);
const modelOf = (read: RowsRead): Loaded<Model> => readModel(read.reading.toModel(), binding, metamodel, persistence);

// What SC-003 compares: the elements and relations in their order, with their attributes and
// ends. The line an element stands at, and what the binding reads beside the model, do not count.
const compared = (loaded: Loaded<Model>) => ({
  diagram: loaded.value.diagram,
  elements: loaded.value.elements.map(({ id, type, attributes, parent }) => ({ id, type, attributes, parent })),
  relations: loaded.value.relations.map(({ id, type, attributes, source, target }) => ({ id, type, attributes, source, target })),
});
const found = (loaded: Loaded<Model>): string[] => loaded.findings.map((finding) => `${finding.code} ${finding.element ?? ''}`.trim());
const counted = (put: DocumentRows): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const each of put.notKept) counts[each.what] = (counts[each.what] ?? 0) + 1;
  return counts;
};

interface Store extends MemoryCalls {
  readonly dataSourceId: string;
  read(): Promise<RowsRead>;
  /** Rows as the in-memory Notion takes them plainly; answers their ids. */
  seed(...rows: Record<string, MemoryValue>[]): string[];
}

async function store(): Promise<Store> {
  const memory = createMemoryCalls();
  const { dataSourceId } = memory.notion.createDatabase();
  const lacking = await prepare(schema, await memory.calls.dataSource(dataSourceId), memory.calls);
  expect(lacking.prepared).toBe(true);
  return {
    ...memory,
    dataSourceId,
    read: async () => readRows(await memory.allRows(dataSourceId), schema, binding),
    seed: (...rows) => memory.notion.seedRows(dataSourceId, rows),
  };
}

/** Puts a document into a new store and takes the store's reading of it. */
async function through(body: Uint8Array): Promise<{ put: DocumentRows; ids: string[]; read: RowsRead; store: Store }> {
  const made = await store();
  const put = rowsOf(body, schema, binding);
  const ids = await createRows(put.rows, made.dataSourceId, made.calls);
  return { put, ids, read: await made.read(), store: made };
}

describe('each example, put into a store and read from it', () => {
  // What each holds that a store does not keep: its comments, and nothing else.
  it.each([
    ['coal-technologies', 101, { comment: 3 }],
    ['digital-trends', 90, { comment: 2 }],
    ['electric-vehicles', 82, { comment: 3 }],
    ['energy-breakthroughs', 97, { comment: 3 }],
    ['eras-of-innovation', 127, { comment: 2 }],
    ['internet-evolution', 97, { comment: 3 }],
    ['llms-and-agents', 109, { comment: 3 }],
    ['technology-trends', 518, { comment: 2 }],
    ['warfare-in-ukraine', 89, { comment: 3 }],
  ])('%s reads the same: %i rows', async (name, count, lost) => {
    const body = example(name);
    const { put, ids, read } = await through(body);
    expect(put.refused).toEqual([]);
    expect(put.rows).toHaveLength(count);
    expect(counted(put)).toEqual(lost);

    expect(read.findings).toEqual([]);
    const original = model(body);
    const stored = modelOf(read);
    expect(compared(stored)).toEqual(compared(original));
    expect(found(stored)).toEqual(found(original));

    // Which row is which entry: every row, at its place among the entries of its kind.
    expect(read.entries).toHaveLength(count);
    const elements = read.reading.toModel().elements;
    for (const kind of schema.kinds) {
      const titles = elements.filter((element) => element.rule === kind.name).map((element) => (kind.single ? kind.name : element.id));
      const rows = read.entries.filter((entry) => entry.kind === kind.name);
      expect(rows.map((entry) => entry.position)).toEqual(rows.map((_, position) => position));
      expect(rows.map((entry) => put.rows[ids.indexOf(entry.rowId)].id)).toEqual(titles);
    }
  }, 30_000);

  it('creates a row a reference names before the row that holds it, each relation by row id', async () => {
    const { put, ids, store: made } = await through(example('eras-of-innovation'));
    const created = made.notion.rows(made.dataSourceId).map((row) => row.id);
    const holding = put.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.references.length > 0);
    expect(holding.length).toBeGreaterThan(0);
    for (const { row, index } of holding) {
      for (const reference of row.references) {
        for (const other of reference.rows) expect(created.indexOf(ids[other])).toBeLessThan(created.indexOf(ids[index]));
        const held = made.notion.rows(made.dataSourceId).find((each) => each.id === ids[index])!.properties[reference.property].relation as { id: string }[];
        expect(held.map((each) => each.id)).toEqual(reference.rows.map((other) => ids[other]));
      }
    }
    // No row was written twice: one call for each.
    expect(made.service.requests.filter((request) => request.startsWith('PATCH /notion/v1/pages'))).toEqual([]);
  });
});

describe('a document as rows', () => {
  it('gives each row its kind, its place among its kind, and its values as Notion takes them', () => {
    const put = rowsOf(fixture('triggers-and-notes'), schema, binding);
    expect(put.rows.map((row) => [row.kind, row.order, row.id])).toEqual([
      ['unit', undefined, 'unit'],
      ['trend', 1, 'transistors'], ['trend', 2, 'radio'],
      ['trigger', 1, 'transistor-invented'],
      ['note', 1, 'note-1'], ['note', 2, 'note-2'],
      ['influence', 1, 'i-12'], ['influence', 2, 'i-13'],
    ]);
    expect(put.rows[0].values).toEqual({ id: { title: [{ text: { content: 'unit' } }] }, Kind: { select: { name: 'unit' } }, unit: { select: { name: 'year' } } });
    expect(put.rows[3].values).toMatchObject({
      Kind: { select: { name: 'trigger' } },
      Order: { number: 1 },
      date: { rich_text: [{ text: { content: '1947-12' } }] },
      row: { number: 1 },
      tags: { multi_select: [{ name: 'electronics' }, { name: 'invention' }] },
    });
    expect(put.rows[7].references).toEqual([{ property: 'from', ids: ['transistors'], rows: [1] }, { property: 'to', ids: ['radio'], rows: [2] }]);
    expect(put.rows[7].values).not.toHaveProperty('from');
    expect(put.notKept.map((each) => [each.what, each.line])).toEqual([['comment', 3]]);
  });

  it('reads the same from a store, a text of several lines and the unit too', async () => {
    const body = fixture('triggers-and-notes');
    const { read } = await through(body);
    expect(read.findings).toEqual([]);
    expect(compared(modelOf(read))).toEqual(compared(model(body)));
    expect(textOf(read)).toMatch(/^gartner-hypecycle-graph: 1\r\nunit: year\r\ntrends:\r\n {2}- id: transistors\r\n/);
    expect(textOf(read)).toContain('    text: |-\r\n      Dates are illustrative.\r\n\r\n      See the readme.\r\n    at: 1950-01\r\n');
  });

  it('says what a store does not keep: a key the binding does not read and an entry that is not a mapping', () => {
    const put = rowsOf(fixture('malformed-entries'), schema, binding);
    expect(put.notKept.map((each) => each.what)).toEqual(['key', 'entry', 'key']);
    expect(put.notKept.map((each) => each.message)).toEqual([
      'The key `colour` of `trend` `odd` is not one the binding reads, so it is not kept.',
      'The entry at line 16 is not one a row holds, so it is not kept: This entry is not a mapping, so it is kept as it is.',
      'The key `weight` of `influence` `link` is not one the binding reads, so it is not kept.',
    ]);
    // A text where its property holds a number is refused, with the entry named.
    expect(put.refused.map((each) => each.message)).toEqual([
      'The `row` of `trend` `odd` is not a value its property holds (number).',
      'The `phases` of `trend` `odd` is not a value its property holds (number).',
    ]);
  });

  it('does not keep the id of a reference that names nothing, and keeps the entry', async () => {
    const body = fixture('rule-dangling-reference');
    const { put, read } = await through(body);
    expect(put.notKept.map((each) => each.message)).toEqual(['The `to` of `influence` `ax` names `x`, which is in no list it may name; a relation cannot hold that id, so it is not kept.']);
    expect(put.rows.find((row) => row.id === 'ax')!.references.map((reference) => reference.property)).toEqual(['from']);
    // The same elements and relations: the end named nothing before, and names nothing now.
    expect(compared(modelOf(read))).toEqual(compared(model(body)));
    expect(textOf(read)).not.toContain('to: x');
  });

  it('keeps two entries with one id as two rows', async () => {
    const body = fixture('rule-duplicate-id');
    const { read } = await through(body);
    expect(compared(modelOf(read))).toEqual(compared(model(body)));
    expect(found(modelOf(read))).toEqual(found(model(body)));
  });

  it('refuses an option with a comma, with the entry named, and an empty value is an absent key', () => {
    const put = rowsOf(encode('gartner-hypecycle-graph: 1\ntrends:\n  - id: a\n    name: ""\n    tags: ["one, two", three]\ninfluences: []\n'), schema, binding);
    expect(put.refused).toEqual([{ what: 'unheld', line: 3, message: 'The `tags` of `trend` `a` is not a value its property holds (multi select).' }]);
    expect(put.notKept).toEqual([{ what: 'empty', line: 3, message: 'The empty `name` of `trend` `a` is not kept: an empty property is an absent key.' }]);
    expect(Object.keys(put.rows[0].values)).toEqual(['id', 'Kind', 'Order']);
  });

  it('refuses a document that cannot be read', () => {
    const put = rowsOf(fixture('not-yaml'), schema, binding);
    expect(put.rows).toEqual([]);
    expect(put.refused.map((each) => each.what)).toEqual(['unreadable']);
  });

  it('splits a text longer than one item holds, and reads it joined', async () => {
    const long = 'word '.repeat(900).trim();
    const body = encode(`gartner-hypecycle-graph: 1\ntrends:\n  - id: a\n    name: A\n    description: ${long}\ninfluences: []\n`);
    const { put, read } = await through(body);
    expect((put.rows[0].values.description.rich_text as unknown[]).length).toBe(3);
    expect(modelOf(read).value.elements[0].attributes.description).toBe(long);
  });

  it('relates rows that name each other in a circle after both exist', async () => {
    const made = await store();
    const row = (id: string, other: number): NewRow => ({
      kind: 'influence', order: other + 1, id, line: 1,
      values: { id: { title: [{ text: { content: id } }] }, Kind: { select: { name: 'influence' } } },
      references: [{ property: 'from', ids: ['?'], rows: [other] }],
    });
    const ids = await createRows([row('a', 1), row('b', 0)], made.dataSourceId, made.calls);
    const rows = made.notion.rows(made.dataSourceId);
    expect(rows.map((each) => (each.properties.from.relation as { id: string }[])[0].id)).toEqual([ids[1], ids[0]]);
  });
});

describe('rows as a document', () => {
  const trend = (id: string, order: number | null, more: Record<string, MemoryValue> = {}): Record<string, MemoryValue> =>
    ({ id, Kind: 'trend', Order: order, name: id.toUpperCase(), start: '2000-01', stop: '2010-01', ...more });
  const ids = (read: RowsRead): string[] => modelOf(read).value.elements.map((element) => element.id);

  it('is the binding\'s template for a store without rows, and reports nothing', async () => {
    const read = await (await store()).read();
    expect(textOf(read)).toBe(binding.template!.text);
    expect(read.findings).toEqual([]);
    expect(read.entries).toEqual([]);
    expect(modelOf(read).findings).toEqual([]);
  });

  it('orders the rows of a kind by Order, which need not be dense, and those with one number by creation', async () => {
    const made = await store();
    made.seed(trend('c', 40), trend('b', 7), trend('d', 40), trend('a', -3), trend('last', null), trend('e', 40.5));
    const read = await made.read();
    expect(read.findings).toEqual([]);
    expect(ids(read)).toEqual(['a', 'b', 'c', 'd', 'e', 'last']);
    expect(read.entries.map((entry) => [entry.kind, entry.position])).toEqual([0, 1, 2, 3, 4, 5].map((position) => ['trend', position]));
  });

  it('records which row is which entry', async () => {
    const made = await store();
    const [second, unit, first, trigger] = made.seed(trend('b', 2), { id: 'unit', Kind: 'unit', unit: 'decade' }, trend('a', 1), { id: 't', Kind: 'trigger', Order: 1, name: 'T', date: '2001-01' });
    expect((await made.read()).entries).toEqual([
      { kind: 'unit', position: 0, rowId: unit },
      { kind: 'trend', position: 0, rowId: first },
      { kind: 'trend', position: 1, rowId: second },
      { kind: 'trigger', position: 0, rowId: trigger },
    ]);
  });

  it('does not read a row whose Kind is empty or names no kind, and reads the rest', async () => {
    const made = await store();
    const [, none, other] = made.seed(trend('a', 1), { id: 'nothing', name: 'N' }, { id: 'odd', Kind: 'gadget', name: 'G' }, trend('b', 2));
    const read = await made.read();
    expect(read.findings.map((finding) => [finding.code, finding.detail?.rowId, finding.message])).toEqual([
      ['store.unknown-kind', none, 'The row `nothing` has no `Kind`, so it is not read.'],
      ['store.unknown-kind', other, 'The row `odd` is of the kind `gadget`, which this store does not have, so it is not read.'],
    ]);
    expect(ids(read)).toEqual(['a', 'b']);
    expect(read.entries).toHaveLength(2);
  });

  it('reports a row the binding cannot read, and reads the rest', async () => {
    const made = await store();
    // A row with no title and no value gives the binding no key to write; a month that is none is read and reported by the binding.
    const [empty] = made.seed({ Kind: 'trend', Order: 1 }, trend('a', 2, { start: 'soon' }), trend('b', 3));
    const read = await made.read();
    expect(read.findings.map((finding) => [finding.code, finding.detail?.rowId])).toEqual([['store.unreadable-row', empty]]);
    const loaded = modelOf(read);
    expect(loaded.value.elements.map((element) => [element.id, element.attributes.start])).toEqual([['a', undefined], ['b', 24000]]);
    expect(found(loaded)).toEqual(['std.unreadableEntry a']);
    expect(read.entries.map((entry) => entry.position)).toEqual([0, 1]);
  });

  it('reads the first row of a kind that has one row, and reports a second', async () => {
    const made = await store();
    const [, second] = made.seed({ id: 'unit', Kind: 'unit', unit: 'year' }, { id: 'unit', Kind: 'unit', unit: 'century' }, trend('a', 1));
    const read = await made.read();
    expect(read.findings.map((finding) => [finding.code, finding.detail?.rowId])).toEqual([['store.second-row', second]]);
    expect(modelOf(read).value.diagram).toEqual({ unit: 'year' });
    expect(read.entries.filter((entry) => entry.kind === 'unit')).toHaveLength(1);
  });

  it('reads a relation as the stored id of the related row', async () => {
    const made = await store();
    const [a, b] = made.seed(trend('a', 1), trend('b', 2));
    made.seed({ id: 'ab', Kind: 'influence', Order: 1, from: [a], to: [b], 'to-phase': 'peak', 'to-edge': 'top', 'to-at': 0.25 });
    const read = await made.read();
    expect(read.findings).toEqual([]);
    expect(textOf(read)).toContain('  - id: ab\r\n    from: a\r\n    to: b\r\n    to-phase: peak\r\n    to-edge: top\r\n    to-at: 0.25\r\n');
    expect(modelOf(read).value.relations.map(({ source, target }) => [source, target])).toEqual([['a', 'b']]);
  });

  it('reports a relation to two rows and reads it as naming none', async () => {
    const made = await store();
    const [a, b, c] = made.seed(trend('a', 1), trend('b', 2), trend('c', 3));
    const [held] = made.seed({ id: 'x', Kind: 'influence', Order: 1, from: [a], to: [b, c] });
    const read = await made.read();
    expect(read.findings.map((finding) => [finding.code, finding.detail?.rowId, finding.message])).toEqual([
      ['store.relation', held, 'The row `x` names 2 rows in `to`, which holds one, so it is read as naming none.'],
    ]);
    expect(modelOf(read).value.relations.map(({ id, source, target }) => [id, source, target])).toEqual([['x', 'a', undefined]]);
    expect(ids(read)).toEqual(['a', 'b', 'c']);
  });

  it('reports a relation to a row of a kind the reference does not allow', async () => {
    const made = await store();
    const [a, t, n] = made.seed(trend('a', 1), { id: 't', Kind: 'trigger', Order: 1, name: 'T', date: '2001-01' }, { id: 'n', Kind: 'note', Order: 1, text: 'N' });
    const [into, note] = made.seed({ id: 'into', Kind: 'influence', Order: 1, from: [a], to: [t] }, { id: 'note', Kind: 'influence', Order: 2, from: [n], to: [a] });
    const read = await made.read();
    expect(read.findings.map((finding) => [finding.detail?.rowId, finding.message])).toEqual([
      [into, 'The row `into` names `t` in `to`, which is a `trigger`.'],
      [note, 'The row `note` names `n` in `from`, which is a `note`.'],
    ]);
    // The id is read all the same, as a file would hold it, so the specification's own rules judge it.
    expect(modelOf(read).value.relations.map(({ id, source, target }) => [id, source, target])).toEqual([['into', 'a', 't'], ['note', 'n', 'a']]);
  });

  it('takes a row in the trash for no row, also where a relation names it', async () => {
    const made = await store();
    const [a, b] = made.seed(trend('a', 1), trend('b', 2));
    made.seed({ id: 'ab', Kind: 'influence', Order: 1, from: [a], to: [b] });
    made.notion.updateRow(b, { in_trash: true });
    const read = await made.read();
    expect(read.findings).toEqual([]);
    expect(ids(read)).toEqual(['a']);
    expect(modelOf(read).value.relations.map(({ source, target }) => [source, target])).toEqual([['a', undefined]]);
    // Handed the row all the same, as a caller that kept it would: it is still no row.
    expect(readRows(made.notion.rows(made.dataSourceId) as never, schema, binding).entries).toEqual(read.entries);
  });

  it('reads an empty property as an absent key, and no property of another kind', async () => {
    const made = await store();
    made.seed(trend('a', 1, { description: '', tags: [], date: '1999-01', text: 'not a trend\'s', row: 0 }));
    const read = await made.read();
    expect(textOf(read)).toBe('gartner-hypecycle-graph: 1\r\ntrends:\r\n  - id: a\r\n    name: A\r\n    start: 2000-01\r\n    stop: 2010-01\r\n    row: 0\r\ninfluences: []\r\n');
  });

  it('leaves a property the schema does not have alone', async () => {
    const made = await store();
    await made.calls.edit((writes) => writes.updateProperties(made.dataSourceId, { Mine: { rich_text: {} } }));
    made.seed(trend('a', 1, { Mine: 'my own' }));
    expect(textOf(await made.read())).not.toContain('my own');
  });
});
