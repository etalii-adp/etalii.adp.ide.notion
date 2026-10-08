// The persistence of a specification (DISL 11) for a model that lives behind an FBL binding: which
// binding, how ids are made, and `typeMap`, which says what the binding's types and attributes are
// in the metamodel. Reading a body is the FBL library's; this module types what it read.

import { findRule, type FblBinding, type FblDocument, type Slot } from '../fbl/documents/types';
import { findingCodes } from '../fbl/finding';
import type { FblElement, FblModel } from '../fbl/model';
import { attributesOf, formatYearMonth, isRelation, parseYearMonth, valueKind, type Metamodel } from './metamodel';
import { emptyModel, finding, type Finding, type Loaded, type Model, type ModelElement, type ModelRelation, type Value } from './model';
import type { Attribute, IdStrategy, Specification, TypeMapEntry } from './specification';

export interface InterpretedPersistence {
  readonly format: string;
  /** The binding `persistence.binding` names: the address of its FBL document, that document's file name, and the binding's name in it. */
  readonly binding?: { readonly document: string; readonly file: string; readonly name: string };
  readonly ids: IdStrategy & Required<Pick<IdStrategy, 'strategy' | 'encoding' | 'stable' | 'pattern' | 'missing' | 'compare'>>;
  /** By the binding's type names. A type that is not listed keeps its name and its attributes' names. */
  readonly typeMap: Readonly<Record<string, TypeMapEntry>>;
  /** What of the view is stored, and what each viewer keeps (DISL 11.6). */
  readonly view: { readonly store: readonly string[]; readonly viewer: readonly string[] };
}

const outside = ['diagram', 'header', 'unreadable'];

/** Interprets `persistence`, with the defaults of DISL 11.2 and 11.5 filled in. */
export function interpretPersistence(specification: Specification, metamodel: Metamodel): Loaded<InterpretedPersistence> {
  const findings: Finding[] = [];
  const declared = specification.persistence ?? {};
  const format = declared.format ?? 'json';
  const problem = (message: string): void => void findings.push(finding('disl.persistence', 'error', message));

  let binding: InterpretedPersistence['binding'];
  if (format !== 'fbl') problem(`The specification stores its model as \`${format}\`, and this add-on reads a model through an FBL binding only.`);
  else if (typeof declared.binding !== 'string' || !declared.binding.includes('#')) problem('The specification does not name its FBL binding as an address and a name.');
  else {
    const hash = declared.binding.lastIndexOf('#');
    const document = declared.binding.slice(0, hash);
    binding = { document, file: document.slice(document.lastIndexOf('/') + 1), name: declared.binding.slice(hash + 1) };
  }

  const typeMap = declared.typeMap ?? {};
  for (const [name, entry] of Object.entries(typeMap)) {
    if (!outside.includes(entry.as) && !(entry.as in metamodel.types)) problem(`\`typeMap\` reads \`${name}\` as \`${entry.as}\`, which is not a type of this specification.`);
  }

  const ids: InterpretedPersistence['ids'] = { strategy: 'uuid-v7', encoding: 'hex', stable: true, pattern: '^[A-Za-z0-9_.:#-]{1,128}$', missing: 'assign', compare: 'exact', ...declared.ids };
  if (ids.strategy !== 'uuid-v4') findings.push(finding('disl.persistence', 'warning', `New elements get an id by the strategy \`uuid-v4\`, not by \`${ids.strategy}\`, which this add-on does not support.`));
  if (ids.types) findings.push(finding('disl.persistence', 'warning', 'The id rules for single types are not supported; every type follows the one rule.'));

  return { value: { format, binding, ids, typeMap, view: { store: declared.view?.store ?? [], viewer: declared.view?.viewer ?? [] } }, findings };
}

/** The binding the specification names, in the FBL document that was loaded for it. */
export const bindingOf = (persistence: InterpretedPersistence, document: FblDocument): FblBinding | undefined =>
  persistence.binding ? document.bindings.get(persistence.binding.name) : undefined;

