import { findingCodes, type Finding } from '../finding';
import { messages } from '../messages';
import type { Span } from '../span';
import { BodyText } from '../text/bodyText';
import { byteLength, isWhiteSpace, trim, trimEnd, trimEndOf, trimStart } from '../text/utf8';

export interface RegistrationHeader {
  readonly key: string;
  readonly value: string;
  readonly line: Span;
}

/** One `key: value` entry of a block, the key being everything before the line's last `": "`. */
export interface RegistrationEntry {
  readonly key: string;
  readonly value: string;
  readonly keySpan: Span;
  readonly valueSpan: Span;
  readonly line: Span;
  readonly indent: number;
}

/** A block: its name line, its whole span, and its entries in order. */
export interface RegistrationBlock {
  readonly name: string;
  readonly nameLine: Span;
  readonly span: Span;
  readonly entries: readonly RegistrationEntry[];
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

/** The headers FBL itself defines (FBL 8.1); a binding declares others. */
export const fblHeaders: readonly string[] = ['body', 'view', 'resource'];

const numberForm = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

/** A layout entry's `x y`, nothing when the value is not two numbers. */
export function positionOf(entry: RegistrationEntry): Position | undefined {
  const parts = entry.value.split(' ').filter((part) => part.length > 0);
  if (parts.length !== 2 || !numberForm.test(parts[0]) || !numberForm.test(parts[1])) return undefined;
  return { x: Number(parts[0]), y: Number(parts[1]) };
}

/**
 * A registration (`.adp`) in the line form of FBL 8.1: the origin on line 1, headers, the
 * `layout:` and `identities:` blocks, and whatever follows them kept as unbound content. Every part
 * keeps its span, so the registration is written by splices like any body (FBL 8.4).
 */
export class RegistrationDocument {
  /** The origin of the tool type (FBL 8.1, line 1). */
  origin = '';

  headerList: readonly RegistrationHeader[] = [];

  layout?: RegistrationBlock;

  identities?: RegistrationBlock;

  /** Where a new block goes: the end of the header region's last line. */
  afterHeaders = 0;

  /** Content after the blocks that FBL does not read, kept byte for byte. */
  unbound: Span = { start: 0, end: 0 };

  private constructor(readonly text: BodyText) {}

  /** The headers in the order they are written; a header written twice keeps its first value. */
  get headers(): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const header of this.headerList) {
      if (!map.has(header.key)) map.set(header.key, header.value);
    }
    return map;
  }

  header(key: string): string | undefined {
    return this.headerList.find((header) => header.key === key)?.value;
  }

  get body(): string | undefined {
    return this.header('body');
  }

  get view(): string | undefined {
    return this.header('view');
  }

  get resource(): string | undefined {
    return this.header('resource');
  }

  /** The positions of the layout block by id; an entry whose value is not two numbers is left out. */
  positions(): ReadonlyMap<string, Position> {
    const positions = new Map<string, Position>();
    for (const entry of this.layout?.entries ?? []) {
      const position = positionOf(entry);
      if (position) positions.set(entry.key, position);
    }
    return positions;
  }

  /** The identities block as natural key to id (FBL 8.6). */
  identityMap(): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.identities?.entries ?? []) {
      if (!map.has(entry.key)) map.set(entry.key, entry.value);
    }
    return map;
  }

  /** The headers neither FBL nor the binding declares, reported as `fbl.unknown-header` (FBL 8.1). */
  unknownHeaders(declared: readonly string[], fileName: string): Finding[] {
    const findings: Finding[] = [];
    for (const header of this.headerList) {
      if (fblHeaders.includes(header.key) || declared.includes(header.key)) continue;
      findings.push(this.finding(findingCodes.unknownHeader, messages.unknownHeader(header.key), header.line, fileName));
    }
    return findings;
  }

  /**
   * Layout entries for ids the model does not have (FBL 8.5): reported as `fbl.stale-view-data`,
   * applied to nothing, and removed at the registration's next write.
   */
  staleEntries(ids: ReadonlySet<string>, fileName: string): Finding[] {
    const findings: Finding[] = [];
    for (const entry of this.layout?.entries ?? []) {
      if (ids.has(entry.key)) continue;
      findings.push(this.finding(findingCodes.staleViewData, messages.staleLayoutEntry(entry.key), entry.keySpan, fileName));
    }
    return findings;
  }

  private finding(code: string, message: string, range: Span, fileName: string): Finding {
    const { line, column } = this.text.position(range.start);
    return { code, severity: 'info', message, location: { file: fileName, line, column, length: this.text.codePoints(range.start, range.end) } };
  }

  /** Reads a registration. The line form has no syntax error: anything not understood is unbound content. */
  static read(bytes: Uint8Array): RegistrationDocument {
    const text = new BodyText(bytes);
    const document = new RegistrationDocument(text);
    const lines = text.lines;
    const contentOf = (index: number): string => text.text(lines[index].start, lines[index].contentEnd);
    document.origin = trim(text.text(text.bomLength, lines[0].contentEnd));
    document.afterHeaders = lines[0].end;
    let index = 1;
    const headers: RegistrationHeader[] = [];
    for (; index < lines.length; index++) {
      const line = lines[index];
      const content = contentOf(index);
      if (trim(content).length === 0) continue;
      if (blockName(content) !== undefined) break;
      const separator = content.indexOf(': ');
      if (separator <= 0 || isWhiteSpace(content[0])) break;
      headers.push({ key: content.slice(0, separator), value: trim(content.slice(separator + 2)), line: { start: line.start, end: line.end } });
      document.afterHeaders = line.end;
    }
    document.headerList = headers;
    while (index < lines.length) {
      const content = contentOf(index);
      if (trim(content).length === 0) {
        index++;
        continue;
      }
      const name = blockName(content);
      if (name === undefined || (name === 'layout' && document.layout) || (name === 'identities' && document.identities)) break;
      const read = readBlock(text, name, index);
      index = read.next;
      if (name === 'layout') document.layout = read.block;
      else document.identities = read.block;
    }
    document.unbound = { start: index < lines.length ? lines[index].start : text.length, end: text.length };
    return document;
  }
}

function blockName(content: string): 'layout' | 'identities' | undefined {
  const name = trimEndOf(content, ' \t');
  return name === 'layout:' ? 'layout' : name === 'identities:' ? 'identities' : undefined;
}

function readBlock(text: BodyText, name: string, at: number): { block: RegistrationBlock; next: number } {
  const header = text.lines[at];
  const entries: RegistrationEntry[] = [];
  let end = header.end;
  let index = at + 1;
  while (index < text.lines.length) {
    const line = text.lines[index];
    const content = text.text(line.start, line.contentEnd);
    if (content.length === 0 || !isWhiteSpace(content[0]) || trim(content).length === 0) break;
    const separator = content.lastIndexOf(': ');
    if (separator < 0) break;
    const keyStart = content.length - trimStart(content).length;
    const key = content.slice(keyStart, separator);
    const valueText = content.slice(separator + 2);
    const keyOffset = line.start + byteLength(content.slice(0, keyStart));
    const valueOffset = line.start + byteLength(content.slice(0, separator + 2));
    entries.push({
      key,
      value: trim(valueText),
      keySpan: { start: keyOffset, end: keyOffset + byteLength(key) },
      valueSpan: { start: valueOffset, end: valueOffset + byteLength(trimEnd(valueText)) },
      line: { start: line.start, end: line.end },
      indent: keyStart,
    });
    end = line.end;
    index++;
  }
  return { block: { name, nameLine: { start: header.start, end: header.end }, span: { start: header.start, end }, entries }, next: index };
}
