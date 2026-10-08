// A DISL specification as this interpreter reads it. The types mirror the schema's `$defs`, name
// for name; a section another module interprets is typed there and is a plain object here.

import { finding, type Finding, type Loaded } from './model';
import { unsupportedFeatures } from './support';

export type { Finding, Loaded } from './model';

// ---- foundations (DISL 2) ----

/** A plain string, or strings by BCP 47 language tag (DISL 2.3). */
export type LocalizedText = string | Readonly<Record<string, string>>;

/** The object form of a computed value (DISL 2.5). */
export interface CelValue {
  readonly cel: string;
  readonly resultType?: string;
  readonly doc?: Doc;
}

/** A property that always holds CEL: its source, or the object form. */
export type Expression = string | CelValue;

/** A literal, or a value computed from CEL, an attribute, a theme token or a parameter (DISL 2.5). */
export type Bindable<T> = T | CelValue | { readonly attribute: string } | { readonly token: string } | { readonly param: string };

/** Every sentence and label that may be computed (DISL 2.3). */
export type Message = LocalizedText | CelValue;

/** Why something is refused, read-only or unavailable (DISL 2.3). */
export type Reason = Message | { readonly when?: Expression; readonly message: Message; readonly id?: string; readonly doc?: Doc } | { readonly reason: string };

export type Doc = LocalizedText | {
  readonly summary?: LocalizedText;
  readonly description?: LocalizedText;
  readonly rationale?: LocalizedText;
  readonly tags?: readonly string[];
  readonly [name: string]: unknown;
};

/** A section this module does not type: the module that interprets it does. */
export type Section = Readonly<Record<string, unknown>>;

// ---- the specification (DISL 3) ----

export interface Specification {
  readonly $schema?: string;
  readonly disl: string;
  readonly language: Language;
  readonly functions?: Readonly<Record<string, FunctionDeclaration>>;
  readonly metamodel: Metamodel;
  readonly coordinates?: Section;
  readonly notation?: Section & { readonly textMetric?: TextMetric };
  readonly toolbox?: Section;
  readonly forms?: Readonly<Record<string, Section>>;
  readonly constraints?: Section;
  readonly behavior?: Section;
  readonly layout?: Section;
  readonly persistence?: Persistence;
  readonly viewpoints?: Readonly<Record<string, Section>>;
  readonly doc?: Doc;
  /** `imports`, `plugins` and the `x-` extensions, which this interpreter does not read. */
  readonly [name: string]: unknown;
}

export interface Language {
  readonly id: string;
  readonly version: string;
  readonly origin?: string;
  readonly label?: LocalizedText;
  readonly doc?: Doc;
  readonly defaultLocale?: string;
  readonly fileExtension?: string;
  readonly icon?: unknown;
  readonly limits?: Section;
  readonly requires?: { readonly conformance?: 'core' | 'standard' | 'full'; readonly features?: readonly string[] };
  readonly [name: string]: unknown;
}

/** `$defs/Function` (DISL 3.4). */
export interface FunctionDeclaration {
  readonly params: readonly { readonly name: string; readonly type: string; readonly doc?: Doc }[];
  readonly returns: string;
  readonly cel: string;
  readonly uses?: readonly ('diagram' | 'env')[];
  readonly recursion?: { readonly maxDepth: number; readonly atMaxDepth: string };
  readonly doc?: Doc;
}

/** How text is measured where a measurement affects geometry (DISL 6.5). */
export type TextMetric = 'host' | {
  readonly kind: 'average';
  readonly advance: number;
  readonly count?: 'utf16' | 'codepoint' | 'grapheme';
  readonly lineHeight?: number;
};

// ---- metamodel (DISL 4) ----

export interface Metamodel {
  readonly diagram?: { readonly attributes?: Readonly<Record<string, Attribute>>; readonly doc?: Doc };
  readonly dataTypes?: Readonly<Record<string, DataType>>;
  readonly enums?: Readonly<Record<string, Enum>>;
  readonly types?: Readonly<Record<string, NodeType>>;
  readonly relations?: Readonly<Record<string, RelationType>>;
  readonly doc?: Doc;
}

