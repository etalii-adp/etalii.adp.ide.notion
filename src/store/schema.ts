// The properties of a store, computed from a binding (etalii.adp spec 012, contracts/store.md,
// "From a binding to properties"). Every kind, key and property is found in the binding at run
// time: this module names none, so a second add-on gets its schema from its own binding.

import { isComputed, type AttributeBinding, type FblBinding, type Rule } from '../fbl/documents/types';
import { attributesOf, isA, isRelation, valueKind, type Metamodel } from '../disl/metamodel';
import { finding, type Finding } from '../disl/model';
import type { InterpretedPersistence } from '../disl/persistence';
import type { Attribute } from '../disl/specification';
import { NotionError, type NotionCalls, type NotionDataSource, type NotionProperty } from './notion';

/** The store's two own properties. */
export const KIND = 'Kind';
export const ORDER = 'Order';

export type PropertyType = 'title' | 'rich_text' | 'number' | 'checkbox' | 'select' | 'multi_select' | 'relation';

export interface StoreProperty {
  readonly name: string;
  readonly type: PropertyType;
  /** A select's options: the enum's stored values, or the kinds' names. */
  readonly options?: readonly string[];
  /** A relation: the kinds whose rows the reference allows. */
  readonly kinds?: readonly string[];
  /** A relation that may hold more than one row. */
  readonly many?: boolean;
}

/** One value of a kind's rows: the property that holds it and the binding's attribute that reads it. */
export interface KindValue {
  readonly property: string;
  readonly attribute: string;
  readonly binding: AttributeBinding;
}

/** A rule of the binding whose entries are rows. */
export interface StoreKind {
  /** The rule's name, which is the value of `Kind`. */
  readonly name: string;
  readonly rule: Rule;
  /** The rule reads one place: at most one row, whose title is the kind's name and which has no `Order`. */
  readonly single: boolean;
  /** In the binding's order. The id is not among them: it is the row's title. */
  readonly values: readonly KindValue[];
}

export interface StoreSchema {
  /** The name of the title property: the key the binding reads an id from. */
  readonly title: string;
  readonly kinds: readonly StoreKind[];
  /** The title property, `Kind`, `Order`, then one for each key in the binding's order. */
  readonly properties: readonly StoreProperty[];
  /** Why the binding cannot be stored; an error among them means it cannot. */
  readonly findings: readonly Finding[];
}

const segmentsOf = (at: string): string[] => at.split('/').filter((part) => part.length > 0);
const onePlace = (parts: readonly string[]): boolean => parts.length > 0 && parts.every((part) => !part.includes('*') && !part.startsWith('{') && !part.includes('['));

// Notion takes two names that differ only in case for one property.
const taken = (name: string): string => name.trim().toLowerCase();

const same = (a: StoreProperty, b: StoreProperty): boolean =>
  a.type === b.type && a.many === b.many && JSON.stringify(a.options) === JSON.stringify(b.options) && JSON.stringify(a.kinds) === JSON.stringify(b.kinds);

