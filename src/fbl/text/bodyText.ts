import type { Span } from '../span';
import { decode, firstInvalid } from './utf8';

export type LineEnding = '\r\n' | '\n' | '\r' | '';

/** One line: `start` to `contentEnd` is the line, up to `end` its ending. */
export interface TextLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly ending: LineEnding;
}

const CR = 0x0d;
const LF = 0x0a;

/**
 * A body's bytes with FBL's view of them (FBL 2.6): UTF-8 with or without a byte-order mark, lines
 * and their endings (CRLF, LF or a lone CR), and conversion from a byte offset to a 1-based line
 * and a code-point column. Every offset is a UTF-8 byte offset into the whole file, the mark included.
 */
export class BodyText {
  /** 3 when the body starts with a UTF-8 byte-order mark, else 0. The mark belongs to no node. */
  readonly bomLength: number;

  /** The byte offset of the first invalid UTF-8 sequence, or nothing. */
  readonly invalidOffset: number | undefined;

  readonly lines: readonly TextLine[];

  constructor(readonly bytes: Uint8Array) {
    this.bomLength = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    this.invalidOffset = firstInvalid(bytes, this.bomLength);
    this.lines = linesOf(bytes);
  }

  get length(): number {
    return this.bytes.length;
  }

  get isValidUtf8(): boolean {
    return this.invalidOffset === undefined;
  }

  /** The bytes as text. Only meaningful for valid UTF-8. */
  text(start: number, end: number): string {
    return decode(this.bytes, start, end);
  }

  textOf(range: Span): string {
    return decode(this.bytes, range.start, range.end);
  }

  /**
   * The ending that ends the most lines, CRLF winning a tie with LF; a lone CR counts as neither
   * (FBL 6.3). Nothing when no line has an ending.
   */
  get dominantEnding(): '\r\n' | '\n' | '\r' | undefined {
    let crlf = 0;
    let lf = 0;
    let cr = 0;
    for (const line of this.lines) {
      if (line.ending === '\r\n') crlf++;
      else if (line.ending === '\n') lf++;
      else if (line.ending === '\r') cr++;
    }
    if (crlf === 0 && lf === 0) return cr > 0 ? '\r' : undefined;
    return crlf >= lf ? '\r\n' : '\n';
  }

  /** The line ending a splice at `offset` writes (FBL 6.3). */
  newlineAt(offset: number, fallback: string): string {
    const line = this.lines[this.lineIndexAt(offset)];
    if (line.ending.length > 0) return line.ending;
    return this.dominantEnding ?? fallback;
  }

  /** The 0-based index of the line holding `offset`. */
  lineIndexAt(offset: number): number {
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.lines[middle].start <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  /** The 1-based line and code-point column of `offset`. */
  position(offset: number): { line: number; column: number } {
    const index = this.lineIndexAt(offset);
    let start = this.lines[index].start;
    if (index === 0) start = Math.max(start, this.bomLength);
    return { line: index + 1, column: 1 + this.codePoints(start, offset) };
  }

  /** The number of code points in a range, for a finding's length. */
  codePoints(start: number, end: number): number {
    let count = 0;
    for (let i = start; i < end && i < this.bytes.length; i++) {
      if ((this.bytes[i] & 0xc0) !== 0x80) count++;
    }
    return count;
  }
}

function linesOf(bytes: Uint8Array): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === CR) {
      if (i + 1 < bytes.length && bytes[i + 1] === LF) {
        lines.push({ start, contentEnd: i, end: i + 2, ending: '\r\n' });
        i += 2;
      } else {
        lines.push({ start, contentEnd: i, end: i + 1, ending: '\r' });
        i += 1;
      }
      start = i;
    } else if (b === LF) {
      lines.push({ start, contentEnd: i, end: i + 1, ending: '\n' });
      i += 1;
      start = i;
    } else {
      i++;
    }
  }
  if (start < bytes.length || lines.length === 0) lines.push({ start, contentEnd: bytes.length, end: bytes.length, ending: '' });
  return lines;
}
