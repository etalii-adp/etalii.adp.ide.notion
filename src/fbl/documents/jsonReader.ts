import { messages } from '../messages';
import type { Span } from '../span';
import { decode } from '../text/utf8';

/**
 * A node of a JSON text as written: its span in the bytes, and for a number its text, which
 * `JSON.parse` would lose. An object keeps every member in document order, a second one of a name
 * included, with the span of its name and the offset of the comma after it.
 */
export type JsonNode =
  | { readonly kind: 'object'; readonly span: Span; readonly pointer: string; readonly members: readonly JsonMember[] }
  | { readonly kind: 'array'; readonly span: Span; readonly pointer: string; readonly items: readonly JsonItem[] }
  | { readonly kind: 'string'; readonly span: Span; readonly pointer: string; readonly value: string }
  | { readonly kind: 'number'; readonly span: Span; readonly pointer: string; readonly raw: string }
  | { readonly kind: 'true' | 'false' | 'null'; readonly span: Span; readonly pointer: string };

export interface JsonMember {
  readonly name: string;
  /** The name as written, quotes included. */
  readonly keySpan: Span;
  readonly value: JsonNode;
  /** The offset of the comma after this member, or -1. */
  readonly comma: number;
  /** Whether an earlier member of the object has this name. */
  readonly duplicate: boolean;
}

export interface JsonItem {
  readonly value: JsonNode;
  /** The offset of the comma after this item, or -1. */
  readonly comma: number;
}

export class JsonSyntaxError extends Error {
  constructor(readonly offset: number, message: string) {
    super(message);
  }
}

const numberForm = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** A JSON Pointer reference token (RFC 6901). */
export const pointerToken = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Reads one JSON text from `start` to the end of the bytes, accepting exactly RFC 8259: no comment,
 * no trailing comma, no number form JSON does not have. Throws a `JsonSyntaxError` with the offset
 * of the problem. With `pointers`, every node gets its JSON Pointer; without, an empty one.
 */