/** A new id for an element of `type`: a version 4 UUID in the declared encoding, after the declared prefix (DISL 11.5.1). */
export function newId(persistence: InterpretedPersistence, type: string): string {
  const { encoding, prefix } = persistence.ids;
  const hex = crypto.randomUUID();
  const digits = hex.replace(/-/g, '');
  const text = encoding === 'base36' ? BigInt(`0x${digits}`).toString(36).padStart(25, '0')
    : encoding === 'base64url' ? btoa(String.fromCharCode(...(digits.match(/../g) ?? []).map((byte) => parseInt(byte, 16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      : hex;
  return (typeof prefix === 'string' ? prefix : prefix?.[type] ?? '') + text;
}

/** What `typeMap` says of a binding type: its entry, or the type under its own name. */
const entryOf = (persistence: InterpretedPersistence, type: string): TypeMapEntry =>
  Object.hasOwn(persistence.typeMap, type) ? persistence.typeMap[type] : { as: type };

const mapped = (entry: TypeMapEntry, name: string): string | null =>
  entry.attributes && Object.hasOwn(entry.attributes, name) ? entry.attributes[name] : name;

/**
 * Turns what the FBL library read into the model the metamodel types (DISL 11.2). It never throws:
 * an entry or a value that cannot be read becomes a finding and stays out of the model.
 *
 * - The library's findings are passed on, each with the element it lies in.
 * - An entry read `as: "unreadable"`, an entry of no type of the metamodel and a value that is not
 *   of its attribute's type are reported as `std.unreadableEntry`, with `detail.reason`.
 * - A relation's end and a reference that name nothing are left unset and reported as
 *   `std.references`, with `detail.missingId` and `detail.end`; that finding replaces the library's own.
 * - `std.duplicateId` gains `detail.id` and `detail.count`.
 */
export function readModel(reading: Pick<FblModel, 'elements' | 'findings' | 'unreadable'>, binding: FblBinding, metamodel: Metamodel, persistence: InterpretedPersistence): Loaded<Model> {
  if (reading.unreadable) return { value: emptyModel, findings: reading.findings };

  const findings: Finding[] = [];
  const file = reading.findings[0]?.location.file ?? 'body';
  const at = (entry: FblElement): Finding['location'] => ({ file, line: entry.line, column: 1, length: 0 });
  const unreadable = (entry: FblElement, reason: string, element?: string): void => void findings.push({
    code: findingCodes.unreadableEntry, severity: 'warning', message: reason, location: at(entry), element, detail: { reason },
  });

  const diagram: Record<string, Value> = {};
  const elements: ModelElement[] = [];
  const relations: ModelRelation[] = [];
  const inModel = new Map<FblElement, string>();
  const read = (entry: FblElement, entryMap: TypeMapEntry, type: string, into: Record<string, Value>, host?: Record<string, unknown>): Partial<Record<'id' | 'source' | 'target', string>> => {
    const named: Partial<Record<'id' | 'source' | 'target', string>> = {};
    const attributes = attributesOf(metamodel, type);
    for (const [name, stored] of Object.entries(entry.attributes)) {
      const target = mapped(entryMap, name);
      if (entryMap.hostAttributes?.includes(name)) { if (host) host[name] = stored; }
      else if (target === null || stored === null || stored === undefined) continue;
      else if (target === 'id' || target === 'source' || target === 'target') named[target] = String(stored);
      else if (!Object.hasOwn(attributes, target)) { if (host) host[name] = stored; }
      else {
        const value = fromStored(stored, attributes[target], metamodel);
        if (value === undefined) unreadable(entry, `\`${name}\` of \`${entry.id}\` is not a value of the type \`${attributes[target].type}\`, so it is not read: ${text(stored)}`, type === 'diagram' ? undefined : entry.id);
        else into[target] = value;
      }
    }
    return named;
  };

  for (const entry of reading.elements) {
    const entryMap = entryOf(persistence, entry.type);
    if (entryMap.as === 'header') continue;
    if (entryMap.as === 'unreadable') unreadable(entry, findRule(binding, entry.rule)?.readOnly || 'This entry cannot be read, so it is kept as it is.');
    else if (entryMap.as === 'diagram') read(entry, entryMap, 'diagram', diagram);
    else if (!(entryMap.as in metamodel.types)) unreadable(entry, `This entry is read as \`${entryMap.as}\`, which is not a type of this tool, so it is kept as it is.`);
    else {
      const attributes: Record<string, Value> = {};
      const host: Record<string, unknown> = {};
      const named = read(entry, entryMap, entryMap.as, attributes, host);
      // An attribute mapped to `id` is the element's id only where the library found none in the body.
      const element: ModelElement = { id: entry.idIsStored ? entry.id : named.id ?? entry.id, type: entryMap.as, attributes, host, parent: entry.parentId, ephemeral: !entry.idIsStored && named.id === undefined, line: entry.line };
      inModel.set(entry, element.id);
      if (isRelation(metamodel.types[entryMap.as])) relations.push({ ...element, source: named.source ?? entry.source, target: named.target ?? entry.target });
      else elements.push(element);
    }
  }

  // The entry a line lies in: the last one that begins at or before it.
  const owner = (line: number): FblElement | undefined => [...reading.elements].reverse().find((entry) => entry.line <= line);
  const dangling = new Map<string, Finding[]>();
  for (const found of reading.findings) {
    const entry = owner(found.location.line);
    const element = entry && inModel.get(entry);
    if (found.code === findingCodes.danglingReference && element !== undefined) dangling.set(element, [...(dangling.get(element) ?? []), found]);
    else if (found.code === findingCodes.duplicateId && entry) {
      const id = idAsStored(entry, binding);
      const count = reading.elements.filter((other) => idAsStored(other, binding) === id).length;
      findings.push({ ...found, element, detail: id === undefined ? undefined : { id, count } });
    } else findings.push({ ...found, element });
  }

  const ids = new Set([...elements, ...relations].map((element) => element.id));
  const missing = (element: ModelElement, end: string, id: string): void => {
    const reported = dangling.get(element.id)?.shift();
    findings.push({
      code: 'std.references', severity: 'error', message: `\`${element.id}\` refers to \`${id}\`, which is not in this document.`,
      location: reported?.location ?? { file, line: element.line, column: 1, length: 0 }, element: element.id, detail: { missingId: id, end },
    });
  };
  const resolved = <T extends ModelElement>(element: T): T => {
    const attributes: Record<string, Value> = { ...element.attributes };
    for (const [name, attribute] of Object.entries(attributesOf(metamodel, element.type))) {
      const id = attributes[name];
      if (typeof id !== 'string' || attribute.many === true || valueKind(metamodel, attribute.type).kind !== 'reference' || ids.has(id)) continue;
      missing(element, name, id);
      delete attributes[name];
    }
    return { ...element, attributes };
  };
  const end = (relation: ModelRelation, side: 'source' | 'target'): string | undefined => {
    const id = relation[side];
    if (id !== undefined && !ids.has(id)) missing(relation, side, id);
    return id !== undefined && ids.has(id) ? id : undefined;
  };

  const model: Model = {
    diagram,
    elements: elements.map(resolved),
    relations: relations.map((relation) => ({ ...resolved(relation), source: end(relation, 'source'), target: end(relation, 'target') })),
  };
  // In reading order (DISL 8.6); within a line, what this reading found comes before the library's.
  return { value: model, findings: findings.sort((a, b) => a.location.line - b.location.line) };
}

/**
 * The attributes of a model change in the binding's names and the FBL library's values: what
 * `readModel` did, the other way round. `type` is a type of the metamodel, or `diagram`; `source`
 * and `target` among the attributes are a relation's ends. An absent value is null, which empties
 * the attribute. Nothing when no type of the binding is read as `type`.
 */
export function toBinding(
  binding: FblBinding, metamodel: Metamodel, persistence: InterpretedPersistence, type: string, attributes: Readonly<Record<string, Value | undefined>>,
): { readonly type: string; readonly attributes: Readonly<Record<string, unknown>> } | undefined {
  const types = [...new Set([...binding.elements, ...binding.relations].map((rule) => rule.type))].filter((candidate) => entryOf(persistence, candidate).as === type);
  const names = (candidate: string): Map<string, string> => {
    const entry = entryOf(persistence, candidate);
    const rules = [...binding.elements, ...binding.relations].filter((rule) => rule.type === candidate);
    return new Map(rules.flatMap((rule) => rule.attributes.map(([name]) => [mapped(entry, name) ?? '', name] as const)));
  };
  // Several binding types may be read as one: the diagram's attributes may come from several entries.
  const wanted = Object.keys(attributes);
  const chosen = types.find((candidate) => wanted.every((name) => names(candidate).has(name) || name === 'source' || name === 'target')) ?? types[0];
  if (chosen === undefined) return undefined;
  const byName = names(chosen);
  const declared = attributesOf(metamodel, type);
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes)) {
    stored[byName.get(name) ?? name] = value === undefined || value === null ? null : Object.hasOwn(declared, name) ? toStored(value, declared[name], metamodel) : value;
  }
  return { type: chosen, attributes: stored };
}

/** A value the FBL library read, as the model holds it; nothing when it is not of the attribute's type. */
export function fromStored(stored: unknown, attribute: Attribute, metamodel: Metamodel): Value | undefined {
  const kind = valueKind(metamodel, attribute.type);
  const one = (value: unknown): Value | undefined => {
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean';
    if (kind.kind === 'enum') return scalar ? kind.enum.values.find((candidate) => candidate.stored === String(value))?.key ?? String(value) : undefined;
    if (kind.kind === 'reference') return scalar ? String(value) : undefined;
    if (kind.kind === 'struct') return plain(value);
    switch (kind.primitive) {
      case 'int': return typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value)) ? Number(value) : undefined;
      case 'number': return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) ? Number(value) : undefined;
      case 'bool': return typeof value === 'boolean' ? value : undefined;
      case 'yearMonth': return typeof value === 'string' ? parseYearMonth(value) : undefined;
      case 'json': case 'binary': return plain(value);
      default: return scalar ? String(value) : undefined;
    }
  };
  if (attribute.many !== true) return one(stored);
  if (!Array.isArray(stored)) return undefined;
  const items = stored.map(one);
  return items.every((item) => item !== undefined) ? (items as Value[]) : undefined;
}

