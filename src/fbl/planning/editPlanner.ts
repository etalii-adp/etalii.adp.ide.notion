import { allRules, attributeOf, isComputed, type AttributeBinding, type Rule, type Slot } from '../documents/types';
import { messages } from '../messages';
import { writtenText, type BodyReading } from '../rules/bodyReading';
import { absentSlot, RefusedException, refuse, type ReadElement, type SlotChange, type SlotRead } from '../rules/familyReader';
import type { Span } from '../span';
import type { ChangePosition, ModelChange } from './modelChange';
import { isEmpty, plain } from './newText';
import { Plan, type PlanResult } from './plan';

/**
 * Plans a model change as one edit (FBL 6.4): the splices of every attribute set, element added or
 * removed, in the body's own conventions, or the reason the change cannot be made. Planning writes
 * nothing; an open body applies what it plans.
 */
export function planEdit(reading: BodyReading, change: ModelChange): PlanResult {
  if (reading.unreadable) return { refused: messages.neverWritten };
  const readOnly = reading.binding.readOnly;
  if (readOnly !== undefined) return { refused: readOnly.length > 0 ? readOnly : messages.readOnlyFile };
  const plan = new Plan(reading);
  try {
    switch (change.kind) {
      case 'save':
        break;
      case 'set':
        planSet(plan, reading, change);
        break;
      case 'add':
        planAdd(plan, reading, change);
        break;
      case 'remove':
        planRemove(plan, reading, change.id);
        break;
      case 'move':
        planMove(plan, reading, change);
        break;
      case 'storeId':
        planStoreId(plan, reading, change);
        break;
      case 'retype':
        return { refused: messages.cannotRetype };
      default:
        throw new Error(messages.registrationEdit);
    }
    return { planned: plan.snapshot ? { splices: plan.ordered(), snapshot: true } : { splices: plan.ordered() } };
  } catch (error) {
    if (error instanceof RefusedException) return { refused: error.message };
    throw error;
  }
}

/** The element a change names; a change that names none is the caller's mistake. */
function elementOf(reading: BodyReading, id: string): ReadElement {
  const element = reading.find(id);
  if (!element) throw new Error(messages.noSuchElement(id));
  return element;
}

function refuseReadOnly(rule: Rule, gesture: string): void {
  if (rule.readOnly !== undefined) refuse(rule.readOnly.length > 0 ? rule.readOnly : messages.ruleReadOnly(rule.type, gesture));
}

// ---- set ----

/** The id of an entry that has none, written where its rule reads it from. */
function planStoreId(plan: Plan, reading: BodyReading, store: ModelChange & { kind: 'storeId' }): void {
  const element = elementOf(reading, store.id);
  refuseReadOnly(element.rule, 'changed');
  const from = element.rule.id?.from;
  if (!from) refuse(messages.noIdOfItsOwn(element.rule.type));
  if (element.idRead?.present === true) refuse(messages.hasIdAlready(element.rule.type));
  if (store.newId.length === 0 || reading.find(store.newId)) refuse(messages.cannotBeTheId(store.newId, element.rule.type));

  // The slot an id is read from, written as an attribute's is: the family puts it where an absent value goes.
  const binding: AttributeBinding = { key: from.key, attribute: from.attribute, child: from.child, group: from.group, text: false, flag: false, absent: new Map(), keepTimePrecision: false, htmlParagraphs: false };
  reading.family.write(plan, element, [{ attribute: 'id', binding, rule: element.rule, read: element.idRead ?? absentSlot, value: store.newId, isEmpty: false }]);
}

