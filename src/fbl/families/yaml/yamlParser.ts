import { messages } from '../../messages';
import { celOf, TreeEntry, TreeValue } from '../../rules/treeFamily';
import type { Span } from '../../span';
import type { BodyText } from '../../text/bodyText';
import { readFlow } from './flowReader';
import { decodeDouble, decodeSingle, typed } from './yamlScalars';

const SPACE = 0x20;
const TAB = 0x09;
const HASH = 0x23;
const DASH = 0x2d;
const COLON = 0x3a;
const DOUBLE = 0x22;
const SINGLE = 0x27;
const BACKSLASH = 0x5c;

const isBlank = (b: number): boolean => b === SPACE || b === TAB;
const code = (character: string): number => character.charCodeAt(0);

export class YamlError extends Error {
  constructor(readonly offset: number, message: string) {
    super(message);
  }
}

interface Key {
  readonly name: string;
  readonly span: Span;
  readonly colon: number;
}

/**
 * The lossless reading of a YAML body's first document (FBL 4.3): block mappings and sequences,
 * plain, quoted and block scalars, flow collections as one value, anchors and aliases, every node
 * with its span as written. Whether the stream is well-formed is judged before this runs
 * (yamlFamily.ts); this parser takes the structure and the spans.
 */
export class YamlParser {
  private readonly bytes: Uint8Array;
  private readonly anchors = new Map<string, TreeValue>();
  private line = 0;
  private end = 0;

  readonly leaves: Span[] = [];

  /** Duplicate keys found: the key spans of the second and later occurrences. */
  readonly duplicates: { name: string; span: Span }[] = [];

  /** Where the first document ends; everything after it is unbound (FBL 4.3). */
  documentEnd = 0;

  constructor(private readonly text: BodyText) {
    this.bytes = text.bytes;
  }

  parseDocument(): TreeValue {
    const lines = this.text.lines;
    this.line = 0;
    while (this.line < lines.length) {
      const p = this.firstNonSpace(this.line);
      if (p < lines[this.line].contentEnd && this.bytes[p] === code('%')) {
        this.line++;
        continue;
      }
      if (this.isMarker(this.line, '---')) {
        this.line++;
        break;
      }
      if (this.isSignificant(this.line)) break;
      this.line++;
    }
    this.end = lines.length;
    for (let i = this.line; i < lines.length; i++) {
      if (this.isMarker(i, '---') || this.isMarker(i, '...')) {
        this.end = i;
        break;
      }
    }
    this.documentEnd = this.end < lines.length ? lines[this.end].start : this.text.length;
    if (this.documentEnd < this.text.length) this.leaves.push({ start: this.documentEnd, end: this.text.length });
    const root = this.parseBlockNode(-1, false) ?? empty(this.text.bomLength);
    const rest = this.nextSignificant(this.line);
    if (rest < this.end) throw new YamlError(this.firstNonSpace(rest), messages.yamlNotContinued);
    return root;
  }

  // ---- lines ----

  private lineStart(line: number): number {
    return line === 0 ? Math.max(this.text.lines[0].start, this.text.bomLength) : this.text.lines[line].start;
  }

  private contentEnd(line: number): number {
    return this.text.lines[line].contentEnd;
  }

  private firstNonSpace(line: number): number {
    let p = this.lineStart(line);
    const end = this.contentEnd(line);
    while (p < end && isBlank(this.bytes[p])) p++;
    return p;
  }

  private isSignificant(line: number): boolean {
    const p = this.firstNonSpace(line);
    return p < this.contentEnd(line) && this.bytes[p] !== HASH;
  }

  private nextSignificant(from: number): number {
    let line = from;
    while (line < this.end && !this.isSignificant(line)) line++;
    return line;
  }

  private isMarker(line: number, marker: string): boolean {
    const start = this.lineStart(line);
    const end = this.contentEnd(line);
    if (end - start < 3 || this.text.text(start, start + 3) !== marker) return false;
    return start + 3 === end || isBlank(this.bytes[start + 3]);
  }

