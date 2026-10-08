// From the splices of one change to row writes (etalii.adp spec 012, contracts/store.md, "From a
// splice to row writes"). The place of a splice gives the kind, the entry gives the row and the
// key gives the property, all found in the binding: no kind, key or property is named here.

import type { FblBinding } from '../fbl/documents/types';
import type { FblOptions } from '../fbl/model';
import { isEmpty, plain } from '../fbl/planning/newText';
import { readBody, type BodyReading } from '../fbl/rules/bodyReading';
import type { ReadElement } from '../fbl/rules/familyReader';
import { applySplices, type FblSplice } from '../fbl/splice';
import { byteLength } from '../fbl/text/utf8';
import type { NotionRow, NotionValues } from './notion';
import { notionValue, type RowsRead, type StoreEntry } from './rows';
import { ORDER, type StoreKind, type StoreProperty, type StoreSchema } from './schema';

/**
 * One write to one row, as plain data. `row` is the store's name for the row: Notion's id of a row
 * that was read, or a name of the store's own for a row that is not created yet.
 */
export type RowWrite =
  /** `values` holds the title and every value but the relations, as Notion takes them. */
  | { readonly write: 'create'; readonly row: string; readonly kind: string; readonly order?: number; readonly values: NotionValues; readonly relations: Readonly<Record<string, readonly string[]>> }
  /** One property, set or emptied. */
  | { readonly write: 'update'; readonly row: string; readonly property: string; readonly value: Record<string, unknown> }
  /** One relation: the rows it names, none when it names nothing. */
  | { readonly write: 'relate'; readonly row: string; readonly property: string; readonly rows: readonly string[] }
  | { readonly write: 'trash' | 'restore'; readonly row: string }
  | { readonly write: 'reorder'; readonly row: string; readonly order: number };

/** Where a row stands among the rows of its kind: by `Order`, then by the time it was created. */
export interface RowPlace {
  readonly order?: number;
  readonly created: string;
}

/** What a row holds for its entry. */
export interface Held {
  readonly title: string;
  readonly values: NotionValues;
  readonly relations: Readonly<Record<string, readonly string[]>>;
}

/**
 * What the store keeps beside the body it built: which row is which entry, where each row stands,
 * and the rows it moved to the trash, so that an entry that comes back takes its own row out of it.
 */
export interface StoreRecord {
  readonly rows: RowsRead;
  readonly places: ReadonlyMap<string, RowPlace>;
  /** By kind and title. */
  readonly trashed: ReadonlyMap<string, Trashed>;
  /** How many rows the store named itself. */
  readonly made: number;
}

export interface Trashed {
  readonly row: string;
  /** What the row held when it was moved to the trash; nothing when the store cannot say. */
  readonly held?: Held;
  readonly place: RowPlace;
}

export type Resolved =
  | { readonly writes: readonly RowWrite[]; readonly record: StoreRecord }
  /** A splice could not be resolved: nothing is to be written and nothing changes. */
  | { readonly refused: string };

/** The record of a store as it was read: `held` are the rows of that read. */
export function recordOf(rows: RowsRead, held: readonly NotionRow[]): StoreRecord {
  const places = new Map(held.map((each) => {
    const order = each.properties[ORDER]?.number;
    return [each.id, { order: typeof order === 'number' ? order : undefined, created: each.created_time }] as const;
  }));
  return { rows, places, trashed: new Map(), made: 0 };
}

class Unresolved extends Error {}
const unresolved = (why: string): never => {
  throw new Unresolved(`The change cannot be stored: ${why}`);
};

// A row that is not created yet was created after every row that is, in the order it was named.
const NEW = '~';
const named = (made: number): string => `new:${made}`;
const sooner = (a: RowPlace | undefined, b: RowPlace | undefined): number =>
  ((a?.order ?? Infinity) - (b?.order ?? Infinity) || 0) || ((a?.created ?? '') < (b?.created ?? '') ? -1 : (a?.created ?? '') > (b?.created ?? '') ? 1 : 0);

const emptied = (property: StoreProperty): Record<string, unknown> =>
  ({ [property.type]: property.type === 'checkbox' ? false : property.type === 'number' || property.type === 'select' ? null : [] });

const text = (value: unknown): string => JSON.stringify(value, (_name, item: unknown) => (typeof item === 'bigint' ? Number(item) : item)) ?? '';

