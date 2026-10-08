// The rows of a store as the document its binding describes, and a document as rows (etalii.adp
// spec 012, contracts/store.md, research D2 and D3). The body is built in memory by replaying the
// rows as insertions into the binding's template through the FBL library, so the binding decides
// every line; no kind, key or property is named here.

import type { Family, FblBinding } from '../fbl/documents/types';
import type { FblOptions } from '../fbl/model';
import { isEmpty, plain } from '../fbl/planning/newText';
import { Plan } from '../fbl/planning/plan';
import { readBody, type BodyReading } from '../fbl/rules/bodyReading';
import { absentSlot, refuse, type Entry, type ReadElement } from '../fbl/rules/familyReader';
import { applySplices } from '../fbl/splice';
import { encode } from '../fbl/text/utf8';
import { finding, type Finding } from '../disl/model';
import type { NotionCalls, NotionRichText, NotionRow, NotionValue, NotionValues } from './notion';
import { KIND, ORDER, type StoreKind, type StoreProperty, type StoreSchema } from './schema';

// ---- values ----

/** What one rich-text item holds. */
const ITEM = 2000;
/** What the name of an option holds. */
const OPTION = 100;

type Scalar = string | number | bigint | boolean;
const isScalar = (value: unknown): value is Scalar => ['string', 'number', 'bigint', 'boolean'].includes(typeof value);
const isOption = (value: unknown): value is Scalar => isScalar(value) && !String(value).includes(',') && String(value).length > 0 && String(value).length <= OPTION;

function items(text: string): { text: { content: string } }[] {
  const parts: { text: { content: string } }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + ITEM);
    // A character of two code units is not split over two items.
    if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    parts.push({ text: { content: text.slice(start, end) } });
    start = end;
  }
  return parts;
}

/**
 * A value the FBL library read or takes, as Notion takes it in a write of `property`; nothing when
 * the property cannot hold it. A relation is not written from a value but from the related rows.
 */
export function notionValue(property: StoreProperty, value: unknown): Record<string, unknown> | undefined {
  switch (property.type) {
    case 'title':
    case 'rich_text':
      return isScalar(value) ? { [property.type]: items(String(value)) } : undefined;
    case 'number':
      return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) ? { number: Number(value) } : undefined;
    case 'checkbox':
      return typeof value === 'boolean' ? { checkbox: value } : undefined;
    case 'select':
      return isOption(value) ? { select: { name: String(value) } } : undefined;
    case 'multi_select':
      return Array.isArray(value) && value.every(isOption) ? { multi_select: value.map((each) => ({ name: String(each) })) } : undefined;
    default:
      return undefined;
  }
}

/**
 * What a row holds in `property`, as the FBL library takes a value; nothing when the property is
 * empty, which is an absent key. A relation is the ids of the related rows.
 */
export function valueOf(property: StoreProperty, held: NotionValue | undefined): unknown {
  if (held?.type !== property.type) return undefined;
  const value = held[property.type];
  switch (property.type) {
    case 'title':
    case 'rich_text': {
      const text = Array.isArray(value) ? (value as NotionRichText[]).map((item) => item.plain_text).join('') : '';
      return text.length > 0 ? text : undefined;
    }
    case 'number':
      // The library writes an integer from a `bigint`.
      return typeof value !== 'number' ? undefined : Number.isSafeInteger(value) ? BigInt(value) : value;
    case 'checkbox':
      return value === true ? true : undefined;
    case 'select':
      return (value as { name?: string } | null)?.name;
    case 'multi_select':
      return Array.isArray(value) && value.length > 0 ? (value as { name: string }[]).map((option) => option.name) : undefined;
    default:
      return Array.isArray(value) && value.length > 0 ? (value as { id: string }[]).map((related) => related.id) : undefined;
  }
}

// ---- rows to document ----

/** Which row an entry of the body is: the entry at `position` among the entries of its kind. */
export interface StoreEntry {
  readonly kind: string;
  readonly position: number;
  readonly rowId: string;
}

export interface RowsRead {
  /** The body the FBL library plans against: a reading of the rows, never a source. */
  readonly body: Uint8Array;
  readonly reading: BodyReading;
  /** In the body's order. */
  readonly entries: readonly StoreEntry[];
  /** What the store could not read from its rows; each has `detail.rowId` where it concerns a row. */
  readonly findings: readonly Finding[];
}

