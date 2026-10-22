import type { JsonNode } from './jsonReader';

/** A loaded FBL document (FBL 2.1): its version and its bindings by name, in document order. */
export interface FblDocument {
  readonly version: string;
  readonly path?: string;
  readonly bindings: ReadonlyMap<string, FblBinding>;
}

export type Family = 'yaml' | 'json' | 'xml' | 'lines' | 'blocks';

/** One binding (FBL 3): how one format maps to a language's model. */
export interface FblBinding {
  readonly name: string;
  readonly title?: string;
  readonly claims: Claims;
  readonly body: BodySettings;
  /** Nothing for a declared reader; the plugin otherwise (FBL 11). */
  readonly plugin?: PluginReader;
  /** Nothing when the body may be written; the reason (possibly empty) when it is read-only. */
  readonly readOnly?: string;
  readonly text: TextDefaults;
  readonly header?: HeaderSettings;
  readonly comment?: string;
  readonly reportUnmatched: boolean;
  readonly blocks: readonly BlockRule[];
  readonly elements: readonly Rule[];
  readonly relations: readonly Rule[];
  readonly registration: RegistrationSettings;
  readonly template?: TemplateSettings;
}

export interface Claims {
  readonly extensions: readonly string[];
  readonly names: readonly string[];
  readonly shared: boolean;
  readonly registrationOnly: boolean;
  readonly marker?: Marker;
  readonly suggest: readonly string[];
  readonly origins: readonly string[];
  /** For each origin, in document order: whether a bare file opens as it, and what suggests it. */
  readonly readings: ReadonlyMap<string, ReadingClaim>;
}

export interface ReadingClaim {
  readonly bare: boolean;
  readonly suggest: readonly string[];
}

/** A marker (FBL 12.2): exactly one of a root key, a first-line prefix or a pattern. */
export interface Marker {
  readonly rootKey?: string;
  readonly rootValue?: JsonNode;
  readonly firstLine?: string;
  readonly pattern?: string;
  readonly lines: number;
}

export interface BodySettings {
  readonly isFolder: boolean;
  readonly family?: Family;
  readonly alsoRead: readonly Family[];
  readonly recogniseAll: readonly string[];
  readonly recogniseAny: readonly string[];
  readonly recogniseNone: readonly string[];
  readonly files: readonly FileRule[];
  readonly ignore: readonly string[];
  readonly settle: number;
}

export interface FileRule {
  readonly name?: string;
  readonly glob: string;
  readonly family?: Family;
  readonly readOnly: boolean;
}

export interface PluginReader {
  readonly plugin: string;
  readonly version?: string;
  /** What the binding hands the plugin's `read` (FBL 11.2), as the document has it. */
  readonly args?: JsonNode;
}

export interface TextDefaults {
  readonly newline: string;
  /** Spaces for each step, or 0 for a tab. */
  readonly indent: number;
  readonly sequenceFlush: boolean;
  readonly finalNewline: boolean;
  readonly quote: string;
}

export interface HeaderSettings {
  readonly key?: string;
  readonly value?: JsonNode;
  readonly line?: string;
  readonly required: boolean;
}

export interface BlockRule {
  readonly name: string;
  readonly line: string;
  readonly within?: readonly string[];
  readonly caseInsensitive: boolean;
  readonly view?: string;
}

/** An element rule or a relation rule (FBL 5.1, 5.4). */
export interface Rule {
  readonly name: string;
  readonly type: string;
  readonly isRelation: boolean;
  readonly at?: string;
  readonly line?: string;
  readonly within?: readonly string[];
  readonly opens: boolean;
  readonly caseInsensitive: boolean;
  readonly files: readonly string[];
  readonly when?: string;
  readonly id?: IdBinding;
  readonly parent?: ParentBinding;
  /** The attribute bindings in the order the binding writes them. */
  readonly attributes: readonly (readonly [string, AttributeBinding])[];
  readonly source?: AttributeBinding;
  readonly target?: AttributeBinding;
  readonly insert?: InsertSettings;
  readonly remove?: RemoveSettings;
  readonly snapshotUndo: boolean;
  readonly readOnly?: string;
}

export interface IdBinding {
  readonly from?: Slot;
  readonly sidecarKey?: string;
}

export interface ParentBinding {
  readonly rules: readonly string[];
  readonly slot?: string;
}

/**
 * A slot (FBL 5.2): exactly one place a value is read from and written to. Exactly one of the slot
 * kinds is set; `child`, `word` and `flag` qualify it.
 */
export interface Slot {
  readonly key?: string;
  /** xml: the name of an attribute of the element. */
  readonly attribute?: string;
  readonly text: boolean;
  readonly child?: string;
  readonly group?: string;
  readonly parent?: string;
  readonly capture?: string;
  readonly value?: string;
  readonly word?: string;
  readonly flag: boolean;
}

/** An attribute binding (FBL 5.2): a slot with the options that decide reading and writing. */
export interface AttributeBinding extends Slot {
  /** "remove", "keep" or "refuse"; nothing for the default. */
  readonly empty?: string;
  /** For a family's name: "insert" or "refuse". */
  readonly absent: ReadonlyMap<string, string>;
  readonly default?: JsonNode;
  /** Nothing for "shortest", else the number of decimals. */
  readonly decimals?: number;
  readonly keepTimePrecision: boolean;
  readonly style?: string;
  readonly reference?: ReferenceBinding;
  /** Wire value to model value, in document order. */
  readonly map?: readonly (readonly [string, string])[];
  readonly override?: Slot;
  readonly htmlParagraphs: boolean;
  readonly create?: CreateChild;
  readonly readOnly?: string;
  /**
   * yaml, json (FBL 0.5): what the slot reads from a scalar, its written text or its typed value.
   * Nothing for the default: text for a string attribute, typed for every other.
   */
  readonly read?: 'text' | 'typed';
  /** yaml, read as typed (FBL 0.5): a quoted scalar is first read by the core schema from its written text. */
  readonly convertQuoted?: boolean;
  /** What the attribute is when its value does not convert to the attribute's type (FBL 0.5). */
  readonly fallback?: Fallback;
}

