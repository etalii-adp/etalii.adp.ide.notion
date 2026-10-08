const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** Text as UTF-8 bytes, without a byte-order mark. */
export const encode = (text: string): Uint8Array => encoder.encode(text);

/** Bytes as text; a byte-order mark is kept as a character, and an invalid sequence becomes U+FFFD. */
export const decode = (bytes: Uint8Array, start = 0, end = bytes.length): string => decoder.decode(bytes.subarray(start, end));

/** The number of bytes a text takes in UTF-8. */
export function byteLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) length += 1;
    else if (unit < 0x800) length += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      length += 4;
      i++;
    } else length += 3;
  }
  return length;
}

/** The offset of the first byte that is not part of a valid UTF-8 sequence, from `start`; nothing when all are. */
export function firstInvalid(bytes: Uint8Array, start: number): number | undefined {
  let i = start;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let length: number;
    let low = 0x80;
    let high = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) length = 2;
    else if (b >= 0xe0 && b <= 0xef) {
      length = 3;
      if (b === 0xe0) low = 0xa0;
      if (b === 0xed) high = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      length = 4;
      if (b === 0xf0) low = 0x90;
      if (b === 0xf4) high = 0x8f;
    } else return i;
    for (let k = 1; k < length; k++) {
      const next = i + k < bytes.length ? bytes[i + k] : -1;
      if (k === 1 ? next < low || next > high : next < 0x80 || next > 0xbf) return i;
    }
    i += length;
  }
  return undefined;
}

// The characters the baseline's platform calls white space and control characters, which is what
// its trimming and its checks of a plain scalar use: the ASCII ones, U+0085 and the Unicode separators.
export function isWhiteSpaceCode(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x85 || code === 0xa0 || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

export const isWhiteSpace = (character: string): boolean => isWhiteSpaceCode(character.charCodeAt(0));

export const isControl = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

export function trimStart(text: string): string {
  let start = 0;
  while (start < text.length && isWhiteSpaceCode(text.charCodeAt(start))) start++;
  return text.slice(start);
}

export function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && isWhiteSpaceCode(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}

export const trim = (text: string): string => trimEnd(trimStart(text));

/** Removes the given characters from the end of a text. */
export function trimEndOf(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

/** Removes the given characters from the start of a text. */
export function trimStartOf(text: string, characters: string): string {
  let start = 0;
  while (start < text.length && characters.includes(text[start])) start++;
  return text.slice(start);
}

export const isAsciiDigit = (character: string): boolean => character >= '0' && character <= '9';

export const isAsciiLetter = (character: string): boolean => (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z');

export const isAsciiLetterOrDigit = (character: string): boolean => isAsciiLetter(character) || isAsciiDigit(character);

/** Ordinal order of two texts: by UTF-16 code unit. */
export const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
