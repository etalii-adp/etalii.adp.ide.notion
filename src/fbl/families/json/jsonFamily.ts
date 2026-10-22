import { JsonSyntaxError, numberValue, readJson, type JsonNode } from '../../documents/jsonReader';
import { attributeOf, wireOrder, type AttributeBinding, type InsertSettings } from '../../documents/types';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import { formatNumber, isEmpty, isNumber, keepsEmpty, plain, render, wire } from '../../planning/newText';
import { refuse, type InsertRequest, type ReadElement, type SlotChange, type SlotRead, type SplicePlan } from '../../rules/familyReader';
import { TreeEntry, TreeFamily, TreeValue } from '../../rules/treeFamily';
import type { Span } from '../../span';

const SPACE = 0x20;
const TAB = 0x09;
const COMMA = 0x2c;

/**
 * The `json` family (FBL 4.4): an RFC 8259 text read byte for byte, members and items with their
 * own spans and the separator after each, comments refused, duplicate names reported.
 */
export class JsonFamily extends TreeFamily {
  private readonly leafSpans: Span[] = [];

  readonly familyName = 'json';

  get leaves(): readonly Span[] {
    return this.leafSpans;
  }

  isTrivia(gap: Span): boolean {
    for (let i = gap.start; i < gap.end; i++) {
      if (!' \t\r\n{}[],:'.includes(String.fromCharCode(this.text.bytes[i]))) return false;
    }
    return true;
  }

  parse(): void {
    let node: JsonNode;
    try {
      node = readJson(this.text.bytes, this.text.bomLength, false);
    } catch (error) {
      if (!(error instanceof JsonSyntaxError)) throw error;
      this.unreadable = { offset: error.offset, message: error.message };
      return;
    }
    const value = this.treeOf(node);
    this.root = new TreeEntry(value.span, undefined, this.column(value.span.start), value, undefined, true);
    this.index(this.root);
    for (const entry of this.treeEntries) {
      if (!entry.isRoot) entry.lineSpan = this.lineSpanOf(entry);
    }
  }

  /** The tree a JSON node is read as: the first member of a name is kept, a second one reported. */
  private treeOf(node: JsonNode): TreeValue {
    switch (node.kind) {
      case 'object': {
        const value = new TreeValue('mapping', 'block', node.span);
        for (const member of node.members) {
          this.leafSpans.push(member.keySpan);
          const inner = this.treeOf(member.value);
          if (member.duplicate) {
            this.report(findingCodes.duplicateKey, 'warning', messages.jsonDuplicateMember(member.name), member.keySpan);
            continue;
          }
          const entry = new TreeEntry({ start: member.keySpan.start, end: inner.span.end }, member.name, this.column(member.keySpan.start), inner, member.keySpan);
          entry.separator = member.comma;
          value.entries.push(entry);
        }
        return value;
      }
      case 'array': {
        const value = new TreeValue('sequence', 'block', node.span);
        for (const item of node.items) {
          const inner = this.treeOf(item.value);
          const entry = new TreeEntry(inner.span, undefined, this.column(inner.span.start), inner);
          entry.separator = item.comma;
          value.entries.push(entry);
        }
        return value;
      }
      case 'string':
        this.leafSpans.push(node.span);
        return new TreeValue('scalar', 'jsonString', node.span, node.value, node.value);
      case 'number':
        this.leafSpans.push(node.span);
        return new TreeValue('scalar', 'jsonOther', node.span, node.raw, numberValue(node.raw));
      default:
        this.leafSpans.push(node.span);
        return new TreeValue('scalar', 'jsonOther', node.span, node.kind, node.kind === 'null' ? null : node.kind === 'true');
    }
  }

  private column(offset: number): number {
    const index = this.text.lineIndexAt(offset);
    return offset - Math.max(this.text.lines[index].start, index === 0 ? this.text.bomLength : 0);
  }

  /**
   * An entry starts its line when only whitespace precedes it, and ends it when only its separator
   * and whitespace follow; its line span then takes the separator with it.
   */
  private lineSpanOf(entry: TreeEntry): Span | undefined {
    if (!this.onlyWhitespaceBefore(entry.own.start)) return undefined;
    const bytes = this.text.bytes;
    let i = entry.own.end;
    const line = this.text.lines[this.text.lineIndexAt(Math.max(entry.own.start, i - 1))];
    while (i < line.contentEnd && (bytes[i] === SPACE || bytes[i] === TAB)) i++;
    if (i < line.contentEnd && bytes[i] === COMMA) i++;
    while (i < line.contentEnd && (bytes[i] === SPACE || bytes[i] === TAB)) i++;
    if (i !== line.contentEnd) return undefined;
    return { start: this.text.lines[this.text.lineIndexAt(entry.own.start)].start, end: line.end };
  }