/** The value read in place of one that does not convert, and whether `fbl.unconverted-value` is reported (FBL 5.2, 7.4). */
export interface Fallback {
  readonly value: JsonNode;
  readonly report: boolean;
}

export interface ReferenceBinding {
  readonly to: readonly string[];
  readonly by: string;
}

/**
 * How a missing child holding the value is written. xml: the element's text and its place. yaml,
 * json (FBL 0.4): `atEnd`, each missing level of the mapping `child` reaches created at the end of
 * the level above it.
 */
export interface CreateChild {
  readonly emit: string;
  readonly place: string;
  readonly before?: string;
  readonly atEnd?: boolean;
}

export interface InsertSettings {
  /** "after-last", "end", "start", "last-child", "next-sibling", "end-of-document" or "before". */
  readonly place: string;
  readonly placeBefore?: string;
  readonly container?: string;
  readonly create?: CreateContainer;
  readonly keys: readonly string[];
  readonly emit?: string;
  readonly skeleton?: string;
  readonly when?: string;
  /**
   * The keys and values every new entry is given as they are (FBL 0.8 6.2), in the constant's member
   * order: a string, a number, a boolean or null; undefined for a member that is none of them, which
   * loading refuses.
   */
  readonly constant?: readonly (readonly [string, string | number | boolean | null | undefined])[];
}

/** How a missing container is created: `at` is "end-of-document", "before", "after", "under" or (FBL 0.4) "end". */
export interface CreateContainer {
  readonly at: string;
  readonly argument?: string;
  readonly text?: string;
}

/**
 * What goes with a removed entry. `removeEmptyLevels` (FBL 0.4) implies `removeContainerWhenEmpty`,
 * and removes the levels above the container that it leaves empty too.
 */
export interface RemoveSettings {
  readonly cascade: readonly string[];
  readonly removeContainerWhenEmpty: boolean;
  readonly removeEmptyLevels?: boolean;
}

export interface RegistrationSettings {
  readonly headers: readonly string[];
  readonly createOnFirstPlacement: boolean;
  readonly resourceCapture?: string;
  readonly legacyLayout?: string;
  readonly legacyIdentities?: string;
}

export interface TemplateSettings {
  readonly text: string;
  readonly byOrigin: ReadonlyMap<string, string>;
}

/** Elements before relations, in binding order: the order rules are offered an entry (FBL 5.1). */
export const allRules = (binding: FblBinding): Rule[] => [...binding.elements, ...binding.relations];

export const findRule = (binding: FblBinding, name: string): Rule | undefined => allRules(binding).find((rule) => rule.name === name);

export const attributeOf = (rule: Rule, name: string): AttributeBinding | undefined => rule.attributes.find(([attribute]) => attribute === name)?.[1];

export const isComputed = (slot: Slot): boolean => slot.value !== undefined;

/** A placeholder of an `emit` text: an attribute's name, or `id`, in braces. */
const placeholderPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The order a new entry's keys or attributes are written in, as the names they are written under:
 * `insert.keys`, or, for a rule that writes its entry from `emit`, the order of the text's
 * placeholders. A key or attribute added to an existing entry takes its place in this order
 * (FBL 6.1). Empty for a rule that cannot insert.
 */
export function wireOrder(rule: Rule): readonly string[] {
  const insert = rule.insert;
  if (!insert) return [];
  if (insert.keys.length > 0) return insert.keys;
  if (insert.emit === undefined) return [];
  const order: string[] = [];
  for (const [, name] of insert.emit.matchAll(placeholderPattern)) {
    const slot = name === 'id' ? rule.id?.from : attributeOf(rule, name);
    const wire = slot?.key ?? slot?.attribute;
    if (wire !== undefined && !order.includes(wire)) order.push(wire);
  }
  return order;
}

/** A slot as a sentence names it. */
export function slotText(slot: Slot): string {
  if (slot.key !== undefined) return `key ${slot.key}`;
  if (slot.attribute !== undefined) return `attribute ${slot.attribute}`;
  if (slot.text) return 'text';
  if (slot.group !== undefined) return `group ${slot.group}`;
  if (slot.parent !== undefined) return `parent ${slot.parent}`;
  if (slot.capture !== undefined) return `capture ${slot.capture}`;
  return slot.value !== undefined ? 'value' : 'slot';
}

export const defaultText: TextDefaults = { newline: '\n', indent: 2, sequenceFlush: false, finalNewline: true, quote: 'double' };

/** Claims with every member a document may leave out. */
export const claimsOf = (claims: Partial<Claims> = {}): Claims => ({
  extensions: [], names: [], shared: false, registrationOnly: false, suggest: [], origins: [], readings: new Map(), ...claims,
});

/** A body's settings with every member a document may leave out. */
export const bodyOf = (body: Partial<BodySettings> = {}): BodySettings => ({
  isFolder: false, alsoRead: [], recogniseAll: [], recogniseAny: [], recogniseNone: [], files: [], ignore: [], settle: 400, ...body,
});

/** A binding with every member a document may leave out, for a caller that makes one without a document. */
export const bindingOf = (binding: Pick<FblBinding, 'name'> & Partial<FblBinding>): FblBinding => ({
  claims: claimsOf(),
  body: bodyOf(),
  text: defaultText,
  reportUnmatched: false,
  blocks: [],
  elements: [],
  relations: [],
  registration: { headers: [], createOnFirstPlacement: false },
  ...binding,
});