  private column(line: number, offset: number): number {
    return offset - this.lineStart(line);
  }

  private isDash(line: number, p: number): boolean {
    return this.bytes[p] === DASH && (p + 1 === this.contentEnd(line) || isBlank(this.bytes[p + 1]));
  }

  private atLineEnd(line: number, from: number): boolean {
    let p = from;
    while (p < this.contentEnd(line) && isBlank(this.bytes[p])) p++;
    return p >= this.contentEnd(line) || (this.bytes[p] === HASH && (p === this.lineStart(line) || isBlank(this.bytes[p - 1])));
  }

  private skipSpaces(line: number, from: number): number {
    let p = from;
    while (p < this.contentEnd(line) && isBlank(this.bytes[p])) p++;
    return p;
  }

  // ---- block structure ----

  private parseBlockNode(parentIndent: number, sequenceAtParent: boolean): TreeValue | undefined {
    const line = this.nextSignificant(this.line);
    if (line >= this.end) return undefined;
    const p = this.firstNonSpace(line);
    const column = this.column(line, p);
    if (column < parentIndent) return undefined;
    if (column === parentIndent && !(sequenceAtParent && this.isDash(line, p))) return undefined;
    this.line = line;
    if (this.isDash(line, p)) return this.parseSequence(line, p, column);
    if (this.keyAt(line, p)) return this.parseMapping(line, p, column);
    return this.parseInline(line, p, parentIndent);
  }

  private parseSequence(firstLine: number, first: number, column: number): TreeValue {
    const value = new TreeValue('sequence', 'block', { start: first, end: first });
    let line = firstLine;
    let p = first;
    for (;;) {
      const dash = p;
      const q = this.skipSpaces(line, p + 1);
      let item: TreeValue;
      if (this.atLineEnd(line, q)) {
        this.line = line + 1;
        item = this.parseBlockNode(column, false) ?? empty(dash + 1);
      } else {
        this.line = line;
        item = this.parseContentAfterIndicator(line, q, column);
      }
      value.entries.push(new TreeEntry({ start: dash, end: endOf(item, dash + 1) }, undefined, column, item));
      const next = this.nextSignificant(this.line);
      if (next >= this.end) break;
      const np = this.firstNonSpace(next);
      if (this.column(next, np) !== column || !this.isDash(next, np)) break;
      line = next;
      p = np;
      this.line = next;
    }
    value.span = { start: value.entries[0].own.start, end: value.entries[value.entries.length - 1].own.end };
    return value;
  }

  private parseContentAfterIndicator(line: number, q: number, parentIndent: number): TreeValue {
    const column = this.column(line, q);
    if (this.isDash(line, q)) return this.parseSequence(line, q, column);
    if (this.keyAt(line, q)) return this.parseMapping(line, q, column);
    return this.parseInline(line, q, parentIndent);
  }

  private parseMapping(firstLine: number, first: number, column: number): TreeValue {
    const value = new TreeValue('mapping', 'block', { start: first, end: first });
    const names = new Set<string>();
    let line = firstLine;
    let p = first;
    for (;;) {
      const key = this.keyAt(line, p);
      if (!key) throw new YamlError(p, messages.yamlKeyExpected);
      this.leaves.push(key.span);
      const q = this.skipSpaces(line, key.colon + 1);
      let member: TreeValue;
      if (this.atLineEnd(line, q)) {
        this.line = line + 1;
        member = this.parseBlockNode(column, true) ?? empty(key.colon + 1);
      } else {
        this.line = line;
        member = this.parseInline(line, q, column);
      }
      const entry = new TreeEntry({ start: key.span.start, end: endOf(member, key.colon + 1) }, key.name, column, member, key.span);
      if (key.name === '<<' && member.merged.length > 0) value.merged.push(...member.merged);
      if (names.has(key.name)) this.duplicates.push({ name: key.name, span: key.span });
      else {
        names.add(key.name);
        value.entries.push(entry);
      }
      const next = this.nextSignificant(this.line);
      if (next >= this.end) break;
      const np = this.firstNonSpace(next);
      const nextColumn = this.column(next, np);
      if (nextColumn > column) throw new YamlError(np, messages.yamlTooDeep);
      if (nextColumn < column || !this.keyAt(next, np)) break;
      line = next;
      p = np;
      this.line = next;
    }
    const entries = value.entries;
    value.span = { start: entries.length > 0 ? entries[0].own.start : p, end: entries.length > 0 ? entries[entries.length - 1].own.end : p };
    return value;
  }

