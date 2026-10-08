import { describe, expect, it } from 'vitest';
import { assignRows, interpretLayout, packAlongRows, readLayoutConfig } from '../../src/disl/layout';
import { loadSpecification } from '../../src/disl/specification';
import { hypeCycleJson, mindmapJson } from './tool';

const interpret = (source: unknown) => interpretLayout(loadSpecification(source).value);

describe('the layout of the hype cycle graph', () => {
  const { value: layout, findings } = interpret(hypeCycleJson());

  it('is read without a finding', () => expect(findings).toEqual([]));

  it('never runs by itself, and keeps every place a user gave', () => {
    expect(layout).toMatchObject({ trigger: 'manual', respect: 'all', default: undefined });
  });

  it('names the two standard algorithms with their options', () => {
    expect(Object.keys(layout.algorithms)).toEqual(['rowPacked', 'rowArrange']);
    expect(layout.algorithms.rowPacked).toMatchObject({
      algorithm: 'rowPacked', scope: 'all', direction: 'right',
      rowPacked: { order: 'start', gap: 4, followConnections: 'Influence', targetAfter: 'sourceMiddle', rowsCovered: 'int(math.ceil(self.height / 56.0))' },
    });
    expect(layout.algorithms.rowPacked.rows).toBeUndefined();
    expect(layout.algorithms.rowArrange).toMatchObject({ algorithm: 'rows', rows: { writes: ['row'], clearance: 16, affinity: 'Influence', ties: 'lower', swapPasses: 64 } });
    expect(Object.keys(layout.algorithms.rowArrange.rows!.extent)).toEqual(['Trend', 'Trigger', 'Note']);
  });
});

describe('a layout in general', () => {
  it('is nothing, run by hand, when a specification declares none', () => {
    expect(interpret({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: {} })).toEqual({ value: { algorithms: {}, default: undefined, trigger: 'manual', respect: 'pinned' }, findings: [] });
  });

  it('reports an algorithm this add-on does not run, and keeps its configuration', () => {
    const { value, findings } = interpret(mindmapJson());
    const mindmap = Object.values(value.algorithms)[0];
    expect(findings.map((finding) => finding.message)).toEqual([`The layout \`${mindmap.name}\` uses the algorithm \`${mindmap.algorithm}\`, which this add-on does not run.`]);
    expect(findings[0]).toMatchObject({ code: 'disl.layout', severity: 'warning' });
  });

  it('fills in the defaults DISL gives the options', () => {
    const said: string[] = [];
    expect(readLayoutConfig('one', { algorithm: 'rowPacked' }, (message) => said.push(message)).rowPacked).toEqual({ order: 'document', gap: 0, followConnections: undefined, targetAfter: 'sourceEnd', rowsCovered: undefined });
    expect(readLayoutConfig('two', { algorithm: 'rows', rows: { writes: ['lane'], extent: {} } }).rows).toEqual({ writes: ['lane'], extent: {}, clearance: 0, affinity: undefined, ties: 'lower', swapPasses: 0 });
    expect(said).toEqual(['The layout `one` gives the algorithm `rowPacked` no options, so its defaults are used.']);
  });
});

describe('the row-packed layout (DISL 10.1)', () => {
  const options = { order: 'start', gap: 4, targetAfter: 'sourceMiddle' } as const;
  const places = (map: Map<string, number>) => Object.fromEntries(map);

  it('packs each row from 0, in the order of the starts, a gap apart', () => {
    const items = [
      { id: 'late', row: 0, size: 96, start: 500 },
      { id: 'early', row: 0, size: 48, start: 100 },
      { id: 'other', row: 1, size: 16, start: 900 },
    ];
    expect(places(packAlongRows(items, [], options))).toEqual({ early: 0, late: 52, other: 0 });
  });

  it('keeps the order of the model for equal starts, and for the order `document`', () => {
    const items = [{ id: 'b', row: 0, size: 10, start: 5 }, { id: 'a', row: 0, size: 10, start: 5 }, { id: 'c', row: 0, size: 10, start: 1 }];
    expect(places(packAlongRows(items, [], options))).toEqual({ c: 0, b: 14, a: 28 });
    expect(places(packAlongRows(items, [], { ...options, order: 'document' }))).toEqual({ b: 0, a: 14, c: 28 });
  });

  it('starts a target no earlier than the middle, the start or the end of its source', () => {
    // The example of DISL 10.1: the target on row 1 starts after the middle of the 96-unit source on row 0.
    const items = [{ id: 'source', row: 0, size: 96, start: 0 }, { id: 'target', row: 1, size: 96, start: 50 }];
    const connections = [['source', 'target']] as const;
    expect(places(packAlongRows(items, connections, options))).toEqual({ source: 0, target: 48 });
    expect(places(packAlongRows(items, connections, { ...options, targetAfter: 'sourceStart' }))).toEqual({ source: 0, target: 0 });
    expect(places(packAlongRows(items, connections, { ...options, targetAfter: 'sourceEnd' }))).toEqual({ source: 0, target: 96 });
  });

  it('holds a target back for a source that starts later, and what follows the target with it', () => {
    const items = [
      { id: 'target', row: 0, size: 10, start: 0 }, { id: 'next', row: 0, size: 10, start: 1 },
      { id: 'first', row: 1, size: 40, start: 2 }, { id: 'source', row: 1, size: 20, start: 3 },
    ];
    expect(places(packAlongRows(items, [['source', 'target']], options))).toEqual({ first: 0, source: 44, target: 54, next: 68 });
  });

  it('keeps every row an item covers clear', () => {
    const items = [{ id: 'tall', row: 0, rows: 2, size: 100, start: 0 }, { id: 'under', row: 1, size: 10, start: 1 }, { id: 'below', row: 2, size: 10, start: 2 }];
    expect(places(packAlongRows(items, [], options))).toEqual({ tall: 0, under: 104, below: 0 });
  });

  it('breaks a cycle at its earliest item', () => {
    const items = [{ id: 'a', row: 0, size: 20, start: 0 }, { id: 'b', row: 1, size: 20, start: 1 }, { id: 'c', row: 2, size: 20, start: 2 }];
    // a follows c, b follows a, c follows b: a, the earliest, follows nothing.
    expect(places(packAlongRows(items, [['c', 'a'], ['a', 'b'], ['b', 'c']], options))).toEqual({ a: 0, b: 10, c: 20 });
    // On one row the later item waits for the earlier, so a demand the other way round is dropped.
    const row = [{ id: 'a', row: 0, size: 20, start: 0 }, { id: 'b', row: 0, size: 20, start: 1 }];
    expect(places(packAlongRows(row, [['b', 'a'], ['a', 'a'], ['gone', 'a']], options))).toEqual({ a: 0, b: 24 });
  });
});

