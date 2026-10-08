// The forms of a specification (DISL 7.5): for each form the types it is for, where it is used, and
// its items as data a panel can show without knowing DISL. What depends on the document (whether an
// item is shown, what it shows, what an entered text means) is a function over a model and an element.

import type { Expressions, Scope, World } from './expressions';
import { attributesOf, defaultOf, formatYearMonth, parseYearMonth, valueKind, type Metamodel } from './metamodel';
import { finding, type Finding, type Loaded, type Model, type Value } from './model';
import { isCel, isObject, labelOf, localized, type Attribute, type CelValue, type Doc, type Expression, type LocalizedText, type Message, type Reason, type Specification } from './specification';

// ---- as the schema has them ----

/** `$defs/FieldValidation` (DISL 7.5). */
export interface FieldValidation {
  readonly rule: Expression;
  readonly message: Message;
  readonly severity?: 'error' | 'warning' | 'info';
  readonly timing?: 'input' | 'commit';
}

/** `$defs/FieldParse` (DISL 7.5): an item that is edited as a text of its own. */
export interface FieldParse {
  readonly accepts: Expression;
  readonly write: readonly unknown[];
  readonly refusal: Message;
  readonly doc?: Doc;
}

/** `$defs/FormItem` (DISL 7.5), as far as it is read. */
export interface FormItemDeclaration {
  readonly kind?: string;
  readonly id?: string;
  readonly attribute?: string;
  readonly widget?: string;
  readonly label?: Message;
  readonly title?: Message;
  readonly placeholder?: Message;
  readonly visible?: Expression;
  readonly enabled?: Expression;
  readonly required?: boolean;
  readonly validate?: readonly FieldValidation[];
  readonly options?: readonly unknown[] | CelValue | { readonly enum: string };
  readonly widgetOptions?: Readonly<Record<string, unknown>>;
  readonly display?: Message;
  readonly parse?: FieldParse;
  readonly readOnly?: boolean | CelValue | { readonly attribute: string };
  readonly readOnlyReasons?: readonly Reason[];
  readonly absentText?: Message;
  readonly emptyText?: Message;
  readonly onChange?: readonly unknown[];
  readonly collapsible?: boolean;
  readonly collapsed?: boolean;
  readonly items?: readonly FormItemDeclaration[];
  readonly tabs?: readonly { readonly title?: Message; readonly items?: readonly FormItemDeclaration[] }[];
  readonly value?: string | CelValue | { readonly attribute: string };
  readonly operation?: string;
  readonly actions?: readonly unknown[];
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

export type Usage = 'inspector' | 'create' | 'embedded' | 'popover' | 'bulk';

/** `$defs/Form` (DISL 7.5). */
export interface FormDeclaration {
  readonly for?: string | readonly string[];
  readonly usage?: readonly Usage[];
  readonly items: readonly FormItemDeclaration[];
  readonly commit?: 'immediate' | 'onBlur' | 'explicit';
  readonly label?: Message;
  readonly icon?: unknown;
  readonly submitLabel?: Message;
  readonly cancelLabel?: Message;
  readonly danger?: boolean;
  readonly doc?: Doc;
}

// ---- interpreted ----

/** What a form is shown for: a model and one of its elements, or the diagram itself when no element is named. */
export interface Subject {
  readonly model: Model;
  readonly element?: string;
  /** Members of `env` (DISL 12.2), such as `viewpoint` and `readOnly`. */
  readonly env?: Scope;
}

export interface Option {
  readonly value: Value;
  readonly label: string;
  readonly icon?: string;
}

/**
 * What an entered value means: the attributes to set (null empties one), or the actions of the
 * item's `parse` to run with `value` bound to the text, or the sentence of a refusal.
 */
export type Parsed =
  | { readonly set: Readonly<Record<string, Value | null>> }
  | { readonly write: readonly unknown[]; readonly value: string }
  | { readonly refused: string };

export interface FormItem {
  /** `field`, `computed`, a container (`section`, `row`, `group`, `tabs`), or another kind of DISL 7.5. */
  readonly kind: string;
  /** The attribute a field edits. */
  readonly attribute?: string;
  /** The widget: the declared one, else the default of the attribute's type (DISL B.7). */
  readonly widget: string;
  readonly widgetOptions: Readonly<Record<string, unknown>>;
  readonly required: boolean;
  /** Whether the item can be edited at all: it has an attribute or a `parse`. */
  readonly editable: boolean;
  /** For a container: whether it can be folded, and starts folded. */
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  /** For a button: the operation it runs. */
  readonly operation?: string;
  /** Actions that run after a value is committed (DISL 9.4). */
  readonly onChange: readonly unknown[];
  /** The items of a container. */
  readonly items: readonly FormItem[];
  /** The name a host addresses the row by: the item's `id`, else its attribute, else its label (DISL 7.5). */
  rowId(on: Subject): string;
  label(on: Subject): string;
  placeholder(on: Subject): string;
  visible(on: Subject): boolean;
  /** Whether the item cannot be changed, and the sentence that says why when there is one. */
  readOnly(on: Subject): { readonly readOnly: boolean; readonly reason?: string };
  /** The choices of a widget that offers some: the declared ones, else the values of the attribute's enum. */
  options(on: Subject): readonly Option[];
  /** The value itself: the stored one, else the attribute's default; for a computed item, what it computes. */
  value(on: Subject): Value | undefined;
  /** The value as text, as the item shows it. */
  display(on: Subject): string;
  /** The sentence of the first validation of severity `error` that an entered value fails, at that moment. */
  validate(on: Subject, input: Value, timing?: 'input' | 'commit'): string | undefined;
  /** What committing an entered value does. It changes nothing: the behavior carries it out. */
  parse(on: Subject, input: Value): Parsed;
}

export interface Form {
  readonly id: string;
  /** Types of the metamodel, or `diagram`. */
  readonly for: readonly string[];
  readonly usage: readonly Usage[];
  readonly commit: 'immediate' | 'onBlur' | 'explicit';
  /** Made from the type's attributes, because the specification declares no form for it (DISL 7.5). */
  readonly generated: boolean;
  readonly items: readonly FormItem[];
  label(on: Subject): string;
}

export interface Forms {
  /** The declared forms, by their id. */
  readonly all: Readonly<Record<string, Form>>;
  /** The form of a type for a usage; see `formFor`. */
  resolve(type: string | undefined, usage: Usage): Form;
}

/** Sentences, reasons and conditions of a specification, evaluated over a model. The behavior words its own with the same. */
export interface Texts {
  world(model: Model, env?: Scope): World;
  /** `self` (the element, or the diagram), `diagram` and `env`, and whatever else is bound. */
  scope(on: Subject, more?: Scope): Scope;
  /** A message as text; one that cannot be evaluated gives the fallback (DISL 2.3). */
  worded(message: Message | undefined, scope: Scope, fallback: string): string;
  /** The sentence of the first reason of a list that applies (DISL 2.3). */
  applicable(reasons: readonly Reason[] | undefined, scope: Scope): string | undefined;
  /** Whether a condition holds; one that is absent or cannot be evaluated gives `otherwise`. */
  holds(condition: unknown, scope: Scope, otherwise: boolean): boolean;
}

export function createTexts(specification: Specification, expressions: Expressions): Texts {
  const locale = specification.language.defaultLocale ?? 'en';
  const behavior = specification.behavior;
  const named = (isObject(behavior) && isObject(behavior.reasons) ? behavior.reasons : {}) as Readonly<Record<string, { readonly when?: Expression; readonly message: Message }>>;
  let last: { readonly model: Model; readonly env: Scope | undefined; readonly world: World } | undefined;

  const world = (model: Model, env?: Scope): World => {
    if (last?.model !== model || last.env !== env) last = { model, env, world: expressions.over(model, { env }) };
    return last.world;
  };
  const worded = (message: Message | undefined, scope: Scope, fallback: string): string => {
    if (message === undefined) return fallback;
    if (!isCel(message)) return localized(message, locale, locale) ?? fallback;
    const result = expressions.evaluate(message, scope);
    if (!result.ok) return fallback;
    if (typeof result.value === 'string') return result.value;
    return (isObject(result.value) ? localized(result.value as Record<string, string>, locale, locale) : undefined) ?? fallback;
  };
  const holds = (condition: unknown, scope: Scope, otherwise: boolean): boolean => {
    if (typeof condition === 'boolean') return condition;
    if (typeof condition !== 'string' && !isCel(condition)) return otherwise;
    const result = expressions.evaluate(condition, scope);
    return result.ok && typeof result.value === 'boolean' ? result.value : otherwise;
  };
  const unworded = 'This is not possible here.';
  const applicable = (reasons: readonly Reason[] | undefined, scope: Scope): string | undefined => {
    for (const reason of reasons ?? []) {
      const stated: Readonly<Record<string, unknown>> | undefined = isCel(reason) || !isObject(reason) ? undefined : reason;
      if (!stated) return worded(reason as Message, scope, unworded);
      if (typeof stated.reason === 'string') {
        const known = Object.hasOwn(named, stated.reason) ? named[stated.reason] : undefined;
        if (known && holds(known.when, scope, true)) return worded(known.message, scope, unworded);
      } else if ('message' in stated) {
        if (holds(stated.when, scope, true)) return worded(stated.message as Message, scope, unworded);
      } else {
        return worded(reason as LocalizedText, scope, unworded);
      }
    }
    return undefined;
  };
  return {
    world, worded, applicable, holds,
    scope: (on, more) => {
      const over = world(on.model, on.env);
      return on.element === undefined ? over.scope(undefined, { self: over.diagram, ...more }) : over.scope(on.element, more);
    },
  };
}

const containers = ['section', 'row', 'group', 'tabs'];

// The default widget of an attribute's type (DISL B.7).
const widgets: Readonly<Record<string, string>> = {
  string: 'text', text: 'textarea', int: 'number', number: 'number', bool: 'checkbox', date: 'date', datetime: 'datetime', time: 'time',
  duration: 'duration', yearMonth: 'month', color: 'color', uri: 'link', expression: 'code', json: 'code', binary: 'file',
};

/** Interprets `forms`. Its findings are the expressions that cannot be read; an item with one is kept. */
export function interpretForms(specification: Specification, metamodel: Metamodel, expressions: Expressions): Loaded<Forms> {
  const declared = (specification.forms ?? {}) as unknown as Readonly<Record<string, FormDeclaration>>;
  const findings: Finding[] = [];
  const texts = createTexts(specification, expressions);
  const { scope, worded, holds, applicable } = texts;

  const unread = (owner: string, properties: Readonly<Record<string, unknown>>): void => {
    for (const [name, value] of Object.entries(properties)) {
      const error = (typeof value === 'string' || isCel(value)) ? expressions.compile(value).error : undefined;
      if (error !== undefined) findings.push(finding('disl.forms', 'error', `The \`${name}\` of ${owner} cannot be read: ${error}`));
    }
  };
  const cel = (value: unknown): CelValue | undefined => (isCel(value) ? value : undefined);

  const elements = new WeakMap<Model, Map<string, { readonly type: string; readonly attributes: Readonly<Record<string, Value>> }>>();
  const subject = (on: Subject): { readonly type: string; readonly attributes: Readonly<Record<string, Value>> } => {
    if (on.element === undefined) return { type: 'diagram', attributes: on.model.diagram };
    let known = elements.get(on.model);
    if (!known) elements.set(on.model, known = new Map([...on.model.elements, ...on.model.relations].map((element) => [element.id, element])));
    return known.get(on.element) ?? { type: '', attributes: {} };
  };

  const widgetOf = (attribute: Attribute | undefined): string => {
    if (!attribute) return 'readonly';
    const kind = valueKind(metamodel, attribute.type);
    if (attribute.many === true) return kind.kind === 'reference' ? 'references' : kind.kind === 'struct' ? 'table' : kind.kind === 'primitive' && kind.primitive !== 'string' ? 'list' : 'tags';
    if (kind.kind === 'enum') return kind.enum.extensible ? 'combobox' : kind.enum.values.length <= 4 ? 'segmented' : 'select';
    if (kind.kind !== 'primitive') return kind.kind;
    const { min, max, step } = attribute as { readonly min?: unknown; readonly max?: unknown; readonly step?: unknown };
    const ranged = typeof min === 'number' && typeof max === 'number' && (max - min) / (typeof step === 'number' && step > 0 ? step : 1) <= 100;
    return ranged && (kind.primitive === 'int' || kind.primitive === 'number') ? 'slider' : widgets[kind.primitive] ?? 'text';
  };

  // One value as a text, by what the attribute holds.
  const shown = (value: Value, attribute: Attribute | undefined): string => {
    if (Array.isArray(value)) return value.map((entry: Value) => shown(entry, attribute)).join(', ');
    const kind = attribute && valueKind(metamodel, attribute.type);
    if (kind?.kind === 'primitive' && kind.primitive === 'yearMonth' && typeof value === 'number') return formatYearMonth(value);
    if (kind?.kind === 'enum') return kind.enum.values.find((entry) => entry.key === value)?.label ?? String(value);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  // An entered text as a value of the attribute, or the sentence that says what it is not.
  const read = (text: string, attribute: Attribute): { readonly value: Value } | { readonly error: string } => {
    const kind = valueKind(metamodel, attribute.type);
    const not = (what: string): { readonly error: string } => ({ error: `'${text}' is not ${what}.` });
    if (kind.kind === 'enum') {
      const found = kind.enum.values.find((entry) => entry.key === text.trim() || entry.label.toLowerCase() === text.trim().toLowerCase());
      return found ? { value: found.key } : kind.enum.extensible ? { value: text } : not(`one of ${kind.enum.values.map((entry) => entry.label).join(', ')}`);
    }
    if (kind.kind !== 'primitive') return { value: text };
    switch (kind.primitive) {
      case 'int': return /^\s*[-+]?\d+\s*$/.test(text) ? { value: Number(text) } : not('a whole number');
      case 'number': return text.trim() !== '' && Number.isFinite(Number(text)) ? { value: Number(text) } : not('a number');
      case 'bool': return /^\s*(true|false)\s*$/.test(text) ? { value: text.trim() === 'true' } : not('true or false');
      case 'yearMonth': {
        const index = parseYearMonth(text.trim());
        return index === undefined ? not('a year and a month, written as YYYY-MM') : { value: index };
      }
      default: return { value: text };
    }
  };

  const item = (form: string, type: string, own: FormItemDeclaration): FormItem => {
    const computed = own.kind === 'computed';
    const kind = own.kind ?? (own.attribute === undefined ? 'text' : 'field');
    const name = own.attribute;
    const attributeOf = (on: Subject): Attribute | undefined => {
      if (name === undefined) return undefined;
      const attributes = attributesOf(metamodel, subject(on).type);
      return Object.hasOwn(attributes, name) ? attributes[name] : undefined;
    };
    const fixed = name === undefined ? undefined : attributesOf(metamodel, type)[name];
    const owner = `the item \`${own.id ?? name ?? (typeof own.label === 'string' ? own.label : kind)}\` of the form \`${form}\``;
    unread(owner, {
      visible: own.visible, enabled: own.enabled, accepts: own.parse?.accepts, label: cel(own.label), title: cel(own.title), display: cel(own.display),
      value: cel(own.value), options: cel(own.options), refusal: cel(own.parse?.refusal), readOnly: cel(own.readOnly),
    });
    for (const validation of own.validate ?? []) unread(owner, { rule: validation.rule, message: cel(validation.message) });

    const stored = (on: Subject): Value | undefined => {
      const attribute = attributeOf(on);
      const attributes = subject(on).attributes;
      if (name === undefined || !attribute) return undefined;
      return Object.hasOwn(attributes, name) ? attributes[name] : defaultOf(attribute);
    };
    // The attribute's value as CEL holds it, which is its default or its zero while nothing is stored.
    const held = (on: Subject): unknown => {
      const attribute = attributeOf(on);
      const attributes = subject(on).attributes;
      return name === undefined || !attribute ? undefined : texts.world(on.model, on.env).toCel(Object.hasOwn(attributes, name) ? attributes[name] : undefined, attribute);
    };
    const entered = (on: Subject, input: Value): unknown => {
      const attribute = attributeOf(on);
      return typeof input === 'string' || !attribute ? input : texts.world(on.model, on.env).toCel(input, attribute);
    };
    const value = (on: Subject): Value | undefined => {
      if (!computed) return stored(on);
      if (isObject(own.value) && typeof own.value.attribute === 'string') return subject(on).attributes[own.value.attribute];
      if (!isCel(own.value)) return own.value as string | undefined;
      const result = expressions.evaluate(own.value, scope(on));
      return result.ok ? result.value : undefined;
    };
    const label = (on: Subject): string => worded(own.title ?? own.label, scope(on), name === undefined ? '' : localized(attributeOf(on)?.label, undefined, undefined) ?? labelOf(name));
    const validate = (on: Subject, input: Value, timing: 'input' | 'commit' = 'commit'): string | undefined => {
      const bound = scope(on, { value: entered(on, input) });
      for (const validation of own.validate ?? []) {
        if ((validation.severity ?? 'error') !== 'error' || (timing === 'input' && validation.timing === 'commit')) continue;
        if (!holds(validation.rule, bound, false)) return worded(validation.message, bound, `This value is not accepted by ${owner}.`);
      }
      return undefined;
    };
    const readOnly = (on: Subject): { readonly readOnly: boolean; readonly reason?: string } => {
      if (on.env?.readOnly === true) return { readOnly: true };
      const attribute = attributeOf(on);
      const bound = scope(on, { value: held(on) });
      const reason = applicable(own.readOnlyReasons, bound) ?? applicable(attribute?.readOnlyReasons, bound);
      if (reason !== undefined) return { readOnly: true, reason };
      const bindable = isObject(own.readOnly) && typeof own.readOnly.attribute === 'string' ? subject(on).attributes[own.readOnly.attribute] === true : holds(own.readOnly, bound, false);
      const locked = bindable || attribute?.readOnly === true || attribute?.derived !== undefined || 'fixed' in (attribute ?? {}) || !holds(own.enabled, bound, true);
      return { readOnly: locked || (own.parse === undefined && attribute === undefined) };
    };

    return {
      kind,
      attribute: name,
      // A computed item that parses its own text is edited as text (DISL 7.5).
      widget: own.widget ?? (!computed ? widgetOf(fixed) : own.parse ? 'text' : 'readonly'),
      widgetOptions: own.widgetOptions ?? {},
      required: own.required === true || fixed?.required === true,
      editable: name !== undefined || own.parse !== undefined,
      collapsible: own.collapsible === true || own.collapsed === true,
      collapsed: own.collapsed === true,
      operation: own.operation,
      onChange: own.onChange ?? [],
      items: [...(own.items ?? []), ...(own.tabs ?? []).map((tab): FormItemDeclaration => ({ kind: 'group', title: tab.title, items: tab.items }))].map((child) => item(form, type, child)),
      rowId: (on) => own.id ?? name ?? label(on),
      label,
      placeholder: (on) => worded(own.placeholder, scope(on), ''),
      visible: (on) => holds(own.visible, scope(on, { value: held(on) }), true),
      readOnly,
      options: (on) => {
        const kindOf = attributeOf(on) && valueKind(metamodel, attributeOf(on)!.type);
        const named = isObject(own.options) && typeof own.options.enum === 'string' ? metamodel.enums[own.options.enum] : own.options === undefined && kindOf?.kind === 'enum' ? kindOf.enum : undefined;
        if (named) return named.values.map((entry) => ({ value: entry.key, label: entry.label, icon: typeof entry.icon === 'string' ? entry.icon : undefined }));
        const evaluated = isCel(own.options) ? expressions.evaluate(own.options, scope(on, { value: held(on) })) : undefined;
        const list: readonly unknown[] = Array.isArray(own.options) ? own.options : evaluated?.ok && Array.isArray(evaluated.value) ? evaluated.value : [];
        return list.map((entry): Option => (isObject(entry) && 'value' in entry
          ? { value: entry.value as Value, label: localized(entry.label as LocalizedText | undefined, undefined, undefined) ?? String(entry.value), icon: typeof entry.icon === 'string' ? entry.icon : undefined }
          : { value: entry as Value, label: String(entry) }));
      },
      value,
      display: (on) => {
        const bound = scope(on, { value: held(on) });
        const present = value(on);
        if (own.display !== undefined) return worded(own.display, bound, present === undefined || present === null ? '' : shown(present, attributeOf(on)));
        if (present === undefined || present === null) return worded(own.absentText ?? attributeOf(on)?.absentText, bound, '');
        if (present === '') return worded(own.emptyText ?? attributeOf(on)?.emptyText, bound, '');
        return shown(present, attributeOf(on));
      },
      validate,
      parse: (on, input) => {
        const locked = readOnly(on);
        if (locked.readOnly) return { refused: locked.reason ?? `${label(on) || 'This'} cannot be changed here.` };
        const invalid = validate(on, input);
        if (invalid !== undefined) return { refused: invalid };
        if (own.parse && typeof input === 'string') {
          const bound = scope(on, { value: input });
          if (!holds(own.parse.accepts, bound, false)) return { refused: worded(own.parse.refusal, bound, `'${input}' is not accepted here.`) };
          return { write: own.parse.write, value: input };
        }
        const attribute = attributeOf(on);
        if (name === undefined || !attribute) return { refused: `${label(on) || 'This'} cannot be changed here.` };
        if (typeof input !== 'string') return { set: { [name]: input } };
        if (attribute.many === true) {
          const entries: Value[] = [];
          for (const part of input.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
            const one = read(part, attribute);
            if ('error' in one) return { refused: one.error };
            // The entries of a list of text are a set, as its widget shows them.
            if (!entries.includes(one.value)) entries.push(one.value);
          }
          return { set: { [name]: entries } };
        }
        const kind = valueKind(metamodel, attribute.type);
        const textual = kind.kind === 'primitive' && ['string', 'text', 'expression', 'uri', 'color'].includes(kind.primitive);
        if (input.trim() === '' && !textual) return { set: { [name]: null } };
        const one = read(input, attribute);
        return 'error' in one ? { refused: one.error } : { set: { [name]: one.value } };
      },
    };
  };

  const form = (id: string, own: FormDeclaration, generated: boolean): Form => {
    const types = own.for === undefined ? [] : typeof own.for === 'string' ? [own.for] : [...own.for];
    const usage = own.usage ?? ['inspector'];
    unread(`the form \`${id}\``, { label: cel(own.label) });
    return {
      id, for: types, usage, generated,
      commit: own.commit ?? (usage.includes('inspector') ? 'immediate' : 'explicit'),
      items: (Array.isArray(own.items) ? own.items : []).map((child) => item(id, types[0] ?? '', child)),
      label: (on) => worded(own.label, scope(on), ''),
    };
  };

  const all: Record<string, Form> = {};
  for (const [id, own] of Object.entries(declared)) if (isObject(own)) all[id] = form(id, own, false);

  // One field for each attribute that is not derived, the ungrouped first, then a section for each `group` (DISL 7.5).
  const generated = new Map<string, Form>();
  const generate = (type: string): Form => {
    const known = generated.get(type);
    if (known) return known;
    const fields = Object.entries(attributesOf(metamodel, type))
      .filter(([, attribute]) => attribute.derived === undefined)
      .map(([attribute, own], index) => ({ attribute, group: own.group, order: own.order ?? Number.MAX_SAFE_INTEGER, index }))
      .sort((a, b) => a.order - b.order || a.index - b.index);
    const groups = [...new Set(fields.map((field) => field.group).filter((group): group is string => group !== undefined))];
    const made = form(type, {
      for: type,
      items: [
        ...fields.filter((field) => field.group === undefined).map(({ attribute }) => ({ attribute })),
        ...groups.map((group) => ({ kind: 'section', title: group, items: fields.filter((field) => field.group === group).map(({ attribute }) => ({ attribute })) })),
      ],
    }, true);
    generated.set(type, made);
    return made;
  };

  const resolve = (type: string | undefined, usage: Usage): Form => {
    const names = type === undefined ? ['diagram'] : metamodel.types[type]?.lineage ?? [type];
    for (const name of names) {
      const found = Object.values(all).find((candidate) => candidate.for.includes(name) && candidate.usage.includes(usage));
      if (found) return found;
    }
    return generate(names[0]);
  };

  return { value: { all, resolve }, findings };
}

/** The form of a type for a usage: its own, that of its nearest supertype, else one made from its attributes. The diagram's own form for no type. */
export const formFor = (forms: Forms, type: string | undefined, usage: Usage = 'inspector'): Form => forms.resolve(type, usage);

/** The rows of a form: its fields and computed items, those inside its containers included, in order. */
export function rowsOf(items: readonly FormItem[]): FormItem[] {
  return items.flatMap((entry) => (containers.includes(entry.kind) ? rowsOf(entry.items) : entry.kind === 'field' || entry.kind === 'computed' ? [entry] : []));
}