/** The schema of the store of a binding's documents. */
export function storeSchema(binding: FblBinding, metamodel: Metamodel, persistence: InterpretedPersistence): StoreSchema {
  const findings: Finding[] = [];
  const problem = (message: string): void => void findings.push(finding('store.schema', 'error', message));

  const kinds: StoreKind[] = [];
  const reads: { kind: StoreKind; property: string; attribute: string; binding: AttributeBinding }[] = [];
  let title: string | undefined;

  for (const rule of binding.elements) {
    const parts = segmentsOf(rule.at ?? '');
    const list = rule.insert !== undefined && parts[parts.length - 1] === '*';
    const single = rule.insert === undefined && onePlace(parts);
    if (!list && !single) continue;

    const values: KindValue[] = [];
    const kind: StoreKind = { name: rule.name, rule, single, values };
    kinds.push(kind);
    const idKey = rule.id?.from?.key;
    if (list) {
      if (idKey === undefined) problem(`The rule \`${rule.name}\` reads no id from a key, so its rows would have no title.`);
      else if (title !== undefined && title !== idKey) problem(`The rule \`${rule.name}\` reads its id from \`${idKey}\` and another rule from \`${title}\`; a store has one title property.`);
      else title = idKey;
    }
    for (const [attribute, slot] of rule.attributes) {
      // A value the binding computes is not kept, but for the entry itself at one place.
      const own = single && slot.value === 'entry';
      if (!own && (isComputed(slot) || slot.key === undefined || slot.key === idKey)) continue;
      if (slot.child !== undefined) {
        problem(`The rule \`${rule.name}\` reads \`${slot.key}\` from a nested entry, which a row cannot hold.`);
        continue;
      }
      const property = own ? parts[parts.length - 1] : slot.key!;
      if (single && !own) {
        problem(`The rule \`${rule.name}\` reads the key \`${property}\` at one place; a store holds the value of such a place only.`);
        continue;
      }
      if (values.some((value) => value.property === property)) continue;
      values.push({ property, attribute, binding: slot });
      reads.push({ kind, property, attribute, binding: slot });
    }
    // The one line of such a place is the only text the store writes itself (research D3).
    if (single && binding.body.family !== 'yaml') problem(`The rule \`${rule.name}\` reads one place, which a store holds for a YAML body only.`);
  }
  if (binding.relations.length > 0) problem(`The binding reads relations with rules of their own (\`${binding.relations[0].name}\`), which a store does not hold.`);

  const entryOf = (type: string) => (Object.hasOwn(persistence.typeMap, type) ? persistence.typeMap[type] : { as: type });
  const typeOf = (kind: StoreKind): string => entryOf(kind.rule.type).as;
  const lists = kinds.filter((kind) => !kind.single);

  // The Notion type of a value, from its attribute in the metamodel, found through `typeMap`.
  const propertyOf = (kind: StoreKind, name: string, attribute: string, slot: AttributeBinding): StoreProperty | undefined => {
    const entry = entryOf(kind.rule.type);
    const mapped = entry.attributes && Object.hasOwn(entry.attributes, attribute) ? entry.attributes[attribute] : attribute;
    const type = metamodel.types[entry.as];
    const declared: Attribute | undefined = mapped === null ? undefined : attributesOf(metamodel, entry.as)[mapped];
    const value = declared ? valueKind(metamodel, declared.type) : undefined;
    const many = declared?.many === true;
    const candidates = (slot.reference?.to ?? lists.map((each) => each.name)).filter((each) => lists.some((list) => list.name === each));
    const allowed = (types: (name: string) => boolean): StoreProperty => ({ name, type: 'relation', kinds: candidates.filter((each) => types(typeOf(lists.find((list) => list.name === each)!))), ...(many ? { many } : {}) });

    if ((mapped === 'source' || mapped === 'target') && isRelation(type)) return allowed((each) => type[mapped].types.includes(each));
    if (value?.kind === 'reference') return allowed((each) => isA(metamodel, each, value.type));
    if (slot.reference) return allowed(() => true);
    if (value?.kind === 'struct') return undefined;
    if (value?.kind === 'enum') return { name, type: many ? 'multi_select' : 'select', options: value.enum.values.map((each) => each.stored) };
    const primitive = value?.primitive ?? 'string';
    if (many) return primitive === 'int' || primitive === 'number' || primitive === 'bool' ? undefined : { name, type: 'multi_select' };
    if (primitive === 'int' || primitive === 'number') return { name, type: 'number' };
    if (primitive === 'bool') return { name, type: 'checkbox' };
    // A month is kept as the document writes it: a Notion date cannot hold every year.
    return { name, type: 'rich_text' };
  };

  const own: StoreProperty[] = [
    { name: title ?? 'Name', type: 'title' },
    { name: KIND, type: 'select', options: kinds.map((kind) => kind.name) },
    { name: ORDER, type: 'number' },
  ];
  const properties = [...own];
  for (const read of reads) {
    const property = propertyOf(read.kind, read.property, read.attribute, read.binding);
    if (!property) {
      problem(`The key \`${read.property}\` of \`${read.kind.name}\` holds a value no Notion property can hold.`);
      continue;
    }
    const known = properties.find((each) => each.name === property.name);
    const clash = properties.find((each) => each.name !== property.name && taken(each.name) === taken(property.name));
    if (clash) problem(`Notion takes the key \`${property.name}\` of \`${read.kind.name}\` for the property \`${clash.name}\`.`);
    else if (!known) properties.push(property);
    else if (own.includes(known)) problem(`The key \`${property.name}\` of \`${read.kind.name}\` is the store's own property \`${known.name}\`.`);
    else if (!same(known, property)) problem(`The key \`${property.name}\` is read as ${known.type} by one rule and as ${property.type} by \`${read.kind.name}\`, or with other options; a store has one property for it.`);
  }

  return { title: own[0].name, kinds, properties, findings };
}

