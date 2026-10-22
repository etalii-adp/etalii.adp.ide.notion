// Whether a value converts to the type its specification gives the attribute (FBL 5.2, 7.4). The
// type names are the specification languages' scalar types; a type this module does not know, an
// element type among them, is not checked.

const numberForm = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const integerForm = /^[-+]?[0-9]+$/;
const dateForm = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const dateTimeForm = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[Tt ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?\s*(?:Z|z|[+-][0-9]{2}(?::?[0-9]{2})?)?)?$/;
const timeForm = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?$/;

/** The words a plain yaml scalar says a bool with beside `true` and `false`, as YAML 1.1 reads them (FBL 5.2's table: `yes` is `true`). */
const trueWords = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'on', 'On', 'ON']);
const falseWords = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO', 'off', 'Off', 'OFF']);

/** The types whose value is a text: a slot of one reads a scalar's written text unasked (FBL 5.2). */
export const isTextType = (type: string | undefined): boolean => type === 'string' || type === 'text';

function isDate(year: number, month: number, day: number): boolean {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isDateText(text: string): boolean {
  const match = dateForm.exec(text);
  return match !== null && isDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isDateTimeText(text: string): boolean {
  const match = dateTimeForm.exec(text.trim());
  if (!match || !isDate(Number(match[1]), Number(match[2]), Number(match[3]))) return false;
  return match[4] === undefined || (Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6] ?? 0) <= 59);
}

function isTimeText(text: string): boolean {
  const match = timeForm.exec(text.trim());
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3] ?? 0) <= 59;
}

const isNumberText = (text: string): boolean => numberForm.test(text.trim()) && Number.isFinite(Number(text));

/**
 * Whether a value as a body's family read it converts to an attribute's type (FBL 7.4): typed from
 * yaml and json, always text from xml, lines and blocks, where a text that says a number is one.
 */
export function reads(type: string, value: unknown): boolean {
  switch (type) {
    case 'number': return typeof value === 'bigint' || typeof value === 'number' || (typeof value === 'string' && isNumberText(value));
    case 'int': return typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value)) || (typeof value === 'string' && integerForm.test(value.trim()));
    case 'bool': return typeof value === 'boolean' || value === 'true' || value === 'false';
    case 'date': return typeof value === 'string' && isDateText(value);
    case 'datetime': return typeof value === 'string' && isDateTimeText(value);
    case 'time': return typeof value === 'string' && isTimeText(value);
    default: return true;
  }
}

/** What converting a typed value gave: the value in the attribute's type, or that it does not convert. */
export type Converted = { readonly value: unknown } | undefined;

/**
 * A typed value of a yaml or json scalar converted to an attribute's type (FBL 5.2, "Reading a
 * scalar"): a conversion that loses nothing succeeds (the int 1 to a number, the double 1.0 to an
 * int), any other does not, and a text is neither a number nor a bool. `plain` is the written text
 * of a plain yaml scalar, which says a bool with `yes` and `no` too.
 */
export function convert(type: string, value: unknown, plain?: string): Converted {
  switch (type) {
    case 'number':
      return typeof value === 'bigint' || typeof value === 'number' ? { value } : undefined;
    case 'int':
      if (typeof value === 'bigint') return { value };
      return typeof value === 'number' && Number.isInteger(value) ? { value: BigInt(value) } : undefined;
    case 'bool':
      if (typeof value === 'boolean') return { value };
      if (plain !== undefined && trueWords.has(plain)) return { value: true };
      return plain !== undefined && falseWords.has(plain) ? { value: false } : undefined;
    case 'date':
    case 'datetime':
    case 'time':
      return typeof value === 'string' && reads(type, value) ? { value } : undefined;
    default:
      return { value };
  }
}
