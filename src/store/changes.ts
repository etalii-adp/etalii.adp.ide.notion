// From what the interpreter makes of one intent to what an open document takes (etalii.adp spec
// 012, FR-024): the changes of the behavior, in the metamodel's names and values, become changes
// in the binding's names and the FBL library's values. `document.edit` takes them together, so
// that one gesture is one edit and one step of undo.

import type { Change } from '../disl/behavior';
import type { Model, Value } from '../disl/model';
import { toBinding } from '../disl/persistence';
import { allRules } from '../fbl/documents/types';
import type { ModelChange } from '../fbl/planning/modelChange';
import type { OpenStore } from './document';

/** What of an open store the changes are read against; `storeOf(document)` is one. */
export type ChangeStore = Pick<OpenStore, 'binding' | 'metamodel' | 'persistence'> & Partial<Pick<OpenStore, 'rows'>>;

export interface Refused {
  readonly refused: string;
}

type Step = Extract<ModelChange, { kind: 'add' | 'set' | 'remove' }>;

const DIAGRAM = 'diagram';

const scalar = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value));
/** A value of a model change (FBL 6.4): a scalar or a list of scalars. A structure and a number that is none are not. */
const takes = (value: unknown): boolean => scalar(value) || (Array.isArray(value) && value.every(scalar));

/**
 * The changes of one intent as the steps the FBL library plans, in order: what `document.edit`
 * takes as one edit. An intent that changes nothing gives no step, and such an edit writes nothing.
 *
 * - The values a change gives one entry are one step: a `set` after an `add` or a `set` of the same entry joins it.
 * - A removal the binding's own cascade makes is left out, so that nothing is removed twice.
 * - A `set` on the diagram (id `''`) is a `set` of the entry the binding reads as the diagram, or an `add` of it when the store has none.
 */
export function modelChangesOf(changes: readonly Change[], store: ChangeStore, model: Model): readonly ModelChange[] | Refused {
  const { binding, metamodel, persistence } = store;
  const rules = allRules(binding);
  const typeOf = (id: string): string | undefined => [...model.elements, ...model.relations].find((element) => element.id === id)?.type;
  const endsOf = (id: string): readonly (string | undefined)[] => {
    const relation = model.relations.find((candidate) => candidate.id === id);
    return relation ? [relation.source, relation.target] : [];
  };
  /** The rules of the binding that read a type of the metamodel. */
  const rulesOf = (type: string | undefined) => {
    const stored = type === undefined ? undefined : toBinding(binding, metamodel, persistence, type, {})?.type;
    return rules.filter((rule) => rule.type === stored);
  };

  function stored(type: string, id: string, attributes: Readonly<Record<string, Value | null | undefined>>): { type: string; attributes: Readonly<Record<string, unknown>> } | Refused {
    const named = type === DIAGRAM ? 'the diagram' : `\`${id}\``;
    const found = toBinding(binding, metamodel, persistence, type, attributes as Readonly<Record<string, Value | undefined>>);
    if (!found) return { refused: `The store holds nothing of the kind of ${named}, so the change cannot be stored.` };
    const reading = rules.filter((rule) => rule.type === found.type);
    // A relation's ends are attributes of a model change, whether or not the binding reads them as attributes.
    const known = new Set([...reading.flatMap((rule) => rule.attributes.map(([name]) => name)), ...(reading.some((rule) => rule.isRelation) ? ['source', 'target'] : [])]);
    for (const [name, value] of Object.entries(found.attributes)) {
      if (!known.has(name)) return { refused: `The store has no place for \`${name}\` of ${named}, so the change cannot be stored.` };
      if (!takes(value)) return { refused: `The store cannot hold the value given for \`${name}\` of ${named}.` };
    }
    return found;
  }

  // What the removal of `id` takes by the binding's own cascade: the entries of the rules it names that refer to it.
  const removed = new Set(changes.filter((change) => change.kind === 'remove').map((change) => change.id));
  function cascaded(id: string): boolean {
    const mine = rulesOf(typeOf(id)).map((rule) => rule.name);
    return endsOf(id).some((end) => {
      if (end === undefined || !removed.has(end)) return false;
      const taking = rulesOf(typeOf(end)).filter((rule) => rule.remove);
      return taking.length > 0 && taking.every((rule) => mine.some((name) => rule.remove!.cascade.includes(name)));
    });
  }

  const steps: Step[] = [];
  const merge = (id: string, attributes: Readonly<Record<string, unknown>>): boolean => {
    const index = steps.map((step) => step.id).lastIndexOf(id);
    const last = steps[index];
    if (!last || last.kind === 'remove') return false;
    steps[index] = { ...last, attributes: { ...last.attributes, ...attributes } };
    return true;
  };

  for (const change of changes) {
    if (change.kind === 'remove') {
      if (!cascaded(change.id)) steps.push({ kind: 'remove', id: change.id });
    } else if (change.kind === 'add') {
      const ends = { ...(change.source === undefined ? {} : { source: change.source }), ...(change.target === undefined ? {} : { target: change.target }) };
      const found = stored(change.type, change.id, { ...change.attributes, ...ends });
      if ('refused' in found) return found;
      steps.push({ kind: 'add', type: found.type, id: change.id, attributes: found.attributes, ...(change.parent === undefined ? {} : { parent: change.parent }) });
    } else if (change.id === '') {
      const found = stored(DIAGRAM, '', change.attributes);
      if ('refused' in found) return found;
      const entry = store.rows?.reading.elements.find((element) => element.rule.type === found.type);
      if (!merge(entry?.id ?? '', found.attributes)) steps.push(entry ? { kind: 'set', id: entry.id, attributes: found.attributes } : { kind: 'add', type: found.type, id: '', attributes: found.attributes });
    } else {
      const added = changes.find((other) => other.kind === 'add' && other.id === change.id);
      const type = added?.kind === 'add' ? added.type : typeOf(change.id);
      if (type === undefined) return { refused: `\`${change.id}\` is not in the document, so it cannot be changed.` };
      const found = stored(type, change.id, change.attributes);
      if ('refused' in found) return found;
      if (!merge(change.id, found.attributes)) steps.push({ kind: 'set', id: change.id, attributes: found.attributes });
    }
  }
  // The diagram's entry was added under no id: the binding gives it none.
  return steps.map((step) => (step.kind === 'add' && step.id === '' ? { kind: 'add', type: step.type, attributes: step.attributes } : step));
}
