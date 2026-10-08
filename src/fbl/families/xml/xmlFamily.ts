import { slotText, type AttributeBinding, type CreateChild, type HeaderSettings, type Rule, type Slot } from '../../documents/types';
import { RegexBudgetError } from '../../expressions/regexMatcher';
import { findingCodes } from '../../finding';
import { messages } from '../../messages';
import { plain, render, wire } from '../../planning/newText';
import { absentSlot, Entry, FamilyReader, OverrideNode, readOnlyAbsent, refuse, type Candidate, type InsertRequest, type ReadElement, type SlotChange, type SlotRead, type SplicePlan } from '../../rules/familyReader';
import { select, selectorStart } from '../../rules/selector';
import type { Span } from '../../span';
import type { SpliceOperation } from '../../splice';
import { isWhiteSpaceCode, trim } from '../../text/utf8';

const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;
const LESS = 0x3c;
const GREATER = 0x3e;
const isSpace = (b: number): boolean => b === SPACE || b === TAB || b === CR || b === LF;

/** An attribute as written (FBL 4.5): its own span from name to closing quote, and its value span between the quotes. */
export interface XmlAttribute {
  readonly kind: 'attribute';
  readonly name: string;
  readonly own: Span;
  readonly value: Span;
  readonly text: string;
}

/** Character data of an element, with its span and its text with references decoded. */
export interface XmlTextRun {
  readonly kind: 'text';
  readonly span: Span;
  readonly text: string;
}

/** The text of an element as a slot reads it: where it is written, and whether it is html paragraphs. */
export class XmlTextNode {
  constructor(readonly element: XmlElement, readonly span: Span | undefined, readonly html: boolean) {}
}

/** An element (FBL 4.5): an entry whose own span runs from its start tag's `<` to its end tag's `>`. */
export class XmlElement extends Entry {
  startTag: Span = { start: 0, end: 0 };

  /** The `>` that ends the start tag, or the `/>` of a self-closed tag. */
  close: Span = { start: 0, end: 0 };

  selfClosed = false;

  endTag?: Span;

  readonly attributes: XmlAttribute[] = [];

  /** Text runs and child elements in document order. */
  readonly content: (XmlTextRun | XmlElement)[] = [];

  /** A reference to an entity other than the five predefined ones: the element is an unreadable entry. */
  unreadable?: string;

  constructor(
    own: Span,
    name: string | undefined,
    indent: number,
    /** The end of the element's name in its start tag, where a first attribute is added. */
    readonly nameEnd = 0,
    readonly isRoot = false,
  ) {
    super(own, name, indent);
  }

  get contentStart(): number {
    return this.startTag.end;
  }

  get contentEnd(): number {
    return this.endTag?.start ?? this.startTag.end;
  }

  get elements(): XmlElement[] {
    return this.content.filter((node): node is XmlElement => node instanceof XmlElement);
  }

  attribute(name: string): XmlAttribute | undefined {
    return this.attributes.find((attribute) => attribute.name === name);
  }
}

class XmlError extends Error {
  constructor(readonly offset: number, message: string) {
    super(message);
  }
}

/**
 * The xml family (FBL 4.5): a lossless reading of an XML 1.0 document over its bytes. The prolog,
 * comments, processing instructions and a document type declaration are unbound content; carriage
 * returns are kept, never normalised; entity declarations are not processed.
 */
export class XmlFamily extends FamilyReader {
  private readonly allEntries: Entry[] = [];
  private readonly leafSpans: Span[] = [];
  private readonly commentLines = new Map<number, Span>();
  private root?: XmlElement;
  private document?: XmlElement;

  readonly familyName = 'xml';

  get entries(): readonly Entry[] {
    return this.allEntries;
  }

  get leaves(): readonly Span[] {
    return this.leafSpans;
  }

  isTrivia(gap: Span): boolean {
    return this.isWhitespace(gap);
  }

  // ---- reading ----

