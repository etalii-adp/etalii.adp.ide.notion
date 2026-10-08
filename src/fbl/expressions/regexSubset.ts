import { messages } from '../messages';
import { isAsciiDigit, isAsciiLetter, isAsciiLetterOrDigit } from '../text/utf8';

/**
 * The common subset of RE2, .NET, Java and ECMAScript regular expressions FBL 2.5 allows: literals,
 * `.`, character classes, the escapes `\d \D \s \S \w \W \t \n \r \\` and escaped punctuation, the
 * anchors `^` and `$`, groups, non-capturing groups and named groups, alternation, and the
 * quantifiers `* + ? {n} {n,} {n,m}` with their lazy forms. An expression is parsed into a small
 * tree for the library's own matcher (regexMatcher.ts); what is outside the subset is rejected by name.
 */
export type RegexNode =
  | { readonly kind: 'empty' }
  | { readonly kind: 'char'; readonly code: number }
  | { readonly kind: 'any' }
  | { readonly kind: 'class'; readonly negated: boolean; readonly items: readonly ClassItem[] }
  | { readonly kind: 'start' }
  | { readonly kind: 'end' }
  | { readonly kind: 'group'; readonly name?: string; readonly node: RegexNode }
  | { readonly kind: 'concat'; readonly nodes: readonly RegexNode[] }
  | { readonly kind: 'alternation'; readonly nodes: readonly RegexNode[] }
  | { readonly kind: 'repeat'; readonly node: RegexNode; readonly min: number; readonly max: number; readonly lazy: boolean };

/** A part of a character class: code units `from` to `to`, or everything outside them when `negated`. */
export interface ClassItem {
  readonly ranges: readonly (readonly [number, number])[];
  readonly negated: boolean;
}

export class RegexSyntaxError extends Error {}

/** The most a counted quantifier may repeat; more would only make the matcher's program large. */
const maxRepeat = 1000;

const digits: ClassItem = { ranges: [[0x30, 0x39]], negated: false };
const word: ClassItem = { ranges: [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]], negated: false };
// White space as the baseline's platform has it: the ASCII ones, U+0085 and the Unicode separators.
const space: ClassItem = {
  ranges: [[0x09, 0x0d], [0x20, 0x20], [0x85, 0x85], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000]],
  negated: false,
};
const not = (item: ClassItem): ClassItem => ({ ranges: item.ranges, negated: true });

/** Nothing when `expression` is in the subset; otherwise a sentence naming the construct. */
export function checkRegex(expression: string): string | undefined {
  const named = excluded(expression);
  if (named !== undefined) return named;
  try {
    parseRegex(expression);
    return undefined;
  } catch (error) {
    if (error instanceof RegexSyntaxError) return messages.doesNotCompile(error.message);
    throw error;
  }
}

/** What FBL 2.5 excludes by name: backreferences, lookaround, atomic groups, possessive quantifiers, inline flags, Unicode property classes. */
function excluded(expression: string): string | undefined {
  let inClass = false;
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i];
    if (c === '\\') {
      if (i + 1 >= expression.length) return messages.loneBackslash;
      const next = expression[i + 1];
      if (isAsciiDigit(next) && next !== '0') return messages.backreference(next);
      if (next === 'k') return messages.namedBackreference;
      if (next === 'p' || next === 'P') return messages.unicodeProperty(next);
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    switch (c) {
      case '[':
        inClass = true;
        if (expression[i + 1] === '^') i++;
        if (expression[i + 1] === ']') i++;
        break;
      case '(':
        if (expression[i + 1] === '?') {
          const rest = expression.slice(i + 2);
          if (rest.startsWith(':')) break;
          if (rest.startsWith('<=') || rest.startsWith('<!')) return messages.lookbehind;
          if (rest.startsWith('<')) break;
          if (rest.startsWith('P<')) return messages.pythonGroup;
          if (rest.startsWith('=') || rest.startsWith('!')) return messages.lookahead;
          if (rest.startsWith('>')) return messages.atomicGroup;
          return messages.inlineFlags;
        }
        break;
      case '*':
      case '+':
      case '?':
      case '}':
        if (expression[i + 1] === '+') return messages.possessive;
        break;
    }
  }
  return inClass ? messages.classNotClosed : undefined;
}

/** Parses an expression of the subset; throws a `RegexSyntaxError` for anything else. */
export function parseRegex(expression: string): RegexNode {
  const named = excluded(expression);
  if (named !== undefined) throw new RegexSyntaxError(named);
  const parser = new Parser(expression);
  const node = parser.alternation();
  if (!parser.atEnd) throw new RegexSyntaxError(messages.groupNotOpened);
  return node;
}

class Parser {
  private position = 0;
  private readonly names = new Set<string>();

  constructor(private readonly source: string) {}

  get atEnd(): boolean {
    return this.position >= this.source.length;
  }

  alternation(): RegexNode {
    const branches = [this.concatenation()];
    while (this.source[this.position] === '|') {
      this.position++;
      branches.push(this.concatenation());
    }
    return branches.length === 1 ? branches[0] : { kind: 'alternation', nodes: branches };
  }

  private concatenation(): RegexNode {
    const nodes: RegexNode[] = [];
    while (!this.atEnd && this.source[this.position] !== '|' && this.source[this.position] !== ')') {
      nodes.push(this.quantified());
    }
    if (nodes.length === 0) return { kind: 'empty' };
    return nodes.length === 1 ? nodes[0] : { kind: 'concat', nodes };
  }

