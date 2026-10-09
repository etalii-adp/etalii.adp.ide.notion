// Which properties of a store hold internal information (etalii.adp spec 012, FR-036): what is
// needed to draw or to keep the diagram and tells nothing of its domain. They are found from the
// specification's notation and forms, so that this module names none.
//
// An attribute is internal when the notation binds it as a size, through a handle of a shape, as
// the anchoring of an end of an edge, or as a placement on an axis. One placement is not: a place
// on a time axis that a form of the specification offers the person as a field is a date of the
// domain, and is shown.

import { interpretCoordinates, type Coordinates } from '../disl/coordinates';
import type { FormDeclaration, FormItemDeclaration } from '../disl/forms';
import { attributesOf, isRelation, type Metamodel } from '../disl/metamodel';
import { edgeNotation, interpretNotation, nodeNotation, type Notation } from '../disl/notation';
import type { InterpretedPersistence } from '../disl/persistence';
import { isObject, type Specification } from '../disl/specification';
import { ORDER, type StoreSchema } from './schema';

const bound = (source: unknown): string | undefined => (isObject(source) && typeof source.attribute === 'string' ? source.attribute : undefined);

/**
 * The attributes of a type that a declared form offers the person as a field: an item of a form
 * for the type, or for a type it descends from, that edits the attribute. An item that computes
 * what it shows, or that is declared read-only, offers nothing, and neither does an attribute the
 * metamodel declares read-only, derived or fixed.
 */
function offeredAttributes(type: string, metamodel: Metamodel, specification: Specification): Set<string> {
  const lineage = metamodel.types[type]?.lineage ?? [type];
  const declared = attributesOf(metamodel, type);
  const offered = new Set<string>();
  const walk = (items: readonly FormItemDeclaration[] | undefined): void => {
    for (const item of items ?? []) {
      const name = item.attribute;
      const attribute = name !== undefined && Object.hasOwn(declared, name) ? (declared[name] as { readonly readOnly?: unknown; readonly derived?: unknown; readonly fixed?: unknown }) : undefined;
      const edits = (item.kind === undefined || item.kind === 'field') && item.readOnly !== true;
      if (name !== undefined && attribute && edits && attribute.readOnly !== true && attribute.derived === undefined && !('fixed' in attribute)) offered.add(name);
      walk(item.items);
      for (const tab of item.tabs ?? []) walk(tab.items);
    }
  };
  for (const form of Object.values((specification.forms ?? {}) as unknown as Readonly<Record<string, FormDeclaration>>)) {
    if ([form.for ?? []].flat().some((name) => lineage.includes(name))) walk(form.items);
  }
  return offered;
}

/** The attributes of a type of the metamodel that the notation binds as said above. */
function internalAttributes(type: string, metamodel: Metamodel, notation: Notation, coordinates: Coordinates, specification: Specification): Set<string> {
  const found = new Set<string>();
  const add = (...sources: unknown[]): void => sources.forEach((source) => {
    const attribute = bound(source);
    if (attribute !== undefined) found.add(attribute);
  });

  if (isRelation(metamodel.types[type])) {
    const edge = edgeNotation(notation, metamodel, type);
    for (const { anchoring } of [edge, ...edge.variants]) {
      for (const end of [anchoring?.source, anchoring?.target]) add(end?.part, end?.side, end?.at);
    }
    return found;
  }

  const node = nodeNotation(notation, metamodel, type);
  const { placement } = node;
  const system = coordinates.systems[placement.system ?? coordinates.default];
  const offered = offeredAttributes(type, metamodel, specification);
  const placed = (kind: string | undefined, ...sources: unknown[]): void => add(...sources.filter((source) => kind !== 'time' || !offered.has(bound(source) ?? '')));
  placed(system?.x.kind, placement.x, placement.x2);
  placed(system?.y.kind, placement.y, placement.y2);
  add(placement.width, placement.height);
  for (const { size, shape } of [node, ...node.variants]) {
    add(size?.width, size?.height);
    const drawn: unknown = shape;
    const name = typeof drawn === 'string' ? drawn : isObject(drawn) && typeof drawn.type === 'string' ? drawn.type : undefined;
    const params = isObject(drawn) && isObject(drawn.params) ? drawn.params : {};
    const declared = name !== undefined && Object.hasOwn(notation.shapes, name) ? notation.shapes[name] : undefined;
    for (const handle of declared?.handles ?? []) {
      // A handle changes the attribute its parameter is bound to, or the ones its `write` sets.
      add(params[handle.param]);
      for (const step of handle.write ?? []) {
        if (isObject(step) && isObject(step.set)) Object.keys(step.set).forEach((attribute) => found.add(attribute));
      }
    }
  }
  return found;
}

/**
 * The names of the properties of a store that are internal, in the schema's order: the store's own
 * order of the rows, and each property whose attribute is internal for every kind that holds it.
 */
export function internalProperties(specification: Specification, metamodel: Metamodel, persistence: InterpretedPersistence, schema: StoreSchema): string[] {
  const coordinates = interpretCoordinates(specification, metamodel).value;
  const notation = interpretNotation(specification, metamodel).value;
  const verdicts = new Map<string, boolean>();
  for (const kind of schema.kinds) {
    const entry = Object.hasOwn(persistence.typeMap, kind.rule.type) ? persistence.typeMap[kind.rule.type] : { as: kind.rule.type };
    const internal = internalAttributes(entry.as, metamodel, notation, coordinates, specification);
    for (const value of kind.values) {
      const mapped = entry.attributes && Object.hasOwn(entry.attributes, value.attribute) ? entry.attributes[value.attribute] : value.attribute;
      verdicts.set(value.property, (verdicts.get(value.property) ?? true) && mapped !== null && internal.has(mapped));
    }
  }
  return schema.properties.filter((property) => property.name === ORDER || verdicts.get(property.name) === true).map((property) => property.name);
}
