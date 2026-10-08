import type { AttributeBinding } from '../documents/types';

// The rules of FBL 6.3 that are the same for every family: numbers, times, maps and the `emit`
// templates of new entries.

/**
 * A number as FBL 6.3 writes it. With `shortest`: an integer's digits, and any other number in
 * ECMAScript's `Number.prototype.toString` form, which is the form FBL names. With `{decimals: n}`:
 * the shortest decimal representation rounded to n decimals, halves away from zero, by its digits
 * and not by the binary value; then trailing zeros and a trailing point dropped, and `-0` written `0`.
 */
export function formatNumber(value: number | bigint, decimals?: number): string {
  if (typeof value === 'bigint') return value.toString();
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  if (decimals === undefined) return String(value);
  const negative = value < 0;
  const rounded = roundDigits(plainDecimal(String(Math.abs(value))), decimals);
  return negative && rounded !== '0' ? `-${rounded}` : rounded;
}

/** A number's shortest representation without an exponent: `1e-7` is `0.0000001`, `1.5e+21` is `1500000000000000000000`. */
function plainDecimal(shortest: string): string {
  const exponent = shortest.indexOf('e');
  if (exponent < 0) return shortest;
  const power = Number(shortest.slice(exponent + 1));
  const [whole, fraction = ''] = shortest.slice(0, exponent).split('.');
  const digits = whole + fraction;
  const point = whole.length + power;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Rounds the digits of a non-negative decimal to `decimals` places, a half going up, and drops what is then superfluous. */
function roundDigits(plain: string, decimals: number): string {
  const [whole, fraction = ''] = plain.split('.');
  let digits = (whole + fraction.slice(0, decimals)).split('').map(Number);
  if (fraction.length > decimals && fraction.charCodeAt(decimals) >= 0x35) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 9) digits[i--] = 0;
    if (i >= 0) digits[i]++;
    else digits = [1, ...digits];
  }
  const kept = Math.min(decimals, fraction.length);
  const text = digits.join('');
  const wholeText = text.slice(0, text.length - kept) || '0';
  const fractionText = text.slice(text.length - kept).replace(/0+$/, '');
  return fractionText.length > 0 ? `${wholeText}.${fractionText}` : wholeText;
}

export const isNumber = (value: unknown): value is number | bigint => typeof value === 'number' || typeof value === 'bigint';

/** A value's written form for families without typed scalars: numbers by the rule above, booleans in lower case. */
export function plain(value: unknown, binding?: AttributeBinding): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isNumber(value)) return formatNumber(value, binding?.decimals);
  return String(value);
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return value instanceof Map ? value.size === 0 : false;
}

/**
 * The wire value for a model value through a `map` (FBL 5.2): the first key in document order
 * whose value matches, unless the value being replaced already maps to it.
 */
export function wire(binding: AttributeBinding, value: unknown, replaced: string | undefined): string | undefined {
  if (!binding.map) return undefined;
  const model = plain(value, binding);
  if (replaced !== undefined && binding.map.some(([key, mapped]) => key === replaced && mapped === model)) return replaced;
  return binding.map.find(([, mapped]) => mapped === model)?.[0];
}

interface Time {
  /** The date as written, `yyyy-MM-dd`. */
  readonly date: string;
  /** The time as written, `HH:mm:ss`, or nothing for a date. */
  readonly time?: string;
  /** The digits of the fraction of a second, without the point. */
  readonly fraction: string;
  /** `Z`, an offset as written, or nothing. */
  readonly offset?: string;
}

const dateForm = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const dateTimeForm = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?\s*(Z|z|[+-][0-9]{2}:?[0-9]{2})?$/;

/** An ISO 8601 date or date-time, read strictly: the fields must be a date and a time that exist. */
function parseTime(text: string): Time | undefined {
  const date = dateForm.exec(text);
  const match = date ?? dateTimeForm.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return undefined;
  if (date) return { date: text, fraction: '' };
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return undefined;
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}:${match[6]}`, fraction: match[7] ?? '', offset: match[8] };
}

/**
 * A date or date-time written with the precision of the value it replaces (FBL 6.3,
 * `time: "keep-precision"`): a date stays a date, a date-time keeps its number of fraction digits,
 * seven at most, and whether it has an offset. Nothing when either is not a date or date-time.
 */
export function keepPrecision(replaced: string, value: string): string | undefined {
  const time = parseTime(value);
  const shape = parseTime(replaced);
  if (!time || !shape) return undefined;
  if (shape.time === undefined) return time.date;
  let text = `${time.date}T${time.time ?? '00:00:00'}`;
  if (shape.fraction.length > 0) text += `.${time.fraction.padEnd(7, '0').slice(0, Math.min(7, shape.fraction.length))}`;
  if (shape.offset !== undefined) {
    if (shape.offset.toUpperCase() === 'Z') text += 'Z';
    else {
      const offset = time.offset === undefined || time.offset.toUpperCase() === 'Z' ? '+00:00' : time.offset;
      text += offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    }
  }
  return text;
}

const isPlaceholderName = (name: string): boolean => /^[A-Za-z0-9_:-]+$/.test(name);

/**
 * Renders an `emit` template (FBL 6.2): placeholders `{name}` replaced by `value`; a `[ … ]`
 * segment written only when every placeholder in it is non-empty. Any other `{` or `}` is literal.
 */
export function render(template: string, value: (name: string) => string | undefined): string {
  let output = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '[') {
      const close = template.indexOf(']', i + 1);
      if (close > 0) {
        let complete = true;
        const rendered = renderPart(template.slice(i + 1, close), (name) => {
          const found = value(name);
          if (found === undefined || found.length === 0) complete = false;
          return found;
        });
        if (complete) output += rendered;
        i = close + 1;
        continue;
      }
    }
    const next = template.indexOf('[', i);
    const end = next < 0 ? template.length : next;
    output += renderPart(template.slice(i, end), value);
    i = end;
    if (next >= 0 && template.indexOf(']', next + 1) < 0) {
      output += '[';
      i++;
    }
  }
  return output;
}

function renderPart(part: string, value: (name: string) => string | undefined): string {
  let output = '';
  let i = 0;
  while (i < part.length) {
    if (part[i] === '{') {
      const close = part.indexOf('}', i + 1);
      if (close > i + 1 && isPlaceholderName(part.slice(i + 1, close))) {
        output += value(part.slice(i + 1, close)) ?? '';
        i = close + 1;
        continue;
      }
    }
    output += part[i];
    i++;
  }
  return output;
}

/** One part of an emit template: a placeholder or a literal, and the optional segment it is in (-1 for none). */
export interface EmitPart {
  readonly placeholder?: string;
  readonly literal?: string;
  readonly segment: number;
}

/** The parts of a template in order, each with the optional segment it sits in. */
export function partsOf(template: string): EmitPart[] {
  const parts: EmitPart[] = [];
  let literal = '';
  let segment = -1;
  let segments = 0;
  const flush = (): void => {
    if (literal.length === 0) return;
    parts.push({ literal, segment });
    literal = '';
  };
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '[' && segment < 0 && template.indexOf(']', i + 1) > 0) {
      flush();
      segment = segments++;
      continue;
    }
    if (c === ']' && segment >= 0) {
      flush();
      segment = -1;
      continue;
    }
    if (c === '{') {
      const close = template.indexOf('}', i + 1);
      if (close > i + 1 && isPlaceholderName(template.slice(i + 1, close))) {
        flush();
        parts.push({ placeholder: template.slice(i + 1, close), segment });
        i = close;
        continue;
      }
    }
    literal += c;
  }
  flush();
  return parts;
}
