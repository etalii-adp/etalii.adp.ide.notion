import type { CelMap } from '../../expressions/cel';
import { trim } from '../../text/utf8';
import { decodeDouble, decodeSingle, fold, typed } from './yamlScalars';

/**
 * Reads a YAML flow collection (`[a, b]`, `{k: v}`) into the values CEL sees (FBL 4.3): its members
 * are readable, while its only writable span is the whole collection.
 */
export function readFlow(text: string): unknown {
  let position = 0;

  const skip = (): void => {
    while (position < text.length) {
      const c = text[position];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') position++;
      else if (c === '#' && (position === 0 || text[position - 1] === ' ' || text[position - 1] === '\t' || text[position - 1] === '\n')) {
        while (position < text.length && text[position] !== '\n') position++;
      } else break;
    }
  };

  const scalar = (key: boolean): unknown => {
    const c = text[position];
    if (c === '"' || c === '\'') {
      const start = ++position;
      while (position < text.length) {
        if (c === '"' && text[position] === '\\') {
          position += 2;
          continue;
        }
        if (text[position] === c) {
          if (c === '\'' && text[position + 1] === '\'') {
            position += 2;
            continue;
          }
          break;
        }
        position++;
      }
      const inner = text.slice(start, Math.min(position, text.length));
      position++;
      return c === '"' ? decodeDouble(inner) : decodeSingle(inner);
    }
    const begin = position;
    while (position < text.length) {
      const d = text[position];
      if (d === ',' || d === ']' || d === '}') break;
      if (d === ':' && (key || position + 1 >= text.length || ' ,]}'.includes(text[position + 1]))) break;
      position++;
    }
    return typed(fold(trim(text.slice(begin, position))));
  };

  const value = (): unknown => {
    skip();
    if (position >= text.length) return null;
    if (text[position] === '[') {
      position++;
      const list: unknown[] = [];
      for (;;) {
        skip();
        if (position >= text.length) return list;
        if (text[position] === ']') {
          position++;
          return list;
        }
        const before = position;
        list.push(value());
        skip();
        if (text[position] === ',') position++;
        // A character no member starts with is passed over, so the reading always ends.
        if (position === before) position++;
      }
    }
    if (text[position] === '{') {
      position++;
      const map: CelMap = new Map();
      for (;;) {
        skip();
        if (position >= text.length) return map;
        if (text[position] === '}') {
          position++;
          return map;
        }
        const before = position;
        const key = scalar(true);
        skip();
        let member: unknown = null;
        if (text[position] === ':') {
          position++;
          member = value();
        }
        map.set(keyText(key), member);
        skip();
        if (text[position] === ',') position++;
        if (position === before) position++;
      }
    }
    return scalar(false);
  };

  return value();
}

/** A flow mapping's key as text, as the baseline's platform writes a value of each type. */
function keyText(key: unknown): string {
  if (key === null || key === undefined) return '';
  if (typeof key === 'boolean') return key ? 'True' : 'False';
  return String(key);
}
