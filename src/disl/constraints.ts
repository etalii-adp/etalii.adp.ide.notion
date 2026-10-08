// The constraints of a specification (DISL 8): what turns a model into findings, and what refuses
// a gesture before it is applied.
//
// What is built: the declared rules (invariants and gesture constraints, with `scope`, `forEach`,
// `when`, `rule`, `severity`, `message`, `target`, `location`, `subject`, `attribute`, `timing`,
// `enforcement`, `enabled` and `group`), `defaults`, `order`, `blockSaveOn`, and `builtIn` applied
// to every finding of the reading and to `std.endpoints`, the one built-in this module raises
// itself. The other built-ins a metamodel generates (`std.required`, `std.facets`, `std.unique`,
// `std.multiplicity`, `std.containment`, `std.acyclic`, `std.axisBounds`) are not raised yet, and a
// rule `over` a view is left out, since a model here has no views. Quick fixes and suppressions
// are not read.

import type { Expressions, Scope, World } from './expressions';
import { attributesOf, isA, isRelation, type Metamodel } from './metamodel';
import { finding, type Finding, type Loaded, type Model, type ModelElement, type ModelRelation, type Value } from './model';
import { isCel, isObject, localized, type CelValue, type Doc, type Expression, type LocalizedText, type Message, type Specification } from './specification';

type Severity = 'error' | 'warning' | 'info' | 'hint';

/** When a rule is evaluated (DISL 8.2). */
export type Timing = 'live' | 'save' | 'explicit' | 'export';

/** The kinds of constraint that are checked before a user's action (DISL 8.4). */
export type GestureKind = 'connect' | 'containment' | 'create' | 'delete' | 'placement' | 'change' | 'reorder';

/** `$defs/Constraints` (DISL 8.1). */
export interface ConstraintsSection {
  readonly rules?: readonly Constraint[];
  readonly groups?: Readonly<Record<string, { readonly label?: LocalizedText; readonly enabledByDefault?: boolean; readonly severityOverride?: Severity; readonly doc?: Doc }>>;
  readonly defaults?: { readonly severity?: Severity; readonly timing?: readonly Timing[] };
  readonly blockSaveOn?: 'never' | 'error';
  readonly builtIn?: Readonly<Record<string, BuiltInSetting>>;
  readonly order?: readonly string[];
  readonly doc?: Doc;
}

/** `$defs/BuiltInSetting` (DISL 8.1). */
export interface BuiltInSetting {
  readonly severity?: Severity;
  readonly enabled?: boolean;
  readonly code?: string | CelValue;
  readonly message?: Message;
  readonly refusal?: Message;
  readonly oncePerGroup?: 'second' | 'last';
  readonly doc?: Doc;
}

/** `$defs/Constraint` (DISL 8.2). */
export interface Constraint {
  readonly id: string;
  readonly code?: string;
  readonly label?: LocalizedText;
  readonly kind?: 'invariant' | GestureKind;
  readonly scope?: string | readonly string[];
  readonly over?: 'model' | 'view';
  readonly forEach?: Expression;
  readonly when?: Expression;
  readonly rule?: Expression;
  readonly severity?: Severity | CelValue;
  readonly message?: Message;
  readonly target?: Expression;
  readonly attribute?: string;
  readonly location?: Expression;
  readonly subject?: Expression;
  readonly timing?: readonly Timing[];
  readonly enforcement?: 'report' | 'prevent' | 'prevent-and-report';
  readonly enabled?: boolean;
  readonly group?: string;
  readonly doc?: Doc;
}

/**
 * A finding of DISL 8.6: the rule or built-in that raised it, by the id suppressions are keyed by,
 * beside the code it reports. `element` is its first target, and `hint` is reported as `info`.
 */
export interface ConstraintFinding extends Finding {
  readonly constraint: string;
  /** The attribute to mark in a form. */
  readonly attribute?: string;
  /** What the finding is about when that is no element. It is shown, never resolved as an id. */
  readonly subject?: string;
}

/** A user's action before it is applied, with the variables DISL 8.4 gives its kind. */
export interface Gesture {
  readonly kind: GestureKind;
  /** The id of the element the gesture is on: `self`. */
  readonly self?: string;
  /** The variables that are elements (`source`, `target`, `parent`, `child`, ...), by the id each has in the model. */
  readonly elements?: Readonly<Record<string, string | undefined>>;
  /**
   * The other variables, as CEL holds them: an integer is a `bigint`. For a `change`, `newValue` is
   * a value of the model, read as the attribute named by `attribute` types it, and `oldValue` is filled in.
   */
  readonly values?: Scope;
}