/** A value of the model as the FBL library writes it: an integer is a `bigint`, a `yearMonth` its text, an enum value its stored form. */
export function toStored(value: Value, attribute: Attribute, metamodel: Metamodel): unknown {
  const kind = valueKind(metamodel, attribute.type);
  const one = (item: Value): unknown => {
    if (kind.kind === 'enum') return kind.enum.values.find((candidate) => candidate.key === item)?.stored ?? item;
    if (kind.kind !== 'primitive' || typeof item !== 'number') return item;
    if (kind.primitive === 'yearMonth') return formatYearMonth(item);
    return kind.primitive === 'int' && Number.isInteger(item) ? BigInt(item) : item;
  };
  return attribute.many === true && Array.isArray(value) ? value.map(one) : one(value);
}

// What the library read, as plain data: its integers are `bigint`s.
function plain(value: unknown): Value | undefined {
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => plain(item) ?? null);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, plain(item) ?? null]));
  return undefined;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, (_name, item: unknown) => (typeof item === 'bigint' ? Number(item) : item)) ?? '');

const sameSlot = (a: Slot, b: Slot): boolean => a.key === b.key && a.attribute === b.attribute && a.text === b.text && a.child === b.child && a.group === b.group && a.capture === b.capture;

// The id an entry holds in the body, which the library keeps only for the first holder: the value
// of the attribute that reads the slot the rule's id is read from.
function idAsStored(entry: FblElement, binding: FblBinding): string | undefined {
  if (entry.idIsStored) return entry.id;
  const rule = findRule(binding, entry.rule);
  const slot = rule?.id?.from;
  const name = slot && rule.attributes.find(([, attribute]) => sameSlot(attribute, slot))?.[0];
  const value = name === undefined ? undefined : entry.attributes[name];
  return value === undefined || value === null ? undefined : String(value);
}