function planSet(plan: Plan, reading: BodyReading, set: ModelChange & { kind: 'set' }): void {
  const element = elementOf(reading, set.id);
  refuseReadOnly(element.rule, 'changed');
  const changes: SlotChange[] = [];
  let newKey: string | undefined;
  for (const [attribute, requested] of Object.entries(set.attributes)) {
    let value = requested;
    let rule: Rule;
    let binding: AttributeBinding | undefined;
    let read: SlotRead;
    if (element.isRelation && (attribute === 'source' || attribute === 'target')) {
      binding = attribute === 'source' ? element.rule.source : element.rule.target;
      value = elementOf(reading, plain(value)).key;
      read = (attribute === 'source' ? element.sourceRead : element.targetRead) ?? absentSlot;
      rule = element.rule;
    } else {
      ({ rule, binding } = bindingFor(reading, element, attribute));
      const known = rule === element.rule ? element.slots.get(attribute) : undefined;
      read = !binding ? absentSlot : known ?? reading.readSlot({ ...element.candidate, rule }, binding, element);
    }
    if (!binding) refuse(messages.attributeNotKept(element.rule.type, attribute));
    if (isComputed(binding) || binding.parent !== undefined || !read.writable) {
      refuse(read.reason !== undefined && read.reason.length > 0 ? read.reason : messages.attributeNotChanged(attribute, element.rule.type));
    }
    const empty = isEmpty(value) || (binding.flag && value === false);
    if (empty && !binding.flag && binding.empty === 'refuse') refuse(messages.attributeNotEmpty(attribute, element.rule.type));
    if (!read.present && !empty && !binding.flag && binding.absent.get(reading.family.familyName) === 'refuse') {
      refuse(messages.nothingToRewrite(reading.binding.name, slotName(binding)));
    }
    if (empty && !read.present && !binding.flag) continue;
    if (!empty && isKey(element, attribute, binding)) {
      const key = plain(value);
      if (key !== element.key) {
        if (reading.elements.some((other) => other !== element && other.rule === element.rule && other.key === key)) refuse(messages.alreadyNamed(element.rule.type, key));
        newKey = key;
      }
    }
    changes.push({ attribute, binding, rule, read, value, isEmpty: empty });
  }
  if (changes.length > 0) reading.family.write(plan, element, changes);
  if (newKey !== undefined) rewriteReferences(plan, reading, element, newKey);
  if (element.rule.snapshotUndo) plan.snapshot = true;
}

const slotName = (slot: Slot): string => slot.key ?? slot.attribute ?? slot.group ?? slot.capture ?? slot.child ?? 'value';

/**
 * The binding that stores `attribute` for the element: its own rule's, else that of another rule
 * that matches the same entry (an element given the attribute that makes it another type is written
 * by that type's rule, FBL 5.1).
 */
function bindingFor(reading: BodyReading, element: ReadElement, attribute: string): { rule: Rule; binding: AttributeBinding | undefined } {
  const own = attributeOf(element.rule, attribute);
  if (own) return { rule: element.rule, binding: own };
  for (const rule of allRules(reading.binding)) {
    const other = rule === element.rule ? undefined : attributeOf(rule, attribute);
    if (!other) continue;
    if (reading.family.candidates(rule).some((candidate) => candidate.entry === element.entry)) return { rule, binding: other };
  }
  return { rule: element.rule, binding: undefined };
}

function isKey(element: ReadElement, attribute: string, binding: AttributeBinding): boolean {
  if (attribute === element.keyAttribute) return true;
  const from = element.rule.id?.from;
  return element.keyAttribute === undefined && from !== undefined && sameSlot(from, binding);
}

const sameSlot = (a: Slot, b: Slot): boolean =>
  a.key === b.key && a.attribute === b.attribute && a.group === b.group && a.text === b.text && a.child === b.child && a.word === b.word && a.capture === b.capture;

/**
 * A rename (FBL 5.7): every reference to the old value is rewritten in the same edit, one
 * `rewrite-reference` splice each, word by word inside a group.
 */
