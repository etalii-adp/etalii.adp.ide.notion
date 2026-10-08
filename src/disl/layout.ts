// The layout of a specification (DISL 10): the configurations it names, when layout runs and what
// it respects, and the standard algorithms `rowPacked` (10.1) and `rows` (10.2), whose results DISL
// states. The algorithms work on plain items; the scene gives them the elements' places.

import type { GeomExpr } from './notation';
import { finding, type Finding, type Loaded } from './model';
import { isObject, type Doc, type Expression, type Section, type Specification } from './specification';

/** `$defs/RowPacked` (DISL 10.1), with its defaults filled in. */
export interface RowPacked {
  readonly order: 'start' | 'document';
  readonly gap: number;
  readonly followConnections?: string;
  readonly targetAfter: 'sourceStart' | 'sourceMiddle' | 'sourceEnd';
  readonly rowsCovered?: Expression;
}

/** `$defs/RowsLayout` (DISL 10.2), with its defaults filled in. */
export interface RowsLayout {
  readonly writes: readonly string[];
  readonly extent: Readonly<Record<string, { readonly from: GeomExpr; readonly to: GeomExpr; readonly rows?: GeomExpr }>>;
  readonly clearance: number;
  readonly affinity?: string;
  readonly ties: 'lower' | 'upper';
  readonly swapPasses: number;
}

/** `$defs/LayoutConfig`: one named configuration. */
export interface LayoutConfig {
  readonly name: string;
  readonly algorithm: string;
  readonly direction: 'right' | 'down' | 'left' | 'up';
  readonly scope: 'all' | 'selection' | 'component';
  readonly rowPacked?: RowPacked;
  readonly rows?: RowsLayout;
  readonly doc?: Doc;
}

export interface Layout {
  readonly algorithms: Readonly<Record<string, LayoutConfig>>;
  /** The configuration an Arrange command and `trigger` use. */
  readonly default?: string;
  /** When layout runs by itself; `manual` is never. */
  readonly trigger: 'manual' | 'onCreate' | 'onChange' | 'onLoadIfMissing' | 'always';
  /** Which positions a user gave survive a layout that runs by itself. */
  readonly respect: 'none' | 'pinned' | 'all';
}

/** The algorithms this add-on runs; a configuration of another one is kept and reported. */
export const standardAlgorithms: readonly string[] = ['none', 'rowPacked', 'rows'];

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Reads one configuration; `report` is told what of it cannot be run. */
export function readLayoutConfig(name: string, declared: Section, report: (message: string) => void = () => undefined): LayoutConfig {
  const algorithm = typeof declared.algorithm === 'string' ? declared.algorithm : 'none';
  if (!standardAlgorithms.includes(algorithm)) report(`The layout \`${name}\` uses the algorithm \`${algorithm}\`, which this add-on does not run.`);
  const options = (key: string): Record<string, unknown> | undefined => {
    const value = declared[key];
    if (algorithm === key && !isObject(value)) report(`The layout \`${name}\` gives the algorithm \`${algorithm}\` no options, so its defaults are used.`);
    return algorithm === key ? (isObject(value) ? value : {}) : undefined;
  };
  const packed = options('rowPacked');
  const rows = options('rows');
  const number = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    name, algorithm,
    direction: oneOf(declared.direction, ['right', 'down', 'left', 'up'], 'right'),
    scope: oneOf(declared.scope, ['all', 'selection', 'component'], 'all'),
    rowPacked: packed && {
      order: oneOf(packed.order, ['start', 'document'], 'document'),
      gap: number(packed.gap, 0),
      followConnections: typeof packed.followConnections === 'string' ? packed.followConnections : undefined,
      targetAfter: oneOf(packed.targetAfter, ['sourceStart', 'sourceMiddle', 'sourceEnd'], 'sourceEnd'),
      rowsCovered: packed.rowsCovered as Expression | undefined,
    },
    rows: rows && {
      writes: Array.isArray(rows.writes) ? (rows.writes as string[]) : [],
      extent: (isObject(rows.extent) ? rows.extent : {}) as RowsLayout['extent'],
      clearance: number(rows.clearance, 0),
      affinity: typeof rows.affinity === 'string' ? rows.affinity : undefined,
      ties: oneOf(rows.ties, ['lower', 'upper'], 'lower'),
      swapPasses: number(rows.swapPasses, 0),
    },
    doc: declared.doc as Doc | undefined,
  };
}

