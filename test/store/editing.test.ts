import { describe, expect, it } from 'vitest';
import type { FblSplice } from '../../src/fbl/splice';
import { storeOf } from '../../src/store/document';
import { recordOf, resolve, type Resolved, type StoreRecord } from '../../src/store/writes';
import type { MemoryPage } from '../support/memoryNotion';
import { openExample, unlined, type OpenExample } from '../support/openExample';

const QUERY = 'POST /v1/data_sources/store/query';
const CREATE = 'POST /v1/pages';
const update = (title: string): string => `PATCH /v1/pages/${title}`;

/** The model in memory is what the database holds, read whole. */
async function expectStored(made: OpenExample): Promise<void> {
  expect(unlined(made.document.model)).toEqual(unlined((await made.reopen()).model));
  // The calls of that reading are not the edit's.
  made.sent();
}

const rowOf = (made: OpenExample, title: string): MemoryPage => made.rows().find((page) => (page.properties.id.title as { plain_text: string }[])[0]?.plain_text === title)!;
const plain = (page: MemoryPage, name: string): unknown => {
  const held = page.properties[name];
  const value = held[held.type as string];
  if (held.type === 'rich_text' || held.type === 'title') return (value as { plain_text: string }[]).map((item) => item.plain_text).join('');
  if (held.type === 'select') return (value as { name: string } | null)?.name ?? null;
  if (held.type === 'multi_select') return (value as { name: string }[]).map((option) => option.name);
  if (held.type === 'relation') return (value as { id: string }[]).map((related) => related.id);
  return value;
};
const highest = (made: OpenExample, kind: string): number =>
  Math.max(...made.rows().filter((page) => !page.in_trash && plain(page, 'Kind') === kind).map((page) => plain(page, 'Order') as number));

