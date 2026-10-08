import { attributeOf, slotText, type AttributeBinding, type BlockRule, type FblBinding, type HeaderSettings, type Rule, type Slot } from '../../documents/types';
import { RegexBudgetError, type BoundedRegex } from '../../expressions/regexMatcher';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import type { ResolvedOptions } from '../../model';
import { partsOf, plain, render, wire } from '../../planning/newText';
import {
  absentSlot, Entry, FamilyReader, readOnlyAbsent, refuse,
  type Candidate, type InsertRequest, type ReadElement, type Reading, type SlotChange, type SlotRead, type SplicePlan, type Word,
} from '../../rules/familyReader';
import type { Span } from '../../span';
import type { SpliceOperation } from '../../splice';
import type { BodyText } from '../../text/bodyText';
import { byteLength, trimEndOf } from '../../text/utf8';

const SPACE = 0x20;
const TAB = 0x09;
const QUOTE = 0x22;
const isBlank = (b: number): boolean => b === SPACE || b === TAB;

/**
 * A statement of the `lines` or `blocks` family (FBL 4.6, 4.7): one line, or, when it opens a
 * block, the lines up to and including the one holding the matching `}`.
 */
export class Statement extends Entry {
  lastLine: number;

  opens = false;

  isHeader = false;

  /** The span of the first line's content, without trailing whitespace: what `re-emit-line` replaces. */
  firstLineSpan: Span;

  constructor(
    own: Span,
    indent: number,
    readonly firstLine: number,
    /** The statement's first line from its first non-whitespace byte, as the rules' `line` expressions see it. */
    readonly content: string,
    /** The byte offset of every UTF-16 index of `content`, and one past its end. */
    readonly offsets: readonly number[],
  ) {
    super(own, undefined, indent);
    this.lastLine = firstLine;
    this.firstLineSpan = own;
  }
}

/** A named group of one statement as one rule's `line` matched it. */
export interface Group {
  readonly kind: 'group';
  readonly value: string;
  readonly span: Span;
}

type Groups = ReadonlyMap<string, Group>;

/** The `lines` and `blocks` families (FBL 4.6, 4.7). */
export class LinesFamily extends FamilyReader {
  private readonly allEntries: Entry[] = [];
  private readonly leafSpans: Span[] = [];
  private readonly statements: Statement[] = [];
  /** What each expression matched in each statement, in the order it was first asked. */
  private readonly matches: { expression: string; statement: Statement; groups: Groups | undefined }[] = [];
  private readonly matchIndex = new Map<Statement, Map<string, Groups | undefined>>();
  private readonly commentLines = new Set<number>();

  constructor(text: BodyText, binding: FblBinding, options: ResolvedOptions, private readonly blocks: boolean) {
    super(text, binding, options);
  }

  get familyName(): string {
    return this.blocks ? 'blocks' : 'lines';
  }

  get entries(): readonly Entry[] {
    return this.allEntries;
  }

  get leaves(): readonly Span[] {
    return this.leafSpans;
  }

  /** Between statements and comments there are only whitespace, line endings and the closing `}` of blocks. */
  isTrivia(gap: Span): boolean {
    for (let i = gap.start; i < gap.end; i++) {
      if (!' \t\r\n}'.includes(String.fromCharCode(this.text.bytes[i]))) return false;
    }
    return true;
  }

  parse(): void {
    const comment = this.binding.comment === undefined ? undefined : this.regex(this.binding.comment, false);
    const lines = this.text.lines;
    const bytes = this.text.bytes;
    const stack: Statement[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const start = index === 0 ? Math.max(line.start, this.text.bomLength) : line.start;
      let first = start;
      while (first < line.contentEnd && isBlank(bytes[first])) first++;
      if (first === line.contentEnd) continue;
      const content = this.text.text(first, line.contentEnd);
      if (comment && this.isMatch(comment, this.text.text(start, line.contentEnd))) {
        this.commentLines.add(index);
        this.leafSpans.push({ start: first, end: line.contentEnd });
        continue;
      }
      const trimmed = trimEndOf(content, ' \t');
      if (this.blocks && trimmed === '}') {
        const opener = stack.pop();
        if (!opener) {
          this.unreadable = { offset: first, message: messages.bracesCloseNothing };
          return;
        }
        opener.lastLine = index;
        opener.lineSpan = { start: opener.lineSpan!.start, end: line.end };
        opener.own = { start: opener.own.start, end: first + 1 };
        continue;
      }
      const statement = new Statement({ start: first, end: first + byteLength(trimmed) }, first - line.start, index, content, byteOffsets(content, first));
      statement.parent = stack[stack.length - 1];
      statement.lineSpan = { start: this.leadingCommentStart(index), end: line.end };
      statement.parent?.children.push(statement);
      this.statements.push(statement);
      this.allEntries.push(statement);
      this.leafSpans.push({ start: first, end: line.contentEnd });
      if (this.blocks) {
        const { net, endsWithOpen } = braces(content);
        if (endsWithOpen && net === 1) {
          statement.opens = true;
          stack.push(statement);
        } else if (net !== 0) {
          this.unreadable = { offset: first, message: messages.bracesOnLine };
          return;
        }
      }
    }
    if (stack.length > 0) this.unreadable = { offset: stack[stack.length - 1].own.start, message: messages.bracesNeverClosed };
  }