interface Landing {
  /** The first splice that lands on the entry. */
  readonly splice: number;
  readonly kind: StoreKind;
  /** The entry before the change; none for one that is inserted. */
  readonly was?: ReadElement;
  /** The entry after the change; none for one that is removed. */
  readonly now?: ReadElement;
  /** The row in the trash that an inserted entry takes out of it. */
  readonly back?: Trashed;
}

/**
 * The row writes the splices of one change come to, in the order of the splices, and the record
 * as it is once they are applied. The splices are in body order and refer to the body of
 * `record`, as the FBL library plans them.
 */
export function resolve(record: StoreRecord, splices: readonly FblSplice[], schema: StoreSchema, binding: FblBinding, options: FblOptions = {}): Resolved {
  if (splices.length === 0) return { writes: [], record };
  try {
    return resolved(record, splices, schema, binding, options);
  } catch (error) {
    if (error instanceof Unresolved) return { refused: error.message };
    throw error;
  }
}

function resolved(record: StoreRecord, splices: readonly FblSplice[], schema: StoreSchema, binding: FblBinding, options: FblOptions): Resolved {
  const before = record.rows;
  let body: Uint8Array;
  try {
    body = applySplices(before.body, splices);
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : String(error));
  }
  const reading = readBody(body, binding, options);
  if (reading.unreadable) unresolved(`it would leave a document that cannot be read. ${reading.unreadable.message}`);

  // Where each splice lies: `start` to `end` in the body before, `from` to `to` in the body after.
  let shift = 0;
  const ranges = splices.map((splice) => {
    const written = byteLength(splice.text);
    const range = { start: splice.start, end: splice.end, from: splice.start + shift, to: splice.start + shift + written };
    shift += written - (splice.end - splice.start);
    return range;
  });

  const property = (name: string): StoreProperty => schema.properties.find((each) => each.name === name)!;
  const isKind = (element: ReadElement): boolean => schema.kinds.some((kind) => kind.rule === element.rule);
  const titleOf = (kind: StoreKind, element: ReadElement): string => (kind.single ? kind.name : element.idRead?.present ? plain(element.idRead.value) : '');

  // What a rule reads and no row holds stays as it was, or the rows would no longer be the document.
  const unheld = (from: BodyReading): string => text(from.elements.filter((element) => !isKind(element)).map((element) => [element.rule.name, [...element.attributes]]));
  if (unheld(before.reading) !== unheld(reading)) unresolved('it changes a part of the document that no row holds.');

  const rowOf = new Map<ReadElement, string>();
  const places = new Map(record.places);
  const trashed = new Map(record.trashed);
  let made = record.made;
  const landings: Landing[] = [];
  /** The rows this change names, each with its number. */
  const fresh = new Map<string, number>();
  const entries: StoreEntry[] = [];
  const disturbed: string[][] = [];

  for (const kind of [...schema.kinds.filter((each) => each.single), ...schema.kinds.filter((each) => !each.single)]) {
    const was = before.reading.elements.filter((element) => element.rule === kind.rule);
    const held = before.entries.filter((entry) => entry.kind === kind.name).sort((a, b) => a.position - b.position);
    if (held.length !== was.length) unresolved(`a row of the kind \`${kind.name}\` cannot be told from an entry.`);
    was.forEach((element, position) => rowOf.set(element, held[position].rowId));
    const now = reading.elements.filter((element) => element.rule === kind.rule);

    // An entry a splice takes whole is removed; one that lies whole in what a splice wrote is inserted.
    const removedBy = was.map(({ entry }) => ranges.findIndex((range) => range.end > range.start && range.start <= entry.own.start && entry.own.end <= range.end));
    const insertedBy = now.map(({ entry }) => ranges.findIndex((range) => range.to > range.from && range.from <= entry.own.start && entry.own.end <= range.to));
    const kept = was.filter((_, position) => removedBy[position] < 0);
    const keptNow = now.filter((_, position) => insertedBy[position] < 0);
    if (kept.length !== keptNow.length) unresolved(`it does not say which entries of the kind \`${kind.name}\` it leaves.`);

    kept.forEach((element, position) => {
      rowOf.set(keptNow[position], rowOf.get(element)!);
      const start = Math.min(element.entry.own.start, element.entry.removalSpan.start);
      const end = Math.max(element.entry.own.end, element.entry.removalSpan.end);
      const splice = ranges.findIndex((range) => range.start <= end && start <= range.end);
      if (splice >= 0) landings.push({ splice, kind, was: element, now: keptNow[position] });
    });

    const gone = was.map((element, position) => ({ element, splice: removedBy[position] })).filter((each) => each.splice >= 0);
    now.forEach((element, position) => {
      const splice = insertedBy[position];
      if (splice < 0) return;
      const title = titleOf(kind, element);
      const moved = gone.findIndex((each) => titleOf(kind, each.element) === title);
      if (moved >= 0) {
        // Removed and inserted in one change: the entry moved, and its row stays.
        const [{ element: from }] = gone.splice(moved, 1);
        rowOf.set(element, rowOf.get(from)!);
        landings.push({ splice, kind, was: from, now: element });
        return;
      }
      const back = trashed.get(`${kind.name}\n${title}`);
      const row = back?.row ?? named(++made);
      if (back) {
        trashed.delete(`${kind.name}\n${title}`);
        places.set(row, back.place);
      } else fresh.set(row, made);
      rowOf.set(element, row);
      landings.push({ splice, kind, now: element, back });
    });
    for (const each of gone) landings.push({ splice: each.splice, kind, was: each.element });

    const sequence = now.map((element) => rowOf.get(element)!);
    sequence.forEach((rowId, position) => entries.push({ kind: kind.name, position, rowId }));
    if (!kind.single && insertedBy.some((splice) => splice >= 0)) disturbed.push(sequence);
  }
  // An entry of a rule that is no kind has no row to be written to.
  if (reading.elements.filter((element) => !isKind(element)).length !== before.reading.elements.filter((element) => !isKind(element)).length) {
    unresolved('it leaves an entry that a row cannot hold.');
  }

  // The `Order` of a new row, and of the rows that no longer stand where the document has them.
  const reorders: RowWrite[] = [];
  for (const sequence of disturbed) {
    sequence.forEach((row, position) => {
      if (!fresh.has(row)) return;
      const ahead = position > 0 ? places.get(sequence[position - 1]) : undefined;
      const behind = sequence.slice(position + 1).find((each) => !fresh.has(each));
      const order = position === 0 ? ((behind === undefined ? undefined : places.get(behind)?.order) ?? 2) - 1 : ahead?.order === undefined ? undefined : ahead.order + 1;
      places.set(row, { order, created: NEW + String(fresh.get(row)).padStart(12, '0') });
    });
    const inOrder = sequence.every((row, position) => position === 0 || sooner(places.get(sequence[position - 1]), places.get(row)) <= 0);
    if (inOrder && sequence.every((row) => !fresh.has(row) || places.get(row)?.order !== undefined)) continue;
    sequence.forEach((row, position) => {
      const place = places.get(row) ?? { created: '' };
      if (place.order === position + 1) return;
      places.set(row, { ...place, order: position + 1 });
      if (!fresh.has(row)) reorders.push({ write: 'reorder', row, order: position + 1 });
    });
  }

  // What the row of an entry holds. A value of the entry after the change that its property
  // cannot hold refuses the change; the entry before it is taken as it was read.
  const heldOf = (kind: StoreKind, element: ReadElement, from: BodyReading, strict: boolean): Held => {
    const values: NotionValues = {};
    const relations: Record<string, readonly string[]> = {};
    for (const { property: name, attribute, binding: slot } of kind.values) {
      if (!element.slots.get(attribute)?.present) continue;
      const value = element.attributes.get(attribute);
      // An empty property is an absent key.
      if (isEmpty(value)) continue;
      const kept = property(name);
      if (kept.type !== 'relation') {
        const taken = notionValue(kept, value);
        if (taken) values[name] = taken;
        else if (strict) unresolved(`the \`${name}\` of \`${titleOf(kind, element)}\` is not a value its property holds (${kept.type.replace('_', ' ')}).`);
        continue;
      }
      // The row whose title is the id; a reference that names no row is an empty relation.
      const rows = (Array.isArray(value) ? value : [value]).map((each) => {
        const id = plain(each);
        const other = slot.reference ? from.referencedBy(slot.reference, id) : from.elements.find((candidate) => candidate.id === id);
        return other && rowOf.get(other);
      }).filter((row) => row !== undefined);
      if (rows.length > 0) relations[name] = rows;
    }
    return { title: titleOf(kind, element), values, relations };
  };

  // Without what the row held, every value of its kind is written.
  const differences = (kind: StoreKind, row: string, was: Held | undefined, now: Held): RowWrite[] => {
    const writes: RowWrite[] = [];
    if (was && was.title !== now.title) writes.push({ write: 'update', row, property: schema.title, value: notionValue(property(schema.title), now.title)! });
    for (const { property: name } of kind.values) {
      const kept = property(name);
      if (kept.type === 'relation') {
        const rows = now.relations[name] ?? [];
        if (!was || (was.relations[name] ?? []).join('\n') !== rows.join('\n')) writes.push({ write: 'relate', row, property: name, rows });
      } else if (!was || text(was.values[name]) !== text(now.values[name])) {
        writes.push({ write: 'update', row, property: name, value: now.values[name] ?? emptied(kept) });
      }
    }
    return writes;
  };

  const writes: RowWrite[] = [];
  for (const { kind, was, now, back } of landings.sort((a, b) => a.splice - b.splice)) {
    if (was && now) {
      writes.push(...differences(kind, rowOf.get(now)!, heldOf(kind, was, before.reading, false), heldOf(kind, now, reading, true)));
    } else if (was) {
      const row = rowOf.get(was)!;
      writes.push({ write: 'trash', row });
      trashed.set(`${kind.name}\n${titleOf(kind, was)}`, { row, held: heldOf(kind, was, before.reading, false), place: places.get(row) ?? { created: '' } });
      places.delete(row);
    } else if (now) {
      const row = rowOf.get(now)!;
      const held = heldOf(kind, now, reading, true);
      if (back) {
        // The same row comes out of the trash, with what it held and the relations to it.
        writes.push({ write: 'restore', row }, ...differences(kind, row, back.held, held));
      } else {
        const order = kind.single ? undefined : places.get(row)?.order;
        writes.push({ write: 'create', row, kind: kind.name, ...(order === undefined ? {} : { order }), values: { [schema.title]: notionValue(property(schema.title), held.title)!, ...held.values }, relations: held.relations });
      }
    }
  }
  writes.push(...reorders);

  return { writes, record: { rows: { body, reading, entries, findings: before.findings }, places, trashed, made } };
}