  parse(): void {
    try {
      this.parseDocument();
    } catch (error) {
      if (!(error instanceof XmlError)) throw error;
      this.unreadable = { offset: error.offset, message: messages.xmlNotWellFormed(error.message) };
    }
  }

  private parseDocument(): void {
    const bytes = this.text.bytes;
    this.root = new XmlElement({ start: 0, end: bytes.length }, undefined, 0, 0, true);
    const stack: XmlElement[] = [];
    const top = (): XmlElement | undefined => stack[stack.length - 1];
    let position = this.text.bomLength;
    while (position < bytes.length) {
      if (bytes[position] !== LESS) {
        position = this.readText(position, top());
        continue;
      }
      if (this.startsWith(position, '<?')) {
        position = this.skip(position, '?>', messages.xmlProcessingInstruction);
      } else if (this.startsWith(position, '<!--')) {
        const start = position;
        position = this.skip(position, '-->', messages.xmlComment);
        this.rememberComment({ start, end: position });
      } else if (this.startsWith(position, '<![CDATA[')) {
        const owner = top();
        if (!owner) throw new XmlError(position, messages.xmlCdataOutside);
        const start = position;
        position = this.skip(position, ']]>', messages.xmlCdata);
        owner.content.push({ kind: 'text', span: { start, end: position }, text: this.text.text(start + 9, position - 3) });
      } else if (this.startsWith(position, '<!')) {
        if (this.document) throw new XmlError(position, messages.xmlDoctypeLate);
        position = this.skipDeclaration(position);
      } else if (this.startsWith(position, '</')) {
        position = this.readEndTag(position, stack);
      } else {
        position = this.readStartTag(position, stack);
      }
    }
    const open = top();
    if (open) throw new XmlError(bytes.length, messages.xmlElementNotClosed(open.name ?? ''));
    if (!this.document) throw new XmlError(this.text.bomLength, messages.xmlNoDocumentElement);
    for (const entry of this.allEntries) entry.lineSpan = this.lineSpanOf(entry);
  }

  private startsWith(position: number, literal: string): boolean {
    if (position + literal.length > this.text.length) return false;
    for (let i = 0; i < literal.length; i++) {
      if (this.text.bytes[position + i] !== literal.charCodeAt(i)) return false;
    }
    return true;
  }

  private find(position: number, literal: string): number {
    for (let i = position; i + literal.length <= this.text.length; i++) {
      if (this.startsWith(i, literal)) return i;
    }
    return -1;
  }

  private skip(position: number, terminator: string, what: string): number {
    const found = this.find(position + 2, terminator);
    if (found < 0) throw new XmlError(position, messages.xmlNotClosed(what));
    const end = found + terminator.length;
    this.leafSpans.push({ start: position, end });
    return end;
  }

  private skipDeclaration(position: number): number {
    let depth = 0;
    let quote = 0;
    for (let i = position + 2; i < this.text.length; i++) {
      const b = this.text.bytes[i];
      if (quote !== 0) {
        if (b === quote) quote = 0;
        continue;
      }
      if (b === 0x22 || b === 0x27) quote = b;
      else if (b === 0x5b) depth++;
      else if (b === 0x5d) depth--;
      else if (b === GREATER && depth === 0) {
        this.leafSpans.push({ start: position, end: i + 1 });
        return i + 1;
      }
    }
    throw new XmlError(position, messages.xmlDeclarationNotClosed);
  }

  private rememberComment(comment: Span): void {
    const line = this.text.lineIndexAt(comment.start);
    if (this.text.lineIndexAt(comment.end - 1) === line && this.onlyWhitespaceBefore(comment.start) && this.onlyTriviaAfter(comment.end)) {
      this.commentLines.set(line, comment);
    }
  }

