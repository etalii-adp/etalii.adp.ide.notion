import type { Finding as FblFinding } from '../fbl/finding';

/**
 * A value of the model: plain data. An integer and a `yearMonth` (its month index, DISL 4.2) are
 * numbers, an enum value is its key, and a reference is the id it names.
 */
export type Value = string | number | boolean | null | readonly Value[] | { readonly [name: string]: Value };

/** Values by name. An attribute that is not stored has no entry: a default is not filled in. */
export type Attributes = Readonly<Record<string, Value>>;

/** A node of an open document, as the specification's metamodel types it. */
export interface ModelElement {
  readonly id: string;
  /** The name of a type of the metamodel. */
  readonly type: string;
  /** The stored attributes, by the metamodel's names. */
  readonly attributes: Attributes;
  /** What the binding reads and writes beside the model (`hostAttributes`, DISL 11.2), as the FBL library gives it. */
  readonly host: Readonly<Record<string, unknown>>;
  /** The id of the node this one is nested in. */
  readonly parent?: string;
  /** The id is not kept in the document, so nothing may be stored by it (DISL 11.5.3). */
  readonly ephemeral: boolean;
  /** The line of the document the element starts at. */
  readonly line: number;
}

/** A relation: an element with two ends, each the id of an element, or absent when it names nothing. */
export interface ModelRelation extends ModelElement {
  readonly source?: string;
  readonly target?: string;
}

/** The elements and relations of an open document, in reading order, and the diagram's own attributes. */
export interface Model {
  readonly diagram: Attributes;
  readonly elements: readonly ModelElement[];
  readonly relations: readonly ModelRelation[];
}

export const emptyModel: Model = { diagram: {}, elements: [], relations: [] };

/**
 * The FBL library's finding (code, severity, message, location), with the id of the element it
 * concerns and the detail a built-in constraint's message reads (DISL 8.7) where there is one.
 */
export interface Finding extends FblFinding {
  readonly element?: string;
  readonly detail?: Attributes;
}

/** What a part of the interpreter gives: a value that is always there, and what was found on the way. */
export interface Loaded<T> {
  readonly value: T;
  readonly findings: readonly Finding[];
}

/** A finding about the specification or the document as a whole, which has no line to point at. */
export const finding = (code: string, severity: Finding['severity'], message: string, more: Partial<Finding> = {}): Finding => ({
  code, severity, message, location: { file: '', line: 0, column: 0, length: 0 }, ...more,
});