/** What a database lacks to be the store of a schema. */
export interface Missing {
  /** The title property has another name: its name now, and the name it must have. */
  readonly rename?: { readonly from: string; readonly to: string };
  /** The properties the database does not have. */
  readonly add: readonly StoreProperty[];
  /** The properties the database holds with another type; `has` is that type. They are left alone. */
  readonly wrong: readonly { readonly property: StoreProperty; readonly has: string }[];
  /** Nothing is lacking: the database is a store. */
  readonly prepared: boolean;
}

/** What `dataSource` lacks, or holds with another type. */
export function missing(schema: StoreSchema, dataSource: NotionDataSource): Missing {
  const held = Object.values(dataSource.properties);
  const add: StoreProperty[] = [];
  const wrong: { property: StoreProperty; has: string }[] = [];
  let rename: Missing['rename'];
  for (const property of schema.properties) {
    const found = held.find((each) => each.name === property.name);
    if (property.type === 'title') {
      const titled = held.find((each) => each.type === 'title');
      if (found && found.type !== 'title') wrong.push({ property, has: found.type });
      else if (!found && titled) rename = { from: titled.name, to: property.name };
    } else if (!found) add.push(property);
    else if (found.type !== property.type) wrong.push({ property, has: found.type });
    else if (property.type === 'relation' && !ownRelation(found, dataSource)) {
      wrong.push({ property, has: 'relation to another database' });
    }
  }
  return { rename, add, wrong, prepared: !rename && add.length === 0 && wrong.length === 0 };
}

const ownRelation = (property: NotionProperty, dataSource: NotionDataSource): boolean =>
  (property.relation as { data_source_id?: string } | undefined)?.data_source_id === dataSource.id;

/**
 * For each property the database lacks, by its name: the properties the database has that can be
 * projected on it (FR-034). Such a property has the type that is needed and a name no property of
 * the schema has, so that no other need claims it; projecting it gives it the name that is needed.
 */
export function projectable(schema: StoreSchema, dataSource: NotionDataSource): Readonly<Record<string, readonly string[]>> {
  const claimed = new Set(schema.properties.map((property) => taken(property.name)));
  const free = Object.values(dataSource.properties).filter((each) => !claimed.has(taken(each.name)));
  return Object.fromEntries(missing(schema, dataSource).add.map((property) => [
    property.name,
    free.filter((each) => each.type === property.type && (each.type !== 'relation' || ownRelation(each, dataSource))).map((each) => each.name),
  ]));
}

const configuration = (property: StoreProperty, dataSourceId: string): Record<string, unknown> => {
  if (property.type === 'select' || property.type === 'multi_select') return { [property.type]: { options: (property.options ?? []).map((name) => ({ name })) } };
  if (property.type === 'relation') return { relation: { data_source_id: dataSourceId, type: 'single_property', single_property: {} } };
  return { [property.type]: {} };
};