  /** A mapping key at `p`: plain, or quoted on one line, followed by `:` and a space or the line's end. */
  private keyAt(line: number, p: number): Key | undefined {
    const end = this.contentEnd(line);
    const bytes = this.bytes;
    const b = bytes[p];
    if (b === DOUBLE || b === SINGLE) {
      let k = p + 1;
      while (k < end) {
        if (bytes[k] === BACKSLASH && b === DOUBLE) {
          k += 2;
          continue;
        }
        if (bytes[k] === b) {
          if (b === SINGLE && k + 1 < end && bytes[k + 1] === SINGLE) {
            k += 2;
            continue;
          }
          break;
        }
        k++;
      }
      if (k >= end) return undefined;
      const colon = this.skipSpaces(line, k + 1);
      if (colon >= end || bytes[colon] !== COLON || !(colon + 1 === end || isBlank(bytes[colon + 1]))) return undefined;
      const inner = this.text.text(p + 1, k);
      return { name: b === DOUBLE ? decodeDouble(inner) : decodeSingle(inner), span: { start: p, end: k + 1 }, colon };
    }
    if ('[{#&*!|>%@`'.includes(String.fromCharCode(b))) return undefined;
    if (b === code('?') && (p + 1 === end || isBlank(bytes[p + 1]))) throw new YamlError(p, messages.yamlExplicitKey);
    if (this.isDash(line, p)) return undefined;
    for (let k = p; k < end; k++) {
      const c = bytes[k];
      if (c === HASH && k > p && isBlank(bytes[k - 1])) return undefined;
      if (c !== COLON || !(k + 1 === end || isBlank(bytes[k + 1]))) continue;
      let keyEnd = k;
      while (keyEnd > p && isBlank(bytes[keyEnd - 1])) keyEnd--;
      if (keyEnd === p) return undefined;
      return { name: this.text.text(p, keyEnd), span: { start: p, end: keyEnd }, colon: k };
    }
    return undefined;
  }

  // ---- values ----

  private parseInline(line: number, from: number, parentIndent: number): TreeValue {
    let q = from;
    let anchor: string | undefined;
    while (this.bytes[q] === code('&') || this.bytes[q] === code('!')) {
      const start = q;
      while (q < this.contentEnd(line) && !isBlank(this.bytes[q])) q++;
      if (this.bytes[start] === code('&')) anchor = this.text.text(start + 1, q);
      q = this.skipSpaces(line, q);
      if (this.atLineEnd(line, q)) {
        this.line = line + 1;
        const block = this.parseBlockNode(parentIndent, true) ?? empty(q);
        if (anchor !== undefined) this.anchors.set(anchor, block);
        return block;
      }
    }
    let value: TreeValue;
    switch (this.bytes[q]) {
      case code('*'): value = this.parseAlias(line, q); break;
      case DOUBLE: case SINGLE: value = this.parseQuoted(line, q); break;
      case code('|'): case code('>'): value = this.parseBlockScalar(line, q, parentIndent); break;
      case code('['): case code('{'): value = this.parseFlow(line, q); break;
      default: value = this.parsePlain(line, q, parentIndent); break;
    }
    if (anchor !== undefined) this.anchors.set(anchor, value);
    return value;
  }