  private leadingCommentStart(index: number): number {
    let start = this.text.lines[index].start;
    for (let above = index - 1; above >= 0 && this.commentLines.has(above); above--) start = this.text.lines[above].start;
    return start;
  }

  /** Whether a line is a comment; an expression that takes too long reads it as not one. */
  private isMatch(regex: BoundedRegex, input: string): boolean {
    try {
      return regex.isMatch(input);
    } catch (error) {
      if (error instanceof RegexBudgetError) return false;
      throw error;
    }
  }

  private timedOut(regex: BoundedRegex, statement: Statement): void {
    this.report(findingCodes.regexTimeout, 'warning', messages.regexTimeout(regex.expression), statement.own);
  }

  private match(expression: string, caseInsensitive: boolean, statement: Statement): Groups | undefined {
    let known = this.matchIndex.get(statement);
    if (!known) {
      known = new Map();
      this.matchIndex.set(statement, known);
    }
    if (known.has(expression)) return known.get(expression);
    const regex = this.regex(expression, caseInsensitive);
    let groups: Map<string, Group> | undefined;
    try {
      const found = regex.match(statement.content);
      if (found) {
        groups = new Map();
        for (const [name, range] of found.groups) {
          groups.set(name, { kind: 'group', value: statement.content.slice(range.start, range.end), span: { start: statement.offsets[range.start], end: statement.offsets[range.end] } });
        }
      }
    } catch (error) {
      if (!(error instanceof RegexBudgetError)) throw error;
      this.timedOut(regex, statement);
    }
    known.set(expression, groups);
    this.matches.push({ expression, statement, groups });
    return groups;
  }

  headerHolds(header: HeaderSettings): boolean {
    if (header.line === undefined) return true;
    const first = this.statements[0];
    if (!first) return false;
    if (!this.match(header.line, false, first)) return false;
    first.isHeader = true;
    return true;
  }

  candidates(rule: Rule): Candidate[] {
    return rule.line === undefined ? [] : this.matching(rule.line, rule.caseInsensitive).map(({ entry, captures }) => ({ rule, entry, captures }));
  }

  override blockCandidates(block: BlockRule): Candidate[] {
    return this.matching(block.line, block.caseInsensitive).map(({ entry, captures }) => ({ block, entry, captures }));
  }

  private matching(expression: string, caseInsensitive: boolean): { entry: Statement; captures: Map<string, string> }[] {
    const found: { entry: Statement; captures: Map<string, string> }[] = [];
    for (const statement of this.statements) {
      if (statement.isHeader) continue;
      const groups = this.match(expression, caseInsensitive, statement);
      if (groups) found.push({ entry: statement, captures: new Map([...groups].map(([name, group]) => [name, group.value])) });
    }
    return found;
  }

  override admits(within: readonly string[] | undefined, entry: Entry, claimedBy: (entry: Entry) => string | undefined): boolean {
    if (!this.blocks || within === undefined) return true;
    const name = entry.parent ? claimedBy(entry.parent) : '^';
    return name !== undefined && within.includes(name);
  }

  private groups(candidate: Candidate): Groups {
    const expression = candidate.rule?.line ?? candidate.block!.line;
    const insensitive = candidate.rule?.caseInsensitive ?? candidate.block!.caseInsensitive;
    return this.match(expression, insensitive, candidate.entry as Statement) ?? new Map();
  }

  celValue(candidate: Candidate): unknown {
    return new Map<string, unknown>(candidate.captures);
  }

  celExtra(candidate: Candidate): { name: string; value: unknown } {
    return { name: 'groups', value: this.celValue(candidate) };
  }