  private quantified(): RegexNode {
    const start = this.position;
    let node = this.atom();
    for (;;) {
      const quantifier = this.quantifier();
      if (!quantifier) return node;
      const text = this.source.slice(quantifier.start, this.position);
      if (node.kind === 'start' || node.kind === 'end' || node.kind === 'repeat' || this.position === start) throw new RegexSyntaxError(messages.nothingToRepeat(text));
      if (quantifier.max < quantifier.min) throw new RegexSyntaxError(messages.quantifierOrder(text));
      if (quantifier.min > maxRepeat || (quantifier.max !== Infinity && quantifier.max > maxRepeat)) throw new RegexSyntaxError(messages.quantifierTooLarge(text));
      node = { kind: 'repeat', node, min: quantifier.min, max: quantifier.max, lazy: quantifier.lazy };
    }
  }

  /** A quantifier at the position, consumed; nothing when there is none. A `{` that opens no quantifier is a literal. */
  private quantifier(): { start: number; min: number; max: number; lazy: boolean } | undefined {
    const start = this.position;
    const c = this.source[start];
    let min: number;
    let max: number;
    if (c === '*') [min, max] = [0, Infinity];
    else if (c === '+') [min, max] = [1, Infinity];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') {
      const counted = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.source.slice(start));
      if (!counted) return undefined;
      min = Number(counted[1]);
      max = counted[2] === undefined ? min : counted[3] === '' ? Infinity : Number(counted[3]);
      this.position += counted[0].length - 1;
    } else return undefined;
    this.position++;
    const lazy = this.source[this.position] === '?';
    if (lazy) this.position++;
    return { start, min, max, lazy };
  }

  private atom(): RegexNode {
    const c = this.source[this.position++];
    switch (c) {
      case '.': return { kind: 'any' };
      case '^': return { kind: 'start' };
      case '$': return { kind: 'end' };
      case '[': return this.characterClass();
      case '(': return this.group();
      case '\\': return this.escape();
      case '*':
      case '+':
      case '?':
        throw new RegexSyntaxError(messages.nothingToRepeat(c));
      default: return { kind: 'char', code: c.charCodeAt(0) };
    }
  }

  private group(): RegexNode {
    let name: string | undefined;
    if (this.source.startsWith('?:', this.position)) {
      this.position += 2;
    } else if (this.source.startsWith('?<', this.position)) {
      const close = this.source.indexOf('>', this.position);
      name = close < 0 ? '' : this.source.slice(this.position + 2, close);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new RegexSyntaxError(messages.groupName);
      if (this.names.has(name)) throw new RegexSyntaxError(messages.groupNameTwice(name));
      this.names.add(name);
      this.position = close + 1;
    }
    const node = this.alternation();
    if (this.source[this.position] !== ')') throw new RegexSyntaxError(messages.groupNotClosed);
    this.position++;
    return { kind: 'group', name, node };
  }

  private escape(): RegexNode {
    const c = this.source[this.position++];
    const item = shorthand(c);
    if (item) return { kind: 'class', negated: false, items: [item] };
    return { kind: 'char', code: escaped(c) };
  }

  private characterClass(): RegexNode {
    const negated = this.source[this.position] === '^';
    if (negated) this.position++;
    const items: ClassItem[] = [];
    let first = true;
    for (;;) {
      if (this.atEnd) throw new RegexSyntaxError(messages.classNotClosed);
      let c = this.source[this.position++];
      if (c === ']' && !first) break;
      first = false;
      let from: number;
      if (c === '\\') {
        c = this.source[this.position++];
        const item = shorthand(c);
        if (item) {
          items.push(item);
          continue;
        }
        from = escaped(c);
      } else {
        from = c.charCodeAt(0);
      }
      // A range, unless the hyphen is the class's last character or is followed by a shorthand.
      if (this.source[this.position] === '-' && this.position + 1 < this.source.length && this.source[this.position + 1] !== ']') {
        const mark = this.position;
        this.position++;
        let d = this.source[this.position++];
        let to: number;
        if (d === '\\') {
          d = this.source[this.position++];
          if (shorthand(d)) {
            this.position = mark;
            items.push({ ranges: [[from, from]], negated: false });
            continue;
          }
          to = escaped(d);
        } else {
          to = d.charCodeAt(0);
        }
        if (to < from) throw new RegexSyntaxError(messages.classRange(this.source.slice(mark - 1, this.position)));
        items.push({ ranges: [[from, to]], negated: false });
        continue;
      }
      items.push({ ranges: [[from, from]], negated: false });
    }
    return { kind: 'class', negated, items };
  }
}

function shorthand(c: string): ClassItem | undefined {
  switch (c) {
    case 'd': return digits;
    case 'D': return not(digits);
    case 'w': return word;
    case 'W': return not(word);
    case 's': return space;
    case 'S': return not(space);
    default: return undefined;
  }
}

/** The code unit an escape stands for: `\t \n \r`, or escaped punctuation. A letter or a digit is no escape of the subset. */
function escaped(c: string): number {
  switch (c) {
    case 't': return 0x09;
    case 'n': return 0x0a;
    case 'r': return 0x0d;
  }
  if (c === undefined) throw new RegexSyntaxError(messages.loneBackslash);
  if (isAsciiLetterOrDigit(c)) throw new RegexSyntaxError(messages.escapeOutsideSubset(c));
  return c.charCodeAt(0);
}

/** Whether a code unit is an ASCII letter, for `caseInsensitive`, which folds those and nothing else. */
export const isAsciiLetterCode = (code: number): boolean => code < 0x80 && isAsciiLetter(String.fromCharCode(code));