export interface Attribute {
  /** A primitive, an enum, a data type, or a node or relation type (a reference). */
  readonly type: string;
  readonly label?: LocalizedText;
  readonly doc?: Doc;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly many?: boolean;
  readonly readOnly?: boolean;
  readonly readOnlyReasons?: readonly Reason[];
  readonly absentText?: Message;
  readonly emptyText?: Message;
  readonly derived?: Expression;
  readonly fixed?: unknown;
  readonly transient?: boolean | 'viewer';
  readonly unique?: 'diagram' | 'parent' | 'type';
  readonly key?: boolean;
  readonly facets?: Section;
  readonly group?: string;
  readonly order?: number;
  /** The facets of DISL 4.2, which may be written on the attribute itself. */
  readonly [name: string]: unknown;
}

export interface DataType {
  readonly base?: string;
  readonly fields?: Readonly<Record<string, Attribute>>;
  readonly label?: LocalizedText;
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

export interface Enum {
  readonly values: Readonly<Record<string, EnumValue>>;
  readonly ordered?: boolean;
  readonly extensible?: boolean;
  readonly label?: LocalizedText;
  readonly doc?: Doc;
}

export interface EnumValue {
  /** The stored form; the key when absent. */
  readonly value?: string;
  readonly label?: LocalizedText;
  readonly doc?: Doc;
  readonly color?: string | { readonly token: string };
  readonly icon?: unknown;
  readonly deprecated?: unknown;
}

export interface NodeType {
  readonly label?: LocalizedText;
  readonly doc?: Doc;
  readonly icon?: unknown;
  readonly abstract?: boolean;
  readonly extends?: string | readonly string[];
  readonly attributes?: Readonly<Record<string, Attribute>>;
  readonly bounds?: { readonly neighbour?: NeighbourBounds };
  readonly children?: Section;
  readonly viewOnly?: boolean;
  readonly labelAttribute?: string;
  readonly tags?: readonly string[];
  readonly [name: string]: unknown;
}

export interface RelationType extends NodeType {
  readonly source: string | readonly string[] | RelationEnd;
  readonly target: string | readonly string[] | RelationEnd;
  readonly directed?: boolean;
  readonly allowSelfLoops?: boolean;
  readonly allowParallel?: boolean;
  readonly acyclic?: boolean;
}

export interface RelationEnd {
  readonly types: readonly string[];
  readonly exclude?: readonly string[];
  readonly ports?: readonly string[];
  readonly min?: number | null;
  readonly max?: number | null;
  readonly role?: string;
  readonly optional?: boolean;
  readonly doc?: Doc;
}

/** Ordered attributes kept a distance apart (DISL 4.3). */
export interface NeighbourBounds {
  readonly attributes: readonly string[];
  readonly between: readonly [string, string];
  readonly gap: number | CelValue;
  readonly inner?: number | CelValue;
  readonly absent?: 'spread' | 'ignore';
  readonly on?: readonly ('change' | 'handle' | 'create')[];
  readonly pinned?: 'edited' | 'none';
  readonly doc?: Doc;
}

// ---- persistence (DISL 11) ----

export interface Persistence {
  readonly format?: string;
  /** `<uri>#<name>` of an FBL document; an inline binding is not read. */
  readonly binding?: string | Section;
  readonly typeMap?: Readonly<Record<string, TypeMapEntry>>;
  readonly ids?: IdStrategy;
  readonly view?: { readonly store?: readonly string[]; readonly viewer?: readonly string[]; readonly [name: string]: unknown };
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

export interface TypeMapEntry {
  /** `diagram`, `header`, `unreadable`, or a type of the metamodel. */
  readonly as: string;
  /** A binding attribute to an attribute's name, `source`, `target`, `id`, or null for one that is not in the model. */
  readonly attributes?: Readonly<Record<string, string | null>>;
  readonly hostAttributes?: readonly string[];
  readonly doc?: Doc;
}

export interface IdRule {
  readonly strategy?: 'uuid-v4' | 'uuid-v7' | 'ulid' | 'nanoid' | 'sequential' | 'natural' | 'cel' | 'derived';
  readonly encoding?: 'hex' | 'base64url' | 'base36';
  readonly prefix?: string | Readonly<Record<string, string>>;
  readonly expression?: Expression;
  readonly stable?: boolean;
  readonly pattern?: string;
  readonly suffix?: string;
  readonly ephemeral?: boolean | Expression;
  readonly reason?: Reason;
  readonly doc?: Doc;
}

export interface IdStrategy extends IdRule {
  readonly types?: Readonly<Record<string, IdRule>>;
  readonly missing?: 'assign' | 'ephemeral';
  readonly compare?: 'exact' | 'ignore-case';
}

// ---- reading ----

export const emptySpecification: Specification = { disl: '', language: { id: '', version: '' }, metamodel: {} };

/** The best text for a locale: its own, the language of it, the default locale's, then the first (DISL 2.3). */
export function localized(text: LocalizedText | undefined, locale = 'en', defaultLocale = 'en'): string | undefined {
  if (text === undefined || typeof text === 'string') return text;
  return text[locale] ?? text[locale.split('-')[0]] ?? text[defaultLocale] ?? Object.values(text)[0];
}

/** The label of something that declares none: its identifier, split at camel case and underscores (DISL 2.4). */
export function labelOf(identifier: string): string {
  const words = identifier.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The CEL source of an expression in either of its forms. */
export const celOf = (expression: Expression): string => (typeof expression === 'string' ? expression : expression.cel);

export const isCel = (value: unknown): value is CelValue => isObject(value) && typeof value.cel === 'string';

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The minor version of DISL this interpreter was written for; its major version is 0. */
const minor = 3;

const sections = ['functions', 'coordinates', 'notation', 'toolbox', 'forms', 'constraints', 'behavior', 'layout', 'persistence', 'viewpoints'] as const;

/**
 * Reads a specification from its parsed JSON (DISL 14.1, steps 2 and 4 as far as the shape of the
 * top level goes; the JSON Schema is checked where the specification is written, in etalii.adp).
 * It never throws: what is not a specification gives an empty one and a finding that says why, and
 * a section that is not an object is left out and reported.
 */
export function loadSpecification(json: unknown): Loaded<Specification> {
  const findings: Finding[] = [];
  const error = (message: string): void => void findings.push(finding('disl.specification', 'error', message));
  if (!isObject(json)) {
    error('This is not a DISL specification: its top level is not an object.');
    return { value: emptySpecification, findings };
  }

  // `dedl` is the version key of the format DISL came from, still read (DISL 18).
  const version = json.disl ?? json.dedl;
  const parts = typeof version === 'string' ? /^(\d+)\.(\d+)$/.exec(version) : null;
  if (!parts) error('The specification does not say which version of DISL it is written in.');
  else if (Number(parts[1]) > 0) {
    error(`The specification is written in DISL ${version}, and this add-on reads DISL 0.${minor}.`);
    return { value: emptySpecification, findings };
  } else if (Number(parts[2]) > minor) {
    findings.push(finding('disl.specification', 'warning', `The specification is written in DISL ${version}, which is newer than the DISL 0.${minor} this add-on reads.`));
  }

  const language = isObject(json.language) ? json.language : {};
  if (typeof language.id !== 'string' || typeof language.version !== 'string') error('The specification does not name its language: `language.id` and `language.version` are required.');
  if (!isObject(json.metamodel)) error('The specification has no metamodel.');

  const value: Record<string, unknown> = {
    ...json,
    disl: typeof version === 'string' ? version : '',
    language: { ...language, id: String(language.id ?? ''), version: String(language.version ?? '') },
    metamodel: isObject(json.metamodel) ? json.metamodel : {},
  };
  for (const section of sections) {
    if (json[section] === undefined || isObject(json[section])) continue;
    error(`The specification's \`${section}\` is not an object, so it is not read.`);
    delete value[section];
  }
  const specification = value as Specification;
  return { value: specification, findings: [...findings, ...unsupportedFeatures(specification)] };
}
