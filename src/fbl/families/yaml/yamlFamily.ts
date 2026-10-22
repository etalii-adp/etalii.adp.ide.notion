import { parseAllDocuments } from 'yaml';
import { allRules, attributeOf, isComputed, type AttributeBinding, type InsertSettings, type Rule, type Slot } from '../../documents/types';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import { formatNumber, isEmpty, isNumber, keepPrecision, keepsEmpty, plain, render, wire } from '../../planning/newText';
import { refuse, type Entry, type InsertRequest, type ReadElement, type SlotChange, type SlotRead, type SplicePlan } from '../../rules/familyReader';
import { TreeEntry, TreeFamily, TreeValue } from '../../rules/treeFamily';
import { isTextType } from '../../rules/typedValue';
import type { Span } from '../../span';
import { byteLength, trimEndOf } from '../../text/utf8';
import { YamlError, YamlParser } from './yamlParser';
import { allowsPlain, doubleQuoted, isPlainSafe, isPlainWritable, singleQuoted } from './yamlScalars';

const HASH = 0x23;

/**
 * The `yaml` family (FBL 4.3): the bundled YAML parser decides whether the stream is well-formed,
 * the `YamlParser` reads the first document's structure and spans, and writing keeps each replaced
 * scalar's style and the body's indentation (FBL 6.3).
 */
export class YamlFamily extends TreeFamily {
  private leafSpans: Span[] = [];

  // The attribute bindings the host says hold a date or a date-time, and those whose slot is read
  // as text (FBL 5.2), each found once by reference.
  private timeTyped?: Set<AttributeBinding>;
  private textRead?: Set<AttributeBinding>;

  readonly familyName = 'yaml';

  private isTimeTyped(binding: AttributeBinding | undefined): boolean {
    if (!binding) return false;
    if (binding.keepTimePrecision) return true;
    this.timeTyped ??= new Set(allRules(this.binding).flatMap((rule) =>
      rule.attributes.filter(([name]) => this.options.timeAttributes.has(`${rule.name}.${name}`)).map(([, attribute]) => attribute)));
    return this.timeTyped.has(binding);
  }

