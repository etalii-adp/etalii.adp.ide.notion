import { messages } from '../messages';
import { isAsciiDigit, isAsciiLetter, isAsciiLetterOrDigit, isWhiteSpace, ordinal } from '../text/utf8';
import { BoundedRegex, RegexBudgetError } from './regexMatcher';
import { RegexSyntaxError } from './regexSubset';

/**
 * Where a CEL expression appears, which decides the variables it may use (FBL 2.4): `tree` for a
 * rule of a yaml, json or xml binding (entry, parent, path, line, registration), `lines` for a rule
 * of a lines or blocks binding (entry, parent, groups, line, registration), `insert` for
 * `insert.when` (attributes).
 */
export type CelContext = 'tree' | 'lines' | 'insert';

/** A CEL expression does not compile, or its evaluation failed. */
export class CelException extends Error {}

/** The result of an evaluation that failed: a missing key, a type mismatch, a division by zero. */
export class CelError {
  constructor(readonly message: string) {}
}

/** The map type CEL values use: insertion-ordered, string keys. A list is an array, an int a `bigint`, a double a `number`. */
export type CelMap = Map<string, unknown>;

const variablesOf: Record<CelContext, readonly string[]> = {
  tree: ['entry', 'parent', 'path', 'line', 'registration'],
  lines: ['entry', 'parent', 'groups', 'line', 'registration'],
  insert: ['attributes'],
};

const stepBudget = 100_000;
const macros = new Set(['all', 'exists', 'exists_one', 'filter', 'map']);
const functions = new Set(['size', 'matches', 'startsWith', 'endsWith', 'contains', 'replace', 'lowerAscii', 'upperAscii', 'int', 'double', 'string']);
const minInt = -(2n ** 63n);
const maxInt = 2n ** 63n - 1n;

type CelNode =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'ident'; readonly name: string }
  | { readonly kind: 'list'; readonly items: readonly CelNode[] }
  | { readonly kind: 'mapLiteral'; readonly entries: readonly (readonly [CelNode, CelNode])[] }
  | { readonly kind: 'member'; readonly target: CelNode; readonly name: string }
  | { readonly kind: 'index'; readonly target: CelNode; readonly key: CelNode }
  | { readonly kind: 'has'; readonly target: CelNode; readonly name: string }
  | { readonly kind: 'unary'; readonly operator: string; readonly operand: CelNode }
  | { readonly kind: 'binary'; readonly operator: string; readonly left: CelNode; readonly right: CelNode }
  | { readonly kind: 'conditional'; readonly condition: CelNode; readonly then: CelNode; readonly otherwise: CelNode }
  | { readonly kind: 'macro'; readonly name: string; readonly target: CelNode; readonly variable: string; readonly body: CelNode }
  | { readonly kind: 'call'; readonly name: string; readonly receiver?: CelNode; readonly arguments: readonly CelNode[] };

/**
 * Compiles an expression of the subset of CEL this library evaluates: literals, member access and
 * indexing, the logical, relational and arithmetic operators, `in`, the conditional, `has()`, the
 * macros `all`, `exists`, `exists_one`, `filter` and `map`, and the functions `size`, `matches`,
 * `startsWith`, `endsWith`, `contains`, `replace`, `lowerAscii`, `upperAscii`, `int`, `double` and
 * `string`. Any other construct is refused here, naming the construct, so a binding that needs more
 * fails at load rather than at read.
 */
export function compileCel(expression: string, context: CelContext): CelProgram {
  const parser = new CelParser(expression);
  const node = parser.expression();
  parser.expectEnd();
  check(node, variablesOf[context], new Set());
  return new CelProgram(expression, node);
}