export interface CheckOptions {
  /** The moment of the check: a rule is evaluated when its `timing` lists it. `live` when absent. */
  readonly timing?: Timing;
  /** The file the findings are located in; the file of the reading's findings when absent. */
  readonly file?: string;
}

export interface Constraints {
  /**
   * The findings of a model: the reading's, each with the code, severity and message its built-in
   * is given, `std.endpoints`, and every invariant that does not hold, in the order of DISL 8.6.
   * A model whose file could not be parsed has that finding alone.
   */
  check(model: Model, readFindings?: readonly Finding[], options?: CheckOptions): ConstraintFinding[];
  /**
   * What refuses a gesture on `model`, the one to show first (DISL 8.4): `std.endpoints` for a
   * `connect`, then the gesture constraints of its kind that prevent. Given the model as the gesture
   * would leave it, also every invariant that prevents and holds now for an element but not then.
   * Each message is the sentence of the refusal. Nothing refuses when the list is empty.
   */
  refusals(gesture: Gesture, model: Model, after?: Model): ConstraintFinding[];
  /** Whether these findings keep the document from being saved (`blockSaveOn`). */
  blocksSave(findings: readonly Finding[]): boolean;
}

const endpoints = 'std.endpoints';
// The built-ins that are not the reader's, in the order of the table of DISL 8.7.
const table = ['std.required', 'std.facets', 'std.unique', 'std.multiplicity', endpoints, 'std.containment', 'std.acyclic', 'std.references', 'std.axisBounds', 'std.typeExists'];
// What the reader raises about an element, not while reading a file: ordered by line (DISL 8.6).
const aboutElements = ['std.duplicateId', 'std.missingId'];
const qualifiedId = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const severities: readonly string[] = ['error', 'warning', 'info', 'hint'];

type Violation = 'source' | 'target' | 'selfLoop' | 'parallel';

// A finding with what orders it: its place in the order of DISL 8.6, whether the reader raised it
// while reading a file, and the line of the element it is ordered by.
interface Found {
  readonly finding: ConstraintFinding;
  readonly rank: number;
  readonly reader?: boolean;
  readonly line?: number;
}

const rated = (severity: Severity): Finding['severity'] => (severity === 'hint' ? 'info' : severity);

// A value of the model as CEL holds it: a whole number is an integer.
const held = (value: Value): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (Array.isArray(value)) return value.map(held);
  return isObject(value) ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, held(item as Value)])) : value;
};

// Of the members of a group of duplicates after its first, those that are reported (DISL 8.1).
const flagged = <T>(later: readonly T[], once: BuiltInSetting['oncePerGroup']): readonly T[] =>
  (once === 'second' ? later.slice(0, 1) : once === 'last' ? later.slice(-1) : later);

const limit = (type: string, violation: Violation): string =>
  violation === 'selfLoop' ? `A relation of the type \`${type}\` cannot connect an element to itself.`
    : violation === 'parallel' ? `A relation of the type \`${type}\` already connects these two elements.`
      : `A relation of the type \`${type}\` cannot have this ${violation}.`;

/**
 * Interprets `constraints`. Its findings are the expressions that cannot be read and the rules
 * that are left out; a rule with such an expression is kept, and reports that when it is evaluated.
 */