describe('each kind of edit writes exactly its rows and properties', () => {
  it('an insertion is one row created, with its Kind, Order, values and relations', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    let before = made.rows();
    const last = highest(made, 'trend');

    expect(await made.apply({ kind: 'add', type: 'Trend', id: 'solid-state', attributes: { name: 'Solid-state batteries', start: '2027-01', stop: '2040-06', row: 30n, phases: 3n, tags: ['batteries', 'ideas'] } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, CREATE]);
    expect(made.written(before)).toEqual({ 'solid-state': ['created'] });
    const created = rowOf(made, 'solid-state');
    expect(Object.fromEntries(['Kind', 'Order', 'name', 'start', 'stop', 'row', 'phases', 'tags', 'description', 'peak-end'].map((name) => [name, plain(created, name)]))).toEqual({
      Kind: 'trend', Order: last + 1, name: 'Solid-state batteries', start: '2027-01', stop: '2040-06', row: 30, phases: 3, tags: ['batteries', 'ideas'], description: '', 'peak-end': '',
    });
    expect(made.document.model.elements.find((element) => element.id === 'solid-state')).toMatchObject({ type: 'Trend', attributes: { name: 'Solid-state batteries', phases: 3 } });
    await expectStored(made);

    // A reference is a relation to the row of the element it names: here a row that was just created.
    before = made.rows();
    const influences = highest(made, 'influence');
    expect(await made.apply({ kind: 'add', type: 'Influence', id: 'solid-state--battery-electric-cars', attributes: { from: 'solid-state', fromPhase: 'peak', fromEdge: 'top', fromAt: 0.25, to: 'battery-electric-cars', toPhase: 'plateau', toEdge: 'bottom', toAt: 0.5 } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, CREATE]);
    expect(made.written(before)).toEqual({ 'solid-state--battery-electric-cars': ['created'] });
    const influence = rowOf(made, 'solid-state--battery-electric-cars');
    expect(['Kind', 'Order', 'from', 'from-phase', 'from-at', 'to', 'to-edge'].map((name) => plain(influence, name))).toEqual([
      'influence', influences + 1, [created.id], 'peak', 0.25, [rowOf(made, 'battery-electric-cars').id], 'bottom',
    ]);
    expect(made.document.model.relations.at(-1)).toMatchObject({ id: 'solid-state--battery-electric-cars', source: 'solid-state', target: 'battery-electric-cars' });
    await expectStored(made);
  });

  it('an insertion into a list the document does not have yet is one row too, with a text of several lines', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    expect(await made.apply({ kind: 'add', type: 'Note', id: 'a-note', attributes: { text: 'Dates after 2026\nare projections.', at: '2030-01', row: 3n, width: 220, height: 60.5 } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, CREATE]);
    expect(made.written(before)).toEqual({ 'a-note': ['created'] });
    expect(['Kind', 'Order', 'text', 'at', 'row', 'width', 'height'].map((name) => plain(rowOf(made, 'a-note'), name))).toEqual(['note', 1, 'Dates after 2026\nare projections.', '2030-01', 3, 220, 60.5]);
    expect(made.document.model.elements.find((element) => element.id === 'a-note')?.attributes.text).toBe('Dates after 2026\nare projections.');
    expect(made.document.findings.filter((found) => found.severity === 'error')).toEqual([]);
    await expectStored(made);
  });

  it('a removal is one row in the trash, and the rows its cascade takes, in the order of the splices', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    const taken = made.document.model.relations.filter((relation) => relation.source === 'lead-acid-battery' || relation.target === 'lead-acid-battery').map((relation) => relation.id);
    expect(taken.length).toBeGreaterThan(1);

    expect(await made.apply({ kind: 'remove', id: 'lead-acid-battery' })).toEqual({ done: true });
    // The trend stands before its influences in the document, so its splice and its write come first.
    expect(made.sent()).toEqual([QUERY, update('lead-acid-battery'), ...taken.map(update)]);
    expect(made.written(before)).toEqual(Object.fromEntries(['lead-acid-battery', ...taken].map((title) => [title, ['in_trash']])));
    expect(rowOf(made, 'lead-acid-battery').in_trash).toBe(true);
    expect(made.rows()).toHaveLength(before.length);
    expect(made.document.model.elements.some((element) => element.id === 'lead-acid-battery')).toBe(false);
    expect(made.document.model.relations.some((relation) => taken.includes(relation.id))).toBe(false);
    await expectStored(made);
  });

  it('a changed value is one property, and the values of one gesture are one call to their row', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    let before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { name: 'Hybrids' } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['name'] });
    expect(plain(rowOf(made, 'hybrid-cars'), 'name')).toBe('Hybrids');

    // A drag: three attributes, one edit.
    before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { start: '1998-03', stop: '2031-03', row: 14n } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['start', 'stop', 'row'] });

    // A key that leaves the document empties its property; a key that enters it sets one.
    before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { description: null, peakEnd: '2004-01' } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['peak-end', 'description'] });
    expect([plain(rowOf(made, 'hybrid-cars'), 'description'), plain(rowOf(made, 'hybrid-cars'), 'peak-end')]).toEqual(['', '2004-01']);
    expect(made.document.model.elements.find((element) => element.id === 'hybrid-cars')?.attributes).not.toHaveProperty('description');

    before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { tags: ['vehicles', 'engines'] } })).toEqual({ done: true });
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['tags'] });
    await expectStored(made);
    expect(made.document.canUndo).toBe(true);
  });

  it('a value set to what it is writes nothing and is no step', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { name: 'Hybrid cars', row: 12n } })).toEqual({ done: true });
    expect(await made.apply({ kind: 'save' })).toEqual({ done: true });
    expect(made.sent()).toEqual([]);
    expect(made.document.canUndo).toBe(false);
  });

  it('a changed reference is one relation', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    expect(await made.apply({ kind: 'set', id: 'prius-unveiled--hybrid-cars', attributes: { to: 'fuel-cell-cars' } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('prius-unveiled--hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'prius-unveiled--hybrid-cars': ['to'] });
    expect(plain(rowOf(made, 'prius-unveiled--hybrid-cars'), 'to')).toEqual([rowOf(made, 'fuel-cell-cars').id]);
    expect(made.document.model.relations.find((relation) => relation.id === 'prius-unveiled--hybrid-cars')?.target).toBe('fuel-cell-cars');
    await expectStored(made);
  });
});

describe('an edit that is refused', () => {
  it('by the specification writes nothing and answers its sentence', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    const model = made.document.model;
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { name: '  ' } })).toEqual({ done: false, sentence: 'A trend needs a name.' });
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { phases: 9n } })).toEqual({ done: false, sentence: 'A trend shows 1 to 4 phases.' });
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { row: 13n, stop: '1990-01' } })).toEqual({ done: false, sentence: 'A trend must stop after it starts, at least one month later.' });
    // A relation the specification does not allow between the two.
    expect(await made.apply({ kind: 'add', type: 'Influence', id: 'back', attributes: { from: 'hybrid-cars', to: 'prius-unveiled', toPhase: 'peak', toEdge: 'top', toAt: 0.5 } })).toEqual({ done: false, sentence: 'An influence cannot end at a trigger.' });
    expect(await made.apply({ kind: 'set', id: 'prius-unveiled--hybrid-cars', attributes: { to: 'tesla-roadster-unveiled' } })).toEqual({ done: false, sentence: 'An influence cannot end at a trigger.' });
    expect(made.sent()).toEqual([]);
    expect(made.written(before)).toEqual({});
    expect(made.document.model).toBe(model);
    expect(made.document.canUndo).toBe(false);
  });

  it('by the binding writes nothing and answers its sentence', async () => {
    const made = await openExample('electric-vehicles', { constraints: false });
    made.sent();
    const before = made.rows();
    const model = made.document.model;
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { name: '' } })).toEqual({ done: false, sentence: 'The name of a Trend cannot be empty.' });
    expect(await made.apply({ kind: 'add', type: 'Trend', id: 'hybrid-cars', attributes: { name: 'Again', start: '2000-01', stop: '2001-01' } })).toEqual({ done: false, sentence: 'Another element already has the id \'hybrid-cars\'.' });
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { storedId: 'other' } })).toEqual({ done: false, sentence: 'The storedId of a Trend cannot be changed in this file.' });
    expect(await made.apply({ kind: 'add', type: 'Unit', attributes: { value: 'year' } })).toEqual({ done: false, sentence: 'The graph\'s unit is changed in the file itself.' });
    // What the library cannot do at all is a refusal too, never an exception.
    expect(await made.apply({ kind: 'remove', id: 'nothing-of-that-name' })).toMatchObject({ done: false });
    expect(await made.apply({ kind: 'place', id: 'hybrid-cars', x: 1, y: 2 })).toMatchObject({ done: false });
    expect(made.sent()).toEqual([]);
    expect(made.written(before)).toEqual({});
    expect(made.document.model).toBe(model);
  });

  it('because a splice cannot be resolved is not written in part', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    const model = made.document.model;
    // The name could be stored; the tag is longer than the name of an option may be.
    const result = await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { name: 'Hybrids', tags: ['vehicles', 'x'.repeat(101)] } });
    expect(result).toEqual({ done: false, sentence: 'The change cannot be stored: the `tags` of `hybrid-cars` is not a value its property holds (multi select).' });
    expect(made.sent()).toEqual([]);
    expect(made.written(before)).toEqual({});
    expect(made.document.model).toBe(model);
    expect(made.document.canUndo).toBe(false);
  });
});