function check(node: CelNode, variables: readonly string[], bound: ReadonlySet<string>): void {
  switch (node.kind) {
    case 'literal':
      return;
    case 'ident':
      if (!variables.includes(node.name) && !bound.has(node.name)) throw new CelException(messages.celNotAVariable(node.name, variables));
      return;
    case 'macro':
      check(node.target, variables, bound);
      check(node.body, variables, new Set([...bound, node.variable]));
      return;
    case 'list':
      for (const item of node.items) check(item, variables, bound);
      return;
    case 'mapLiteral':
      for (const [key, value] of node.entries) {
        check(key, variables, bound);
        check(value, variables, bound);
      }
      return;
    case 'member':
    case 'has':
      check(node.target, variables, bound);
      return;
    case 'index':
      check(node.target, variables, bound);
      check(node.key, variables, bound);
      return;
    case 'unary':
      check(node.operand, variables, bound);
      return;
    case 'binary':
      check(node.left, variables, bound);
      check(node.right, variables, bound);
      return;
    case 'conditional':
      check(node.condition, variables, bound);
      check(node.then, variables, bound);
      check(node.otherwise, variables, bound);
      return;
    case 'call':
      if (node.receiver) check(node.receiver, variables, bound);
      for (const argument of node.arguments) check(argument, variables, bound);
      return;
  }
}

/** A compiled CEL expression. */
export class CelProgram {
  constructor(readonly source: string, private readonly root: CelNode) {}

  /** Evaluates with `variables`; a `CelError` when evaluation fails. */
  evaluate(variables: Readonly<Record<string, unknown>>): unknown {
    try {
      return evaluate(this.root, { variables, steps: 0 }, undefined);
    } catch (error) {
      if (error instanceof CelException) return new CelError(error.message);
      throw error;
    }
  }

  /** True only when the expression evaluates to true. */
  isTrue(variables: Readonly<Record<string, unknown>>): boolean {
    return this.evaluate(variables) === true;
  }
}

interface Run {
  readonly variables: Readonly<Record<string, unknown>>;
  steps: number;
}

interface Local {
  readonly name: string;
  readonly value: unknown;
  readonly parent: Local | undefined;
}

function step(run: Run): void {
  if (++run.steps > stepBudget) throw new CelException(messages.celBudget);
}

function lookup(name: string, run: Run, locals: Local | undefined): unknown {
  for (let local = locals; local; local = local.parent) {
    if (local.name === name) return local.value;
  }
  if (Object.prototype.hasOwnProperty.call(run.variables, name)) return run.variables[name];
  throw new CelException(messages.celNoValue(name));
}

const isMap = (value: unknown): value is CelMap => value instanceof Map;

function evaluate(node: CelNode, run: Run, locals: Local | undefined): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'ident':
      step(run);
      return lookup(node.name, run, locals);
    case 'list':
      return node.items.map((item) => evaluate(item, run, locals));
    case 'mapLiteral': {
      const map: CelMap = new Map();
      for (const [key, value] of node.entries) map.set(asString(evaluate(key, run, locals)), evaluate(value, run, locals));
      return map;
    }
    case 'member': {
      step(run);
      const target = evaluate(node.target, run, locals);
      if (!isMap(target)) throw new CelException(messages.celNotAMap(node.name));
      if (!target.has(node.name)) throw new CelException(messages.celNoSuchKey(node.name));
      return target.get(node.name);
    }
    case 'index': {
      step(run);
      const target = evaluate(node.target, run, locals);
      const key = evaluate(node.key, run, locals);
      if (Array.isArray(target)) {
        const index = asInt(key);
        if (index < 0n || index >= BigInt(target.length)) throw new CelException(messages.celIndexOutOfRange(index));
        return target[Number(index)];
      }
      if (isMap(target)) {
        const name = asString(key);
        if (!target.has(name)) throw new CelException(messages.celNoSuchKey(name));
        return target.get(name);
      }
      throw new CelException(messages.celNotIndexable);
    }
    case 'has': {
      step(run);
      const target = evaluate(node.target, run, locals);
      if (!isMap(target)) throw new CelException(messages.celHasNeedsMap);
      return target.has(node.name);
    }
    case 'unary': {
      step(run);
      const value = evaluate(node.operand, run, locals);
      if (node.operator === '!') {
        if (typeof value !== 'boolean') throw new CelException(messages.celNotNeedsBool);
        return !value;
      }
      if (typeof value === 'bigint') return int(-value);
      if (typeof value === 'number') return -value;
      throw new CelException(messages.celMinusNeedsNumber);
    }
    case 'binary':
      step(run);
      return node.operator === '&&' || node.operator === '||' ? logical(node, run, locals) : binary(node.operator, evaluate(node.left, run, locals), evaluate(node.right, run, locals));
    case 'conditional': {
      step(run);
      const condition = evaluate(node.condition, run, locals);
      if (condition === true) return evaluate(node.then, run, locals);
      if (condition === false) return evaluate(node.otherwise, run, locals);
      throw new CelException(messages.celConditionalNeedsBool);
    }
    case 'macro':
      step(run);
      return macro(node, run, locals);
    case 'call':
      step(run);
      return call(node, run, locals);
  }
}