export function readJson(bytes: Uint8Array, start = 0, pointers = true): JsonNode {
  let position = start;

  const fail = (offset: number, message: string): never => {
    throw new JsonSyntaxError(offset, message);
  };

  const current = (): number => (position < bytes.length ? bytes[position] : 0);

  const skipWhitespace = (): void => {
    while (position < bytes.length) {
      const b = bytes[position];
      if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) position++;
      else if (b === 0x2f) fail(position, messages.jsonComment);
      else break;
    }
  };

  const expect = (expected: string): void => {
    if (current() !== expected.charCodeAt(0)) fail(position, messages.jsonExpected(expected));
    position++;
  };

  const child = (pointer: string, token: string): string => (pointers ? `${pointer}/${pointerToken(token)}` : '');

  const string = (): { text: string; span: Span } => {
    const open = position;
    position++;
    let text = '';
    let run = position;
    for (;;) {
      if (position >= bytes.length) fail(open, messages.jsonStringNotClosed);
      const b = bytes[position];
      if (b === 0x22) break;
      if (b < 0x20) fail(position, messages.jsonControlCharacter);
      if (b !== 0x5c) {
        position++;
        continue;
      }
      text += decode(bytes, run, position);
      position++;
      const escape = current();
      position++;
      switch (escape) {
        case 0x22: text += '"'; break;
        case 0x5c: text += '\\'; break;
        case 0x2f: text += '/'; break;
        case 0x62: text += '\b'; break;
        case 0x66: text += '\f'; break;
        case 0x6e: text += '\n'; break;
        case 0x72: text += '\r'; break;
        case 0x74: text += '\t'; break;
        case 0x75: {
          const hex = position + 4 <= bytes.length ? decode(bytes, position, position + 4) : '';
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(position, messages.jsonUnicodeEscape);
          text += String.fromCharCode(parseInt(hex, 16));
          position += 4;
          break;
        }
        default:
          fail(position - 1, messages.jsonEscape);
      }
      run = position;
    }
    text += decode(bytes, run, position);
    position++;
    return { text, span: { start: open, end: position } };
  };

  const literal = (pointer: string): JsonNode => {
    const open = position;
    // The run a value that is no string, object or array is written as; what it may be is decided below.
    while (position < bytes.length) {
      const b = bytes[position];
      if ((b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x2b || b === 0x2e || b === 0x45) position++;
      else break;
    }
    const raw = decode(bytes, open, position);
    const span = { start: open, end: position };
    if (raw === 'true' || raw === 'false' || raw === 'null') return { kind: raw, span, pointer };
    if (numberForm.test(raw)) return { kind: 'number', span, pointer, raw };
    return fail(open, raw.length === 0 ? messages.jsonValueExpected : messages.jsonNotAValue(raw));
  };

  const value = (pointer: string): JsonNode => {
    if (position >= bytes.length) fail(position, messages.jsonEndsAtValue);
    switch (current()) {
      case 0x7b: return object(pointer);
      case 0x5b: return array(pointer);
      case 0x22: {
        const read = string();
        return { kind: 'string', span: read.span, pointer, value: read.text };
      }
      default: return literal(pointer);
    }
  };

  const object = (pointer: string): JsonNode => {
    const open = position;
    position++;
    const members: JsonMember[] = [];
    const names = new Set<string>();
    skipWhitespace();
    if (current() === 0x7d) {
      position++;
      return { kind: 'object', span: { start: open, end: position }, pointer, members };
    }
    for (;;) {
      skipWhitespace();
      if (current() !== 0x22) fail(position, messages.jsonMemberName);
      const key = string();
      skipWhitespace();
      expect(':');
      skipWhitespace();
      const member = value(child(pointer, key.text));
      const duplicate = names.has(key.text);
      names.add(key.text);
      skipWhitespace();
      if (current() === 0x2c) {
        members.push({ name: key.text, keySpan: key.span, value: member, comma: position, duplicate });
        position++;
        continue;
      }
      members.push({ name: key.text, keySpan: key.span, value: member, comma: -1, duplicate });
      expect('}');
      break;
    }
    return { kind: 'object', span: { start: open, end: position }, pointer, members };
  };

  const array = (pointer: string): JsonNode => {
    const open = position;
    position++;
    const items: JsonItem[] = [];
    skipWhitespace();
    if (current() === 0x5d) {
      position++;
      return { kind: 'array', span: { start: open, end: position }, pointer, items };
    }
    for (;;) {
      skipWhitespace();
      const item = value(child(pointer, String(items.length)));
      skipWhitespace();
      if (current() === 0x2c) {
        items.push({ value: item, comma: position });
        position++;
        continue;
      }
      items.push({ value: item, comma: -1 });
      expect(']');
      break;
    }
    return { kind: 'array', span: { start: open, end: position }, pointer, items };
  };

  skipWhitespace();
  const root = value('');
  skipWhitespace();
  if (position < bytes.length) fail(position, messages.jsonSecondValue);
  return root;
}

/** The first member of an object with a name; nothing for another kind of node. */
export function memberOf(node: JsonNode | undefined, name: string): JsonNode | undefined {
  return node?.kind === 'object' ? node.members.find((member) => member.name === name)?.value : undefined;
}

/** A scalar as text: a string's value, `true`, `false`, nothing for null, and any other value as written. */
export function scalarText(node: JsonNode): string {
  switch (node.kind) {
    case 'string': return node.value;
    case 'true': return 'true';
    case 'false': return 'false';
    case 'null': return '';
    case 'number': return node.raw;
    default: return '';
  }
}

/** A scalar as a value: a string, a `bigint` for a number written as an integer, a `number` otherwise, a boolean, or null. */
export function scalarValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'string': return node.value;
    case 'number': return numberValue(node.raw);
    case 'true': return true;
    case 'false': return false;
    default: return null;
  }
}

const minInt = -(2n ** 63n);
const maxInt = 2n ** 63n - 1n;

/** A JSON number's value: a `bigint` when it is written as an integer that fits 64 bits, else a `number`. */
export function numberValue(raw: string): bigint | number {
  if (/^-?[0-9]+$/.test(raw)) {
    const integer = BigInt(raw);
    if (integer >= minInt && integer <= maxInt) return integer;
  }
  return Number(raw);
}