function rewriteReferences(plan: Plan, reading: BodyReading, renamed: ReadElement, newKey: string): void {
  const oldKey = renamed.key;
  for (const other of reading.elements) {
    if (other.isRelation) {
      if (other.sourceElement === renamed) rewrite(plan, reading, other.sourceRead, oldKey, newKey);
      if (other.targetElement === renamed) rewrite(plan, reading, other.targetRead, oldKey, newKey);
    }
    for (const [name, binding] of other.rule.attributes) {
      if (!binding.reference || !binding.reference.to.includes(renamed.rule.name)) continue;
      if (other === renamed && name === renamed.keyAttribute) continue;
      const read = other.slots.get(name);
      if (!read?.present) continue;
      const words = read.words ?? [];
      if (words.length > 1 || (words.length === 1 && Array.isArray(other.attributes.get(name)))) {
        for (const word of words) {
          if (word.text !== oldKey) continue;
          rewrite(plan, reading, { value: word.text, span: word.span, present: true, writable: true, quote: word.quoted ? '"' : undefined }, oldKey, newKey);
        }
        continue;
      }
      rewrite(plan, reading, read, oldKey, newKey);
    }
  }
}

function rewrite(plan: Plan, reading: BodyReading, read: SlotRead | undefined, oldKey: string, newKey: string): void {
  if (!read?.present || !read.span || writtenText(read) !== oldKey || plan.touches(read.span)) return;
  plan.addAt('rewrite-reference', read.span, reading.family.format(read, undefined, newKey));
}

// ---- add ----

function planAdd(plan: Plan, reading: BodyReading, add: ModelChange & { kind: 'add' }): void {
  // A declared binding appends where its insert rule says; a position among siblings is a plugin's to honour.
  if (add.position !== undefined) refuse(messages.cannotAddAtPosition(add.type));
  const rules = allRules(reading.binding).filter((candidate) => candidate.type === add.type && (add.slot === undefined || candidate.parent?.slot === add.slot));
  if (rules.length === 0) refuse(messages.noPlaceForType(add.type));
  // Several rules may write one type (a cell's items are options or rows; a filter's conditions
  // are written at each level of nesting). The one meant is a rule the parent given can contain,
  // where any is, and among those the one that binds the most of the attributes given, the first
  // of them on a tie.
  const container = add.parent !== undefined ? reading.find(add.parent) : undefined;
  const insertable = rules.filter((candidate) => candidate.insert);
  const contained = insertable.filter((candidate) => container !== undefined && candidate.parent?.rules.includes(container.rule.name) === true);
  const bound = (candidate: Rule): number => Object.keys(add.attributes).filter((name) => attributeOf(candidate, name) !== undefined).length;
  let rule: Rule | undefined;
  for (const candidate of contained.length > 0 ? contained : insertable) {
    if (!rule || bound(candidate) > bound(rule)) rule = candidate;
  }
  if (!rule) {
    const reason = rules[0].readOnly;
    refuse(reason !== undefined && reason.length > 0 ? reason : messages.cannotBeAdded(add.type));
  }
  refuseReadOnly(rule, 'added');
  const values = new Map<string, unknown>();
  for (const [name, value] of Object.entries(add.attributes)) {
    if (rule.isRelation && (name === 'source' || name === 'target')) continue;
    values.set(name, value);
  }
  if (rule.insert!.when !== undefined && !reading.insertAllowed(rule.insert!.when, values)) refuse(messages.thisCannotBeAdded(add.type));
  // An attribute the add gives its empty value refuses the add when its binding says so, as a set of it does (FBL 6.2, 6.4).
  for (const [name, value] of values) {
    const binding = attributeOf(rule, name);
    if (binding && !binding.flag && binding.empty === 'refuse' && isEmpty(value)) refuse(messages.attributeNotEmpty(name, rule.type));
  }
  const source = rule.isRelation ? endOf(reading, add, 'source') : undefined;
  const target = rule.isRelation ? endOf(reading, add, 'target') : undefined;
  const parent = add.parent !== undefined ? elementOf(reading, add.parent) : undefined;
  if (parent && rule.parent && !rule.parent.rules.includes(parent.rule.name)) refuse(messages.cannotBePlacedInside(add.type, parent.rule.type));
  if (rule.id?.from && add.id !== undefined && reading.elements.some((element) => element.rule.id?.from !== undefined && element.id === add.id)) {
    refuse(messages.idTaken(add.id));
  }
  reading.family.insert(plan, { rule, id: add.id, values, parent, source, target });
  if (rule.snapshotUndo) plan.snapshot = true;
}