  // ---- writing ----

  format(read: SlotRead, binding: AttributeBinding | undefined, value: unknown): string {
    const wired = binding ? wire(binding, value, read.wire) : undefined;
    return wired !== undefined ? quote(wired) : writeJson(value, binding);
  }

  write(plan: SplicePlan, element: ReadElement, changes: readonly SlotChange[]): void {
    for (const change of changes) {
      const read = change.read;
      if (change.isEmpty && change.binding.empty === 'remove') {
        if (read.node instanceof TreeEntry) plan.addAt('remove-key', this.removalSpan(read.node), '');
        continue;
      }
      if (read.present && read.span) {
        const written = this.format(read, change.binding, change.value);
        if (written !== this.text.textOf(read.span)) plan.addAt('replace-value', read.span, written);
        continue;
      }
      const mapping = this.mapping(element.entry as TreeEntry, change.binding.child);
      if (!mapping || change.binding.key === undefined) refuse(messages.jsonNoObject(this.binding.name, change.binding.key ?? ''));
      const added = `${quote(change.binding.key)}: ${this.format(read, change.binding, change.value)}`;
      const before = memberBefore(mapping, change.binding.key, wireOrder(change.rule));
      const { offset, text } = before
        ? { offset: before.own.end, text: (before.lineSpan ? `,${this.newlineAt(before.own.end)}${this.indentation(before.indent)}` : ', ') + added }
        : this.newMember(mapping, added);
      plan.add('insert-key', offset, offset, text);
    }
  }

  /** A new member or item after a container's last entry, with the previous entry's separator (FBL 6.3). */
  private newMember(container: TreeValue, text: string): { offset: number; text: string } {
    if (container.entries.length === 0) return { offset: container.span.start + 1, text };
    const last = container.entries[container.entries.length - 1];
    if (last.lineSpan) return { offset: last.own.end, text: `,${this.newlineAt(last.own.end)}${this.indentation(last.indent)}${text}` };
    return { offset: last.own.end, text: `, ${text}` };
  }

  insert(plan: SplicePlan, request: InsertRequest): void {
    const settings = request.rule.insert!;
    // FBL 6.2's place {before: key} is not built here yet; refused, as the lines family does, and not placed at the end.
    if (settings.place === 'before') refuse(messages.cannotPlace(this.familyName, settings.place));
    const container = settings.container === undefined ? undefined : this.container(settings.container, request.parent?.entry, this.capturesOf(plan));
    // The entry beside which the new one is written, whose layout it takes (FBL 6.3).
    const siblings = container?.value.kind === 'scalar' ? [] : container?.value.entries ?? [];
    const beside = settings.place === 'start' ? siblings[0] : siblings[siblings.length - 1];
    let text: string;
    if (settings.emit !== undefined) {
      text = render(settings.emit, (name) => {
        switch (name) {
          case 'id': return request.id === undefined ? undefined : escape(request.id);
          case 'source': return request.source ? escape(request.source.key) : undefined;
          case 'target': return request.target ? escape(request.target.key) : undefined;
          default: {
            const value = request.values.get(name);
            return value !== null && value !== undefined ? escape(plain(value, attributeOf(request.rule, name))) : undefined;
          }
        }
      });
    } else {
      const members: string[] = [];
      // A constant is written as it is, as its JSON type: at its place in `insert.keys` when they name
      // it, else after the other keys, in the constant's member order (FBL 0.8 6.2).
      const constant = new Map(settings.constant ?? []);
      for (const key of settings.keys) {
        const value = constant.has(key) ? writeJson(constant.get(key), undefined) : wireValue(request, key);
        if (value !== undefined) members.push(`${quote(key)}: ${value}`);
      }
      for (const [key, value] of constant) {
        if (!settings.keys.includes(key)) members.push(`${quote(key)}: ${writeJson(value, undefined)}`);
      }
      text = this.newObject(members, beside);
    }
    if (!container) {
      const created = newContainer(settings, request.parent?.entry as TreeEntry | undefined);
      if (!created) refuse(messages.jsonNoContainer(this.binding.name, settings.container, request.rule.type));
      // A container that encloses its entries on one line cannot be written before an entry that
      // goes inside it, so it is created as its opening and its closing with the entry between
      // them, all three at one offset (FBL 6.2).
      plan.add('ensure-container', created.offset, created.offset, created.opening);
      plan.add('insert-entry', created.offset, created.offset, text);
      plan.add('ensure-container', created.offset, created.offset, ']');
      return;
    }
    if (container.value.kind === 'scalar') refuse(messages.jsonNoContainer(this.binding.name, settings.container, request.rule.type));
    if (settings.place === 'start' && container.value.entries.length > 0) {
      const first = container.value.entries[0];
      plan.add('insert-entry', first.own.start, first.own.start, text + (first.lineSpan ? `,${this.newlineAt(first.own.start)}${this.indentation(first.indent)}` : ', '));
      return;
    }
    const { offset, text: inserted } = this.newMember(container.value, text);
    plan.add('insert-entry', offset, offset, inserted);
  }