export function interpretConstraints(specification: Specification, metamodel: Metamodel, expressions: Expressions): Loaded<Constraints> {
  const declared = (specification.constraints ?? {}) as ConstraintsSection;
  const settings = declared.builtIn ?? {};
  const groups = declared.groups ?? {};
  const locale = specification.language.defaultLocale ?? 'en';
  const findings: Finding[] = [];

  const rules = (declared.rules ?? []).filter((rule) => {
    if (rule.over === 'view') findings.push(finding('disl.constraints', 'warning', `The constraint \`${rule.id}\` is evaluated for each view, which this add-on does not support, so it is left out.`));
    const group = rule.group === undefined ? undefined : groups[rule.group];
    return rule.over !== 'view' && rule.enabled !== false && group?.enabledByDefault !== false;
  });
  const unread = (owner: string, properties: Readonly<Record<string, unknown>>): void => {
    for (const [name, value] of Object.entries(properties)) {
      const error = typeof value === 'string' || isCel(value) ? expressions.compile(value).error : undefined;
      if (error !== undefined) findings.push(finding('disl.constraints', 'error', `The \`${name}\` of ${owner} cannot be read: ${error}`));
    }
  };
  for (const rule of rules) {
    const { forEach, when, rule: condition, location, subject, target } = rule;
    unread(`the constraint \`${rule.id}\``, {
      forEach, when, rule: condition, location, subject, target: target === 'self' ? undefined : target,
      severity: isCel(rule.severity) ? rule.severity : undefined, message: isCel(rule.message) ? rule.message : undefined,
    });
  }
  for (const [id, setting] of Object.entries(settings)) {
    unread(`the built-in \`${id}\``, Object.fromEntries(Object.entries({ code: setting.code, message: setting.message, refusal: setting.refusal }).filter(([, value]) => isCel(value))));
  }

  // ---- sentences, severities and codes ----

  // A message that fails to evaluate gives the position's default text (DISL 2.3).
  const worded = (message: Message | undefined, scope: Scope, fallback: string): string => {
    if (message === undefined) return fallback;
    if (!isCel(message)) return localized(message, locale, locale) ?? fallback;
    const result = expressions.evaluate(message, scope);
    if (!result.ok) return fallback;
    if (typeof result.value === 'string') return result.value;
    return (isObject(result.value) ? localized(result.value as Record<string, string>, locale, locale) : undefined) ?? fallback;
  };

  const severityOf = (rule: Constraint, scope: Scope): Finding['severity'] => {
    const override = rule.group === undefined ? undefined : groups[rule.group]?.severityOverride;
    const computed = isCel(rule.severity) ? expressions.evaluate(rule.severity, scope) : undefined;
    const own = computed ? (computed.ok && severities.includes(computed.value as string) ? (computed.value as Severity) : undefined) : (rule.severity as Severity | undefined);
    return rated(override ?? own ?? declared.defaults?.severity ?? 'error');
  };

  const timingOf = (rule: Constraint): readonly Timing[] => rule.timing ?? declared.defaults?.timing ?? ['live', 'save'];
  const isInvariant = (rule: Constraint): boolean => (rule.kind ?? 'invariant') === 'invariant';

  // ---- scope ----

  const scopeNames = (rule: Constraint): readonly string[] => (rule.scope === undefined ? ['diagram'] : typeof rule.scope === 'string' ? [rule.scope] : rule.scope);
  const inScope = (names: readonly string[], element: ModelElement): boolean => {
    const relation = isRelation(metamodel.types[element.type]);
    return names.some((name) => name === '*' || (name === 'node' && !relation) || (name === 'relation' && relation) || isA(metamodel, element.type, name));
  };
  // In model order; a rule of the diagram is evaluated once, for no element.
  const scopeOf = (rule: Constraint, model: Model): readonly (ModelElement | undefined)[] => {
    const names = scopeNames(rule);
    if (names.includes('diagram')) return [undefined];
    return [...model.elements, ...model.relations].sort((a, b) => a.line - b.line).filter((element) => inScope(names, element));
  };

  // ---- one model ----

  interface Context {
    readonly model: Model;
    readonly world: World;
    readonly byId: ReadonlyMap<string, ModelElement | ModelRelation>;
    readonly file: string;
  }
  const contextOf = (model: Model, file: string): Context =>
    ({ model, world: expressions.over(model), byId: new Map([...model.relations, ...model.elements].map((element) => [element.id, element])), file });
  const scopeFor = (context: Context, self: ModelElement | undefined, more: Scope = {}): Scope =>
    (self ? context.world.scope(self.id, more) : context.world.scope(undefined, { self: context.world.diagram, ...more }));
  const at = (context: Context, element: ModelElement | undefined): Finding['location'] =>
    (element ? { file: context.file, line: element.line, column: 1, length: 0 } : { file: context.file, line: 0, column: 0, length: 0 });

  // What a rule finds for one element of its scope, or with a gesture's variables in `scope`.
  const judge = (rule: Constraint, context: Context, self: ModelElement | undefined, scope: Scope): Found[] => {
    const found: Found[] = [];
    const report = (bound: Scope, message: string, item?: ModelElement): void => {
      const stated = rule.target === undefined || rule.target === 'self' ? undefined : expressions.evaluate(rule.target, bound);
      const ids = stated?.ok ? (Array.isArray(stated.value) ? stated.value : [stated.value]) : [(item ?? self)?.id];
      const targets = ids.flatMap((id) => (typeof id === 'string' && context.byId.has(id) ? [context.byId.get(id)!] : []));
      const location = rule.location === undefined ? undefined : expressions.evaluate(rule.location, bound);
      const place = location?.ok && isObject(location.value) && typeof location.value.file === 'string' ? location.value : undefined;
      const subject = rule.subject === undefined ? undefined : expressions.evaluate(rule.subject, bound);
      found.push({
        rank: table.length,
        line: (self ?? item ?? targets[0])?.line,
        finding: {
          code: rule.code ?? rule.id,
          constraint: rule.id,
          severity: severityOf(rule, bound),
          message,
          location: place ? { file: String(place.file), line: Number(place.line ?? 0), column: Number(place.column ?? 0), length: Number(place.length ?? 0) } : at(context, targets[0]),
          ...(targets.length > 0 ? { element: targets[0].id } : {}),
          ...(rule.attribute === undefined ? {} : { attribute: rule.attribute }),
          ...(subject?.ok && typeof subject.value === 'string' ? { subject: subject.value } : {}),
        },
      });
    };
    // A rule that cannot be evaluated never passes silently (DISL 2.5).
    const failed = (bound: Scope, error: string, item?: ModelElement): void => report(bound, `The constraint \`${rule.id}\` could not be evaluated: ${error}`, item);
    const one = (bound: Scope, item?: ModelElement): void => {
      // The rule is evaluated only where `when` holds, and a `when` that fails does not hold.
      const applies = rule.when === undefined ? undefined : expressions.evaluate(rule.when, bound);
      if (applies && !(applies.ok && applies.value === true)) return;
      const result = rule.rule === undefined ? undefined : expressions.evaluate(rule.rule, bound);
      if (result?.ok && result.value === true) return;
      if (result && !result.ok) failed(bound, result.error, item);
      else if (result && result.value !== false) failed(bound, 'it gave neither true nor false', item);
      else report(bound, worded(rule.message, bound, `The constraint \`${localized(rule.label, locale, locale) ?? rule.id}\` does not hold.`), item);
    };
    if (rule.forEach === undefined) {
      one(scope);
      return found;
    }
    const items = expressions.evaluate(rule.forEach, scope);
    if (!items.ok) failed(scope, items.error);
    else if (!Array.isArray(items.raw) || !Array.isArray(items.value)) failed(scope, '`forEach` did not give a list');
    else {
      const plain = items.value;
      // An element among the items is an object in CEL and its id as plain data.
      items.raw.forEach((item: unknown, index) => {
        const id = typeof item === 'object' && item !== null ? plain[index] : undefined;
        one({ ...scope, item, index: BigInt(index) }, typeof id === 'string' ? context.byId.get(id) : undefined);
      });
    }
    return found;
  };

  // A built-in's finding, with the code, the severity and the message `builtIn` gives it.
  const builtIn = (context: Context, id: string, raised: Finding, line: number | undefined, errors: Set<string>): Found | undefined => {
    const setting = Object.hasOwn(settings, id) ? settings[id] : {};
    if (setting.enabled === false) return undefined;
    const scope = context.world.scope(raised.element, { detail: held(raised.detail ?? { reason: raised.message }) });
    let code = typeof setting.code === 'string' ? setting.code : id;
    if (isCel(setting.code)) {
      const computed = expressions.evaluate(setting.code, scope);
      if (computed.ok && typeof computed.value === 'string' && qualifiedId.test(computed.value)) code = computed.value;
      else errors.add(id);
    }
    return {
      rank: table.indexOf(id),
      reader: !table.includes(id) && !aboutElements.includes(id),
      line,
      finding: { ...raised, code, constraint: id, severity: setting.severity === undefined ? raised.severity : rated(setting.severity), message: worded(setting.message, scope, raised.message) },
    };
  };

  // The limits of its type that a relation breaks, in the order DISL 8.7 gives, and the group of
  // parallels each relation is in. `proposed` is a relation that is not in the model yet.
  const limits = (context: Context, proposed?: ModelRelation): { readonly broken: [ModelRelation, Violation][]; readonly groups: ReadonlyMap<string, ModelRelation[]> } => {
    const broken: [ModelRelation, Violation][] = [];
    const parallels = new Map<string, ModelRelation[]>();
    const keys = new Map<ModelRelation, string>();
    const relations = [...context.model.relations.filter((relation) => relation.id !== proposed?.id), ...(proposed ? [proposed] : [])];
    for (const relation of relations) {
      const type = metamodel.types[relation.type];
      const source = context.byId.get(relation.source ?? '');
      const target = context.byId.get(relation.target ?? '');
      if (!isRelation(type) || !source || !target || type.allowParallel) continue;
      const ends = type.directed ? [source.id, target.id] : [source.id, target.id].sort();
      const key = JSON.stringify([relation.type, ...ends]);
      keys.set(relation, key);
      parallels.set(key, [...(parallels.get(key) ?? []), relation]);
    }
    for (const relation of proposed ? [proposed] : relations) {
      const type = metamodel.types[relation.type];
      const source = context.byId.get(relation.source ?? '');
      const target = context.byId.get(relation.target ?? '');
      if (!isRelation(type) || !source || !target) continue;
      if (!type.source.types.includes(source.type)) broken.push([relation, 'source']);
      if (!type.target.types.includes(target.type)) broken.push([relation, 'target']);
      if (!type.allowSelfLoops && source === target) broken.push([relation, 'selfLoop']);
      if ((parallels.get(keys.get(relation) ?? '')?.indexOf(relation) ?? 0) > 0) broken.push([relation, 'parallel']);
    }
    return { broken, groups: new Map([...keys].map(([relation, key]) => [relation.id, parallels.get(key)!])) };
  };

  // ---- the order of findings (DISL 8.6) ----

  const ordered = (found: readonly Found[]): ConstraintFinding[] => {
    const codes = declared.order ?? [];
    const place = (code: string): number => (codes.includes(code) ? codes.indexOf(code) : codes.length);
    const last = Number.MAX_SAFE_INTEGER;
    // Both sorts are stable, so ties keep the order the findings were raised in.
    const arisen = [...found].sort((a, b) => a.rank - b.rank);
    if (codes.length === 0) return arisen.map((item) => item.finding);
    return arisen
      .sort((a, b) => place(a.finding.code) - place(b.finding.code) || Number(b.reader ?? false) - Number(a.reader ?? false) || (a.reader ? 0 : (a.line ?? last) - (b.line ?? last)))
      .map((item) => item.finding);
  };

  const check = (model: Model, readFindings: readonly Finding[] = [], options: CheckOptions = {}): ConstraintFinding[] => {
    const context = contextOf(model, options.file ?? readFindings[0]?.location.file ?? 'body');
    const found: Found[] = [];
    const errors = new Set<string>();
    const add = (item: Found | undefined): void => void (item && found.push(item));
    const finish = (): ConstraintFinding[] => [
      ...ordered(found),
      ...[...errors].map((id) => ({ ...finding('disl.constraints', 'error', `The \`code\` of the built-in \`${id}\` did not give a code, so its findings carry \`${id}\`.`), constraint: id })),
    ];

    // A file that cannot be parsed has that finding and no other, and no constraint is evaluated (DISL 8.6).
    const unparseable = readFindings.filter((raised) => raised.code === 'std.unparseable');
    if (unparseable.length > 0) {
      for (const raised of unparseable) add(builtIn(context, raised.code, raised, undefined, errors));
      return finish();
    }

    // The holders of one id are a group, which is reported once where `oncePerGroup` says so.
    const holders = new Map<string, Finding[]>();
    for (const raised of readFindings) {
      const id = raised.code === 'std.duplicateId' ? raised.detail?.id : undefined;
      if (typeof id === 'string') holders.set(id, [...(holders.get(id) ?? []), raised]);
    }
    const reported = new Set([...holders.values()].flatMap((group) => flagged(group, settings['std.duplicateId']?.oncePerGroup)));
    for (const raised of readFindings) {
      const group = holders.get(String(raised.detail?.id ?? ''));
      if (raised.code !== 'std.duplicateId' || !group) add(builtIn(context, raised.code, raised, context.byId.get(raised.element ?? '')?.line ?? raised.location.line, errors));
      // A group is ordered by the line of its first member, which keeps the id.
      else if (reported.has(raised)) add(builtIn(context, raised.code, raised, context.byId.get(String(raised.detail?.id))?.line ?? group[0].location.line, errors));
    }

    const { broken, groups: parallels } = limits(context);
    for (const [relation, violation] of broken) {
      const group = parallels.get(relation.id) ?? [relation];
      if (violation === 'parallel' && !flagged(group.slice(1), settings[endpoints]?.oncePerGroup).includes(relation)) continue;
      const raised: Finding = { code: endpoints, severity: 'error', message: limit(relation.type, violation), location: at(context, relation), element: relation.id, detail: { relationType: relation.type, violation } };
      add(builtIn(context, endpoints, raised, violation === 'parallel' ? group[0].line : relation.line, errors));
    }

    for (const rule of rules) {
      if (!isInvariant(rule) || !timingOf(rule).includes(options.timing ?? 'live')) continue;
      for (const self of scopeOf(rule, model)) found.push(...judge(rule, context, self, scopeFor(context, self)));
    }
    return finish();
  };

  const refusals = (gesture: Gesture, model: Model, after?: Model): ConstraintFinding[] => {
    const context = contextOf(model, 'body');
    const self = context.byId.get(gesture.self ?? '');
    const values: Record<string, unknown> = { ...gesture.values };
    for (const [name, id] of Object.entries(gesture.elements ?? {})) values[name] = id === undefined ? null : context.world.element(id);
    const attribute = gesture.kind === 'change' && self && typeof values.attribute === 'string' ? attributesOf(metamodel, self.type)[values.attribute] : undefined;
    if (self && attribute) {
      values.newValue = context.world.toCel(values.newValue as Value | undefined, attribute);
      values.oldValue = context.world.toCel(self.attributes[values.attribute as string], attribute);
    }
    const scope = self ? context.world.scope(self.id, values) : context.world.scope(undefined, { self: null, ...values });
    const refused: ConstraintFinding[] = [];

    const setting = Object.hasOwn(settings, endpoints) ? settings[endpoints] : {};
    if (gesture.kind === 'connect' && setting.enabled !== false && typeof values.relationType === 'string') {
      const type = values.relationType;
      const proposed: ModelRelation = { id: gesture.self ?? '', type, attributes: {}, host: {}, ephemeral: true, line: 0, source: gesture.elements?.source, target: gesture.elements?.target };
      for (const [, violation] of limits(context, proposed).broken) {
        const end = violation === 'source' || violation === 'target' ? { end: violation } : {};
        refused.push({
          code: endpoints, constraint: endpoints, severity: rated(setting.severity ?? 'error'), location: at(context, self), ...(self ? { element: self.id } : {}),
          // A refusal is never taken from `message` (DISL 8.1).
          message: worded(setting.refusal, { ...scope, violation: { rule: endpoints, relationType: type, ...end } }, limit(type, violation)),
        });
      }
    }

    for (const rule of rules) {
      if (rule.kind !== gesture.kind || (rule.enforcement ?? 'prevent') === 'report') continue;
      const names = scopeNames(rule);
      if (names.includes('diagram') || (self && inScope(names, self))) refused.push(...judge(rule, context, self, scope).map((item) => item.finding));
    }

    // An invariant that prevents rejects what would make it false where it holds now (DISL 8.2):
    // an element that breaks it already can still be changed.
    const next = after ? contextOf(after, 'body') : undefined;
    for (const rule of next ? rules : []) {
      if (!isInvariant(rule) || !next || (rule.enforcement ?? 'report') === 'report') continue;
      for (const element of scopeOf(rule, next.model)) {
        const then = judge(rule, next, element, scopeFor(next, element));
        const now = element === undefined ? undefined : context.byId.get(element.id);
        const isNew = element !== undefined && now === undefined;
        if (then.length > 0 && (isNew || judge(rule, context, now, scopeFor(context, now)).length === 0)) refused.push(...then.map((item) => item.finding));
      }
    }
    return refused;
  };

  const blocksSave = (raised: readonly Finding[]): boolean => declared.blockSaveOn === 'error' && raised.some((item) => item.severity === 'error');

  return { value: { check, refusals, blocksSave }, findings };
}