  private readText(position: number, parent: XmlElement | undefined): number {
    let end = position;
    while (end < this.text.length && this.text.bytes[end] !== LESS) end++;
    const range = { start: position, end };
    if (this.isWhitespace(range)) {
      parent?.content.push({ kind: 'text', span: range, text: this.text.textOf(range) });
      return end;
    }
    if (!parent) throw new XmlError(position, messages.xmlTextOutside);
    this.leafSpans.push(range);
    parent.content.push({ kind: 'text', span: range, text: this.decode(range, parent) });
    return end;
  }

  /** Decodes the five predefined entities and character references; any other reference makes `owner` unreadable. */
  private decode(range: Span, owner: XmlElement | undefined): string {
    const raw = this.text.textOf(range);
    if (!raw.includes('&')) return raw;
    let text = '';
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== '&') {
        text += raw[i];
        continue;
      }
      const semicolon = raw.indexOf(';', i + 1);
      if (semicolon < 0) throw new XmlError(range.start, messages.xmlAmpersand);
      const name = raw.slice(i + 1, semicolon);
      switch (name) {
        case 'amp': text += '&'; break;
        case 'lt': text += '<'; break;
        case 'gt': text += '>'; break;
        case 'quot': text += '"'; break;
        case 'apos': text += '\''; break;
        default:
          if (name.startsWith('#')) {
            const hex = name.startsWith('#x');
            const digits = hex ? name.slice(2) : name.slice(1);
            const code = (hex ? /^[0-9a-fA-F]{1,8}$/ : /^[0-9]{1,9}$/).test(digits) ? parseInt(digits, hex ? 16 : 10) : -1;
            if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new XmlError(range.start, messages.xmlCharacterReference(name));
            text += String.fromCodePoint(code);
          } else {
            if (owner && owner.unreadable === undefined) owner.unreadable = messages.xmlEntity(name);
            text += `&${name};`;
          }
      }
      i = semicolon;
    }
    return text;
  }

  private readName(position: number): number {
    let end = position;
    while (end < this.text.length && isNameByte(this.text.bytes[end], end === position)) end++;
    if (end === position) throw new XmlError(position, messages.xmlNameExpected);
    return end;
  }

  private skipSpace(from: number): number {
    let position = from;
    while (position < this.text.length && isSpace(this.text.bytes[position])) position++;
    return position;
  }

  private readStartTag(start: number, stack: XmlElement[]): number {
    const bytes = this.text.bytes;
    const parent = stack[stack.length - 1];
    if (!parent && this.document) throw new XmlError(start, messages.xmlSecondDocumentElement);
    const nameEnd = this.readName(start + 1);
    const element = new XmlElement({ start, end: nameEnd }, this.text.text(start + 1, nameEnd), start - this.text.lines[this.text.lineIndexAt(start)].start, nameEnd);
    element.parent = parent ?? this.root;
    let position = nameEnd;
    for (;;) {
      const spaced = this.skipSpace(position);
      if (spaced >= this.text.length) throw new XmlError(start, messages.xmlStartTagNotClosed(element.name!));
      if (this.startsWith(spaced, '/>')) {
        element.selfClosed = true;
        element.close = { start: spaced, end: spaced + 2 };
        position = spaced + 2;
        break;
      }
      if (bytes[spaced] === GREATER) {
        element.close = { start: spaced, end: spaced + 1 };
        position = spaced + 1;
        break;
      }
      if (spaced === position) throw new XmlError(spaced, messages.xmlAttributesSeparated);
      const attributeEnd = this.readName(spaced);
      const name = this.text.text(spaced, attributeEnd);
      const equals = this.skipSpace(attributeEnd);
      if (equals >= this.text.length || bytes[equals] !== 0x3d) throw new XmlError(equals, messages.xmlAttributeNoValue(name));
      const open = this.skipSpace(equals + 1);
      if (open >= this.text.length || (bytes[open] !== 0x22 && bytes[open] !== 0x27)) throw new XmlError(open, messages.xmlValueQuoted(name));
      const quote = bytes[open];
      let close = open + 1;
      while (close < this.text.length && bytes[close] !== quote) {
        if (bytes[close] === LESS) throw new XmlError(close, messages.xmlValueLessThan);
        close++;
      }
      if (close >= this.text.length) throw new XmlError(open, messages.xmlValueNotClosed(name));
      if (element.attribute(name)) throw new XmlError(spaced, messages.xmlAttributeTwice(name));
      const value = { start: open + 1, end: close };
      element.attributes.push({ kind: 'attribute', name, own: { start: spaced, end: close + 1 }, value, text: this.decode(value, element) });
      position = close + 1;
    }
    element.startTag = { start, end: position };
    element.own = element.startTag;
    this.leafSpans.push(element.startTag);
    this.allEntries.push(element);
    if (!parent) {
      this.document = element;
      this.root!.children.push(element);
    } else {
      parent.children.push(element);
      parent.content.push(element);
    }
    if (!element.selfClosed) stack.push(element);
    return position;
  }

  private readEndTag(start: number, stack: XmlElement[]): number {
    const nameEnd = this.readName(start + 2);
    const name = this.text.text(start + 2, nameEnd);
    const close = this.skipSpace(nameEnd);
    if (close >= this.text.length || this.text.bytes[close] !== GREATER) throw new XmlError(start, messages.xmlEndTagNotClosed(name));
    const open = stack[stack.length - 1];
    if (!open) throw new XmlError(start, messages.xmlEndTagClosesNothing(name));
    if (open.name !== name) throw new XmlError(start, messages.xmlEndTagMismatch(name, open.name ?? ''));
    stack.pop();
    open.endTag = { start, end: close + 1 };
    open.own = { start: open.startTag.start, end: close + 1 };
    this.leafSpans.push(open.endTag);
    return close + 1;
  }

  /** The line span (FBL 4.1.1): whole lines, extended upwards over comment lines at the same indentation. */
  private lineSpanOf(entry: Entry): Span | undefined {
    if (!this.onlyWhitespaceBefore(entry.own.start) || !this.onlyTriviaAfter(entry.own.end)) return undefined;
    const lines = this.text.lines;
    let first = this.text.lineIndexAt(entry.own.start);
    const last = this.text.lineIndexAt(entry.own.end - 1);
    for (;;) {
      const comment = first > 0 ? this.commentLines.get(first - 1) : undefined;
      if (!comment || comment.start - lines[first - 1].start !== entry.indent) break;
      first--;
    }
    return { start: lines[first].start, end: lines[last].end };
  }

  override get step(): number {
    for (const entry of this.allEntries) {
      const parent = entry.parent as XmlElement | undefined;
      if (parent && !parent.isRoot && entry.lineSpan && parent.lineSpan && entry.indent >= parent.indent) return entry.indent - parent.indent;
    }
    return this.binding.text.indent === 0 ? 1 : this.binding.text.indent;
  }

  private readonly attributeEquals = (entry: Entry, attribute: string, value: string): boolean => (entry as XmlElement).attribute(attribute)?.text === value;

  private child(element: XmlElement, selector: string): XmlElement | undefined {
    return select(element, selector, this.attributeEquals)[0]?.entry as XmlElement | undefined;
  }

  candidates(rule: Rule): Candidate[] {
    if (rule.at === undefined || !this.root) return [];
    const found: Candidate[] = [];
    for (const { entry, captures } of select(this.root, rule.at, this.attributeEquals)) {
      const element = entry as XmlElement;
      if (element.unreadable !== undefined) {
        const line = this.locate(element.own).line;
        if (!this.findings.some((finding) => finding.code === findingCodes.unreadableEntry && finding.location.line === line)) {
          this.report(findingCodes.unreadableEntry, 'warning', messages.entryUnreadable(element.unreadable), element.startTag);
        }
        continue;
      }
      found.push({ rule, entry, captures });
    }
    return found;
  }

  override enclosing(entry: Entry): Entry[] {
    const found: Entry[] = [];
    for (let parent = entry.parent as XmlElement | undefined; parent && !parent.isRoot; parent = parent.parent as XmlElement | undefined) found.push(parent);
    return found;
  }

  celValue(candidate: Candidate): unknown {
    const element = candidate.entry as XmlElement;
    const map = new Map<string, unknown>();
    for (const attribute of element.attributes) map.set(attribute.name, attribute.text);
    map.set('text', ownText(element));
    return map;
  }

  celExtra(candidate: Candidate): { name: string; value: unknown } {
    return { name: 'path', value: new Map(candidate.captures) };
  }

  read(candidate: Candidate, slot: Slot): SlotRead {
    const element = candidate.entry as XmlElement;
    if (slot.capture !== undefined) {
      const key = candidate.captures.get(slot.capture);
      return key !== undefined ? { value: key, present: true, writable: false, reason: messages.xmlNameNotRewritten } : absentSlot;
    }
    const target = slot.child === undefined ? element : this.child(element, slot.child);
    if (slot.attribute !== undefined) return target ? readAttribute(target, slot.attribute) : absentSlot;
    if (slot.text) {
      if (!target) return absentSlot;
      const html = (slot as Partial<AttributeBinding>).htmlParagraphs === true;
      const writable = target.unreadable === undefined;
      if (html) {
        const body = this.child(target, 'html/body') ?? target;
        const range = body.selfClosed ? undefined : { start: body.contentStart, end: body.contentEnd };
        return { value: paragraphs(body), span: range, present: true, writable: writable && !body.selfClosed, node: new XmlTextNode(target, range, true) };
      }
      if (target.selfClosed) return { value: '', present: true, writable, node: new XmlTextNode(target, undefined, false) };
      const firstChild = target.elements[0];
      const range = { start: target.contentStart, end: firstChild?.own.start ?? target.contentEnd };
      let value = '';
      for (const node of target.content) {
        if (node instanceof XmlElement) break;
        value += node.text;
      }
      return { value, span: range, present: true, writable, node: new XmlTextNode(target, range, false), wire: value };
    }
    return readOnlyAbsent(messages.xmlEntryHasNoSlot(slotText(slot)));
  }

  readRaw(entry: Entry, name: string): SlotRead {
    return entry instanceof XmlElement ? readAttribute(entry, name) : absentSlot;
  }

  headerHolds(header: HeaderSettings): boolean {
    if (header.line === undefined) return true;
    if (!this.document) return false;
    try {
      return this.regex(header.line, false).isMatch(this.text.textOf(this.document.startTag));
    } catch (error) {
      if (error instanceof RegexBudgetError) return false;
      throw error;
    }
  }

  // ---- writing (FBL 6) ----

  format(read: SlotRead, binding: AttributeBinding | undefined, value: unknown): string {
    const written = binding ? wire(binding, value, read.wire) ?? plain(value, binding) : plain(value);
    const node = read.node instanceof OverrideNode ? read.node.node : read.node;
    if (node instanceof XmlTextNode) return node.html ? htmlParagraphs(written) : escapeText(written);
    return escapeAttribute(written);
  }

  write(plan: SplicePlan, element: ReadElement, changes: readonly SlotChange[]): void {
    const owner = element.entry as XmlElement;
    for (const change of changes) {
      const read = change.read;
      const binding = change.binding;
      const node = read.node instanceof OverrideNode ? read.node.node : read.node;
      if (isAttribute(node) && read.present) {
        if (change.isEmpty && binding.empty === 'remove') {
          plan.add('remove-key', this.whitespaceBefore(node.own.start), node.own.end, '');
        } else {
          const written = this.format(read, binding, change.value);
          if (written !== this.text.textOf(node.value)) plan.addAt('replace-value', node.value, written);
        }
        continue;
      }
      if (node instanceof XmlTextNode && read.present) {
        const removesChild = node.element !== owner && (binding.create !== undefined || read.node instanceof OverrideNode);
        if (change.isEmpty && binding.empty === 'remove' && removesChild) {
          this.removeChild(plan, node.element.parent as XmlElement, node.element);
        } else if (node.span) {
          const written = this.format(read, binding, change.value);
          if (written !== this.text.textOf(node.span)) plan.addAt('replace-value', node.span, written);
        } else {
          this.open(plan, node.element, this.format(read, binding, change.value), 'replace-value', true);
        }
        continue;
      }
      if (binding.attribute !== undefined) {
        if (!(node instanceof XmlElement)) refuse(messages.xmlNoChild(this.binding.name, binding.child, binding.attribute));
        const offset = node.attributes.length > 0 ? node.attributes[node.attributes.length - 1].own.end : node.nameEnd;
        plan.add('insert-key', offset, offset, ` ${binding.attribute}="${this.format(read, binding, change.value)}"`);
        continue;
      }
      if (binding.text && binding.create) {
        const content = this.format({ ...read, node: new XmlTextNode(owner, undefined, binding.htmlParagraphs) }, binding, change.value);
        this.createChild(plan, owner, binding.create, render(binding.create.emit, (placeholder) => (placeholder === 'value' ? content : undefined)));
        continue;
      }
      refuse(messages.xmlNoElement(this.binding.name, binding.child, change.attribute));
    }
  }

  /** The start of the whitespace directly before `offset`. */
  private whitespaceBefore(from: number): number {
    let offset = from;
    while (offset > 0 && isSpace(this.text.bytes[offset - 1])) offset--;
    return offset;
  }

  /** The bytes from the start of an element's line to its first byte. */
  private indentOf(entry: Entry): string {
    return this.text.text(this.text.lines[this.text.lineIndexAt(entry.own.start)].start, entry.own.start);
  }

  private childIndent(parent: XmlElement): string {
    return this.indentOf(parent) + this.indentation(this.step);
  }

  /**
   * Opens a self-closed element to hold `content` (FBL 6.1 `self-close`): its `/>` becomes `>`, the
   * content follows on its own line, and a new end tag closes it on the line after, at the
   * element's indentation.
   */
  private open(plan: SplicePlan, element: XmlElement, content: string, operation: SpliceOperation, inline = false): void {
    const at = element.close.end;
    plan.addAt('self-close', element.close, '>');
    if (inline || !element.lineSpan) {
      plan.add(operation, at, at, content);
      plan.add('self-close', at, at, `</${element.name}>`);
      return;
    }
    const newline = this.newlineAt(element.close.start);
    plan.add(operation, at, at, newline + this.childIndent(element) + content);
    plan.add('self-close', at, at, `${newline}${this.indentOf(element)}</${element.name}>`);
  }

  /** Appends `content` as the element's last child, on its own line when the last child is on one (FBL 6.3). */
  private append(plan: SplicePlan, element: XmlElement, content: string, operation: SpliceOperation): void {
    if (element.selfClosed) {
      this.open(plan, element, content, operation);
      return;
    }
    const children = element.elements;
    const last = children[children.length - 1];
    if (last) {
      if (last.lineSpan) {
        const lineOfLast = this.text.lines[this.text.lineIndexAt(last.own.end - 1)];
        const ending = lineOfLast.ending.length > 0 ? lineOfLast.ending : this.newlineAt(last.own.end);
        plan.add(operation, last.lineSpan.end, last.lineSpan.end, this.indentOf(last) + content + ending);
      } else {
        plan.add(operation, last.own.end, last.own.end, content);
      }
      return;
    }
    const end = element.endTag!;
    if (this.onlyWhitespaceBefore(end.start) && this.text.lineIndexAt(end.start) !== this.text.lineIndexAt(element.startTag.end)) {
      const lineStart = this.text.lines[this.text.lineIndexAt(end.start)].start;
      plan.add(operation, lineStart, lineStart, this.childIndent(element) + content + this.newlineAt(lineStart));
      return;
    }
    plan.add(operation, end.start, end.start, content);
  }

  /** A child element holding a value (FBL 5.2 `create`), placed first, last or before the first child of a name. */
  private createChild(plan: SplicePlan, element: XmlElement, create: CreateChild, content: string): void {
    if (element.selfClosed) {
      this.open(plan, element, content, 'insert-key');
      return;
    }
    const before = create.place === 'first'
      ? element.elements[0]
      : create.place === 'before' ? element.elements.find((child) => child.name === create.before) : undefined;
    if (!before) {
      this.append(plan, element, content, 'insert-key');
      return;
    }
    if (before.lineSpan) {
      const offset = this.text.lines[this.text.lineIndexAt(before.own.start) - 1].contentEnd;
      plan.add('insert-key', offset, offset, this.newlineAt(offset) + this.indentOf(before) + content);
      return;
    }
    plan.add('insert-key', before.own.start, before.own.start, content);
  }

  /**
   * Removes a child element holding a value with the line break before it (`remove-key`), and
   * closes the parent again when only whitespace is left in it (`self-close`).
   */
  private removeChild(plan: SplicePlan, parent: XmlElement, child: XmlElement): void {
    const line = this.text.lineIndexAt(child.own.start);
    let range: Span = child.lineSpan && line > 0 ? { start: this.text.lines[line - 1].contentEnd, end: child.own.end } : child.own;
    if (range.start < parent.contentStart) range = { start: parent.contentStart, end: range.end };
    const end = parent.endTag;
    const closes = end !== undefined
      && this.isWhitespace({ start: parent.contentStart, end: range.start })
      && this.isWhitespace({ start: range.end, end: end.start });
    if (!closes || !end) {
      plan.addAt('remove-key', range, '');
      return;
    }
    plan.add('self-close', parent.close.start, range.start, '/>');
    plan.addAt('remove-key', range, '');
    plan.add('self-close', range.end, end.end, '');
  }

  insert(plan: SplicePlan, request: InsertRequest): void {
    const settings = request.rule.insert!;
    const contained = settings.container !== undefined && this.root
      ? (select(selectorStart(settings.container, this.root, undefined), settings.container, this.attributeEquals)[0]?.entry as XmlElement | undefined)
      : undefined;
    const parent = (request.parent?.entry instanceof XmlElement ? request.parent.entry : undefined) ?? contained ?? this.document;
    if (!parent) refuse(messages.xmlNoParent(this.binding.name, request.rule.type));
    const text = settings.emit !== undefined
      ? render(settings.emit, (name) => {
        switch (name) {
          case 'id': return request.id === undefined ? undefined : escapeAttribute(request.id);
          case 'source': return request.source ? escapeAttribute(request.source.key) : undefined;
          case 'target': return request.target ? escapeAttribute(request.target.key) : undefined;
          default: {
            const value = request.values.get(name);
            const binding = request.rule.attributes.find(([attribute]) => attribute === name)?.[1];
            return value !== null && value !== undefined ? escapeAttribute(plain(value, binding)) : undefined;
          }
        }
      })
      : newElement(request);
    const first = parent.elements[0];
    if (settings.place === 'start' && first) {
      if (first.lineSpan) {
        const lineStart = this.text.lines[this.text.lineIndexAt(first.own.start)].start;
        plan.add('insert-entry', lineStart, lineStart, this.indentOf(first) + text + this.newlineAt(lineStart));
      } else {
        plan.add('insert-entry', first.own.start, first.own.start, text);
      }
      return;
    }
    this.append(plan, parent, text, 'insert-entry');
  }

  remove(plan: SplicePlan, element: ReadElement): void {
    const entry = element.entry as XmlElement;
    if (entry === this.document) refuse(messages.xmlDocumentElement(this.binding.name));
    plan.addAt('remove-entry', entry.removalSpan, '');
  }
}

