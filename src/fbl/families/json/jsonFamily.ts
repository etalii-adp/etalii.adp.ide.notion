import { JsonSyntaxError, numberValue, readJson, type JsonNode } from '../../documents/jsonReader';
import { attributeOf, type AttributeBinding } from '../../documents/types';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import { formatNumber, isNumber, plain, render, wire } from '../../planning/newText';
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
      const { offset, text } = this.newMember(mapping, `${quote(change.binding.key)}: ${this.format(read, change.binding, change.value)}`);
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
    const container = settings.container === undefined ? undefined : this.container(settings.container, request.parent?.entry, this.capturesOf(plan));
    if (!container || container.value.kind === 'scalar') refuse(messages.jsonNoContainer(this.binding.name, settings.container, request.rule.type));
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
      for (const key of settings.keys) {
        const value = wireValue(request, key);
        if (value !== undefined) members.push(`${quote(key)}: ${value}`);
      }
      text = `{ ${members.join(', ')} }`;
    }
    if (settings.place === 'start' && container.value.entries.length > 0) {
      const first = container.value.entries[0];
      plan.add('insert-entry', first.own.start, first.own.start, text + (first.lineSpan ? `,${this.newlineAt(first.own.start)}${this.indentation(first.indent)}` : ', '));
      return;
    }
    const { offset, text: inserted } = this.newMember(container.value, text);
    plan.add('insert-entry', offset, offset, inserted);
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

  remove(plan: SplicePlan, element: ReadElement): void {
    const entry = element.entry as TreeEntry;
    if (entry.isRoot) refuse(messages.wholeFile(this.binding.name));
    plan.addAt('remove-entry', this.removalSpan(entry), '');
  }
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
    const value = request.values.get(name);
    if (binding.key === key && binding.child === undefined && value !== null && value !== undefined) return writeJson(value, binding);
  }
  return undefined;
}
