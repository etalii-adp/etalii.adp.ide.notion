/**
 * One model change, as a DISL transaction makes it and as a conformance fixture's step names it
 * (FBL 6.4, 15.3). Planning turns it into one edit or a refusal.
 *
 * - `save`: saves without a change: no splice (FBL 15.3).
 * - `add`: adds an element or relation; a relation's ends are the attributes `source` and `target`, by id.
 * - `set`: sets attributes of one element or relation; an empty string, an empty list or null empties an attribute.
 * - `remove`: removes an element or relation, with what its rule cascades to.
 * - `place`: places an element on the canvas: an edit of the registration, not of the body (FBL 8.3).
 * - `identify`: stores the id of the element with a natural key in the registration's `identities` (FBL 8.6).
 *
 * An attribute's value is a string, a boolean, null, a list of these, or a number: a `bigint` for
 * an integer and a `number` for any other.
 */
export type ModelChange =
  | { readonly kind: 'save' }
  | { readonly kind: 'add'; readonly type: string; readonly id?: string; readonly attributes: Readonly<Record<string, unknown>>; readonly parent?: string }
  | { readonly kind: 'set'; readonly id: string; readonly attributes: Readonly<Record<string, unknown>> }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'place'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'identify'; readonly key: string; readonly id: string };
