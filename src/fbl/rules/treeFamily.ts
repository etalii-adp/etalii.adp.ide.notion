import { scalarText } from '../documents/jsonReader';
import { slotText, type HeaderSettings, type Rule, type Slot } from '../documents/types';
import type { CelMap } from '../expressions/cel';
import { messages } from '../messages';
import type { Span } from '../span';
import { absentSlot, Entry, FamilyReader, readOnlyAbsent, type Candidate, type SlotRead, type SplicePlan } from './familyReader';
import { select, selectorStart } from './selector';

export type ValueKind = 'scalar' | 'mapping' | 'sequence';

/** How a value is written: FBL 6.3 keeps a replaced value's style when the new value fits it. */
export type ValueStyle = 'plain' | 'single' | 'double' | 'literal' | 'folded' | 'flowSequence' | 'flowMapping' | 'block' | 'empty' | 'jsonString' | 'jsonOther';

/** A value of a yaml or json tree (FBL 4.1.1): a scalar, a mapping or a sequence, with its span as written. */
export class TreeValue {
  /** The members of a mapping or the items of a sequence, in order. */
  readonly entries: TreeEntry[] = [];

  /** yaml: the mappings a `<<` key merges into this one, for reading. */
  readonly merged: TreeValue[] = [];

  constructor(
    readonly kind: ValueKind,
    readonly style: ValueStyle,
    /** The value as written: quotes included; a block collection from its first to its last entry's last byte. */
    public span: Span,
    /** A scalar's text, decoded. */
    readonly text = '',
    /** A scalar's value by the YAML 1.2 core schema or JSON's types: a string, a bigint, a number, a boolean or null. */
    readonly typed: unknown = null,
    /** A flow collection's members as CEL sees them: readable, but writable only as a whole (FBL 4.3). */
    readonly flow: unknown = undefined,
    /** Reached through an alias or a merge key: readable, never writable (FBL 4.3). */
    readonly viaAlias = false,
  ) {}

  member(key: string): TreeEntry | undefined {
    return this.entries.find((entry) => entry.name === key);
  }
}

/** A mapping member, a sequence item, or the document root (FBL 4.1.1). */
export class TreeEntry extends Entry {
  /** json: the offset of the comma after this entry, or -1. */
  separator = -1;

  constructor(
    own: Span,
    name: string | undefined,
    indent: number,
    public value: TreeValue,
    /** A member's key as written, quotes included. */
    readonly keySpan?: Span,
    readonly isRoot = false,
  ) {
    super(own, name, indent);
  }

  get isItem(): boolean {
    return !this.isRoot && !this.keySpan;
  }
}

/** A tree value as CEL sees it (FBL 4.1.4). */
export function celOf(value: TreeValue): unknown {
  switch (value.kind) {
    case 'mapping': {
      const map: CelMap = new Map();
      for (const merged of value.merged) {
        const inherited = celOf(merged);
        if (inherited instanceof Map) for (const [key, member] of inherited) map.set(key, member);
      }
      for (const member of value.entries) {
        if (member.name !== undefined && member.name !== '<<') map.set(member.name, celOf(member.value));
      }
      return map;
    }
    case 'sequence':
      return value.entries.map((entry) => celOf(entry.value));
    default:
      return value.flow !== undefined && value.flow !== null ? value.flow : value.typed;
  }
}

/** What yaml and json share: selectors, CEL values and reading keys (FBL 4.2, 4.1.4, 5.2). */
export abstract class TreeFamily extends FamilyReader {
  protected readonly allEntries: Entry[] = [];

  root?: TreeEntry;

  get entries(): readonly Entry[] {
    return this.allEntries;
  }

  get treeEntries(): TreeEntry[] {
    return this.allEntries as TreeEntry[];
  }

  candidates(rule: Rule): Candidate[] {
    if (rule.at === undefined || !this.root) return [];
    return select(this.root, rule.at).map(({ entry, captures }) => ({ rule, entry, captures }));
  }

