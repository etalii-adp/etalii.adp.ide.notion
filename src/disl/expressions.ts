// The CEL environment of DISL 12 on `@marcbachmann/cel-js`: the library parses and evaluates, and
// this module adds what DISL puts on top of CEL: elements with their attributes and their
// neighbours, the function library of 12.4 as far as it is built, and a specification's own
// `functions`. In CEL an integer is a `bigint` and any other number a `number`, as the library
// has it; what an evaluation gives back is plain data again.

import { Environment, Optional, serialize, type ASTNode } from '@marcbachmann/cel-js';
import { attributesOf, defaultOf, isA, ordinal, parseYearMonth, valueKind, yearMonthOf, zeroOf, type Metamodel } from './metamodel';
import { finding, type Attributes, type Finding, type Model, type ModelElement, type ModelRelation, type Value } from './model';
import { celOf, type Attribute, type Expression, type Specification } from './specification';

/** The variables of one evaluation, by name (DISL 12.3). An integer among them is a `bigint`. */
export type Scope = Readonly<Record<string, unknown>>;

/**
 * What an evaluation gave. `value` is plain data: a number for an integer, an id for an element,
 * null for an optional without a value. `raw` is the same as CEL holds it, for a later scope.
 * A failure is a result, never an exception: its caller turns it into a finding or a default (DISL 2.5).
 */
export type Evaluated =
  | { readonly ok: true; readonly value: Value; readonly raw: unknown }
  | { readonly ok: false; readonly error: string };

/** An expression parsed once. `error` says why it could not be parsed; evaluating it then fails with the same words. */
export interface Compiled {
  readonly cel: string;
  readonly error?: string;
  evaluate(scope?: Scope): Evaluated;
}

/** A model as CEL sees it: `diagram`, and each element as `self` or behind a relation's end. */
export interface World {
  readonly diagram: unknown;
  /** The element with this id as CEL holds it, or null. */
  element(id: string): unknown;
  /** `diagram` and `env`, `self` when an id is given, and whatever else the context binds. */
  scope(self?: string, more?: Scope): Scope;
  /** A value of the model as CEL holds it, by the type of its attribute. */
  toCel(value: Value | undefined, attribute: Attribute): unknown;
}

export interface WorldOptions {
  /** Members of `env` (DISL 12.2) that differ from their defaults, such as `viewpoint`, `mode`, `zoom` and `readOnly`. */
  readonly env?: Scope;
  /** `self.view` of an element: its placement in the current view. Without it, `view` is null, as in a headless context. */
  view?(id: string): Scope | undefined;
}

export interface Expressions {
  /** The functions of the specification that could not be read. */
  readonly findings: readonly Finding[];
  /** Parses an expression, once for each source text. */
  compile(expression: Expression): Compiled;
  evaluate(expression: Expression, scope?: Scope): Evaluated;
  over(model: Model, options?: WorldOptions): World;
}

export interface ExpressionOptions {
  readonly locale?: string;
  /** The host's measure of a text at a font size, for a specification whose text metric is `host` (DISL 6.5). */
  textWidth?(text: string, fontSize: number): number;
}

// The library tells a value of a type of its own by its constructor, so an element is an object of
// this class, and reads its members through a proxy. What CEL may not see of it is kept beside it.
class Entity {}
class Namespace {}

interface Facts {
  readonly id: string;
  readonly type: string;
  /** Whether a member holds a value of its own, which is what `has()` and `.?` ask (DISL 4.3). */
  stored(name: string): boolean;
  find(id: string): Entity | null;
}

const facts = new WeakMap<object, Facts>();
const factsOf = (value: unknown): Facts | undefined => (typeof value === 'object' && value !== null ? facts.get(value) : undefined);

const reason = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const summary = (error as { summary?: unknown }).summary;
  return typeof summary === 'string' ? summary : error.message.split('\n')[0];
};

const number = (value: unknown): number => Number(value);