interface Pending {
  readonly held: NotionRow;
  readonly id: string | undefined;
  readonly values: Map<string, unknown>;
  /** The values set after the entry is added. */
  readonly later: Map<string, unknown>;
}

/**
 * The document the rows are, through the binding. It never throws: a row that cannot be read is a
 * finding, and the rest is read.
 */
export function readRows(rows: readonly NotionRow[], schema: StoreSchema, binding: FblBinding, options: FblOptions = {}): RowsRead {
  const findings: Finding[] = [];
  const report = (code: string, held: NotionRow | undefined, message: string): void =>
    void findings.push(finding(code, 'warning', message, held ? { detail: { rowId: held.id } } : {}));
  const property = (name: string): StoreProperty => schema.properties.find((each) => each.name === name)!;
  const titleOf = (held: NotionRow): string | undefined => valueOf(property(schema.title), held.properties[schema.title]) as string | undefined;
  const named = (held: NotionRow): string => titleOf(held) ?? held.id;

  const live = rows.filter((held) => !held.in_trash);
  const kindOf = (held: NotionRow): StoreKind | undefined => {
    const name = valueOf(property(KIND), held.properties[KIND]);
    return schema.kinds.find((kind) => kind.name === name);
  };
  const related = new Map(live.map((held) => [held.id, { kind: kindOf(held)?.name, title: titleOf(held) }]));

  const orderOf = (held: NotionRow): number => {
    const order = held.properties[ORDER]?.number;
    return typeof order === 'number' ? order : Infinity;
  };
  const ordered = (kind: StoreKind): NotionRow[] => live.filter((held) => kindOf(held) === kind)
    .sort((a, b) => (kind.single ? 0 : orderOf(a) - orderOf(b) || 0) || a.created_time.localeCompare(b.created_time));

  const valuesOf = (kind: StoreKind, held: NotionRow): Map<string, unknown> => {
    const values = new Map<string, unknown>();
    for (const { property: name, attribute } of kind.values) {
      const kept = property(name);
      const value = valueOf(kept, held.properties[name]);
      if (value === undefined) continue;
      if (kept.type !== 'relation') {
        values.set(attribute, value);
        continue;
      }
      const ids = value as string[];
      if (!kept.many && ids.length > 1) {
        report('store.relation', held, `The row \`${named(held)}\` names ${ids.length} rows in \`${name}\`, which holds one, so it is read as naming none.`);
        continue;
      }
      const titles: string[] = [];
      for (const id of ids) {
        const other = related.get(id);
        // A row in the trash, or of another database, is no row: the relation names nothing.
        if (other?.title === undefined) continue;
        if (!kept.kinds?.includes(other.kind ?? '')) report('store.relation', held, `The row \`${named(held)}\` names \`${other.title}\` in \`${name}\`, which is ${other.kind === undefined ? 'of no kind' : `a \`${other.kind}\``}.`);
        titles.push(other.title);
      }
      if (titles.length > 0) values.set(attribute, kept.many ? titles : titles[0]);
    }
    return values;
  };

  for (const held of live) {
    if (kindOf(held)) continue;
    const name = valueOf(property(KIND), held.properties[KIND]);
    report('store.unknown-kind', held, name === undefined ? `The row \`${named(held)}\` has no \`${KIND}\`, so it is not read.` : `The row \`${named(held)}\` is of the kind \`${String(name)}\`, which this store does not have, so it is not read.`);
  }

  // The template, with the one line of each place that is read as a whole. The library adds an
  // entry to a list only, so this line is the store's own (research D3).
  const newline = binding.text.newline;
  const template = binding.template?.text ?? '';
  let bytes = encode(template);
  let reading = readBody(bytes, binding, options);
  const entries: StoreEntry[] = [];
  const read = new Map<StoreKind, number>();

  try {
    let lines = '';
    for (const kind of schema.kinds.filter((each) => each.single)) {
      const [first, ...more] = ordered(kind);
      for (const held of more) report('store.second-row', held, `A store has one row of the kind \`${kind.name}\`; this second one is not read.`);
      const own = kind.values[0];
      const value = first && own ? valuesOf(kind, first).get(own.attribute) : undefined;
      if (value === undefined) continue;
      lines += `${own.property}: ${reading.family.format(absentSlot, own.binding, value)}${newline}`;
      entries.push({ kind: kind.name, position: 0, rowId: first.id });
      read.set(kind, 1);
    }
    if (lines.length > 0) {
      // Below the header when the binding has one, else at the end.
      const below = binding.header ? template.indexOf(newline) : -1;
      const cut = below < 0 ? template.length : below + newline.length;
      const head = template.slice(0, cut);
      bytes = encode(head + (head.length > 0 && !head.endsWith(newline) ? newline : '') + lines + template.slice(cut));
      reading = readBody(bytes, binding, options);
    }

    // One reading for a batch: the library reads the whole text again after each edit.
    const insert = (kind: StoreKind, batch: readonly Pending[]): Pending[] => {
      const plan = new Plan(reading);
      const done: Pending[] = [];
      for (const each of batch) {
        try {
          const when = kind.rule.insert!.when;
          if (when !== undefined && !reading.insertAllowed(when, each.values)) refuse('The binding does not add such an entry.');
          reading.family.insert(plan, { rule: kind.rule, id: each.id, values: each.values });
          done.push(each);
        } catch (error) {
          report('store.unreadable-row', each.held, `The row \`${named(each.held)}\` is not read: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      bytes = applySplices(bytes, plan.ordered());
      reading = readBody(bytes, binding, options);
      return done;
    };

    for (const kind of schema.kinds.filter((each) => !each.single)) {
      const pending: Pending[] = ordered(kind).map((held) => {
        const values = valuesOf(kind, held);
        const later = new Map([...values].filter(([, value]) => typeof value === 'string' && /[\r\n]/.test(value)));
        for (const attribute of later.keys()) values.delete(attribute);
        return { held, id: titleOf(held), values, later };
      });
      // The first entry makes the list, so it is planned alone. Each later one is planned at the
      // same place: behind the last, or before the first where the binding adds at the start.
      const atStart = kind.rule.insert!.place === 'start';
      const done: Pending[] = [];
      while (pending.length > 0 && done.length === 0) done.push(...insert(kind, [atStart ? pending.pop()! : pending.shift()!]));
      const rest = insert(kind, pending);
      const inOrder = atStart ? [...rest, ...done] : [...done, ...rest];

      // A text of several lines is set once its entry is there: written with a new entry, the
      // library indents its lines as if the key stood at the margin, and the body no longer reads.
      const added = reading.elements.filter((element) => element.rule === kind.rule);
      if (added.length === inOrder.length && inOrder.some((each) => each.later.size > 0)) {
        const plan = new Plan(reading);
        inOrder.forEach((each, position) => {
          const changes = [...each.later].map(([attribute, value]) => ({ attribute, binding: kind.values.find((own) => own.attribute === attribute)!.binding, rule: kind.rule, read: added[position].slots.get(attribute) ?? absentSlot, value, isEmpty: false }));
          if (changes.length > 0) reading.family.write(plan, added[position], changes);
        });
        bytes = applySplices(bytes, plan.ordered());
        reading = readBody(bytes, binding, options);
      }
      inOrder.forEach((each, position) => entries.push({ kind: kind.name, position, rowId: each.held.id }));
      read.set(kind, inOrder.length);
    }

    for (const [kind, count] of read) {
      const found = reading.elements.filter((element) => element.rule === kind.rule).length;
      if (found !== count) findings.push(finding('store.unreadable', 'error', `The binding reads ${found} of the ${count} rows of the kind \`${kind.name}\`, so a row cannot be told from an entry.`));
    }
  } catch (error) {
    findings.push(finding('store.unreadable', 'error', `The rows could not be read as a document: ${error instanceof Error ? error.message : String(error)}`));
  }
  return { body: bytes, reading, entries, findings };
}

// ---- document to rows ----

/** A row to create. */
export interface NewRow {
  readonly kind: string;
  /** The place among the rows of its kind, from 1; nothing for a kind of one row. */
  readonly order?: number;
  /** The title: the entry's id as written, or the kind's name for a kind of one row. */
  readonly id: string;
  /** The title, `Kind`, `Order` and every value but the relations, as Notion takes them. */
  readonly values: NotionValues;
  /** Each relation: the stored ids it names, and the rows that have them, as indexes into the rows. */
  readonly references: readonly { readonly property: string; readonly ids: readonly string[]; readonly rows: readonly number[] }[];
  readonly line: number;
}

/** Something of a document that a store does not hold. */
export interface NotKept {
  readonly what: 'comment' | 'key' | 'entry' | 'reference' | 'empty' | 'unheld' | 'unreadable';
  readonly line: number;
  /** A sentence that names the entry. */
  readonly message: string;
}

export interface DocumentRows {
  /** In the document's order. */
  readonly rows: readonly NewRow[];
  /** What is lost when the rows are stored: the document is stored without it. */
  readonly notKept: readonly NotKept[];
  /** What Notion cannot hold in its property. A document with any is not put in. */
  readonly refused: readonly NotKept[];
}

// The library reads a comment as the space between two values and keeps its mark to itself.
const commentMarks: Partial<Record<Family, string>> = { yaml: '#' };

/** The rows a document is, through the binding, and what of it a store does not keep. */
export function rowsOf(body: Uint8Array, schema: StoreSchema, binding: FblBinding, options: FblOptions = {}): DocumentRows {
  const reading = readBody(body, binding, options);
  if (reading.unreadable) return { rows: [], notKept: [], refused: [{ what: 'unreadable', line: 1, message: reading.unreadable.message }] };

  const rows: NewRow[] = [];
  const notKept: NotKept[] = [];
  const refused: NotKept[] = [];
  const lineOf = (offset: number): number => reading.text.position(offset).line;
  const property = (name: string): StoreProperty => schema.properties.find((each) => each.name === name)!;
  const kindOf = (element: ReadElement | undefined): StoreKind | undefined => schema.kinds.find((kind) => kind.rule === element?.rule);
  const named = (element: ReadElement): string => `\`${element.rule.name}\` \`${element.id}\``;

  const elements = reading.elements.filter((element) => kindOf(element));
  const indexOf = new Map(elements.map((element, index) => [element, index]));
  const counts = new Map<StoreKind, number>();

  for (const element of elements) {
    const kind = kindOf(element)!;
    const order = kind.single ? undefined : (counts.get(kind) ?? 0) + 1;
    counts.set(kind, order ?? 1);
    const id = kind.single ? kind.name : element.idRead?.present ? plain(element.idRead.value) : '';
    const values: NotionValues = { [schema.title]: notionValue(property(schema.title), id)!, [KIND]: { select: { name: kind.name } } };
    if (order !== undefined) values[ORDER] = { number: order };
    const references: { property: string; ids: string[]; rows: number[] }[] = [];

    for (const { property: name, attribute, binding: slot } of kind.values) {
      if (!element.slots.get(attribute)?.present) continue;
      const value = element.attributes.get(attribute);
      const line = element.line;
      if (isEmpty(value)) {
        notKept.push({ what: 'empty', line, message: `The empty \`${name}\` of ${named(element)} is not kept: an empty property is an absent key.` });
        continue;
      }
      const kept = property(name);
      if (kept.type !== 'relation') {
        const held = notionValue(kept, value);
        if (held) values[name] = held;
        else refused.push({ what: 'unheld', line, message: `The \`${name}\` of ${named(element)} is not a value its property holds (${kept.type.replace('_', ' ')}).` });
        continue;
      }
      const ids = (Array.isArray(value) ? value : [value]).map((each) => plain(each));
      const reference = { property: name, ids: [] as string[], rows: [] as number[] };
      for (const id of ids) {
        const other = slot.reference ? reading.referencedBy(slot.reference, id) : elements.find((each) => each.id === id);
        const index = other && indexOf.get(other);
        if (index === undefined) {
          notKept.push({ what: 'reference', line, message: `The \`${name}\` of ${named(element)} names \`${id}\`, which is in no list it may name; a relation cannot hold that id, so it is not kept.` });
          continue;
        }
        reference.ids.push(id);
        reference.rows.push(index);
      }
      if (reference.rows.length > 0) references.push(reference);
    }
    rows.push({ kind: kind.name, order, id, values, references, line: element.line });
  }

  // Everything else the document holds: keys no rule reads, and entries no kind's rule reads.
  const lists = schema.kinds.map((kind) => (kind.rule.at ?? '').split('/').filter((part) => part.length > 0));
  const leadsToKind = (path: readonly string[]): boolean => lists.some((at) => at.length > path.length && path.every((part, index) => at[index] === part));
  const visit = (entry: Entry, path: readonly string[]): void => {
    const element = reading.elementOf(entry);
    const kind = kindOf(element);
    const keys = new Set(element?.rule.attributes.map(([, slot]) => slot.key));
    if (element?.rule.id?.from?.key !== undefined) keys.add(element.rule.id.from.key);
    if (element && !kind && path.length > 0) {
      notKept.push({ what: 'entry', line: element.line, message: `The entry at line ${element.line} is not one a row holds, so it is not kept${element.rule.readOnly ? `: ${element.rule.readOnly}` : '.'}` });
      return;
    }
    for (const child of entry.children) {
      const line = lineOf(child.own.start);
      if (reading.elementOf(child)) visit(child, [...path, child.name ?? '*']);
      else if (kind?.single || (child.name !== undefined && keys.has(child.name))) continue;
      else if (kind) notKept.push({ what: 'key', line, message: `The key \`${child.name ?? ''}\` of ${named(element!)} is not one the binding reads, so it is not kept.` });
      else if (leadsToKind([...path, child.name ?? '*'])) visit(child, [...path, child.name ?? '*']);
      else notKept.push({ what: child.name === undefined ? 'entry' : 'key', line, message: `${child.name === undefined ? 'The entry' : `The key \`${child.name}\``} at line ${line} is not read by the binding, so it is not kept.` });
    }
  };
  for (const entry of reading.family.entries) if (!entry.parent) visit(entry, []);

  const mark = commentMarks[binding.body.family ?? 'lines'];
  if (mark !== undefined) {
    // Between two leaves the mark can only begin a comment.
    let from = reading.text.bomLength;
    const gap = (to: number): void => {
      const text = reading.text.text(from, Math.max(from, to));
      let at = text.indexOf(mark);
      while (at >= 0) {
        const line = lineOf(from + encode(text.slice(0, at)).length);
        notKept.push({ what: 'comment', line, message: `The comment at line ${line} is not kept.` });
        const end = text.indexOf('\n', at);
        at = end < 0 ? -1 : text.indexOf(mark, end);
      }
    };
    for (const leaf of [...reading.family.leaves].sort((a, b) => a.start - b.start)) {
      gap(leaf.start);
      from = Math.max(from, leaf.end);
    }
    gap(reading.text.length);
  }

  const byLine = (a: NotKept, b: NotKept): number => a.line - b.line;
  return { rows, notKept: notKept.sort(byLine), refused: refused.sort(byLine) };
}

/**
 * Creates the rows in a data source, in one edit: a row a reference names before the row that
 * holds the reference, each relation by row id. Answers the row ids, in the order of `rows`.
 */
export function createRows(rows: readonly NewRow[], dataSourceId: string, calls: NotionCalls): Promise<string[]> {
  const ids: string[] = [];
  const relations = (held: NewRow): NotionValues =>
    Object.fromEntries(held.references.map((reference) => [reference.property, { relation: reference.rows.map((index) => ({ id: ids[index] })) }]));
  return calls.edit(async (writes) => {
    let left = rows.map((_, index) => index);
    while (left.length > 0) {
      const ready = left.filter((index) => rows[index].references.every((reference) => reference.rows.every((other) => ids[other] !== undefined)));
      // Rows that name each other in a circle are created without relations, and related after.
      const now = ready.length > 0 ? ready : left;
      const made = await Promise.all(now.map((index) => writes.createRow(dataSourceId, ready.length > 0 ? { ...rows[index].values, ...relations(rows[index]) } : rows[index].values)));
      now.forEach((index, position) => (ids[index] = made[position].id));
      if (ready.length === 0) await Promise.all(now.map((index) => writes.updateRow(ids[index], relations(rows[index]))));
      left = left.filter((index) => ids[index] === undefined);
    }
    return ids;
  });
}