  /**
   * A new object entry with its members (FBL 6.3): one member on each line, indented as the
   * members of the entry it is written beside, when that entry is an object written so; else on one
   * line, as an entry beside none or beside one written on one line is.
   */
  private newObject(members: readonly string[], beside: TreeEntry | undefined): string {
    const model = beside?.value.kind === 'mapping' ? beside.value.entries[0] : undefined;
    if (!beside || !model?.lineSpan || members.length === 0) return `{ ${members.join(', ')} }`;
    const newline = this.newlineAt(beside.own.end);
    return `{${newline}${members.map((member) => this.indentation(model.indent) + member).join(`,${newline}`)}${newline}${this.indentation(beside.indent)}}`;
  }

  /**
   * What removing an entry takes (FBL 6.2): its line span when it has one and is not the last of
   * several, else its own span with one separator: the one after it, or, for the last entry, the
   * one before it and the whitespace in between.
   */
  private removalSpan(entry: TreeEntry): Span {
    const siblings = (entry.parent as TreeEntry).value.entries;
    const index = siblings.indexOf(entry);
    const isLast = index === siblings.length - 1;
    if (isLast && index > 0) return { start: siblings[index - 1].separator, end: entry.own.end };
    if (entry.lineSpan) return entry.lineSpan;
    if (!isLast) return { start: entry.own.start, end: siblings[index + 1].own.start };
    return entry.own;
  }

  /**
   * A move among siblings in json (FBL 5.5): the entry is removed with the one separator a removal
   * takes, and its own bytes are inserted with the separator its new place needs: after it when
   * another entry follows, before it when it becomes the last.
   */
  override move(plan: SplicePlan, element: ReadElement, before: ReadElement | undefined, last: ReadElement): void {
    const entry = element.entry as TreeEntry;
    const own = this.text.textOf(entry.own);
    plan.addAt('remove-entry', this.removalSpan(entry), '');
    if (before) {
      const next = before.entry as TreeEntry;
      if (next.lineSpan) {
        const start = next.lineSpan.start;
        plan.add('insert-entry', start, start, `${this.indentation(next.indent)}${own},${this.newlineAt(start)}`);
        return;
      }
      plan.add('insert-entry', next.own.start, next.own.start, `${own}, `);
      return;
    }
    const tail = last.entry as TreeEntry;
    const inserted = tail.lineSpan ? `,${this.newlineAt(tail.own.end)}${this.indentation(tail.indent)}${own}` : `, ${own}`;
    plan.add('insert-entry', tail.own.end, tail.own.end, inserted);
  }

  remove(plan: SplicePlan, element: ReadElement): void {
    const entry = element.entry as TreeEntry;
    if (entry.isRoot) refuse(messages.wholeFile(this.binding.name));

    // The only entry of a container that goes when it is left empty (FBL 6.2): the container goes
    // with it, as what is before the entry, the entry itself, and what is after it.
    const container = entry.parent as TreeEntry | undefined;
    if (element.rule.remove?.removeContainerWhenEmpty === true && container && !container.isRoot && container.parent instanceof TreeEntry && container.value.entries.length === 1) {
      // The container goes as it was created (FBL 6.2): with the separator before it, where a
      // member stands before it, so that removing what an insert created leaves the bytes the
      // insert started from. Only a first member takes the separator after it instead.
      const members = container.parent.value.entries;
      const at = members.indexOf(container);
      const start = at > 0 ? members[at - 1].own.end : container.own.start;
      const end = at === 0 && members.length > 1 ? members[1].own.start : container.own.end;
      plan.add('remove-container', start, entry.own.start, '');
      plan.addAt('remove-entry', entry.own, '');
      plan.add('remove-container', entry.own.end, end, '');
      return;
    }

    plan.addAt('remove-entry', this.removalSpan(entry), '');
  }
}