/** Creates the environment of one specification. It is made once and kept: making it is the expensive part. */
export function createExpressions(specification: Specification, metamodel: Metamodel, options: ExpressionOptions = {}): Expressions {
  const locale = options.locale ?? specification.language.defaultLocale ?? 'en';
  const environment = new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true, homogeneousAggregateLiterals: false });
  const findings: Finding[] = [];
  environment.registerType('Entity', Entity).registerType('Namespace', Namespace);
  environment.registerConstant('math', 'Namespace', new Namespace()).registerConstant('lists', 'Namespace', new Namespace());
  const register = <A extends unknown[]>(signature: string, handler: (...args: A) => unknown): void =>
    void environment.registerFunction(signature, handler as (...args: unknown[]) => unknown);

  // The scope of the evaluation in progress: a function that uses `diagram` or `env` reads it there.
  let active: Scope = {};

  // ---- members of elements ----

  const member = (target: unknown, name: string): unknown => {
    if (target instanceof Optional) return target.hasValue() ? member(target.value(), name) : undefined;
    if (target instanceof Map) return target.get(name);
    return typeof target === 'object' && target !== null && (factsOf(target) || Object.hasOwn(target, name)) ? (target as Record<string, unknown>)[name] : undefined;
  };
  const has = (target: unknown, name: string): boolean => {
    if (target instanceof Optional) return target.hasValue() && has(target.value(), name);
    return factsOf(target)?.stored(name) ?? member(target, name) !== undefined;
  };
  register('__has(dyn, string): bool', has);
  register('__field(dyn, string): optional<dyn>', (target: unknown, name: string) => (has(target, name) ? Optional.of(member(target, name)) : Optional.none()));

  const typed = (name: string) => (entity: Entity): boolean => isA(metamodel, factsOf(entity)?.type ?? '', name);
  const list = (entity: Entity, name: string): Entity[] => member(entity, name) as Entity[];
  register('Entity.isA(string): bool', (entity: Entity, type: string) => typed(type)(entity));
  register('Entity.incomingOf(string): list<dyn>', (entity: Entity, type: string) => list(entity, 'incoming').filter(typed(type)));
  register('Entity.outgoingOf(string): list<dyn>', (entity: Entity, type: string) => list(entity, 'outgoing').filter(typed(type)));
  register('Entity.nodesOfType(string): list<dyn>', (entity: Entity, type: string) => list(entity, 'nodes').filter(typed(type)));
  register('Entity.relationsOfType(string): list<dyn>', (entity: Entity, type: string) => list(entity, 'relations').filter(typed(type)));
  register('Entity.elementById(string): dyn', (entity: Entity, id: string) => factsOf(entity)?.find(id) ?? null);
  register('Entity.label(): string', (entity: Entity) => String(member(entity, metamodel.types[factsOf(entity)?.type ?? '']?.labelAttribute ?? '') ?? ''));

  // ---- the function library (DISL 12.1 and 12.4), as far as it is built ----

  // Halves round away from zero, as CEL's `math.round` does and `Math.round` does not.
  register('Namespace.round(dyn): double', (_: unknown, value: unknown) => Math.sign(number(value)) * Math.round(Math.abs(number(value))));
  register('Namespace.floor(dyn): double', (_: unknown, value: unknown) => Math.floor(number(value)));
  register('Namespace.ceil(dyn): double', (_: unknown, value: unknown) => Math.ceil(number(value)));
  register('Namespace.trunc(dyn): double', (_: unknown, value: unknown) => Math.trunc(number(value)));
  register('Namespace.sqrt(dyn): double', (_: unknown, value: unknown) => Math.sqrt(number(value)));
  register('Namespace.abs(dyn): dyn', (_: unknown, value: unknown) => (typeof value === 'bigint' ? (value < 0n ? -value : value) : Math.abs(number(value))));
  register('Namespace.range(int): list<int>', (_: unknown, size: bigint) => Array.from({ length: Number(size) }, (_item, index) => BigInt(index)));
  const least = (...values: unknown[]): unknown => values.reduce((a, b) => ((b as number) < (a as number) ? b : a));
  const greatest = (...values: unknown[]): unknown => values.reduce((a, b) => ((b as number) > (a as number) ? b : a));
  for (const count of [2, 3, 4]) {
    const parameters = Array.from({ length: count }, () => 'dyn').join(', ');
    register(`min(${parameters}): dyn`, least);
    register(`max(${parameters}): dyn`, greatest);
    register(`Namespace.least(${parameters}): dyn`, (_: unknown, ...values: unknown[]) => least(...values));
    register(`Namespace.greatest(${parameters}): dyn`, (_: unknown, ...values: unknown[]) => greatest(...values));
  }
  register('clamp(dyn, dyn, dyn): dyn', (value: unknown, low: unknown, high: unknown) => greatest(low, least(value, high)));
  register('lower(string): string', (text: string) => text.toLowerCase());
  register('upper(string): string', (text: string) => text.toUpperCase());
  register('list.flatten(): list<dyn>', (items: unknown[]) => items.flat());
  register('list.distinct(): list<dyn>', (items: unknown[]) => [...new Set(items)]);
  register('list.indexOf(dyn): int', (items: unknown[], item: unknown) => BigInt(items.indexOf(item)));

  register('yearMonth(dyn, dyn): int', (year: unknown, month: unknown) => BigInt(number(year) * 12 + number(month) - 1));
  register('int.year(): int', (index: bigint) => BigInt(yearMonthOf(Number(index)).year));
  register('int.month(): int', (index: bigint) => BigInt(yearMonthOf(Number(index)).month));
  register('parseYearMonth(string): optional<int>', (text: string) => {
    const index = parseYearMonth(text);
    return index === undefined ? Optional.none() : Optional.of(BigInt(index));
  });
  register('formatYearMonth(dyn, string): string', (index: unknown, pattern: string) => formatPattern(number(index), pattern, locale));

  register('enumLabel(string, dyn): string', (name: string, key: unknown) => metamodel.enums[name]?.values.find((value) => value.key === key)?.label ?? String(key));
  register('ordinal(dyn, string): int', (key: unknown, name: string) => BigInt(ordinal(metamodel, name, String(key))));

  const metric = specification.notation?.textMetric;
  register('textWidth(string, dyn): double', (text: string, fontSize: unknown) => {
    if (typeof metric === 'object') {
      // Graphemes are counted as code points: close for the texts a diagram holds, and the same in every host.
      const count = metric.count === 'codepoint' || metric.count === 'grapheme' ? [...text].length : text.length;
      return count * metric.advance * number(fontSize);
    }
    if (!options.textWidth) throw new Error('textWidth() has no text metric to measure with');
    return options.textWidth(text, number(fontSize));
  });

  // ---- parsing ----

  const parse = (cel: string): ((scope: Scope) => unknown) => environment.parse(needsRewrite.test(cel) ? rewrite(environment.parse(cel).ast) : cel);

  const cache = new Map<string, Compiled>();
  const compile = (expression: Expression): Compiled => {
    const cel = celOf(expression);
    const known = cache.get(cel);
    if (known) return known;
    let run: ((scope: Scope) => unknown) | undefined;
    let error: string | undefined;
    try { run = parse(cel); } catch (failure) { error = reason(failure); }
    const compiled: Compiled = {
      cel,
      error,
      evaluate(scope = {}) {
        if (!run) return { ok: false, error: error ?? '' };
        const outer = active;
        active = scope;
        try {
          const raw = run(scope);
          return { ok: true, value: plain(raw), raw };
        } catch (failure) {
          return { ok: false, error: reason(failure) };
        } finally {
          active = outer;
        }
      },
    };
    cache.set(cel, compiled);
    return compiled;
  };

  // ---- the specification's own functions (DISL 3.4) ----

  const declared = Object.entries(specification.functions ?? {});
  const bodies = new Map<string, (scope: Scope) => unknown>();
  const body = (cel: string): ((scope: Scope) => unknown) => bodies.get(cel) ?? bodies.set(cel, parse(cel)).get(cel)!;
  for (const [name, declaration] of declared) {
    let depth = 0;
    try {
      register(`${name}(${declaration.params.map(() => 'dyn').join(', ')}): dyn`, (...values: unknown[]) => {
        // A function sees its parameters, and of its caller's scope only what `uses` lists.
        const scope: Record<string, unknown> = Object.fromEntries(declaration.params.map((parameter, index) => [parameter.name, values[index]]));
        for (const used of declaration.uses ?? []) scope[used] = active[used];
        if (declaration.recursion && depth >= declaration.recursion.maxDepth) return body(declaration.recursion.atMaxDepth)(scope);
        depth++;
        try { return body(declaration.cel)(scope); } finally { depth--; }
      });
    } catch (failure) {
      findings.push(finding('disl.function', 'error', `The function \`${name}\` of the specification cannot be used: ${reason(failure)}`));
    }
  }
  // Parsed only now, when every function is known, so that the order of declaration does not matter here.
  for (const [name, declaration] of declared) {
    try { body(declaration.cel); } catch (failure) {
      findings.push(finding('disl.function', 'error', `The function \`${name}\` of the specification cannot be read: ${reason(failure)}`));
    }
  }

  // ---- a model as CEL sees it ----

  const over = (model: Model, worldOptions: WorldOptions = {}): World => {
    const byId = new Map<string, ModelElement | ModelRelation>([...model.relations, ...model.elements].map((element) => [element.id, element]));
    const entities = new Map<string, Entity>();
    const env = { now: new Date(), locale, mode: 'light', zoom: 1.0, user: {}, viewpoint: '', readOnly: false, ...worldOptions.env };

    const entity = (known: Omit<Facts, 'find'>, read: (name: string) => unknown): Entity => {
      const proxy = new Proxy(new Entity(), {
        get: (target, name, receiver) => (typeof name === 'string' && name !== 'constructor' ? read(name) : Reflect.get(target, name, receiver) as unknown),
      });
      facts.set(proxy, { ...known, find });
      return proxy;
    };
    const toCel = (value: Value | undefined, attribute: Attribute): unknown => {
      const kind = valueKind(metamodel, attribute.type);
      const one = (item: Value): unknown => {
        if (kind.kind === 'reference') return typeof item === 'string' ? find(item) : null;
        const integer = kind.kind === 'primitive' && (kind.primitive === 'int' || kind.primitive === 'yearMonth');
        return integer && typeof item === 'number' && Number.isInteger(item) ? BigInt(item) : item;
      };
      const present = value ?? defaultOf(attribute) ?? zeroOf(kind, attribute.many === true);
      return attribute.many === true && Array.isArray(present) ? present.map(one) : one(present);
    };
    const attribute = (type: string, stored: Attributes, name: string): unknown => {
      const attributes = attributesOf(metamodel, type);
      return Object.hasOwn(attributes, name) ? toCel(Object.hasOwn(stored, name) ? stored[name] : undefined, attributes[name]) : undefined;
    };
    const all = (elements: readonly ModelElement[]): Entity[] => elements.map((element) => find(element.id) as Entity);

    const diagram = entity({ id: '', type: 'diagram', stored: (name) => Object.hasOwn(model.diagram, name) }, (name) => {
      switch (name) {
        case 'id': return '';
        case 'type': case 'kind': return 'diagram';
        case 'nodes': return all(model.elements);
        case 'relations': return all(model.relations);
        case 'elements': return all([...model.elements, ...model.relations]);
        default: return attribute('diagram', model.diagram, name);
      }
    });

    function find(id: string | undefined): Entity | null {
      const element = id === undefined ? undefined : byId.get(id);
      if (!element) return null;
      const known = entities.get(element.id);
      if (known) return known;
      const relation = 'source' in element || 'target' in element || metamodel.types[element.type]?.kind === 'relation';
      const built = (name: string): unknown => {
        switch (name) {
          case 'id': return element.id;
          case 'type': return element.type;
          case 'kind': return relation ? 'relation' : 'node';
          case 'view': return worldOptions.view?.(element.id) ?? null;
          case 'parent': return find(element.parent);
          case 'owner': return find(element.parent) ?? diagram;
          case 'children': return all(model.elements.filter((child) => child.parent === element.id));
          case 'incoming': return all(model.relations.filter((other) => other.target === element.id));
          case 'outgoing': return all(model.relations.filter((other) => other.source === element.id));
          case 'source': case 'target': return relation ? find((element as ModelRelation)[name]) : undefined;
          default: return undefined;
        }
      };
      const created = entity(
        { id: element.id, type: element.type, stored: (name) => Object.hasOwn(element.attributes, name) || (built(name) ?? null) !== null },
        (name) => { const value = built(name); return value === undefined ? attribute(element.type, element.attributes, name) : value; },
      );
      entities.set(element.id, created);
      return created;
    }

    return {
      diagram,
      element: find,
      scope: (self, more) => ({ diagram, env, ...(self === undefined ? {} : { self: find(self) }), ...more }),
      toCel,
    };
  };

  return { findings, compile, evaluate: (expression, scope) => compile(expression).evaluate(scope), over };
}

