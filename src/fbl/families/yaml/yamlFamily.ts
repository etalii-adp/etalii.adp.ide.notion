import { parseAllDocuments } from 'yaml';
import { attributeOf, isComputed, type AttributeBinding, type InsertSettings, type Rule, type Slot } from '../../documents/types';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import { formatNumber, isEmpty, isNumber, keepPrecision, plain, render, wire } from '../../planning/newText';
import { refuse, type Entry, type InsertRequest, type ReadElement, type SlotChange, type SlotRead, type SplicePlan } from '../../rules/familyReader';
import { TreeEntry, TreeFamily, TreeValue } from '../../rules/treeFamily';
import type { Span } from '../../span';
import { byteLength, trimEndOf } from '../../text/utf8';
import { YamlError, YamlParser } from './yamlParser';
import { doubleQuoted, isPlainSafe, singleQuoted } from './yamlScalars';

const HASH = 0x23;

/**
 * The `yaml` family (FBL 4.3): the bundled YAML parser decides whether the stream is well-formed,
 * the `YamlParser` reads the first document's structure and spans, and writing keeps each replaced
 * scalar's style and the body's indentation (FBL 6.3).
 */
export class YamlFamily extends TreeFamily {
  private leafSpans: Span[] = [];

  readonly familyName = 'yaml';

  get leaves(): readonly Span[] {
    return this.leafSpans;
  }

  parse(): void {
    const problem = this.wellFormed();
    if (problem) {
      this.unreadable = problem;
      return;
    }
    const parser = new YamlParser(this.text);
    try {
      const value = parser.parseDocument();
      this.root = new TreeEntry(value.span, undefined, 0, value, undefined, true);
      this.index(this.root);
    } catch (error) {
      if (!(error instanceof YamlError)) throw error;
      this.unreadable = { offset: error.offset, message: error.message };
      return;
    }
    this.leafSpans = parser.leaves;
    for (const { name, span } of parser.duplicates) {
      this.report(findingCodes.duplicateKey, 'warning', messages.yamlDuplicateKey(name), span);
    }
    for (const entry of this.treeEntries) {
      if (!entry.isRoot) entry.lineSpan = this.lineSpanOf(entry);
    }
  }

  /** The whole stream is read; a syntax error anywhere makes the body unreadable (FBL 4.3, 7.5). */
  private wellFormed(): { offset: number; message: string } | undefined {
    const content = this.text.text(this.text.bomLength, this.text.length);
    // A repeated key is FBL's warning fbl.duplicate-key, not an error.
    for (const document of parseAllDocuments(content, { uniqueKeys: false, prettyErrors: false, logLevel: 'silent' })) {
      const error = document.errors[0];
      if (!error) continue;
      const index = Math.min(Math.max(error.pos[0], 0), content.length);
      return { offset: this.text.bomLength + byteLength(content.slice(0, index)), message: messages.yamlNotWellFormed(error.message) };
    }
    return undefined;
  }

  /** Between leaves there is only whitespace, comments, indicators, anchors, tags and document markers. */
  isTrivia(gap: Span): boolean {
    const bytes = this.text.bytes;
    for (let i = gap.start; i < gap.end; i++) {
      const c = String.fromCharCode(bytes[i]);
      if (' \t\r\n:-?,.'.includes(c)) continue;
      if (c === '#' || c === '%') {
        while (i < gap.end && bytes[i] !== 0x0d && bytes[i] !== 0x0a) i++;
        continue;
      }
      if (c === '&' || c === '!') {
        while (i < gap.end && !' \t\r\n'.includes(String.fromCharCode(bytes[i]))) i++;
        continue;
      }
      return false;
    }
    return true;
  }

  /**
   * An entry's line span (FBL 4.1.1) when it starts and ends its lines: from its first line,
   * extended over the comment lines directly above it at its indentation, to the end of its last
   * line's ending, a trailing comment included.
   */
  private lineSpanOf(entry: TreeEntry): Span | undefined {
    if (!this.onlyWhitespaceBefore(entry.own.start)) return undefined;
    if (!this.onlyTriviaAfter(entry.own.end, HASH)) return undefined;
    const lines = this.text.lines;
    const first = this.text.lineIndexAt(entry.own.start);
    const last = this.text.lineIndexAt(Math.max(entry.own.start, entry.own.end - 1));
    let start = lines[first].start;
    for (let above = first - 1; above >= 0; above--) {
      const line = lines[above];
      let p = line.start;
      while (p < line.contentEnd && this.text.bytes[p] === 0x20) p++;
      if (p >= line.contentEnd || this.text.bytes[p] !== HASH || p - line.start !== entry.indent) break;
      start = line.start;
    }
    return { start, end: lines[last].end };
  }