/** `&&` and `||` decide on one side when it settles the result, whatever the other side did. */
function logical(node: CelNode & { kind: 'binary' }, run: Run, locals: Local | undefined): unknown {
  const side = (operand: CelNode): unknown => {
    try {
      return evaluate(operand, run, locals);
    } catch (error) {
      if (error instanceof CelException) return new CelError(error.message);
      throw error;
    }
  };
  const and = node.operator === '&&';
  const left = side(node.left);
  if (and && left === false) return false;
  if (!and && left === true) return true;
  const right = side(node.right);
  if (and && right === false) return false;
  if (!and && right === true) return true;
  if (typeof left === 'boolean' && typeof right === 'boolean') return and;
  throw new CelException(left instanceof CelError ? left.message : right instanceof CelError ? right.message : messages.celNeedsBools(node.operator));
}

function binary(operator: string, left: unknown, right: unknown): unknown {
  switch (operator) {
    case '==': return equal(left, right);
    case '!=': return !equal(left, right);
    case '<': return compare(left, right) < 0;
    case '<=': return compare(left, right) <= 0;
    case '>': return compare(left, right) > 0;
    case '>=': return compare(left, right) >= 0;
    case 'in':
      if (Array.isArray(right)) return right.some((item) => equal(item, left));
      if (isMap(right)) return typeof left === 'string' && right.has(left);
      throw new CelException(messages.celInNeedsCollection);
    case '+':
      if (typeof left === 'bigint' && typeof right === 'bigint') return int(left + right);
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      return asDouble(left) + asDouble(right);
    case '-':
      return typeof left === 'bigint' && typeof right === 'bigint' ? int(left - right) : asDouble(left) - asDouble(right);
    case '*':
      return typeof left === 'bigint' && typeof right === 'bigint' ? int(left * right) : asDouble(left) * asDouble(right);
    case '/':
      if (typeof left === 'bigint' && typeof right === 'bigint') {
        if (right === 0n) throw new CelException(messages.celDivisionByZero);
        return int(left / right);
      }
      return asDouble(left) / asDouble(right);
    case '%':
      if (typeof left === 'bigint' && typeof right === 'bigint') {
        if (right === 0n) throw new CelException(messages.celModulusByZero);
        return left % right;
      }
      throw new CelException(messages.celModulusNeedsInts);
    default:
      throw new CelException(messages.celUnknownOperator(operator));
  }
}

function macro(node: CelNode & { kind: 'macro' }, run: Run, locals: Local | undefined): unknown {
  const target = evaluate(node.target, run, locals);
  let items: Iterable<unknown>;
  if (Array.isArray(target)) items = target;
  else if (isMap(target)) items = [...target.keys()];
  else throw new CelException(messages.celMacroNeedsCollection(node.name));
  const results: unknown[] = [];
  for (const item of items) {
    const value = evaluate(node.body, run, { name: node.variable, value: item, parent: locals });
    switch (node.name) {
      case 'all':
        if (value === false) return false;
        break;
      case 'exists':
        if (value === true) return true;
        break;
      case 'exists_one':
      case 'filter':
        if (value === true) results.push(item);
        break;
      case 'map':
        results.push(value);
        break;
    }
  }
  switch (node.name) {
    case 'all': return true;
    case 'exists': return false;
    case 'exists_one': return results.length === 1;
    default: return results;
  }
}