  override enclosing(entry: Entry): Entry[] {
    const found: Entry[] = [];
    for (let parent = entry.parent; parent; parent = parent.parent) {
      if ((parent as TreeEntry).isRoot) break;
      found.push(parent);
    }
    return found;
  }

  celValue(candidate: Candidate): unknown {
    return celOf((candidate.entry as TreeEntry).value);
  }

  celExtra(candidate: Candidate): { name: string; value: unknown } {
    return { name: 'path', value: new Map(candidate.captures) };
  }

  headerHolds(header: HeaderSettings): boolean {
    if (header.key === undefined) return true;
    const member = this.root?.value.member(header.key);
    if (!member) return false;
    if (!header.value) return true;
    return scalarText(header.value) === member.value.text;
  }

  /** The mapping a slot is read in: the entry's own, or the one `child` reaches from it. */
  protected mapping(entry: TreeEntry, child: string | undefined): TreeValue | undefined {
    if (child === undefined) return entry.value.kind === 'mapping' ? entry.value : undefined;
    const reached = select(entry, child)[0]?.entry as TreeEntry | undefined;
    return reached?.value.kind === 'mapping' ? reached.value : undefined;
  }

  read(candidate: Candidate, slot: Slot): SlotRead {
    const entry = candidate.entry as TreeEntry;
    if (slot.capture !== undefined) {
      const key = candidate.captures.get(slot.capture);
      if (key === undefined) return absentSlot;
      for (let tree: TreeEntry | undefined = entry; tree; tree = tree.parent as TreeEntry | undefined) {
        if (tree.name === key && tree.keySpan) return { value: key, span: tree.keySpan, present: true, writable: true, node: tree };
      }
      return { value: key, present: true, writable: false, reason: messages.capturedKeyNotFound };
    }
    if (slot.key === undefined) return readOnlyAbsent(messages.entryHasNoSlot(this.familyName, slotText(slot)));
    const mapping = this.mapping(entry, slot.child);
    if (!mapping) return absentSlot;
    return readMember(mapping, slot.key);
  }

  readRaw(entry: Entry, name: string): SlotRead {
    const tree = entry as TreeEntry;
    return tree.value.kind === 'mapping' ? readMember(tree.value, name) : absentSlot;
  }

  /** The container entry an insert's `container` selector names, from the root or the parent entry. */
  protected container(selector: string, parent: Entry | undefined, captures: ReadonlyMap<string, string>): TreeEntry | undefined {
    if (!this.root) return undefined;
    const resolved = selector.split('/').map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? captures.get(segment.slice(1, -1)) ?? segment : segment)).join('/');
    if (resolved.startsWith('/') && resolved.replace(/^\/+|\/+$/g, '').length === 0) return this.root;
    const start = selectorStart(resolved, this.root, parent);
    return select(start, resolved)[0]?.entry as TreeEntry | undefined;
  }

  /** The captures the binding's existing entries bound, so `{capture}` segments of a container resolve (FBL 6.2). */
  protected capturesOf(plan: SplicePlan): ReadonlyMap<string, string> {
    return plan.reading.elements.map((element) => element.candidate.captures).find((captures) => captures.size > 0) ?? new Map();
  }

  protected index(entry: TreeEntry): void {
    this.allEntries.push(entry);
    for (const child of entry.value.entries) {
      child.parent = entry;
      entry.children.push(child);
      this.index(child);
    }
  }
}

export function readMember(mapping: TreeValue, name: string): SlotRead {
  const member = mapping.member(name);
  if (member) {
    const writable = !member.value.viaAlias && member.value.kind === 'scalar';
    const reason = member.value.viaAlias ? messages.valueViaAlias : writable ? undefined : messages.valueIsCollection;
    return {
      value: celOf(member.value),
      span: member.value.span,
      present: true,
      writable,
      reason,
      node: member,
      wire: member.value.kind === 'scalar' ? member.value.text : undefined,
    };
  }
  for (const merged of mapping.merged) {
    const inherited = merged.member(name);
    if (inherited) return { value: celOf(inherited.value), span: inherited.value.span, present: true, writable: false, reason: messages.valueViaMerge, node: inherited };
  }
  return { ...absentSlot, node: mapping };
}