/** Interprets `layout`. With none, there is no layout and nothing runs by itself. */
export function interpretLayout(specification: Specification): Loaded<Layout> {
  const section = specification.layout ?? {};
  const findings: Finding[] = [];
  const report = (message: string): void => void findings.push(finding('disl.layout', 'warning', message));
  const algorithms: Record<string, LayoutConfig> = {};
  for (const [name, declared] of Object.entries(isObject(section.algorithms) ? section.algorithms : {})) {
    if (isObject(declared)) algorithms[name] = readLayoutConfig(name, declared, report);
  }
  const chosen = typeof section.default === 'string' ? section.default : undefined;
  if (chosen !== undefined && !Object.hasOwn(algorithms, chosen)) report(`The default layout \`${chosen}\` is not declared.`);
  return {
    value: {
      algorithms,
      default: chosen !== undefined && Object.hasOwn(algorithms, chosen) ? chosen : undefined,
      trigger: oneOf(section.trigger, ['manual', 'onCreate', 'onChange', 'onLoadIfMissing', 'always'], 'manual'),
      respect: oneOf(section.respect, ['none', 'pinned', 'all'], 'pinned'),
    },
    findings,
  };
}

// ---- `rowPacked` (DISL 10.1) ----

/** One element a row-packed layout places along the packed axis. */
export interface PackedItem {
  readonly id: string;
  /** Its own row, and how many rows it covers from there down. */
  readonly row: number;
  readonly rows?: number;
  /** Its extent along the packed axis. */
  readonly size: number;
  /** Where its base placement starts along the packed axis, for `order: "start"`. */
  readonly start?: number;
}

/**
 * Where each item starts along the packed axis. Every item keeps its row; within a row the items
 * follow `order`, each at the smallest position at least `gap` after the item before it on every
 * row it covers, and the target of a connection starts no earlier than its source's `targetAfter`
 * point. A cycle of such demands is broken at its item earliest in the order. The first item of a
 * row with nothing before it starts at 0.
 */
export function packAlongRows(items: readonly PackedItem[], connections: readonly (readonly [string, string])[], options: Pick<RowPacked, 'order' | 'gap' | 'targetAfter'>): Map<string, number> {
  const ordered = items.map((item, index) => ({ item, index }))
    .sort((a, b) => (options.order === 'start' ? (a.item.start ?? 0) - (b.item.start ?? 0) : 0) || a.index - b.index)
    .map((entry) => entry.item);
  const place = new Map(ordered.map((item, index) => [item.id, index]));

  // What each item waits for: the item before it on each of its rows, and the sources of its connections.
  const before = new Map<string, string[]>(ordered.map((item) => [item.id, []]));
  const sources = new Map<string, string[]>(ordered.map((item) => [item.id, []]));
  const last = new Map<number, string>();
  for (const item of ordered) {
    for (let row = item.row; row < item.row + Math.max(1, item.rows ?? 1); row++) {
      const previous = last.get(row);
      if (previous !== undefined && !before.get(item.id)!.includes(previous)) before.get(item.id)!.push(previous);
      last.set(row, item.id);
    }
  }
  for (const [source, target] of connections) {
    if (source !== target && place.has(source) && place.has(target) && !sources.get(target)!.includes(source)) sources.get(target)!.push(source);
  }

  const byId = new Map(ordered.map((item) => [item.id, item]));
  const share = options.targetAfter === 'sourceStart' ? 0 : options.targetAfter === 'sourceMiddle' ? 0.5 : 1;
  const positions = new Map<string, number>();
  const visiting: string[] = [];
  const position = (id: string): number => {
    const known = positions.get(id);
    if (known !== undefined) return known;
    visiting.push(id);
    let at = 0;
    const after = (other: string, distance: number): void => {
      const open = visiting.indexOf(other);
      if (open < 0) {
        at = Math.max(at, position(other) + distance);
        return;
      }
      // A cycle: the demand on its earliest item is the one dropped. What that item waits for
      // there comes later in the order, so it is never the item before it on a row: it is a source.
      const cycle = visiting.slice(open);
      const earliest = cycle.reduce((best, candidate) => (place.get(candidate)! < place.get(best)! ? candidate : best));
      throw new Cycle(earliest, cycle[(cycle.indexOf(earliest) + 1) % cycle.length]);
    };
    for (const other of before.get(id)!) after(other, byId.get(other)!.size + options.gap);
    for (const source of sources.get(id)!) after(source, byId.get(source)!.size * share);
    visiting.pop();
    positions.set(id, at);
    return at;
  };
  for (;;) {
    try {
      for (const item of ordered) position(item.id);
      return positions;
    } catch (failure) {
      if (!(failure instanceof Cycle)) throw failure;
      sources.set(failure.target, sources.get(failure.target)!.filter((source) => source !== failure.source));
      positions.clear();
      visiting.length = 0;
    }
  }
}