  /** Whether an attribute's slot is read as text: by `read`, or as a string attribute's is unasked (FBL 5.2). */
  private isTextRead(binding: AttributeBinding | undefined): boolean {
    if (!binding) return false;
    this.textRead ??= new Set(allRules(this.binding).flatMap((rule) =>
      rule.attributes
        .filter(([name, attribute]) => attribute.read === 'text' || (attribute.read === undefined && isTextType(this.options.attributeType?.(rule.type, name))))
        .map(([, attribute]) => attribute)));
    return this.textRead.has(binding);
  }

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
    if (typeof value === 'boolean') return keepQuotes(value ? 'true' : 'false', old, binding);
    if (typeof value === 'string') return this.string(value, old, binding, keyIndent);
    if (Array.isArray(value)) return `[${value.map((item) => (typeof item === 'string' ? flowItem(item) : this.scalar(item, undefined, binding, keyIndent))).join(', ')}]`;
    if (isNumber(value)) return keepQuotes(formatNumber(value, binding?.decimals), old, binding);
    return this.string(plain(value, binding), old, binding, keyIndent);
  }

  private string(text: string, old: TreeValue | undefined, binding: AttributeBinding | undefined, keyIndent: number): string {
    const timeTyped = this.isTimeTyped(binding);
    let value = text;
    if (binding?.keepTimePrecision === true && old?.kind === 'scalar' && old.text.length > 0) value = keepPrecision(old.text, value) ?? value;
    const multiline = value.includes('\n') || value.includes('\r');
    // A slot read as text whose attribute asks for plain is written plain whenever the syntax allows it (FBL 6.3).
    const fitsPlain = isPlainWritable(value, timeTyped) || (binding?.style === 'plain' && this.isTextRead(binding) && allowsPlain(value));
    switch (old?.style) {
      case 'plain':
        if (fitsPlain) return value;
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
        if (fitsPlain) return value;
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
        if (member) {
          // FBL 0.4, section 5.2: the levels the key leaves empty go with it, up to the entry itself.
          const reached = change.binding.child;
          if (change.binding.create?.atEnd === true && reached !== undefined) this.removeEmptiedLevels(plan, member, segmentsOf(reached).length, (entry) => entry === member);
          plan.addAt('remove-key', member.lineSpan ?? member.own, '');
        }
        continue;
      }
      if (read.present && member) {
        const written = this.format(read, change.binding, change.value);
        if (written !== this.text.textOf(member.value.span)) plan.addAt('replace-value', member.value.span, written);
        continue;
      }
      const mapping = read.node instanceof TreeValue ? read.node : this.mapping(element.entry as TreeEntry, change.binding.child);
      const child = change.binding.child;
      if (!mapping && change.binding.create?.atEnd === true && child !== undefined && change.binding.key !== undefined) {
        // FBL 0.4, section 5.2: every missing level of the child mapping, then the key, at one offset.
        const missing = this.missingLevels(element.entry as TreeEntry, segmentsOf(child));
        if (!missing) refuse(messages.noPlaceToCreate(this.binding.name, child));
        const { offset: at, lines: levels, inside } = missing;
        for (const level of levels) plan.add('ensure-container', at, at, this.newLine(at, [level]));
        plan.add('insert-key', at, at, this.newLine(at, [`${this.indentation(inside)}${change.binding.key}: ${this.scalar(change.value, undefined, change.binding, inside)}`]));
        continue;
      }
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
    } else if (change.binding.create?.atEnd === true) {
      // FBL 0.4, section 5.2: with no key of the rule before it, the mapping's first key.
      offset = mapping.entries[0].lineSpan?.start ?? mapping.entries[0].own.start;
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
    // FBL 6.2's place {before: key} is not built here yet; refused, as the lines family does, and not placed at the end.
    if (settings.place === 'before') refuse(messages.cannotPlace(this.familyName, settings.place));
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
    if (create.at === 'end') {
      // FBL 0.4, section 6.2, Missing levels: outermost first, then the entry, all at one offset.
      const from = selector.startsWith('/') ? this.root : (parent as TreeEntry | undefined);
      const missing = from ? this.missingLevels(from, segmentsOf(selector)) : undefined;
      if (!missing) refuse(messages.yamlNoPlace(name));
      const { offset: at, lines: levels, inside } = missing;
      if (create.text !== undefined && levels.length > 0) levels[levels.length - 1] = create.text;
      for (const level of levels) plan.add('ensure-container', at, at, this.newLine(at, [level]));
      const first = inside - this.step + this.sequenceOffset;
      plan.add('insert-entry', at, at, this.newLine(at, this.item(keys, first, first + 2)));
      return;
    }
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
    } else if (create.at === 'before' && hasMembers(mapping)) {
      // Before a key the file does not have: at its end, as after-last falls back to end.
      offset = this.text.length;
      indent = mapping.entries[0].indent;
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

  /**
   * The levels of `segments` that `from` does not reach, as the key lines that create them,
   * outermost first; where they go, which is the end of the innermost level the body has; and the
   * indentation of what the innermost level holds (FBL 0.4, section 6.2). Nothing when a missing
   * level is named by `*` or a capture, which gives no key to write, or when the level to write in
   * is not a block mapping.
   */
  private missingLevels(from: TreeEntry, segments: readonly string[]): { offset: number; lines: string[]; inside: number } | undefined {
    let level = from;
    let reached = 0;
    while (reached < segments.length && level.value.kind === 'mapping') {
      const member = level.value.member(segments[reached]);
      if (!member) break;
      level = member;
      reached++;
    }
    let offset: number;
    let indent: number;
    const value = level.value;
    if (value.kind === 'mapping' && value.entries.length > 0) {
      offset = level.isRoot ? this.text.length : this.lineEndAfter(value.entries[value.entries.length - 1]);
      indent = value.entries[0].indent;
    } else if (value.style === 'empty') {
      offset = level.isRoot ? this.text.length : this.lineEndAfter(level);
      indent = level.isRoot ? 0 : level.indent + this.step;
    } else {
      return undefined;
    }
    const lines: string[] = [];
    for (let i = reached; i < segments.length; i++) {
      if (segments[i] === '*' || segments[i].startsWith('{')) return undefined;
      lines.push(`${this.indentation(indent)}${segments[i]}:`);
      indent += this.step;
    }
    return { offset, lines, inside: indent };
  }

  /**
   * Removes the heads of the levels above `start` that its removal leaves empty, at most `most`
   * of them and never the root, outermost first (FBL 0.4, section 6.2). A level is left empty when
   * everything in it is `going` or is such a level itself.
   */
  private removeEmptiedLevels(plan: SplicePlan, start: TreeEntry, most: number, going: (entry: TreeEntry) => boolean): void {
    const heads: Span[] = [];
    let emptied: TreeEntry | undefined;
    let level = start.parent as TreeEntry | undefined;
    while (heads.length < most && level && !level.isRoot && level.lineSpan) {
      const within = emptied;
      if (!level.value.entries.every((entry) => entry === within || going(entry))) break;
      const first = level.value.entries[0];
      heads.unshift({ start: level.lineSpan.start, end: (first.lineSpan ?? first.own).start });
      emptied = level;
      level = level.parent as TreeEntry | undefined;
    }
    for (const head of heads) {
      if (!plan.touches(head)) plan.addAt('remove-container', head, '');
    }
  }

  private item(lines: readonly string[], dash: number, keyIndent: number): string[] {
    return lines.map((written, index) => {
      const line = this.nested(written, keyIndent);
      return index === 0
        ? `${this.indentation(dash)}-${' '.repeat(Math.max(1, keyIndent - dash - 1))}${line}`
        : this.indentation(keyIndent) + line;
    });
  }

  /**
   * A key line whose value runs over several lines (a literal block, written relative to column 0)
   * with its continuation lines moved under the key's indentation; blank ones stay empty.
   */
  private nested(line: string, keyIndent: number): string {
    if (!line.includes('\n')) return line;
    return line.split('\n').map((part, index) => (index > 0 && trimEndOf(part, '\r').length > 0 ? this.indentation(keyIndent) + part : part)).join('\n');
  }

  /**
   * The key lines of a new item in `insert.keys` order, then the skeleton's lines. A constant is written
   * as it is: at its place in `insert.keys` when they name it, else after the other keys, in the
   * constant's member order (FBL 0.8 6.2).
   */
  private itemLines(request: InsertRequest): string[] {
    const rule = request.rule;
    const settings = rule.insert!;
    const constant = new Map(settings.constant ?? []);
    const lines: string[] = [];
    for (const key of keyOrder(rule, undefined)) {
      if (settings.keys.length > 0 && !settings.keys.includes(key)) continue;
      if (constant.has(key)) {
        if (settings.keys.includes(key)) lines.push(`${key}: ${this.scalar(constant.get(key), undefined, undefined, 0)}`);
        continue;
      }
      const value = this.wireValue(request, key);
      if (value !== undefined) lines.push(`${key}: ${value}`);
    }
    for (const [key, value] of constant) {
      if (!settings.keys.includes(key)) lines.push(`${key}: ${this.scalar(value, undefined, undefined, 0)}`);
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
      // An attribute the add does not give has no value; one it gives its empty value has its key by the binding's `empty` (FBL 6.2).
      if (!request.values.has(name)) continue;
      const value = request.values.get(name);
      if (isEmpty(value) && !keepsEmpty(binding, value)) continue;
      return this.scalar(wire(binding, value, undefined) ?? value, undefined, binding, 0);
    }
    return undefined;
  }

  remove(plan: SplicePlan, element: ReadElement, removed: ReadonlySet<ReadElement>): void {
    const entry = element.entry as TreeEntry;
    if (entry.isRoot) refuse(messages.wholeFile(this.binding.name));
    const range = entry.lineSpan ?? entry.own;
    const settings = element.rule.remove;
    if (settings?.removeContainerWhenEmpty === true) {
      // The container alone, or with remove-empty-levels every level of its selector that a key
      // names, counted from the container up to the first level a * or a capture names.
      let levels = 1;
      if (settings.removeEmptyLevels === true) {
        const segments = segmentsOf(element.rule.insert?.container ?? containerOf(element.rule.at));
        levels = 0;
        while (levels < segments.length && isKeySegment(segments[segments.length - 1 - levels])) levels++;
      }
      const all = new Set<Entry>([...removed].map((other) => other.entry));
      const gone = new Set<Entry>([...removed].filter((other) => other.rule.remove?.removeContainerWhenEmpty === true).map((other) => other.entry));
      // A sibling container goes too when this edit removes everything in it.
      this.removeEmptiedLevels(plan, entry, levels, (other) => all.has(other) || (other.value.entries.length > 0 && other.value.entries.every((inner) => gone.has(inner))));
    }
    plan.addAt('remove-entry', this.withoutFinalNewline(range, removed), '');
  }

  /**
   * The last entry of a body without a final newline, removed with the line ending before it, so
   * the body still has no final newline, as an insertion after such a line keeps it so (FBL 6.3).
   * Not when the entry above is removed too, whose span ends where this one starts.
   */
  private withoutFinalNewline(range: Span, removed: ReadonlySet<ReadElement>): Span {
    const bytes = this.text.bytes;
    if (range.end !== this.text.length || range.start === 0 || bytes[bytes.length - 1] === 0x0a || bytes[range.start - 1] !== 0x0a) return range;
    for (const other of removed) {
      if (other.entry instanceof TreeEntry && (other.entry.lineSpan ?? other.entry.own).end === range.start) return range;
    }
    let start = range.start - 1;
    if (start > 0 && bytes[start - 1] === 0x0d) start--;
    return { start, end: range.end };
  }
}

/** The key segments of a selector, without the slashes around them. */
const segmentsOf = (selector: string): string[] => selector.replace(/^\/+|\/+$/g, '').split('/');

/** Whether a selector's segment names a key, which gives a level its line; `*` and a capture do not. */
const isKeySegment = (segment: string): boolean => segment.length > 0 && segment !== '*' && !segment.startsWith('{');

/**
 * A string inside a flow collection: plain only when it is plain-safe and holds none of the flow
 * indicators `, [ ] { }` nor a `:`, which a flow collection would read as a separator or a
 * mapping; double-quoted otherwise (FBL 6.3).
 */
const flowItem = (value: string): string => (isPlainSafe(value, false) && !/[,[\]{}:]/.test(value) ? value : doubleQuoted(value));

/**
 * A number or a bool that replaces a quoted scalar which the binding reads from its written text
 * (`quoted: "convert"`, FBL 5.2) keeps the quotes: a replaced value keeps its style (FBL 6.3).
 */
function keepQuotes(written: string, old: TreeValue | undefined, binding: AttributeBinding | undefined): string {
  if (binding?.convertQuoted !== true) return written;
  return old?.style === 'double' ? `"${written}"` : old?.style === 'single' ? `'${written}'` : written;
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