  private lineEndAfter(entry: TreeEntry): number {
    return entry.lineSpan?.end ?? this.text.lines[this.text.lineIndexAt(Math.max(entry.own.start, entry.own.end - 1))].end;
  }

  // ---- new text (FBL 6.3) ----

  format(read: SlotRead, binding: AttributeBinding | undefined, value: unknown): string {
    const member = read.node instanceof TreeEntry ? read.node : undefined;
    const old = member?.value;
    const wired = binding ? wire(binding, value, read.wire) : undefined;
    const written = this.scalar(wired ?? value, old, binding, member?.indent ?? 0);
    return old?.style === 'empty' ? ` ${written}` : written;
  }

  private scalar(value: unknown, old: TreeValue | undefined, binding: AttributeBinding | undefined, keyIndent: number): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return this.string(value, old, binding, keyIndent);
    if (Array.isArray(value)) return `[${value.map((item) => this.scalar(item, undefined, binding, keyIndent)).join(', ')}]`;
    if (isNumber(value)) return formatNumber(value, binding?.decimals);
    return this.string(plain(value, binding), old, binding, keyIndent);
  }

  private string(text: string, old: TreeValue | undefined, binding: AttributeBinding | undefined, keyIndent: number): string {
    const timeTyped = binding?.keepTimePrecision === true;
    let value = text;
    if (timeTyped && old?.kind === 'scalar' && old.text.length > 0) value = keepPrecision(old.text, value) ?? value;
    const multiline = value.includes('\n') || value.includes('\r');
    switch (old?.style) {
      case 'plain':
        if (isPlainSafe(value, timeTyped)) return value;
        break;
      case 'single':
        if (!multiline) return singleQuoted(value);
        break;
      case 'double':
        return doubleQuoted(value);
      case 'literal':
        if (multiline) return this.literal(value, keyIndent);
        break;
    }
    switch (binding?.style) {
      case 'single':
        if (!multiline) return singleQuoted(value);
        break;
      case 'double':
        return doubleQuoted(value);
      case 'literal':
        if (multiline) return this.literal(value, keyIndent);
        break;
      case 'plain':
        if (isPlainSafe(value, timeTyped)) return value;
        break;
    }
    if (isPlainSafe(value, timeTyped)) return value;
    return this.binding.text.quote === 'single' && !multiline ? singleQuoted(value) : doubleQuoted(value);
  }

  /** A multi-line string written `|-`, its lines one step deeper than its key (FBL 6.3). */
  private literal(value: string, keyIndent: number): string {
    const newline = this.text.dominantEnding ?? this.binding.text.newline;
    const indent = this.indentation(keyIndent + this.step);
    return `|-${value.replaceAll('\r\n', '\n').split('\n').map((line) => newline + (line.length === 0 ? '' : indent + line)).join('')}`;
  }

  // ---- writing ----

  write(plan: SplicePlan, element: ReadElement, changes: readonly SlotChange[]): void {
    for (const change of changes) {
      const read = change.read;
      const member = read.node instanceof TreeEntry ? read.node : undefined;
      if (change.isEmpty && change.binding.empty === 'remove') {
        if (member) plan.addAt('remove-key', member.lineSpan ?? member.own, '');
        continue;
      }
      if (read.present && member) {
        const written = this.format(read, change.binding, change.value);
        if (written !== this.text.textOf(member.value.span)) plan.addAt('replace-value', member.value.span, written);
        continue;
      }
      const mapping = read.node instanceof TreeValue ? read.node : this.mapping(element.entry as TreeEntry, change.binding.child);
      if (!mapping || mapping.kind !== 'mapping' || change.binding.key === undefined) {
        refuse(messages.yamlNoMapping(this.binding.name, change.binding.key ?? ''));
      }
      this.insertKey(plan, mapping, change.binding.key, change);
    }
  }

  /** A key the entry lacks goes at its place in the rule's key order: after the nearest present key before it, else before the nearest after it. */
  private insertKey(plan: SplicePlan, mapping: TreeValue, key: string, change: SlotChange): void {
    const order = keyOrder(change.rule, change.binding.child);
    const index = order.indexOf(key);
    let offset: number;
    let before: TreeEntry | undefined;
    for (let i = index - 1; i >= 0 && !before; i--) before = mapping.member(order[i]);
    if (before) {
      offset = this.lineEndAfter(before);
    } else {
      let after: TreeEntry | undefined;
      for (let i = index + 1; i < order.length && !after; i++) after = mapping.member(order[i]);
      offset = after?.lineSpan?.start ?? this.lineEndAfter(mapping.entries[mapping.entries.length - 1]);
    }
    const indent = mapping.entries[0].indent;
    const line = `${this.indentation(indent)}${key}: ${this.scalar(change.value, undefined, change.binding, indent)}`;
    plan.add('insert-key', offset, offset, this.newLine(offset, [line]));
  }

  /**
   * The text of new lines inserted at `offset`, a line start: each line with the ending of the line
   * the insertion point is on. At the end of a body without a final newline the break goes before
   * the text and none after it (FBL 6.3).
   */
  private newLine(offset: number, lines: readonly string[]): string {
    const newline = offset > 0 ? this.newlineAt(offset - 1) : this.newlineAt(0);
    const textLines = this.text.lines;
    if (offset === this.text.length && this.text.length > 0 && textLines[textLines.length - 1].ending.length === 0) {
      return lines.map((line) => newline + line).join('');
    }
    return lines.map((line) => line + newline).join('');
  }

  /** The columns between a key and the `-` of its sequence's items, as the body shows it, else `text.sequenceIndent`. */
  private get sequenceOffset(): number {
    for (const entry of this.treeEntries) {
      if (entry.keySpan && entry.lineSpan && entry.value.kind === 'sequence' && entry.value.entries.length > 0) {
        return entry.value.entries[0].indent - entry.indent;
      }
    }
    return this.binding.text.sequenceFlush ? 0 : this.step;
  }

  insert(plan: SplicePlan, request: InsertRequest): void {
    const rule = request.rule;
    const settings = rule.insert!;
    const parent = request.parent?.entry ?? endParent(request);
    const captures = request.parent?.candidate.captures ?? (parent ? plan.reading.elementOf(parent)?.candidate.captures : undefined) ?? this.capturesOf(plan);
    const selector = settings.container ?? containerOf(rule.at);
    const container = this.container(selector, parent, captures);
    const keys = this.itemLines(request);
    if (keys.length === 0) refuse(messages.yamlNoKeys(rule.type));
    if (!container) {
      this.ensureContainer(plan, settings, selector, parent, keys);
      return;
    }
    const value = container.value;
    if (value.kind === 'sequence') {
      const siblings = value.entries;
      const lastOf = (entries: readonly TreeEntry[]): TreeEntry | undefined => entries[entries.length - 1];
      const previous = settings.place === 'start'
        ? undefined
        : settings.place === 'after-last'
          ? lastOf(siblings.filter((sibling) => plan.reading.claimedBy(sibling) === rule.name)) ?? lastOf(siblings)
          : lastOf(siblings);
      const model = previous ?? siblings[0];
      const dash = model.indent;
      const keyIndent = model.value.kind === 'mapping' && model.value.entries.length > 0 ? model.value.entries[0].indent : dash + 2;
      const offset = previous ? this.lineEndAfter(previous) : siblings[0].lineSpan?.start ?? siblings[0].own.start;
      plan.add('insert-entry', offset, offset, this.newLine(offset, this.item(keys, dash, keyIndent)));
      return;
    }
    if (value.style === 'empty') {
      const offset = this.lineEndAfter(container);
      const dash = container.indent + this.sequenceOffset;
      plan.add('insert-entry', offset, offset, this.newLine(offset, this.item(keys, dash, dash + 2)));
      return;
    }
    if (value.style === 'flowSequence' && Array.isArray(value.flow) && value.flow.length === 0 && container.keySpan) {
      // An empty flow sequence ("elements: []", the template's) becomes a block sequence: the
      // flow value goes and the item follows on its own line.
      const colon = this.text.text(container.keySpan.end, value.span.start).indexOf(':');
      plan.add('replace-value', container.keySpan.end + colon + 1, value.span.end, '');
      const offset = this.lineEndAfter(container);
      const dash = container.indent + this.sequenceOffset;
      plan.add('insert-entry', offset, offset, this.newLine(offset, this.item(keys, dash, dash + 2)));
      return;
    }
    refuse(messages.yamlNotAList(selector, rule.type));
  }

  private ensureContainer(plan: SplicePlan, settings: InsertSettings, selector: string, parent: Entry | undefined, keys: readonly string[]): void {
    const create = settings.create;
    if (!create) refuse(messages.yamlNoContainer(selector.replace(/^\/+/, '')));
    const trimmed = trimEndOf(selector, '/');
    const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    let owner = selector.startsWith('/') ? this.root : (parent as TreeEntry | undefined);
    if (selector.startsWith('/') && selector.replace(/^\/+|\/+$/g, '').includes('/')) owner = this.container(containerOf(selector), parent, new Map());
    const mapping = owner?.value;
    const hasMembers = (value: TreeValue | undefined): value is TreeValue => value?.kind === 'mapping' && value.entries.length > 0;
    const argument = create.argument ?? '';
    let offset: number;
    let indent: number;
    const after = create.at === 'after' ? mapping?.member(argument) : undefined;
    const before = create.at === 'before' ? mapping?.member(argument) : undefined;
    const under = create.at === 'under' ? this.container(argument, parent, new Map())?.value : undefined;
    if (create.at === 'end-of-document') {
      offset = this.text.length;
      indent = hasMembers(mapping) ? mapping.entries[0].indent : 0;
    } else if (after) {
      offset = this.lineEndAfter(after);
      indent = after.indent;
    } else if (before) {
      offset = before.lineSpan?.start ?? before.own.start;
      indent = before.indent;
    } else if (hasMembers(under)) {
      offset = this.lineEndAfter(under.entries[under.entries.length - 1]);
      indent = under.entries[0].indent;
    } else {
      refuse(messages.yamlNoPlace(name));
    }
    const containerText = create.text ?? `${this.indentation(indent)}${name}:`;
    plan.add('ensure-container', offset, offset, this.newLine(offset, [containerText]));
    const dash = indent + this.sequenceOffset;
    plan.add('insert-entry', offset, offset, this.newLine(offset, this.item(keys, dash, dash + 2)));
  }

  private item(lines: readonly string[], dash: number, keyIndent: number): string[] {
    return lines.map((line, index) => (index === 0
      ? `${this.indentation(dash)}-${' '.repeat(Math.max(1, keyIndent - dash - 1))}${line}`
      : this.indentation(keyIndent) + line));
  }

  /** The key lines of a new item in `insert.keys` order, then the skeleton's lines. */
  private itemLines(request: InsertRequest): string[] {
    const rule = request.rule;
    const settings = rule.insert!;
    const lines: string[] = [];
    for (const key of keyOrder(rule, undefined)) {
      if (settings.keys.length > 0 && !settings.keys.includes(key)) continue;
      const value = this.wireValue(request, key);
      if (value !== undefined) lines.push(`${key}: ${value}`);
    }
    if (settings.skeleton !== undefined) {
      const rendered = render(settings.skeleton, (name) => {
        const value = request.values.get(name);
        if (value !== null && value !== undefined) return plain(value, attributeOf(rule, name));
        return name === 'id' ? request.id : undefined;
      });
      lines.push(...trimEndOf(rendered.replaceAll('\r\n', '\n'), '\n').split('\n'));
    }
    return lines;
  }

  private wireValue(request: InsertRequest, key: string): string | undefined {
    const rule = request.rule;
    if (rule.id?.from?.key === key && request.id !== undefined) return this.scalar(request.id, undefined, undefined, 0);
    if (rule.source?.key === key && request.source) return this.scalar(request.source.key, undefined, undefined, 0);
    if (rule.target?.key === key && request.target) return this.scalar(request.target.key, undefined, undefined, 0);
    for (const [name, binding] of rule.attributes) {
      if (binding.key !== key || binding.child !== undefined || isComputed(binding)) continue;
      const value = request.values.get(name);
      if (!request.values.has(name) || isEmpty(value)) continue;
      return this.scalar(wire(binding, value, undefined) ?? value, undefined, binding, 0);
    }
    return undefined;
  }

  remove(plan: SplicePlan, element: ReadElement, removed: ReadonlySet<ReadElement>): void {
    const entry = element.entry as TreeEntry;
    if (entry.isRoot) refuse(messages.wholeFile(this.binding.name));
    const range = entry.lineSpan ?? entry.own;
    const container = entry.parent as TreeEntry | undefined;
    if (element.rule.remove?.removeContainerWhenEmpty === true && container && !container.isRoot && container.lineSpan) {
      const gone = new Set([...removed].map((other) => other.entry));
      if (container.value.entries.every((sibling) => gone.has(sibling))) {
        const first = container.value.entries[0];
        const head = { start: container.lineSpan.start, end: (first.lineSpan ?? first.own).start };
        if (!plan.touches(head)) plan.addAt('remove-container', head, '');
      }
    }
    plan.addAt('remove-entry', range, '');
  }
}

/** The order keys are written in: the rule's `insert.keys`, then its bindings' keys in binding order. */
function keyOrder(rule: Rule, child: string | undefined): string[] {
  const order: string[] = [];
  if (child === undefined) order.push(...(rule.insert?.keys ?? []));
  const add = (slot: Slot | undefined): void => {
    if (slot?.key !== undefined && slot.child === child && !order.includes(slot.key)) order.push(slot.key);
  };
  add(rule.id?.from);
  add(rule.source);
  add(rule.target);
  for (const [, binding] of rule.attributes) add(binding);
  return order;
}

function containerOf(at: string | undefined): string {
  if (at === undefined) return '/';
  const cut = at.lastIndexOf('/');
  return cut <= 0 ? '/' : at.slice(0, cut);
}

/** The entry a relation is written inside when one of its ends is its enclosing entry (a dependency inside what depends). */
function endParent(request: InsertRequest): Entry | undefined {
  if (request.rule.target?.parent !== undefined) return request.target?.entry;
  if (request.rule.source?.parent !== undefined) return request.source?.entry;
  return undefined;
}
