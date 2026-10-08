import { describe, expect, it } from 'vitest';
import type { ModelChange } from '../../src/fbl/planning/modelChange';
import { openExample, unlined, type OpenExample } from '../support/openExample';

const QUERY = 'POST /v1/data_sources/store/query';
const CREATE = 'POST /v1/pages';
const update = (title: string): string => `PATCH /v1/pages/${title}`;

// Twenty edits of every kind: entries inserted into a list that exists and into one that does not,
// with and without references and a text of several lines; values set, emptied and added, one and
// several at a time; a reference changed; entries removed, with and without what the cascade takes.
const edits: ModelChange[] = [
  { kind: 'add', type: 'Trend', id: 'fusion', attributes: { name: 'Fusion', start: '2035-01', stop: '2060-01', row: 42n, phases: 2n, tags: ['ideas'] } },
  { kind: 'add', type: 'Trigger', id: 'first-plasma', attributes: { name: 'First plasma', date: '2034-06', row: 44n } },
  { kind: 'add', type: 'Note', id: 'a-note', attributes: { text: 'Fusion is drawn\nas an idea.', at: '2036-01', row: 46n, width: 180, height: 48.5 } },
  { kind: 'add', type: 'Influence', id: 'fusion--surface-mining', attributes: { from: 'fusion', fromPhase: 'peak', fromEdge: 'top', fromAt: 0.5, to: 'surface-mining', toPhase: 'plateau', toEdge: 'bottom', toAt: 0.9 } },
  { kind: 'add', type: 'Influence', id: 'first-plasma--fusion', attributes: { from: 'first-plasma', to: 'fusion', toPhase: 'peak', toEdge: 'top', toAt: 0.1 } },
  { kind: 'set', id: 'fusion', attributes: { name: 'Fusion power' } },
  { kind: 'set', id: 'safety-lamp', attributes: { start: '1816-02', stop: '1901-02', row: 3n } },
  { kind: 'set', id: 'safety-lamp', attributes: { tags: ['mining', 'safety', 'lamps'] } },
  { kind: 'set', id: 'safety-lamp', attributes: { description: null } },
  { kind: 'set', id: 'mechanised-coal-cutting', attributes: { description: 'Cutters and conveyors.' } },
  { kind: 'set', id: 'note-projections', attributes: { text: 'After 2026: projections.' } },
  { kind: 'set', id: 'note-projections', attributes: { width: 199.5, height: 40 } },
  { kind: 'set', id: 'coke-smelting--newcomen-engine', attributes: { to: 'safety-lamp' } },
  { kind: 'set', id: 'coke-smelting--newcomen-engine', attributes: { fromPhase: 'trough', fromAt: 0.25, description: null } },
  { kind: 'set', id: 'mechanised-coal-cutting', attributes: { peakEnd: '1900-01', troughEnd: '1920-01', slopeEnd: '1940-01' } },
  { kind: 'remove', id: 'newcomen-engine--watt-steam-engine' },
  { kind: 'remove', id: 'note-projections' },
  { kind: 'remove', id: 'newcomen-engine' },
  { kind: 'remove', id: 'rainhill-trials' },
  { kind: 'remove', id: 'fusion' },
];

const creates = (calls: readonly string[]): number => calls.filter((call) => call === CREATE).length;