describe('the library\'s plans that the store works around', () => {
  it('a set that empties the last key of an entry and adds another is one edit and one step', async () => {
    const made = await openExample('electric-vehicles');
    made.sent();
    const before = made.rows();
    // Planned as one edit the library answers that two splices overlap; one attribute at a time it plans both.
    expect(await made.apply({ kind: 'set', id: 'hybrid-cars', attributes: { description: null, slopeEnd: '2020-01' } })).toEqual({ done: true });
    expect(made.sent()).toEqual([QUERY, update('hybrid-cars')]);
    expect(made.written(before)).toEqual({ 'hybrid-cars': ['slope-end', 'description'] });
    expect(made.document.undo()).toEqual({ done: true });
    await made.settled();
    expect(made.written(before)).toEqual({});
    expect(made.document.canUndo).toBe(false);
  });
});

describe('splices resolved to row writes, from the binding alone', () => {
  const decoder = new TextDecoder();

  async function opened(example: string) {
    const made = await openExample(example);
    const store = storeOf(made.document);
    const record = recordOf(store.rows, store.held);
    const run = (splices: readonly FblSplice[], from: StoreRecord = record): Resolved => resolve(from, splices, store.schema, store.binding);
    const text = (start: number, end: number): string => decoder.decode(store.rows.body.subarray(start, end));
    const entriesOf = (kind: string) => store.rows.reading.elements.filter((element) => element.rule.name === kind).map((element) => element.entry);
    const rowsOf = (kind: string): string[] => store.rows.entries.filter((entry) => entry.kind === kind).map((entry) => entry.rowId);
    return { made, store, record, run, text, entriesOf, rowsOf };
  }

  it('a changed place is the Order of the rows that moved', async () => {
    const { run, text, entriesOf, rowsOf } = await opened('electric-vehicles');
    const [first, second, third] = entriesOf('trend').map((entry) => entry.removalSpan);
    const [one, two, three] = rowsOf('trend');
    // The first two change places.
    const swapped = run([{ operation: 'insert-entry', start: first.start, end: second.end, text: text(second.start, second.end) + text(first.start, first.end) }]);
    expect(swapped).toMatchObject({ writes: [{ write: 'reorder', row: two, order: 1 }, { write: 'reorder', row: one, order: 2 }] });
    expect('record' in swapped && swapped.record.rows.entries.filter((entry) => entry.kind === 'trend').slice(0, 3).map((entry) => entry.rowId)).toEqual([two, one, three]);

    // The first goes behind the third: the three rows that no longer stand where they did.
    const moved = run([
      { operation: 'remove-entry', start: first.start, end: first.end, text: '' },
      { operation: 'insert-entry', start: third.end, end: third.end, text: text(first.start, first.end) },
    ]);
    expect(moved).toMatchObject({ writes: [{ write: 'reorder', row: two, order: 1 }, { write: 'reorder', row: three, order: 2 }, { write: 'reorder', row: one, order: 3 }] });
  });

  it('a splice that lands on nothing writes nothing', async () => {
    const { run, record, text, entriesOf, store } = await opened('electric-vehicles');
    const [first] = entriesOf('trend');
    // A comment, which no rule reads.
    const comment = run([{ operation: 'insert-entry', start: first.removalSpan.start, end: first.removalSpan.start, text: '  # the first of them\r\n' }]);
    expect(comment).toMatchObject({ writes: [] });
    expect('record' in comment && comment.record.rows.body.length).toBe(record.rows.body.length + 23);
    // Only how a value is written.
    const name = store.rows.reading.elements.find((element) => element.entry === first)!.slots.get('name')!.span!;
    expect(run([{ operation: 'replace-value', start: name.start, end: name.end, text: `"${text(name.start, name.end)}"` }])).toMatchObject({ writes: [] });
    expect(run([])).toEqual({ writes: [], record });
  });

  it('a splice that cannot be resolved refuses the whole change', async () => {
    const { run, entriesOf, store } = await opened('electric-vehicles');
    const [first] = entriesOf('trend');
    const name = store.rows.reading.elements.find((element) => element.entry === first)!.slots.get('name')!.span!;
    const rename: FblSplice = { operation: 'replace-value', start: name.start, end: name.end, text: 'Renamed' };
    expect(run([rename])).toMatchObject({ writes: [{ write: 'update', property: 'name' }] });
    // An entry that is no mapping is read by a rule that is no kind: no row can hold it.
    const refused = run([rename, { operation: 'insert-entry', start: first.removalSpan.end, end: first.removalSpan.end, text: '  - just some words\r\n' }]);
    expect(refused).toEqual({ refused: expect.stringMatching(/^The change cannot be stored: /) });
    // The header, which a rule reads and no row holds.
    expect(run([{ operation: 'replace-value', start: 25, end: 26, text: '2' }])).toEqual({ refused: 'The change cannot be stored: it changes a part of the document that no row holds.' });
    // A document that can no longer be read.
    expect(run([{ operation: 'replace-value', start: name.start, end: name.end, text: '[' }])).toEqual({ refused: expect.stringMatching(/^The change cannot be stored: it would leave a document that cannot be read/) });
    // Splices that overlap.
    expect(run([rename, rename])).toEqual({ refused: expect.stringMatching(/^The change cannot be stored: /) });
  });

  it('the value of a one-place kind is the property of its one row, created when there is none and trashed when it leaves', async () => {
    const { run, text } = await opened('electric-vehicles');
    const below = text(0, 200).indexOf('\r\n') + 2;
    const created = run([{ operation: 'insert-key', start: below, end: below, text: 'unit: year\r\n' }]);
    expect(created).toMatchObject({ writes: [{ write: 'create', row: 'new:1', kind: 'unit', values: { id: { title: [{ text: { content: 'unit' } }] }, unit: { select: { name: 'year' } } }, relations: {} }] });
    if (!('record' in created)) throw new Error('not resolved');
    expect(created.writes[0]).not.toHaveProperty('order');
    expect(created.record.rows.entries[0]).toEqual({ kind: 'unit', position: 0, rowId: 'new:1' });

    const changed = run([{ operation: 'replace-value', start: below + 6, end: below + 10, text: 'decade' }], created.record);
    expect(changed).toMatchObject({ writes: [{ write: 'update', row: 'new:1', property: 'unit', value: { select: { name: 'decade' } } }] });
    if (!('record' in changed)) throw new Error('not resolved');
    const removed = run([{ operation: 'remove-key', start: below, end: below + 14, text: '' }], changed.record);
    expect(removed).toMatchObject({ writes: [{ write: 'trash', row: 'new:1' }] });
    // The same line again takes the same row out of the trash, and sets what differs from what it held.
    if (!('record' in removed)) throw new Error('not resolved');
    expect(run([{ operation: 'insert-key', start: below, end: below, text: 'unit: century\r\n' }], removed.record)).toMatchObject({
      writes: [{ write: 'restore', row: 'new:1' }, { write: 'update', row: 'new:1', property: 'unit', value: { select: { name: 'century' } } }],
    });
  });

  it('an inserted entry is one row created with its place, and a removed one comes back as the same row', async () => {
    const { run, text, entriesOf, rowsOf } = await opened('electric-vehicles');
    const spans = entriesOf('trigger').map((entry) => entry.removalSpan);
    const [one, two] = rowsOf('trigger');
    const entry = '  - id: new-one\r\n    name: New\r\n    date: 2001-01\r\n    row: 4\r\n';
    // Behind the last: the highest Order and one.
    expect(run([{ operation: 'insert-entry', start: spans.at(-1)!.end, end: spans.at(-1)!.end, text: entry }])).toMatchObject({
      writes: [{ write: 'create', row: 'new:1', kind: 'trigger', order: spans.length + 1, values: { name: { rich_text: [{ text: { content: 'New' } }] }, row: { number: 4 } } }],
    });
    // Between two rows there is no number for it, so the rows behind it are numbered again.
    const between = run([{ operation: 'insert-entry', start: spans[0].end, end: spans[0].end, text: entry }]);
    if (!('writes' in between)) throw new Error('not resolved');
    expect(between.writes.slice(0, 2)).toMatchObject([{ write: 'create', row: 'new:1', order: 2 }, { write: 'reorder', row: two, order: 3 }]);
    expect(between.writes).toHaveLength(spans.length);

    const removed = run([{ operation: 'remove-entry', start: spans[0].start, end: spans[0].end, text: '' }]);
    expect(removed).toMatchObject({ writes: [{ write: 'trash', row: one }] });
    if (!('record' in removed)) throw new Error('not resolved');
    expect(run([{ operation: 'insert-entry', start: spans[0].start, end: spans[0].start, text: text(spans[0].start, spans[0].end) }], removed.record)).toEqual({
      writes: [{ write: 'restore', row: one }], record: expect.anything(),
    });
  });
});