const regexes = new Map<string, BoundedRegex>();

function matches(text: string, expression: string): boolean {
  try {
    let regex = regexes.get(expression);
    if (!regex) {
      regex = new BoundedRegex(expression, false);
      if (regexes.size >= 256) regexes.clear();
      regexes.set(expression, regex);
    }
    return regex.isMatch(text);
  } catch (error) {
    if (error instanceof RegexSyntaxError || error instanceof RegexBudgetError) throw new CelException(error.message);
    throw error;
  }
}

function call(node: CelNode & { kind: 'call' }, run: Run, locals: Local | undefined): unknown {
  let receiver = node.receiver ? evaluate(node.receiver, run, locals) : undefined;
  const given = node.arguments.map((argument) => evaluate(argument, run, locals));
  if (!node.receiver && given.length > 0) receiver = given.shift();
  const argument = (index: number): unknown => {
    if (index >= given.length) throw new CelException(messages.celMissingArgument(node.name));
    return given[index];
  };
  switch (node.name) {
    case 'size':
      // CEL counts a string's code points.
      if (typeof receiver === 'string') return BigInt([...receiver].length);
      if (Array.isArray(receiver)) return BigInt(receiver.length);
      if (isMap(receiver)) return BigInt(receiver.size);
      throw new CelException(messages.celSizeNeeds);
    case 'matches': return matches(asString(receiver), asString(argument(0)));
    case 'startsWith': return asString(receiver).startsWith(asString(argument(0)));
    case 'endsWith': return asString(receiver).endsWith(asString(argument(0)));
    case 'contains': return asString(receiver).includes(asString(argument(0)));
    case 'replace': {
      const old = asString(argument(0));
      return old.length === 0 ? asString(receiver) : asString(receiver).replaceAll(old, () => asString(argument(1)));
    }
    // CEL changes the ASCII letters and leaves every other character as it is.
    case 'lowerAscii': return asString(receiver).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    case 'upperAscii': return asString(receiver).replace(/[a-z]/g, (letter) => letter.toUpperCase());
    case 'int':
      if (typeof receiver === 'bigint') return receiver;
      if (typeof receiver === 'number' && Number.isFinite(receiver)) return int(BigInt(Math.trunc(receiver)));
      if (typeof receiver === 'string' && /^\s*[+-]?[0-9]+\s*$/.test(receiver)) return int(BigInt(receiver.trim().replace(/^\+/, '')));
      throw new CelException(messages.celIntCannotConvert);
    case 'double':
      if (typeof receiver === 'string') {
        const text = receiver.trim();
        if (/^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(text)) return Number(text);
        if (/^[+-]?Infinity$|^NaN$/.test(text)) return Number(text);
        throw new CelException(messages.celDoubleCannotConvert);
      }
      return asDouble(receiver);
    case 'string': return format(receiver);
    default: throw new CelException(messages.celFunctionNotSupported(node.name));
  }
}

function int(value: bigint): bigint {
  if (value < minInt || value > maxInt) throw new CelException(messages.celIntOverflow);
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new CelException(messages.celStringExpected);
  return value;
}

function asInt(value: unknown): bigint {
  if (typeof value !== 'bigint') throw new CelException(messages.celIntExpected);
  return value;
}

function asDouble(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  throw new CelException(messages.celNumberExpected);
}

/** CEL's equality: an int and a double are equal when they are the same number, lists and maps by their members. */
function equal(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'bigint' && typeof b === 'number') return compareNumbers(a, b) === 0;
  if (typeof a === 'number' && typeof b === 'bigint') return compareNumbers(a, b) === 0;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  if (isMap(a) && isMap(b)) return a.size === b.size && [...a].every(([key, value]) => b.has(key) && equal(value, b.get(key)));
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') return ordinal(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if ((typeof a !== 'bigint' && typeof a !== 'number') || (typeof b !== 'bigint' && typeof b !== 'number')) throw new CelException(messages.celNumberExpected);
  return compareNumbers(a, b);
}