describe('undo and redo', () => {
  it('twenty undos leave the store as before twenty edits, and twenty redos as after them', async () => {
    const made = await openExample('coal-technologies');
    const first = { contents: made.contents(), model: made.document.model, rows: made.rows().length };
    made.sent();

    for (const edit of edits) {
      expect([edit, await made.apply(edit)]).toEqual([edit, { done: true }]);
      expect(made.document.canRedo).toBe(false);
    }
    const last = { contents: made.contents(), model: made.document.model, rows: made.rows().length };
    expect(last.contents).not.toEqual(first.contents);
    expect(unlined((await made.reopen()).model)).toEqual(unlined(last.model));
    // Five entries were inserted: five rows more, the removed ones in the trash.
    expect(creates(made.sent())).toBe(5);
    expect(last.rows).toBe(first.rows + 5);
    expect(made.events.some((event) => event.kind === 'reloaded')).toBe(false);

    for (let step = 0; step < edits.length; step++) {
      expect(made.document.canUndo).toBe(true);
      expect(made.document.undo()).toEqual({ done: true });
      await made.settled();
    }
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, true]);
    expect(made.contents()).toEqual(first.contents);
    expect(made.document.model).toEqual(first.model);
    expect(unlined((await made.reopen()).model)).toEqual(unlined(first.model));
    // A removed element comes back as its own row: no row is created by an undo.
    expect(creates(made.sent())).toBe(0);
    expect(made.rows()).toHaveLength(last.rows);
    // With nothing to undo the step changes nothing.
    expect(made.document.undo()).toEqual({ done: true });
    await made.settled();
    expect(made.sent()).toEqual([]);

    for (let step = 0; step < edits.length; step++) {
      expect(made.document.canRedo).toBe(true);
      expect(made.document.redo()).toEqual({ done: true });
      await made.settled();
    }
    expect([made.document.canUndo, made.document.canRedo]).toEqual([true, false]);
    expect(made.contents()).toEqual(last.contents);
    expect(made.document.model).toEqual(last.model);
    expect(unlined((await made.reopen()).model)).toEqual(unlined(last.model));
    // An inserted element that was undone comes back as its own row too.
    expect(creates(made.sent())).toBe(0);
    expect(made.rows()).toHaveLength(last.rows);
    expect(made.events.some((event) => event.kind === 'reloaded')).toBe(false);
    expect(made.events.at(-1)).toEqual({ kind: 'status', status: 'idle' });
  }, 30_000);

  it('a drag that changed several attributes is one step', async () => {
    const made = await openExample('coal-technologies');
    const first = made.contents();
    const before = made.rows();
    made.sent();
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { start: '1816-02', stop: '1901-02', row: 3n } })).toEqual({ done: true });
    expect(made.written(before)).toEqual({ 'safety-lamp': ['start', 'stop', 'row'] });
    made.sent();
    expect(made.document.undo()).toEqual({ done: true });
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, true]);
    await made.settled();
    expect(made.sent()).toEqual([QUERY, update('safety-lamp')]);
    expect(made.written(before)).toEqual({});
    expect(made.contents()).toEqual(first);
    expect(made.document.redo()).toEqual({ done: true });
    await made.settled();
    expect(made.sent()).toEqual([QUERY, update('safety-lamp')]);
    expect(made.written(before)).toEqual({ 'safety-lamp': ['start', 'stop', 'row'] });
  });

  it('an edit of several entries is one step: one undo puts every row back, and a refused change leaves all of them', async () => {
    const made = await openExample('coal-technologies');
    const first = made.contents();
    const before = made.rows();
    made.sent();
    expect(await made.apply([{ kind: 'set', id: 'safety-lamp', attributes: { row: 3n } }, { kind: 'set', id: 'note-projections', attributes: { row: 4n, width: 120 } }])).toEqual({ done: true });
    // One check for somebody else's change, then the rows in the order of the changes.
    expect(made.sent()).toEqual([QUERY, update('safety-lamp'), update('note-projections')]);
    expect(made.written(before)).toEqual({ 'safety-lamp': ['row'], 'note-projections': ['row', 'width'] });
    expect(made.document.undo()).toEqual({ done: true });
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, true]);
    await made.settled();
    expect(made.written(before)).toEqual({});
    expect(made.contents()).toEqual(first);
    expect(made.document.redo()).toEqual({ done: true });
    await made.settled();
    expect(made.written(before)).toEqual({ 'safety-lamp': ['row'], 'note-projections': ['row', 'width'] });
    expect(made.document.undo()).toEqual({ done: true });
    await made.settled();

    // The second change names nothing, so the first is not made either.
    made.sent();
    expect((await made.apply([{ kind: 'set', id: 'safety-lamp', attributes: { row: 9n } }, { kind: 'set', id: 'nobody', attributes: { row: 1n } }])).done).toBe(false);
    expect(made.sent()).toEqual([]);
    expect(made.document.canUndo).toBe(false);
    expect(made.contents()).toEqual(first);
  });

  it('a removal with its cascade is one step, and its undo takes the same rows out of the trash', async () => {
    const made = await openExample('coal-technologies');
    const first = made.contents();
    const before = made.rows();
    const taken = made.document.model.relations.filter((relation) => relation.source === 'newcomen-engine' || relation.target === 'newcomen-engine').map((relation) => relation.id);
    expect(taken.length).toBeGreaterThan(2);
    expect(await made.apply({ kind: 'remove', id: 'newcomen-engine' })).toEqual({ done: true });
    expect(Object.keys(made.written(before))).toHaveLength(taken.length + 1);
    made.sent();

    expect(made.document.undo()).toEqual({ done: true });
    expect(made.document.canUndo).toBe(false);
    expect(made.document.model.relations.filter((relation) => taken.includes(relation.id))).toHaveLength(taken.length);
    await made.settled();
    // One call a row, each taking it out of the trash, and nothing else: its values and the relations to it are as before.
    expect(made.sent()).toEqual([QUERY, update('newcomen-engine'), ...taken.map(update)]);
    expect(made.written(before)).toEqual({});
    expect(made.rows().map((page) => [page.id, page.in_trash])).toEqual(before.map((page) => [page.id, false]));
    expect(made.contents()).toEqual(first);
  });

  it('an insertion the store plans in two steps is one step, one row in the trash and the same row again', async () => {
    const made = await openExample('coal-technologies');
    const first = made.contents();
    expect(await made.apply({ kind: 'add', type: 'Note', id: 'a-note', attributes: { text: 'Two\nlines.', at: '2036-01', row: 46n, width: 180, height: 48 } })).toEqual({ done: true });
    const added = made.contents();
    const before = made.rows();
    made.sent();
    expect(made.document.undo()).toEqual({ done: true });
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, true]);
    await made.settled();
    expect(made.sent()).toEqual([QUERY, update('a-note')]);
    expect(made.written(before)).toEqual({ 'a-note': ['in_trash'] });
    expect(made.contents()).toEqual(first);

    expect(made.document.redo()).toEqual({ done: true });
    await made.settled();
    // Out of the trash, and its values in one call.
    expect(made.sent()).toEqual([QUERY, update('a-note'), update('a-note')]);
    expect(made.written(before)).toEqual({});
    expect(made.contents()).toEqual(added);
  });

  it('a new edit after an undo leaves nothing to redo', async () => {
    const made = await openExample('coal-technologies');
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { name: 'One' } })).toEqual({ done: true });
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { name: 'Two' } })).toEqual({ done: true });
    expect(made.document.undo()).toEqual({ done: true });
    expect([made.document.canUndo, made.document.canRedo]).toEqual([true, true]);
    // A refused edit does not cost what was undone.
    expect(made.document.edit({ kind: 'set', id: 'safety-lamp', attributes: { name: '' } })).toMatchObject({ done: false });
    expect(made.document.canRedo).toBe(true);
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { name: 'Three' } })).toEqual({ done: true });
    expect([made.document.canUndo, made.document.canRedo]).toEqual([true, false]);
    made.sent();
    expect(made.document.redo()).toEqual({ done: true });
    await made.settled();
    expect(made.sent()).toEqual([]);
    expect(made.contents().trend.find((row) => row.id === 'safety-lamp')?.name).toBe('Three');
  });

  it('an undo made while the writes of its edit are still queued is stored behind them and leaves the store the same', async () => {
    const made = await openExample('coal-technologies');
    const first = made.contents();
    const before = made.rows();
    made.sent();
    made.events.length = 0;
    expect(made.document.edit({ kind: 'add', type: 'Trend', id: 'fusion', attributes: { name: 'Fusion', start: '2035-01', stop: '2060-01' } })).toEqual({ done: true });
    expect(made.document.edit({ kind: 'remove', id: 'rainhill-trials' })).toEqual({ done: true });
    // Answered at once, before a write of either edit was sent.
    expect(made.sent()).toEqual([]);
    expect(made.document.undo()).toEqual({ done: true });
    expect(made.document.undo()).toEqual({ done: true });
    expect(made.document.model.elements.some((element) => element.id === 'fusion')).toBe(false);
    expect(made.calls.status()).toBe('storing');
    await made.settled();

    const sent = made.sent();
    // The row that is not created yet when its removal is planned is written to once it is.
    expect(sent.slice(0, 2)).toEqual([QUERY, CREATE]);
    expect(sent.at(-1)).toBe(update('fusion'));
    expect(sent.filter((call) => call === QUERY)).toHaveLength(4);
    expect(made.written(before)).toEqual({ fusion: ['created'] });
    expect(made.rows().at(-1)?.in_trash).toBe(true);
    expect(made.contents()).toEqual(first);
    expect(made.events.filter((event) => event.kind === 'status')).toEqual([{ kind: 'status', status: 'storing' }, { kind: 'status', status: 'idle' }]);
  });

  it('the history is empty after a reload', async () => {
    const made = await openExample('coal-technologies');
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { name: 'One' } })).toEqual({ done: true });
    expect(await made.apply({ kind: 'set', id: 'safety-lamp', attributes: { name: 'Two' } })).toEqual({ done: true });
    expect(made.document.undo()).toEqual({ done: true });
    await made.settled();
    expect([made.document.canUndo, made.document.canRedo]).toEqual([true, true]);
    await made.document.reload();
    expect([made.document.canUndo, made.document.canRedo]).toEqual([false, false]);
    made.sent();
    expect(made.document.undo()).toEqual({ done: true });
    expect(made.document.redo()).toEqual({ done: true });
    await made.settled();
    expect(made.sent()).toEqual([]);
    // The handlers start again from what was read: the next edit and its undo are stored.
    await roundTrip(made);
  });
});

async function roundTrip(made: OpenExample): Promise<void> {
  const first = made.contents();
  expect(await made.apply({ kind: 'remove', id: 'safety-lamp' })).toEqual({ done: true });
  expect(made.contents()).not.toEqual(first);
  expect(made.document.undo()).toEqual({ done: true });
  await made.settled();
  expect(made.contents()).toEqual(first);
}