/**
 * Makes a database a store: renames the title property, gives each property of `project` the name
 * of the missing one it is projected on, and adds what is still missing, in one write. `project`
 * is by the name that is needed; an entry that `projectable` does not offer, or that names a
 * property another entry took, is left out, and that property is added. It changes no property
 * that exists with the right name and type, removes none and touches no row. Answers what the
 * database still lacks: a property that exists with another type is left alone.
 */
export async function prepare(schema: StoreSchema, dataSource: NotionDataSource, calls: NotionCalls, project: Readonly<Record<string, string>> = {}): Promise<Missing> {
  const lacking = missing(schema, dataSource);
  const offered = projectable(schema, dataSource);
  const changes: Record<string, Record<string, unknown>> = {};
  if (lacking.rename) changes[lacking.rename.from] = { name: lacking.rename.to };
  for (const property of lacking.add) {
    const chosen = Object.hasOwn(project, property.name) ? project[property.name] : undefined;
    if (chosen !== undefined && offered[property.name].includes(chosen) && !Object.hasOwn(changes, chosen)) changes[chosen] = { name: property.name };
    else changes[property.name] = configuration(property, dataSource.id);
  }
  if (Object.keys(changes).length === 0) return lacking;
  return missing(schema, await calls.edit((writes) => writes.updateProperties(dataSource.id, changes)));
}

/** The views were not changed. The store itself is as it should be. */
export class ViewsError extends Error {
  override readonly name = 'ViewsError';
}

// The layouts whose configuration says which properties a view shows (Notion's reference, "Update a view").
const SHOWING = ['table', 'board', 'list', 'calendar', 'timeline', 'gallery', 'map'];

// Notion writes the id of a property percent-encoded in one answer and plain in another.
function plain(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Hides the properties of those names in every view of a data source that shows properties
 * (FR-036). What a view says of its other properties is sent back as it was, and a view that
 * hides them all already is not written to. Rejects with a `ViewsError` where Notion refuses.
 */
export async function hide(dataSource: NotionDataSource, names: readonly string[], calls: NotionCalls): Promise<void> {
  const ids = Object.values(dataSource.properties).filter((property) => names.includes(property.name)).map((property) => plain(property.id));
  if (ids.length === 0) return;
  try {
    const changes: { id: string; type: string; properties: { property_id: string; visible?: boolean }[] }[] = [];
    for (let cursor: string | undefined, more = true; more;) {
      const page = await calls.views(dataSource.id, cursor);
      for (const { id } of page.results) {
        const view = await calls.view(id);
        if (!SHOWING.includes(view.type)) continue;
        // `property_name` is in an answer only: a request names a property by its id.
        const said = (view.configuration?.properties ?? []).map((entry) => Object.fromEntries(Object.entries(entry).filter(([member]) => member !== 'property_name')) as typeof entry);
        const hidden = (id: string): boolean => said.some((entry) => plain(entry.property_id) === id && entry.visible === false);
        if (ids.every(hidden)) continue;
        const kept = said.map((entry) => (ids.includes(plain(entry.property_id)) ? { ...entry, visible: false } : entry));
        const added = ids.filter((id) => !said.some((entry) => plain(entry.property_id) === id)).map((id) => ({ property_id: id, visible: false }));
        changes.push({ id: view.id, type: view.type, properties: [...kept, ...added] });
      }
      more = page.has_more && page.next_cursor !== null;
      cursor = page.next_cursor ?? undefined;
    }
    if (changes.length > 0) await calls.edit((writes) => Promise.all(changes.map((change) => writes.updateView(change.id, change.type, change.properties))));
  } catch (error) {
    if (!(error instanceof NotionError)) throw error;
    throw new ViewsError(`The internal properties could not be hidden in the views of the database: ${error.message}`, { cause: error });
  }
}