const isAttribute = (node: unknown): node is XmlAttribute => typeof node === 'object' && node !== null && (node as XmlAttribute).kind === 'attribute';

function isNameByte(b: number, first: boolean): boolean {
  if (b >= 0x80 || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x3a) return true;
  return !first && ((b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x2e);
}

function readAttribute(element: XmlElement, name: string): SlotRead {
  const attribute = element.attribute(name);
  if (attribute) return { value: attribute.text, span: attribute.value, present: true, writable: element.unreadable === undefined, node: attribute, wire: attribute.text };
  return { ...absentSlot, node: element };
}

/** An element's own character data, references decoded. */
const ownText = (element: XmlElement): string => element.content.map((node) => (node instanceof XmlElement ? '' : node.text)).join('');

/** All character data inside an element, its descendants' included. */
const allText = (element: XmlElement): string => element.content.map((node) => (node instanceof XmlElement ? allText(node) : node.text)).join('');

function descendants(element: XmlElement): XmlElement[] {
  return element.elements.flatMap((child) => [child, ...descendants(child)]);
}

/** White space inside a paragraph collapsed to one space, and none at its ends. */
function collapse(text: string): string {
  let collapsed = '';
  let space = false;
  for (let i = 0; i < text.length; i++) {
    if (isWhiteSpaceCode(text.charCodeAt(i))) space = true;
    else {
      if (space) collapsed += ' ';
      space = false;
      collapsed += text[i];
    }
  }
  return trim(space ? `${collapsed} ` : collapsed);
}

/** An html body as plain text (FBL 4.5): one line for each `p` element, whitespace inside a paragraph collapsed. */
function paragraphs(body: XmlElement): string {
  const found = descendants(body).filter((element) => element.name === 'p');
  if (found.length === 0) return collapse(allText(body));
  return found.map((paragraph) => collapse(allText(paragraph))).join('\n');
}

/** Text escaping (FBL 4.5): `&`, `<` and `>`. */
export const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Attribute escaping (FBL 4.5): the text escapes, and `"`, LF and CR. */
export const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;').replaceAll('\n', '&#xa;').replaceAll('\r', '&#xd;');

/** Plain text as html paragraphs (FBL 4.5): one `<p>line</p>` for each line. */
export const htmlParagraphs = (value: string): string =>
  (value.length === 0 ? '' : value.replaceAll('\r\n', '\n').split('\n').map((line) => `<p>${escapeText(line)}</p>`).join(''));

/** A new element without an `emit`: the rule's element name with its attributes in `insert.keys` order, then binding order (FBL 6.3). */
function newElement(request: InsertRequest): string {
  const rule = request.rule;
  const segments = rule.at!.split('/').filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  const bracket = last.indexOf('[');
  const name = bracket > 0 ? last.slice(0, bracket) : last;
  const written: [string, string][] = [];
  if (rule.id?.from?.attribute !== undefined && request.id !== undefined) written.push([rule.id.from.attribute, request.id]);
  for (const [attribute, binding] of rule.attributes) {
    const value = request.values.get(attribute);
    if (binding.attribute !== undefined && binding.child === undefined && value !== null && value !== undefined) written.push([binding.attribute, plain(value, binding)]);
  }
  if (rule.source?.attribute !== undefined && request.source) written.push([rule.source.attribute, request.source.key]);
  if (rule.target?.attribute !== undefined && request.target) written.push([rule.target.attribute, request.target.key]);
  const keys = rule.insert!.keys;
  const rank = (attribute: string): number => (keys.includes(attribute) ? keys.indexOf(attribute) : keys.length);
  const ordered = written.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.index - b.index).map(({ entry }) => entry);
  return `<${name}${ordered.map(([attribute, value]) => ` ${attribute}="${escapeAttribute(value)}"`).join('')}/>`;
}