  private expectLineEnd(line: number, p: number): void {
    if (!this.atLineEnd(line, p)) throw new YamlError(p, messages.yamlAfterValue);
  }

  private parseAlias(line: number, q: number): TreeValue {
    let p = q + 1;
    while (p < this.contentEnd(line) && !' \t,]}'.includes(String.fromCharCode(this.bytes[p]))) p++;
    const name = this.text.text(q + 1, p);
    const target = this.anchors.get(name);
    if (!target) throw new YamlError(q, messages.yamlAlias(name));
    this.expectLineEnd(line, p);
    this.line = line + 1;
    const span = { start: q, end: p };
    this.leaves.push(span);
    const value = new TreeValue('scalar', 'plain', span, target.text, target.typed, target.kind === 'scalar' ? target.flow : celOf(target), true);
    if (target.kind === 'mapping') value.merged.push(target);
    return value;
  }

  private parseQuoted(line: number, q: number): TreeValue {
    const quote = this.bytes[q];
    let p = q + 1;
    let current = line;
    for (;;) {
      if (p >= this.contentEnd(current)) {
        current++;
        if (current >= this.end) throw new YamlError(q, messages.yamlQuotedNotClosed);
        p = this.lineStart(current);
        continue;
      }
      const b = this.bytes[p];
      if (quote === DOUBLE && b === BACKSLASH) {
        p += 2;
        continue;
      }
      if (b === quote) {
        if (quote === SINGLE && p + 1 < this.contentEnd(current) && this.bytes[p + 1] === SINGLE) {
          p += 2;
          continue;
        }
        break;
      }
      p++;
    }
    const span = { start: q, end: p + 1 };
    this.expectLineEnd(current, p + 1);
    this.line = current + 1;
    this.leaves.push(span);
    const inner = this.text.text(q + 1, p);
    const decoded = quote === DOUBLE ? decodeDouble(inner) : decodeSingle(inner);
    return new TreeValue('scalar', quote === DOUBLE ? 'double' : 'single', span, decoded, decoded);
  }

  private parsePlain(line: number, q: number, parentIndent: number): TreeValue {
    const end = this.plainEnd(line, q);
    let plain = this.text.text(q, end);
    let last = end;
    let current = line;
    let blank = 0;
    for (let next = line + 1; next < this.end; next++) {
      const p = this.firstNonSpace(next);
      if (p >= this.contentEnd(next)) {
        blank++;
        continue;
      }
      if (this.bytes[p] === HASH || this.column(next, p) <= parentIndent) break;
      if (this.keyAt(next, p) || (this.isDash(next, p) && this.column(next, p) <= parentIndent + 1)) break;
      const partEnd = this.plainEnd(next, p);
      plain += blank > 0 ? '\n'.repeat(blank) + this.text.text(p, partEnd) : ` ${this.text.text(p, partEnd)}`;
      blank = 0;
      last = partEnd;
      current = next;
    }
    this.line = current + 1;
    const span = { start: q, end: last };
    this.leaves.push(span);
    return new TreeValue('scalar', 'plain', span, plain, typed(plain));
  }

  private plainEnd(line: number, q: number): number {
    const end = this.contentEnd(line);
    let p = q;
    while (p < end) {
      if (this.bytes[p] === HASH && p > q && isBlank(this.bytes[p - 1])) break;
      p++;
    }
    while (p > q && isBlank(this.bytes[p - 1])) p--;
    return p;
  }