  read(candidate: Candidate, slot: Slot): SlotRead {
    if (slot.group === undefined) return readOnlyAbsent(messages.statementHasNoSlot(this.familyName, slotText(slot)));
    const group = this.groups(candidate).get(slot.group);
    const absent: SlotRead = slot.flag ? { value: false, present: false, writable: true } : absentSlot;
    if (!group) return absent;
    if (slot.word === undefined) return { value: group.value, span: group.span, present: true, writable: true, node: group, words: this.words(group), wire: group.value };
    const expression = this.regex(slot.word, false);
    for (const word of this.words(group)) {
      const raw = this.text.textOf(word.span);
      let found;
      try {
        found = expression.match(raw);
      } catch (error) {
        if (!(error instanceof RegexBudgetError)) throw error;
        this.timedOut(expression, candidate.entry as Statement);
        continue;
      }
      if (!found) continue;
      if (slot.flag) return { value: true, span: word.span, present: true, writable: true, node: word, wire: raw };
      const value = found.groups.get('value');
      if (value) {
        const text = raw.slice(value.start, value.end);
        const offset = word.span.start + byteLength(raw.slice(0, value.start));
        return { value: text, span: { start: offset, end: offset + byteLength(text) }, present: true, writable: true, node: word, wire: text };
      }
      return { value: word.text, span: word.span, present: true, writable: true, node: word, quote: word.quoted ? '"' : undefined, wire: word.text };
    }
    return absent;
  }

  /**
   * The words of a group (FBL 4.6): runs of non-whitespace, where a run starting with `"` extends
   * to the next `"` and includes both quotes.
   */
  words(group: Group): Word[] {
    const words: Word[] = [];
    const bytes = this.text.bytes;
    let i = group.span.start;
    const end = group.span.end;
    while (i < end) {
      while (i < end && isBlank(bytes[i])) i++;
      if (i >= end) break;
      const start = i;
      if (bytes[i] === QUOTE) {
        i++;
        while (i < end && bytes[i] !== QUOTE) i++;
        if (i < end) i++;
        words.push({ text: this.text.text(start + 1, Math.max(start + 1, i - 1)), span: { start, end: i }, quoted: true });
        continue;
      }
      while (i < end && !isBlank(bytes[i])) i++;
      words.push({ text: this.text.text(start, i), span: { start, end: i }, quoted: false });
    }
    return words;
  }

  readRaw(entry: Entry, name: string): SlotRead {
    for (const { statement, groups } of this.matches) {
      const group = statement === entry ? groups?.get(name) : undefined;
      if (group) return { value: group.value, span: group.span, present: true, writable: true, node: group };
    }
    return absentSlot;
  }

  override afterRead(claimedBy: (entry: Entry) => string | undefined): void {
    if (!this.binding.reportUnmatched) return;
    for (const statement of this.statements) {
      if (statement.isHeader || claimedBy(statement) !== undefined) continue;
      this.report(findingCodes.unboundStatement, 'warning', messages.unboundStatement, statement.firstLineSpan);
    }
  }

  // ---- writing ----

  format(read: SlotRead, binding: AttributeBinding | undefined, value: unknown): string {
    const written = (binding ? wire(binding, value, read.wire) : undefined) ?? plain(value, binding);
    return read.quote !== undefined ? read.quote + written + read.quote : written;
  }

  /** The written form of a value for an emit placeholder: a map's first key, a flag's word, a number by FBL 6.3. */
  private emitted(binding: AttributeBinding | undefined, value: unknown): string {
    if (!binding) return plain(value);
    if (binding.flag) return value === true ? flagWord(binding) : '';
    return wire(binding, value, undefined) ?? plain(value, binding);
  }

  write(plan: SplicePlan, element: ReadElement, changes: readonly SlotChange[]): void {
    const statement = element.entry as Statement;
    let reEmit = false;
    const pending: { operation: SpliceOperation; span: Span; text: string }[] = [];
    const insertAt = (change: SlotChange): void => {
      const point = this.insertPoint(element, change);
      if (point) pending.push({ operation: 'insert-key', span: { start: point.offset, end: point.offset }, text: point.text });
      else reEmit = true;
    };
    for (const change of changes) {
      const read = change.read;
      const binding = change.binding;
      if (binding.flag) {
        if ((change.value === true) === read.present) continue;
        if (read.present) pending.push({ operation: 'remove-key', span: this.withSpaceBefore(read.span!), text: '' });
        else insertAt(change);
        continue;
      }
      if (change.isEmpty && binding.empty === 'remove') {
        if (read.present) pending.push({ operation: 'remove-key', span: this.removable(read), text: '' });
        continue;
      }
      if (read.present && read.span) {
        const text = this.format(read, binding, change.value);
        if (text !== this.text.textOf(read.span)) pending.push({ operation: 'replace-value', span: read.span, text });
        continue;
      }
      insertAt(change);
    }
    if (!reEmit) {
      for (const { operation, span, text } of pending) plan.addAt(operation, span, text);
      return;
    }
    const emit = element.rule.insert?.emit;
    if (emit === undefined) refuse(messages.noPlaceInLine(element.rule.type));
    const values = new Map(element.attributes);
    for (const change of changes) values.set(change.attribute, change.isEmpty ? null : change.value);
    const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
    const line = render(emit, (name) => this.placeholder(element.rule, name, values, text(element.idRead?.value) ?? element.id, text(element.sourceRead?.value), text(element.targetRead?.value)));
    plan.addAt('re-emit-line', this.reEmitSpan(statement), line);
  }