// ---- `has()` and `.?` ----

// The library reads a member in one way for `x.f`, `has(x.f)` and `x.?f`, and DISL does not: an
// attribute without a stored value reads as its default or its zero value, while `has()` and `.?`
// ask whether a value is stored (DISL 4.3). So an expression that holds either is written again
// with the two as calls of functions of this module, and parsed a second time.
//
// The same pass works around the library's typing of `o.value()`: on a variable it has no static
// type for, the result takes part in no comparison ("overlaps with"), so it is wrapped in `dyn()`.
const needsRewrite = /\.\?|\bhas\s*\(|\.value\s*\(/;

function rewrite(node: ASTNode): string {
  const list = (nodes: readonly ASTNode[]): string => nodes.map(rewrite).join(', ');
  switch (node.op) {
    case 'value': {
      const value = node.args;
      if (typeof value === 'string') return JSON.stringify(value);
      if (typeof value === 'number') return /[.e]/.test(String(value)) ? String(value) : `${value}.0`;
      return typeof value === 'bigint' || typeof value === 'boolean' || value === null ? String(value) : serialize(node);
    }
    case 'id': return node.args;
    case '.': return `${rewrite(node.args[0])}.${node.args[1]}`;
    case '.?': return `__field(${rewrite(node.args[0])}, ${JSON.stringify(node.args[1])})`;
    case '[]': return `${rewrite(node.args[0])}[${rewrite(node.args[1])}]`;
    case '[?]': return `${rewrite(node.args[0])}[?${rewrite(node.args[1])}]`;
    case 'call': {
      const [name, parameters] = node.args;
      const asked = name === 'has' && parameters.length === 1 ? parameters[0] : undefined;
      return asked?.op === '.' ? `__has(${rewrite(asked.args[0])}, ${JSON.stringify(asked.args[1])})` : `${name}(${list(parameters)})`;
    }
    case 'rcall': {
      const call = `${rewrite(node.args[1])}.${node.args[0]}(${list(node.args[2])})`;
      return node.args[0] === 'value' && node.args[2].length === 0 ? `dyn(${call})` : call;
    }
    case 'list': return `[${list(node.args)}]`;
    case 'map': return `{${node.args.map(([key, value]) => `${rewrite(key)}: ${rewrite(value)}`).join(', ')}}`;
    case '?:': return `(${rewrite(node.args[0])} ? ${rewrite(node.args[1])} : ${rewrite(node.args[2])})`;
    case '!_': return `(!${rewrite(node.args)})`;
    case '-_': return `(-${rewrite(node.args)})`;
    default: return `(${rewrite(node.args[0])} ${node.op} ${rewrite(node.args[1])})`;
  }
}

// ---- values ----

/** What CEL holds as plain data: a number for an integer, an id for an element, null for an optional without a value. */
function plain(value: unknown): Value {
  if (typeof value === 'bigint') return Number(value);
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Optional) return value.hasValue() ? plain(value.value()) : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || value instanceof Set) return [...value].map(plain);
  const known = factsOf(value);
  if (known) return known.id;
  const entries: [unknown, unknown][] = value instanceof Map ? [...value] : Object.entries(value);
  return Object.fromEntries(entries.map(([name, item]) => [String(name), plain(item)]));
}

// An LDML pattern as far as a month needs one: `u` and `y` are the signed astronomical year, `M`
// and `MM` the month's number, `MMM` and `MMMM` its name, and text between apostrophes is itself.
function formatPattern(index: number, pattern: string, locale: string): string {
  const { year, month } = yearMonthOf(index);
  return pattern.replace(/'([^']*)'|[uy]+|M+/g, (token: string, quoted: string | undefined) => {
    if (quoted !== undefined) return quoted;
    if (token[0] !== 'M') return (year < 0 ? '-' : '') + String(Math.abs(year)).padStart(token.length, '0');
    if (token.length <= 2) return String(month).padStart(token.length, '0');
    return new Intl.DateTimeFormat(locale, { month: token.length === 3 ? 'short' : 'long', timeZone: 'UTC' }).format(Date.UTC(2000, month - 1, 1));
  });
}