describe('the rows-only arrangement (DISL 10.2)', () => {
  const options = { clearance: 16, ties: 'lower', swapPasses: 64 } as const;
  const rows = (map: Map<string, number>) => Object.fromEntries(map);

  it('uses the fewest rows: the example of DISL 10.2', () => {
    // Three spans from 1800 to 1850, 1840 to 1900 and 1860 to 1900, at 4 units a year.
    const items = [{ id: 'a', from: -400, to: -200 }, { id: 'b', from: -240, to: 0 }, { id: 'c', from: -160, to: 0 }];
    expect(rows(assignRows(items, [], options))).toEqual({ a: 0, b: 1, c: 0 });
    // 16 clear is kept: an extent that starts 15 after another ends does not share its row.
    expect(rows(assignRows([{ id: 'a', from: 0, to: 100 }, { id: 'b', from: 115, to: 200 }, { id: 'c', from: 116, to: 200 }], [], options))).toEqual({ a: 0, b: 1, c: 0 });
  });

  it('puts an item on the free row nearest its placed linked items, the lower or the upper on a tie', () => {
    const items = [
      { id: 'top', from: 0, to: 10 }, { id: 'mid', from: 1, to: 11 }, { id: 'low', from: 2, to: 300 },
      { id: 'linked', from: 100, to: 110 }, { id: 'tied', from: 200, to: 210 },
    ];
    const links = [['mid', 'linked']] as const;
    expect(rows(assignRows(items, links, { ...options, swapPasses: 0 }))).toEqual({ top: 0, mid: 1, low: 2, linked: 1, tied: 0 });
    const three = [{ id: 'a', from: 0, to: 10 }, { id: 'b', from: 1, to: 11 }, { id: 'c', from: 2, to: 12 }, { id: 'tied', from: 100, to: 110 }];
    expect(rows(assignRows(three, [['b', 'tied']], { ...options, swapPasses: 0 })).tied).toBe(1);
    expect(rows(assignRows(three, [['a', 'tied'], ['c', 'tied']], { ...options, swapPasses: 0 })).tied).toBe(1);
    const two = [{ id: 'a', from: 0, to: 10 }, { id: 'gap', from: 1, to: 500 }, { id: 'c', from: 2, to: 12 }, { id: 'tied', from: 100, to: 110 }];
    expect(rows(assignRows(two, [['a', 'tied'], ['c', 'tied']], { ...options, swapPasses: 0, ties: 'lower' })).tied).toBe(0);
    expect(rows(assignRows(two, [['a', 'tied'], ['c', 'tied']], { ...options, swapPasses: 0, ties: 'upper' })).tied).toBe(2);
  });

  it('swaps whole neighbouring rows while that shortens the links, and not without passes', () => {
    const items = [{ id: 'a', from: 0, to: 100 }, { id: 'b', from: 1, to: 100 }, { id: 'c', from: 2, to: 100 }, { id: 'd', from: 3, to: 100 }];
    const links = [['a', 'd']] as const;
    expect(rows(assignRows(items, links, { ...options, swapPasses: 0 }))).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    const swapped = rows(assignRows(items, links, options));
    expect(Math.abs(swapped.a - swapped.d)).toBe(1);
    expect(Object.values(swapped).sort()).toEqual([0, 1, 2, 3]);
  });

  it('opens rows below for an item of several rows, and never swaps a row it covers', () => {
    const items = [{ id: 'a', from: 0, to: 100 }, { id: 'tall', from: 1, to: 100, rows: 2 }, { id: 'b', from: 2, to: 100 }, { id: 'c', from: 3, to: 100 }];
    const arranged = rows(assignRows(items, [['a', 'c']], options));
    // The rows under the tall item swap, so that c is nearer a; the rows it covers, and a above them, stay.
    expect(arranged).toEqual({ a: 0, tall: 1, b: 4, c: 3 });
    expect(rows(assignRows(items, [['a', 'c']], { ...options, swapPasses: 0 }))).toEqual({ a: 0, tall: 1, b: 3, c: 4 });
  });

  it('changes nothing when it is run again', () => {
    const items = [{ id: 'a', from: 0, to: 50 }, { id: 'b', from: 20, to: 90 }, { id: 'c', from: 70, to: 120 }, { id: 'd', from: 71, to: 130 }];
    const links = [['a', 'c'], ['b', 'd']] as const;
    expect(assignRows(items, links, options)).toEqual(assignRows([...items], links, options));
  });
});