  private reEmitSpan(statement: Statement): Span {
    if (!statement.opens) return statement.firstLineSpan;
    const range = statement.firstLineSpan;
    let end = range.end - 1;
    while (end > range.start && isBlank(this.text.bytes[end - 1])) end--;
    return { start: range.start, end };
  }

  private placeholder(rule: Rule, name: string, values: ReadonlyMap<string, unknown>, id: string | undefined, source: string | undefined, target: string | undefined): string | undefined {
    switch (name) {
      case 'id': return id;
      case 'source': return source;
      case 'target': return target;
    }
    const value = values.get(name);
    return value !== null && value !== undefined ? this.emitted(attributeOf(rule, name), value) : undefined;
  }

  private withSpaceBefore(range: Span): Span {
    let start = range.start;
    while (start > 0 && isBlank(this.text.bytes[start - 1])) start--;
    return { start, end: range.end };
  }

  /** A removed value takes its quotes and the whitespace before it with it (FBL 6.1 `remove-key`). */
  private removable(read: SlotRead): Span {
    let range = read.span!;
    const bytes = this.text.bytes;
    if (range.start > 0 && range.end < this.text.length && bytes[range.start - 1] === QUOTE && bytes[range.end] === QUOTE) range = { start: range.start - 1, end: range.end + 1 };
    return this.withSpaceBefore(range);
  }

  /**
   * Where an absent value can be written by `insert-key` (FBL 6.3): when the rule's emit places it
   * right after a value the statement has, and nothing after it in the emit is present in the
   * statement. Nothing when the line must be re-emitted instead.
   */
  private insertPoint(element: ReadElement, change: SlotChange): { offset: number; text: string } | undefined {
    const emit = element.rule.insert?.emit;
    if (emit === undefined) return undefined;
    const parts = partsOf(emit);
    const index = parts.findIndex((part) => part.placeholder === change.attribute);
    if (index < 0 || parts[index].segment < 0) return undefined;
    const segment = parts[index].segment;
    const first = parts.findIndex((part) => part.segment === segment);
    let previous = -1;
    for (let i = first - 1; i >= 0; i--) {
      if (parts[i].placeholder !== undefined) {
        previous = i;
        break;
      }
    }
    if (previous < 0) return undefined;
    const after = this.spanOf(element, parts[previous].placeholder!);
    if (!after) return undefined;
    for (let i = index + 1; i < parts.length; i++) {
      const later = parts[i].placeholder;
      if (later !== undefined && this.spanOf(element, later)) return undefined;
    }
    let offset = after.end;
    const between = parts.slice(previous + 1, first).map((part) => part.literal ?? '').join('');
    const length = byteLength(between);
    if (between.length > 0 && offset + length <= this.text.length && this.text.text(offset, offset + length) === between) offset += length;
    const template = `[${parts.filter((part) => part.segment === segment).map((part) => part.literal ?? `{${part.placeholder}}`).join('')}]`;
    const text = render(template, (name) => (name === change.attribute ? this.emitted(change.binding, change.value) : undefined));
    return text.length === 0 ? undefined : { offset, text };
  }

  private spanOf(element: ReadElement, placeholder: string): Span | undefined {
    switch (placeholder) {
      case 'id': return element.idRead?.span;
      case 'source': return element.sourceRead?.span;
      case 'target': return element.targetRead?.span;
      default: {
        const read = element.slots.get(placeholder);
        return read?.present ? read.span : undefined;
      }
    }
  }