/** Compares two numbers as the numbers they are, without converting an int to a double first. NaN compares as neither. */
function compareNumbers(a: bigint | number, b: bigint | number): number {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : a === b ? 0 : NaN;
  if (typeof a === 'number') return -compareNumbers(b, a);
  const double = b as number;
  if (Number.isNaN(double)) return NaN;
  if (double === Infinity) return -1;
  if (double === -Infinity) return 1;
  const whole = BigInt(Math.trunc(double));
  if (a !== whole) return a < whole ? -1 : 1;
  const fraction = double - Math.trunc(double);
  return fraction > 0 ? -1 : fraction < 0 ? 1 : 0;
}

function format(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

type Token = readonly [kind: 'int' | 'double' | 'string' | 'ident' | 'op', text: string];

class CelParser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
  }

  expression(): CelNode {
    const condition = this.or();
    if (this.peek('?')) {
      this.position++;
      const then = this.or();
      this.expect(':');
      const otherwise = this.expression();
      return { kind: 'conditional', condition, then, otherwise };
    }
    return condition;
  }

  expectEnd(): void {
    if (this.position < this.tokens.length) throw new CelException(messages.celUnexpected(this.tokens[this.position][1], this.source));
  }

  private or(): CelNode {
    let left = this.and();
    while (this.peek('||')) {
      this.position++;
      left = { kind: 'binary', operator: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): CelNode {
    let left = this.relation();
    while (this.peek('&&')) {
      this.position++;
      left = { kind: 'binary', operator: '&&', left, right: this.relation() };
    }
    return left;
  }

  private relation(): CelNode {
    let left = this.addition();
    while (['==', '!=', '<', '<=', '>', '>=', 'in'].some((operator) => this.peek(operator))) {
      const operator = this.tokens[this.position++][1];
      left = { kind: 'binary', operator, left, right: this.addition() };
    }
    return left;
  }

  private addition(): CelNode {
    let left = this.multiplication();
    while (this.peek('+') || this.peek('-')) {
      const operator = this.tokens[this.position++][1];
      left = { kind: 'binary', operator, left, right: this.multiplication() };
    }
    return left;
  }

  private multiplication(): CelNode {
    let left = this.unary();
    while (this.peek('*') || this.peek('/') || this.peek('%')) {
      const operator = this.tokens[this.position++][1];
      left = { kind: 'binary', operator, left, right: this.unary() };
    }
    return left;
  }

  private unary(): CelNode {
    if (this.peek('!') || this.peek('-')) {
      const operator = this.tokens[this.position++][1];
      return { kind: 'unary', operator, operand: this.unary() };
    }
    return this.postfix(this.primary());
  }

  private postfix(start: CelNode): CelNode {
    let node = start;
    for (;;) {
      if (this.peek('.')) {
        this.position++;
        const name = this.expectIdent();
        if (this.peek('(')) {
          this.position++;
          if (macros.has(name)) {
            const variable = this.expectIdent();
            this.expect(',');
            const body = this.expression();
            this.expect(')');
            node = { kind: 'macro', name, target: node, variable, body };
            continue;
          }
          if (!functions.has(name)) throw new CelException(messages.celFunctionUnknown(name));
          node = { kind: 'call', name, receiver: node, arguments: this.arguments() };
          continue;
        }
        node = { kind: 'member', target: node, name };
        continue;
      }
      if (this.peek('[')) {
        this.position++;
        const key = this.expression();
        this.expect(']');
        node = { kind: 'index', target: node, key };
        continue;
      }
      return node;
    }
  }

  private arguments(): CelNode[] {
    const list: CelNode[] = [];
    if (!this.peek(')')) {
      list.push(this.expression());
      while (this.peek(',')) {
        this.position++;
        list.push(this.expression());
      }
    }
    this.expect(')');
    return list;
  }

  private primary(): CelNode {
    if (this.position >= this.tokens.length) throw new CelException(messages.celEndsTooEarly(this.source));
    const [kind, text] = this.tokens[this.position++];
    switch (kind) {
      case 'int': {
        const value = BigInt(text);
        if (value > maxInt) throw new CelException(messages.celIntOverflow);
        return { kind: 'literal', value };
      }
      case 'double': return { kind: 'literal', value: Number(text) };
      case 'string': return { kind: 'literal', value: text };
      case 'ident':
        switch (text) {
          case 'true': return { kind: 'literal', value: true };
          case 'false': return { kind: 'literal', value: false };
          case 'null': return { kind: 'literal', value: null };
          case 'has': {
            this.expect('(');
            const target = this.postfix(this.primary());
            this.expect(')');
            if (target.kind !== 'member') throw new CelException(messages.celHasNeedsSelection);
            return { kind: 'has', target: target.target, name: target.name };
          }
        }
        if (this.peek('(')) {
          this.position++;
          if (!functions.has(text)) throw new CelException(messages.celFunctionUnknown(text));
          return { kind: 'call', name: text, arguments: this.arguments() };
        }
        return { kind: 'ident', name: text };
      case 'op':
        if (text === '(') {
          const inner = this.expression();
          this.expect(')');
          return inner;
        }
        if (text === '[') {
          const items: CelNode[] = [];
          if (!this.peek(']')) {
            items.push(this.expression());
            while (this.peek(',')) {
              this.position++;
              if (this.peek(']')) break;
              items.push(this.expression());
            }
          }
          this.expect(']');
          return { kind: 'list', items };
        }
        if (text === '{') {
          const entries: [CelNode, CelNode][] = [];
          if (!this.peek('}')) {
            do {
              if (this.peek(',')) this.position++;
              const key = this.expression();
              this.expect(':');
              entries.push([key, this.expression()]);
            } while (this.peek(','));
          }
          this.expect('}');
          return { kind: 'mapLiteral', entries };
        }
        break;
    }
    throw new CelException(messages.celUnexpected(text, this.source));
  }

  private peek(text: string): boolean {
    const token = this.tokens[this.position];
    return token !== undefined && token[0] === 'op' && token[1] === text;
  }

  private expect(text: string): void {
    if (!this.peek(text)) throw new CelException(messages.celExpected(text, this.source));
    this.position++;
  }

  private expectIdent(): string {
    const token = this.tokens[this.position];
    if (token === undefined || token[0] !== 'ident') throw new CelException(messages.celExpectedName(this.source));
    this.position++;
    return token[1];
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (isWhiteSpace(c)) {
      i++;
      continue;
    }
    if (isAsciiDigit(c)) {
      const start = i;
      while (i < source.length && isAsciiDigit(source[i])) i++;
      let isDouble = false;
      if (i + 1 < source.length && source[i] === '.' && isAsciiDigit(source[i + 1])) {
        isDouble = true;
        i++;
        while (i < source.length && isAsciiDigit(source[i])) i++;
      }
      if (source[i] === 'u' || source[i] === 'U') throw new CelException(messages.celUnsigned);
      tokens.push([isDouble ? 'double' : 'int', source.slice(start, i)]);
      continue;
    }
    if (isAsciiLetter(c) || c === '_') {
      const start = i;
      while (i < source.length && (isAsciiLetterOrDigit(source[i]) || source[i] === '_')) i++;
      const name = source.slice(start, i);
      // 'in' is an operator spelled as a name.
      tokens.push([name === 'in' ? 'op' : 'ident', name]);
      continue;
    }
    if (c === '\'' || c === '"') {
      let text = '';
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i++;
          text += source[i] === 'n' ? '\n' : source[i] === 't' ? '\t' : source[i] === 'r' ? '\r' : source[i];
        } else {
          text += source[i];
        }
        i++;
      }
      if (i >= source.length) throw new CelException(messages.celStringNotClosed(source));
      i++;
      tokens.push(['string', text]);
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      tokens.push(['op', two]);
      i += 2;
      continue;
    }
    if ('!-+*/%<>?:.,()[]{}'.includes(c)) {
      tokens.push(['op', c]);
      i++;
      continue;
    }
    throw new CelException(messages.celCharacter(c, source));
  }
  return tokens;
}