/**
 * The member a new `key` is written right after: the nearest one before it in the rule's key order
 * (FBL 6.1, "at the position `insert.keys` gives"). Nothing when the order does not place the key,
 * or places it after every member, and it goes last.
 */
function memberBefore(mapping: TreeValue, key: string, order: readonly string[]): TreeEntry | undefined {
  const position = order.indexOf(key);
  if (position < 0) return undefined;
  let before: TreeEntry | undefined;
  for (const entry of mapping.entries) {
    const at = entry.name === undefined ? -1 : order.indexOf(entry.name);
    if (at >= 0 && at < position) before = entry;
  }
  return !before || before === mapping.entries[mapping.entries.length - 1] ? undefined : before;
}

/**
 * Where a missing container is created and how it opens (FBL 6.2 `create`): a list under the
 * selector's last name, right after the member `create.at.after` names in the parent entry's
 * object, or after that object's last member for `create.at: "end"` (FBL 0.4). Nothing when the
 * rule creates no container, or creates it in a way this family does not write yet: anywhere but
 * after a member that stands on one line with its siblings.
 */
function newContainer(settings: InsertSettings, parent: TreeEntry | undefined): { offset: number; opening: string } | undefined {
  const selector = settings.container;
  const create = settings.create;
  if (selector === undefined || !create || (create.at !== 'after' && create.at !== 'end') || create.text !== undefined || selector.startsWith('/')) return undefined;
  const mapping = parent?.value;
  if (!mapping || mapping.kind !== 'mapping' || mapping.entries.length === 0) return undefined;
  // "end" is after the last member of the container's parent; "after" names the member.
  const member = create.at === 'end' ? mapping.entries[mapping.entries.length - 1] : create.argument !== undefined ? mapping.member(create.argument) : undefined;
  if (!member || member.lineSpan) return undefined;
  const trimmed = selector.replace(/\/+$/, '');
  return { offset: member.own.end, opening: `, ${quote(trimmed.slice(trimmed.lastIndexOf('/') + 1))}: [` };
}

/** A value as JSON writes it. */
export function writeJson(value: unknown, binding: AttributeBinding | undefined): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isNumber(value)) return formatNumber(value, binding?.decimals);
  if (Array.isArray(value)) return `[${value.map((item) => writeJson(item, binding)).join(', ')}]`;
  return quote(String(value));
}

/** A JSON string with the escapes RFC 8785 uses (FBL 6.3). */
export const quote = (value: string): string => `"${escape(value)}"`;

export function escape(value: string): string {
  let text = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const code = value.charCodeAt(i);
    switch (code) {
      case 0x22: text += '\\"'; break;
      case 0x5c: text += '\\\\'; break;
      case 0x08: text += '\\b'; break;
      case 0x0c: text += '\\f'; break;
      case 0x0a: text += '\\n'; break;
      case 0x0d: text += '\\r'; break;
      case 0x09: text += '\\t'; break;
      default:
        text += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : c;
    }
  }
  return text;
}

function wireValue(request: InsertRequest, key: string): string | undefined {
  const rule = request.rule;
  if (rule.id?.from?.key === key && request.id !== undefined) return quote(request.id);
  if (rule.source?.key === key && request.source) return quote(request.source.key);
  if (rule.target?.key === key && request.target) return quote(request.target.key);
  for (const [name, binding] of rule.attributes) {
    if (binding.key !== key || binding.child !== undefined) continue;
    // An attribute the add does not give has no value; one it gives its empty value has its key by the binding's `empty` (FBL 6.2).
    if (!request.values.has(name)) continue;
    const value = request.values.get(name);
    if (isEmpty(value) && !keepsEmpty(binding, value)) continue;
    return writeJson(value, binding);
  }
  return undefined;
}
