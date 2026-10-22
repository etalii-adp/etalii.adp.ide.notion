/** Where an added or moved element goes among its siblings (FBL 11.2, `$defs/ChangePosition`). */
export type ChangePosition = { readonly index: number } | { readonly after: string } | { readonly before: string };

/**
 * One model change, as a DISL transaction makes it, as a persistence plugin's `plan` receives it
 * and as a conformance fixture's step names it (FBL 6.4, 11.2, 15.3). Planning turns it into one
 * edit or a refusal.
 *
 * - `save`: saves without a change: no splice (FBL 15.3).
 * - `add`: adds an element or relation; a relation's ends are the attributes `source` and `target`, by id.
 *   `parent` is the element it goes in, the top level without one. `position` is where among that
 *   parent's children it goes, last without one; only a body whose children are ordered can honour
 *   it. `slot` is the containment slot of the parent it fills, when its type can be written in
 *   several; without it, the first rule of the type that can insert is chosen.
 * - `move`: moves an element, with everything it contains, under `parent` (the top level without
 *   one) to `position`, after the last child without one. An index is counted among the new
 *   parent's children in the slot after the element was taken out of its old place (FBL 11.2), so
 *   the same index means the same for a move within one parent and across parents: moving the
 *   second of three children to index 0 makes it the first, to index 2 the last.
 * - `retype`: changes an element's type, with the attributes the new type is given (DISL 9.5).
 * - `set`: sets attributes of one element or relation; an empty string, an empty list or null empties an attribute.
 * - `remove`: removes an element or relation, with what its rule cascades to.
 * - `place`: places an element on the canvas: an edit of the registration, not of the body (FBL 8.3).
 * - `identify`: stores the id of the element with a natural key in the registration's `identities` (FBL 8.6).
 * - `storeId`: writes an id into an entry of the body that keeps its id in the body and has none
 *   yet: the entry is from then on found by `newId`, and can be named by it.
 *
 * An attribute's value is a string, a boolean, null, a list of these, or a number: a `bigint` for
 * an integer and a `number` for any other.
 */
export type ModelChange =
  | { readonly kind: 'save' }
  | { readonly kind: 'add'; readonly type: string; readonly id?: string; readonly attributes: Readonly<Record<string, unknown>>; readonly parent?: string; readonly position?: ChangePosition; readonly slot?: string }
  | { readonly kind: 'move'; readonly id: string; readonly parent?: string; readonly position?: ChangePosition }
  | { readonly kind: 'retype'; readonly id: string; readonly type: string; readonly attributes: Readonly<Record<string, unknown>> }
  | { readonly kind: 'set'; readonly id: string; readonly attributes: Readonly<Record<string, unknown>> }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'place'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'identify'; readonly key: string; readonly id: string }
  | { readonly kind: 'storeId'; readonly id: string; readonly newId: string };