function endOf(reading: BodyReading, add: ModelChange & { kind: 'add' }, end: 'source' | 'target'): ReadElement {
  const value = add.attributes[end];
  if (value === null || value === undefined) refuse(messages.needsEnd(add.type, end));
  const id = plain(value);
  const element = reading.find(id);
  if (!element || element.isRelation) refuse(messages.endNamesNoElement(end, id));
  return element;
}

// ---- move ----

/**
 * A reorder among siblings (FBL 5.5, 6.4): the entry is removed where it is and inserted where it
 * goes, carrying its own bytes, its comments and unbound keys with it.
 */
function planMove(plan: Plan, reading: BodyReading, move: ModelChange & { kind: 'move' }): void {
  const element = elementOf(reading, move.id);
  refuseReadOnly(element.rule, 'moved');
  if (!element.rule.insert || !element.rule.remove) refuse(messages.cannotBeMoved(element.rule.type));
  const parent = move.parent !== undefined ? elementOf(reading, move.parent) : undefined;
  if (parent !== element.parent) refuse(messages.cannotMoveToAnotherParent(element.rule.type));
  const siblings = reading.elements.filter((other) => areSiblings(other, element));
  // The position is among the siblings once the element is taken out (FBL 11.2).
  const others = siblings.filter((other) => other !== element);
  const index = indexOf(move.position, others, element);
  if (index === siblings.indexOf(element)) return; // It is there already: no splice.
  reading.family.move(plan, element, others[index], others[others.length - 1]);
  if (element.rule.snapshotUndo) plan.snapshot = true;
}

/** Where a position puts an element among its siblings without it: before the one at the index, after the last without a position or past them. */
function indexOf(position: ChangePosition | undefined, others: readonly ReadElement[], element: ReadElement): number {
  if (!position) return others.length;
  if ('index' in position) return position.index < 0 || position.index > others.length ? others.length : position.index;
  const id = 'after' in position ? position.after : position.before;
  const at = others.findIndex((other) => other.id === id);
  if (at < 0) refuse(messages.noSuchSibling(id, element.rule.type));
  return 'after' in position ? at + 1 : at;
}

/**
 * Whether two elements are ordered among each other: the same parent and containment slot, and at
 * the top level, where there is neither, the same type.
 */
const areSiblings = (other: ReadElement, element: ReadElement): boolean =>
  other.parent === element.parent
  && other.rule.parent?.slot === element.rule.parent?.slot
  && (element.parent !== undefined || other.rule.type === element.rule.type);

// ---- remove ----

function planRemove(plan: Plan, reading: BodyReading, id: string): void {
  const element = elementOf(reading, id);
  refuseReadOnly(element.rule, 'removed');
  const settings = element.rule.remove;
  if (!settings) refuse(messages.cannotBeRemoved(element.rule.type));
  const removed = new Set<ReadElement>([element]);
  for (const other of reading.elements) {
    if (other === element || !settings.cascade.includes(other.rule.name)) continue;
    if (references(other, element)) removed.add(other);
  }
  const all = [...removed];
  const outermost = all
    .filter((candidate) => !all.some((other) => other !== candidate && contains(other.entry.removalSpan, candidate.entry.removalSpan)))
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.entry.own.start - a.candidate.entry.own.start || a.index - b.index)
    .map(({ candidate }) => candidate);
  for (const target of outermost) reading.family.remove(plan, target, removed);
  if (all.some((candidate) => candidate.rule.snapshotUndo)) plan.snapshot = true;
}

const contains = (outer: Span, inner: Span): boolean => outer.start <= inner.start && inner.end <= outer.end && !(outer.start === inner.start && outer.end === inner.end);

function references(other: ReadElement, element: ReadElement): boolean {
  if (other.isRelation && (other.sourceElement === element || other.targetElement === element)) return true;
  for (const [name, binding] of other.rule.attributes) {
    if (!binding.reference || !binding.reference.to.includes(element.rule.name) || other === element) continue;
    const value = other.attributes.get(name);
    if (Array.isArray(value) ? value.some((item) => plain(item) === element.key) : plain(value) === element.key) return true;
  }
  return false;
}
