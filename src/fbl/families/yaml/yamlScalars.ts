import { isAsciiDigit, isControl, isWhiteSpace, trimEndOf, trimStartOf } from '../../text/utf8';

// Scalars as the YAML 1.2 core schema reads them, and as FBL 6.3 writes them.

const decimal = /^[-+]?[0-9]+$/;
const octal = /^0o[0-7]+$/;
const hexadecimal = /^0x[0-9a-fA-F]+$/;
const float = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;
const special = /^[-+]?(\.inf|\.Inf|\.INF)$|^(\.nan|\.NaN|\.NAN)$/;
const timestamp = /^[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?([Tt ]|$)/;
const yaml11Number = /^[-+]?([0-9][0-9_]*)?\.?[0-9_]*([eE][-+]?[0-9]+)?$|^0b[01_]+$|^[-+]?0[0-7_]+$|^[-+]?[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?$/;
const minInt = -(2n ** 63n);
const maxInt = 2n ** 63n - 1n;

/** A plain scalar's value by the YAML 1.2 core schema: null, a boolean, an int (a bigint), a float (a number), else the string. */
export function typed(plain: string): unknown {
  switch (plain) {
    case '': case '~': case 'null': case 'Null': case 'NULL': return null;
    case 'true': case 'True': case 'TRUE': return true;
    case 'false': case 'False': case 'FALSE': return false;
  }
  if (decimal.test(plain)) {
    const integer = BigInt(plain.replace(/^\+/, ''));
    if (integer >= minInt && integer <= maxInt) return integer;
  }
  if (octal.test(plain) || hexadecimal.test(plain)) return BigInt(plain);
  if (float.test(plain)) return Number(plain);
  if (special.test(plain)) {
    if (plain.toLowerCase().includes('nan')) return NaN;
    return plain.startsWith('-') ? -Infinity : Infinity;
  }
  return plain;
}

/**
 * FBL 6.3: a string is plain-safe when it is not empty; has no leading or trailing whitespace; no
 * line break or control character; does not start with an indicator; contains neither ': ' nor
 * ' #' and does not end with ':'; and reads back as the same string under the YAML 1.2 core schema
 * and as a string under YAML 1.1, unless the attribute's type is what it would read as (`timeTyped`
 * for a date or date-time attribute).
 */
export function isPlainSafe(value: string, timeTyped: boolean): boolean {
  if (value.length === 0) return false;
  if (isWhiteSpace(value[0]) || isWhiteSpace(value[value.length - 1])) return false;
  for (const c of value) {
    if (c === '\n' || c === '\r' || isControl(c)) return false;
  }
  if ('-?:,[]{}#&*!|>\'"%@`'.includes(value[0])) return false;
  if (value.includes(': ') || value.includes(' #') || value.endsWith(':')) return false;
  if (typeof typed(value) !== 'string') return false;
  if (['yes', 'no', 'on', 'off', 'y', 'n', 'true', 'false', 'null', '~'].includes(value.toLowerCase())) return false;
  if (yaml11Number.test(value) && [...value].some(isAsciiDigit)) return false;
  if (timestamp.test(value)) return timeTyped;
  return true;
}

export function doubleQuoted(value: string): string {
  let text = '"';
  for (const c of value) {
    switch (c) {
      case '\\': text += '\\\\'; break;
      case '"': text += '\\"'; break;
      case '\n': text += '\\n'; break;
      case '\t': text += '\\t'; break;
      case '\r': text += '\\r'; break;
      default:
        text += isControl(c) ? `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : c;
    }
  }
  return `${text}"`;
}

export const singleQuoted = (value: string): string => `'${value.replaceAll('\'', '\'\'')}'`;

/** Decodes a double-quoted scalar's content (without its quotes), folding line breaks as YAML does. */
export function decodeDouble(content: string): string {
  let text = '';
  const folded = fold(content);
  for (let i = 0; i < folded.length; i++) {
    const c = folded[i];
    if (c !== '\\' || i + 1 >= folded.length) {
      text += c;
      continue;
    }
    const e = folded[++i];
    switch (e) {
      case 'n': text += '\n'; break;
      case 't': case '\t': text += '\t'; break;
      case 'r': text += '\r'; break;
      case '0': text += String.fromCharCode(0); break;
      case 'a': text += String.fromCharCode(7); break;
      case 'b': text += String.fromCharCode(8); break;
      case 'e': text += String.fromCharCode(0x1b); break;
      case 'f': text += String.fromCharCode(0x0c); break;
      case 'v': text += String.fromCharCode(0x0b); break;
      case ' ': text += ' '; break;
      case '/': text += '/'; break;
      case '"': text += '"'; break;
      case '\\': text += '\\'; break;
      case 'N': text += String.fromCharCode(0x85); break;
      case '_': text += String.fromCharCode(0xa0); break;
      case 'x': [text, i] = hex(folded, i, 2, text); break;
      case 'u': [text, i] = hex(folded, i, 4, text); break;
      case 'U': [text, i] = hex(folded, i, 8, text); break;
      default: text += `\\${e}`; break;
    }
  }
  return text;
}

/** The character a hexadecimal escape of up to `digits` digits names, appended to `text`; nothing for an invalid one. */
function hex(source: string, i: number, digits: number, text: string): [string, number] {
  const available = Math.min(digits, source.length - i - 1);
  const written = available > 0 ? source.slice(i + 1, i + 1 + available) : '';
  if (!/^[0-9a-fA-F]+$/.test(written)) return [text, i];
  const code = parseInt(written, 16);
  const valid = code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return [valid ? text + String.fromCodePoint(code) : text, i + available];
}

export const decodeSingle = (content: string): string => fold(content).replaceAll('\'\'', '\'');

/** Line folding of flow scalars: a line break and the whitespace around it become a space, an empty line a newline. */
export function fold(content: string): string {
  if (!content.includes('\n')) return content;
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  let text = trimEndOf(lines[0], ' \t');
  let empty = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = i === lines.length - 1 ? trimStartOf(lines[i], ' \t') : trimEndOf(trimStartOf(lines[i], ' \t'), ' \t');
    if (line.length === 0 && i < lines.length - 1) {
      empty++;
      continue;
    }
    text += empty > 0 ? '\n'.repeat(empty) : ' ';
    empty = 0;
    text += line;
  }
  return text;
}