// The demand to drop: `target` no longer waits for `source`.
class Cycle extends Error {
  constructor(readonly target: string, readonly source: string) { super('cycle'); }
}

// ---- `rows` (DISL 10.2) ----

/** One element a rows-only arrangement assigns a row: its extent across, and the rows it covers. */
export interface RowItem {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly rows?: number;
}

/**
 * The top row of each item. The items are taken by `from`, then `to`, then the order given; each
 * goes on a free top row among those in use, the one nearest the average row of its placed linked
 * items, else the first; with none free, on the lowest top row whose rows are free. Whole
 * neighbouring rows are then swapped while that strictly shortens the links, for at most
 * `swapPasses` passes; a row an item of several rows covers stays where it is.
 */
export function assignRows(items: readonly RowItem[], links: readonly (readonly [string, string])[], options: Pick<RowsLayout, 'clearance' | 'ties' | 'swapPasses'>): Map<string, number> {
  const ordered = items.map((item, index) => ({ item: { ...item, rows: Math.max(1, item.rows ?? 1) }, index }))
    .sort((a, b) => a.item.from - b.item.from || a.item.to - b.item.to || a.index - b.index)
    .map((entry) => entry.item);
  const linked = new Map<string, string[]>(ordered.map((item) => [item.id, []]));
  for (const [from, to] of links) {
    if (from !== to && linked.has(from) && linked.has(to)) {
      linked.get(from)!.push(to);
      linked.get(to)!.push(from);
    }
  }

  // Where each row is next free, across.
  const freeFrom: number[] = [];
  const rows = new Map<string, number>();
  for (const item of ordered) {
    const fits = (top: number): boolean => {
      for (let row = top; row < top + item.rows; row++) if (row < freeFrom.length && freeFrom[row] > item.from) return false;
      return true;
    };
    const placed = linked.get(item.id)!.filter((id) => rows.has(id)).map((id) => rows.get(id)!);
    const free: number[] = [];
    for (let top = 0; top + item.rows <= freeFrom.length; top++) if (fits(top)) free.push(top);

    let row = 0;
    if (free.length === 0) {
      while (!fits(row)) row++;
    } else if (placed.length === 0) {
      row = free[0];
    } else {
      const wanted = placed.reduce((sum, value) => sum + value, 0) / placed.length;
      row = [...free].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || (options.ties === 'upper' ? b - a : a - b))[0];
    }
    while (freeFrom.length < row + item.rows) freeFrom.push(-Infinity);
    for (let covered = row; covered < row + item.rows; covered++) freeFrom[covered] = item.to + options.clearance;
    rows.set(item.id, row);
  }

  const pinned = new Set<number>();
  for (const item of ordered) {
    if (item.rows > 1) for (let row = rows.get(item.id)!; row < rows.get(item.id)! + item.rows; row++) pinned.add(row);
  }
  // Which row each assigned row is drawn at after the swaps.
  const at = freeFrom.map((_, index) => index);
  const pairs: [string, string][] = [];
  for (const item of ordered) for (const other of linked.get(item.id)!) if (item.id < other) pairs.push([item.id, other]);
  const length = (): number => pairs.reduce((sum, [from, to]) => sum + Math.abs(at[rows.get(from)!] - at[rows.get(to)!]), 0);

  let best = length();
  for (let pass = 0; pass < options.swapPasses; pass++) {
    let kept = false;
    for (let position = 0; position + 1 < at.length; position++) {
      const upper = at.indexOf(position);
      const lower = at.indexOf(position + 1);
      if (pinned.has(upper) || pinned.has(lower)) continue;
      [at[upper], at[lower]] = [at[lower], at[upper]];
      const swapped = length();
      if (swapped < best - 1e-9) {
        best = swapped;
        kept = true;
      } else {
        [at[upper], at[lower]] = [at[lower], at[upper]];
      }
    }
    if (!kept) break;
  }
  return new Map([...rows].map(([id, row]) => [id, at[row]]));
}