  insert(plan: SplicePlan, request: InsertRequest): void {
    const rule = request.rule;
    const settings = rule.insert;
    if (settings?.emit === undefined) refuse(messages.noEmit(rule.type));
    const line = render(settings.emit, (name) => this.placeholder(rule, name, request.values, request.id, request.source?.key, request.target?.key));
    let container: Statement | undefined;
    if (this.blocks) {
      if (request.parent) container = request.parent.entry as Statement;
      else if (settings.container !== undefined) container = findContainer(plan.reading, settings.container);
      if (!container && (request.parent || settings.container !== undefined)) refuse(messages.noBlock(rule.type));
    }
    const siblings = container
      ? container.children as Statement[]
      : this.statements.filter((statement) => !statement.parent && !statement.isHeader);
    const lastOf = (statements: readonly Statement[]): Statement | undefined => statements[statements.length - 1];
    let previous: Statement | undefined;
    switch (settings.place) {
      case 'after-last':
        previous = lastOf(siblings.filter((sibling) => plan.reading.claimedBy(sibling) === rule.name)) ?? lastOf(siblings);
        break;
      case 'end':
      case 'last-child':
        previous = lastOf(siblings);
        break;
      case 'start':
        previous = undefined;
        break;
      case 'end-of-document':
        previous = lastOf(this.statements);
        break;
      default:
        refuse(messages.cannotPlace(this.familyName, settings.place));
    }
    if (container && !container.opens) {
      this.openBlock(plan, container, line);
      return;
    }
    let offset: number;
    if (previous) offset = previous.lineSpan!.end;
    else if (container) offset = this.text.lines[container.firstLine].end;
    else offset = siblings[0]?.lineSpan?.start ?? this.text.length;
    const indent = previous?.indent ?? siblings[0]?.indent ?? (container ? container.indent + this.step : 0);
    plan.add('insert-entry', offset, offset, this.newLine(offset, this.indentation(indent) + line));
  }

  /** The text of a new line at `offset`, a line start or the end of a body without a final newline (FBL 6.3). */
  private newLine(offset: number, line: string): string {
    const newline = this.newlineAt(offset);
    const lines = this.text.lines;
    if (offset === this.text.length && this.text.length > 0 && lines[lines.length - 1].ending.length === 0) return newline + line;
    return line + newline;
  }

  private openBlock(plan: SplicePlan, parent: Statement, line: string): void {
    const first = this.text.lines[parent.firstLine];
    const newline = this.newlineAt(first.start);
    plan.add('open-block', parent.firstLineSpan.end, parent.firstLineSpan.end, ' {');
    const childIndent = this.indentation(parent.indent + this.step);
    const close = `${this.indentation(parent.indent)}}`;
    if (first.ending.length === 0) {
      plan.add('insert-entry', first.end, first.end, newline + childIndent + line);
      plan.add('open-block', first.end, first.end, newline + close);
      return;
    }
    plan.add('insert-entry', first.end, first.end, childIndent + line + newline);
    plan.add('open-block', first.end, first.end, close + newline);
  }

  remove(plan: SplicePlan, element: ReadElement): void {
    plan.addAt('remove-entry', element.entry.removalSpan, '');
  }
}

const findContainer = (reading: Reading, name: string): Statement | undefined =>
  reading.family.entries.find((entry): entry is Statement => entry instanceof Statement && reading.claimedBy(entry) === name);

/** A statement's braces outside its quoted strings: how many more open than close, and whether it ends with one that opens. */
function braces(content: string): { net: number; endsWithOpen: boolean } {
  let net = 0;
  let inString = false;
  let last = '';
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inString) {
      if (c === '\\' && i + 1 < content.length) i++;
      else if (c === '"') inString = false;
      last = c;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') net++;
    else if (c === '}') net--;
    if (c !== ' ' && c !== '\t') last = c;
  }
  return { net, endsWithOpen: !inString && last === '{' };
}

/** The byte offset of every UTF-16 index of a text that starts at `start`, and one past its end. */
function byteOffsets(content: string, start: number): number[] {
  const offsets = new Array<number>(content.length + 1);
  let offset = start;
  for (let i = 0; i < content.length; i++) {
    offsets[i] = offset;
    const unit = content.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < content.length) {
      offsets[i + 1] = offset;
      offset += 4;
      i++;
      continue;
    }
    offset += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
  }
  offsets[content.length] = offset;
  return offsets;
}

/** The word a flag writes: its `word` expression without its anchors and escapes. */
function flagWord(slot: Slot): string {
  let word = slot.word ?? '';
  if (word.startsWith('^')) word = word.slice(1);
  if (word.endsWith('$')) word = word.slice(0, -1);
  return word.replace(/\\(.)/g, (_escape, character: string) => (character === 't' ? '\t' : character === 'n' ? '\n' : character === 'r' ? '\r' : character));
}