  private parseBlockScalar(line: number, q: number, parentIndent: number): TreeValue {
    const literal = this.bytes[q] === code('|');
    let p = q + 1;
    let chomp = 'c';
    let explicitIndent = 0;
    while (p < this.contentEnd(line) && !isBlank(this.bytes[p])) {
      const c = String.fromCharCode(this.bytes[p]);
      if (c === '+' || c === '-') chomp = c;
      else if (c >= '0' && c <= '9') explicitIndent = Number(c);
      else throw new YamlError(p, messages.yamlBlockHeader);
      p++;
    }
    this.expectLineEnd(line, p);
    const headerEnd = p;
    let indent = explicitIndent > 0 ? Math.max(parentIndent, 0) + explicitIndent : -1;
    const contentLines: number[] = [];
    let trailingBlank = 0;
    let lastContent = -1;
    for (let next = line + 1; next < this.end; next++) {
      const first = this.firstNonSpace(next);
      const isBlankLine = first >= this.contentEnd(next);
      const column = this.column(next, first);
      if (isBlankLine) {
        contentLines.push(next);
        trailingBlank++;
        continue;
      }
      if (indent < 0) {
        if (column <= parentIndent) break;
        indent = column;
      }
      if (column < indent) break;
      contentLines.push(next);
      trailingBlank = 0;
      lastContent = next;
    }
    const style = literal ? 'literal' : 'folded';
    if (lastContent < 0) {
      this.line = line + 1;
      const span = { start: q, end: headerEnd };
      this.leaves.push(span);
      return new TreeValue('scalar', style, span, '', '');
    }
    const texts = contentLines.filter((index) => index <= lastContent).map((index) => {
      const start = Math.min(this.lineStart(index) + indent, this.contentEnd(index));
      return this.text.text(start, this.contentEnd(index));
    });
    let body = literal ? texts.join('\n') : foldBlock(texts);
    if (chomp === '+') body += `\n${'\n'.repeat(trailingBlank)}`;
    else if (chomp !== '-') body += '\n';
    this.line = lastContent + 1;
    const span = { start: q, end: this.contentEnd(lastContent) };
    this.leaves.push(span);
    return new TreeValue('scalar', style, span, body, body);
  }

  private parseFlow(line: number, q: number): TreeValue {
    let depth = 0;
    let current = line;
    let p = q;
    for (;;) {
      if (p >= this.contentEnd(current)) {
        current++;
        if (current >= this.end) throw new YamlError(q, messages.yamlFlowNotClosed);
        p = this.lineStart(current);
        continue;
      }
      const b = this.bytes[p];
      if (b === DOUBLE || b === SINGLE) {
        const quote = b;
        p++;
        for (;;) {
          if (p >= this.contentEnd(current)) {
            current++;
            if (current >= this.end) throw new YamlError(q, messages.yamlFlowQuotedNotClosed);
            p = this.lineStart(current);
            continue;
          }
          if (quote === DOUBLE && this.bytes[p] === BACKSLASH) {
            p += 2;
            continue;
          }
          if (this.bytes[p] === quote) {
            if (quote === SINGLE && p + 1 < this.contentEnd(current) && this.bytes[p + 1] === SINGLE) {
              p += 2;
              continue;
            }
            break;
          }
          p++;
        }
        p++;
        continue;
      }
      if (b === HASH && p > q && isBlank(this.bytes[p - 1])) {
        p = this.contentEnd(current);
        continue;
      }
      if (b === code('[') || b === code('{')) depth++;
      if (b === code(']') || b === code('}')) {
        depth--;
        if (depth === 0) {
          p++;
          break;
        }
      }
      p++;
    }
    this.expectLineEnd(current, p);
    this.line = current + 1;
    const span = { start: q, end: p };
    this.leaves.push(span);
    const raw = this.text.textOf(span);
    return new TreeValue('scalar', this.bytes[q] === code('[') ? 'flowSequence' : 'flowMapping', span, raw, null, readFlow(raw));
  }
}

const empty = (offset: number): TreeValue => new TreeValue('scalar', 'empty', { start: offset, end: offset });

const endOf = (value: TreeValue, fallback: number): number => (value.style === 'empty' ? fallback : value.span.end);

function foldBlock(lines: readonly string[]): string {
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const previous = lines[i - 1];
      const moreIndented = line.startsWith(' ') || previous.startsWith(' ');
      text += line.length === 0 || previous.length === 0 || moreIndented ? '\n' : ' ';
    }
    text += line;
  }
  return text;
}