const isValue = (write: RowWrite): boolean => write.write === 'update' || write.write === 'relate' || write.write === 'reorder';

/**
 * The writes of one change that was planned in several steps, as the writes of one: a value of a
 * row the same change creates is taken into its creation, and a value of a row it then moves to
 * the trash is not written at all. An inserted entry is so one row created, and a removed one is
 * one row in the trash, whatever number of steps planned them. The record then no longer says what
 * such a row in the trash holds, so that every value is written when it comes back.
 */
export function folded(writes: readonly RowWrite[], record: StoreRecord): { readonly writes: readonly RowWrite[]; readonly record: StoreRecord } {
  const out: RowWrite[] = [];
  const unsure = new Set<string>();
  for (const write of writes) {
    if (write.write === 'trash') {
      // Back to the write that created or restored the row, if this change has one.
      for (let at = out.length - 1; at >= 0 && !(out[at].row === write.row && !isValue(out[at])); at--) {
        if (out[at].row !== write.row) continue;
        out.splice(at, 1);
        unsure.add(write.row);
      }
    }
    const at = isValue(write) ? out.findIndex((each) => each.write === 'create' && each.row === write.row) : -1;
    const created = at < 0 ? undefined : out[at];
    if (created?.write !== 'create') out.push(write);
    else if (write.write === 'update') out[at] = { ...created, values: { ...created.values, [write.property]: write.value } };
    else if (write.write === 'relate') out[at] = { ...created, relations: { ...created.relations, [write.property]: write.rows } };
    else if (write.write === 'reorder') out[at] = { ...created, order: write.order };
  }
  if (unsure.size === 0) return { writes: out, record };
  const trashed = new Map([...record.trashed].map(([key, each]) => [key, unsure.has(each.row) ? { row: each.row, place: each.place } : each]));
  return { writes: out, record: { ...record, trashed } };
}
