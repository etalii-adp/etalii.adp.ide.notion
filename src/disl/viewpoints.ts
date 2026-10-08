// The viewpoints of a specification (DISL 3.5): each with its coordinate system, its layout and
// the notation it draws with, which is its own overrides merged over the specification's. A
// variant is another presentation of its base viewpoint, offered as a toggle on its views.

import type { Coordinates } from './coordinates';
import { readLayoutConfig, type Layout, type LayoutConfig } from './layout';
import type { Metamodel } from './metamodel';
import { finding, type Finding, type Loaded } from './model';
import { merged, readNotation, type Notation, type Position } from './notation';
import { isObject, labelOf, type Expression, type Message, type Section, type Specification } from './specification';

export interface Toggle {
  readonly label: Message;
  readonly icon?: unknown;
  readonly position?: Position;
}

export interface Viewpoint {
  readonly name: string;
  readonly label: Message;
  /** The viewpoint this one is another presentation of. */
  readonly variantOf?: string;
  /** The variants of this viewpoint, each offered as its `toggle`. */
  readonly variants: readonly string[];
  readonly toggle?: Toggle;
  readonly coordinateSystem: string;
  /** The layout that places what the notation leaves to it. */
  readonly layout?: LayoutConfig;
  /** The types shown and hidden; without `include`, every type is shown. */
  readonly include?: readonly string[];
  readonly exclude: readonly string[];
  readonly members?: Expression;
  /** The toolbox groups offered; every group when it names none. */
  readonly toolbox?: readonly string[];
  /** The notation with this viewpoint's overrides, and those of the viewpoint it varies under them. */
  readonly notation: Notation;
}

export interface Viewpoints {
  readonly all: Readonly<Record<string, Viewpoint>>;
  /** The viewpoint a view opens in, which is never a variant. */
  readonly default: string;
}

export interface ViewpointParts {
  readonly notation: Notation;
  readonly coordinates: Coordinates;
  readonly layout: Layout;
}

const strings = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);

// A viewpoint's `nodes`, `edges` and `styles` over the notation under it. A style is merged key by
// key; of a node or an edge, each property the viewpoint gives replaces the one under it, so that
// a placement is the viewpoint's own and not a mix of two.
function over(under: Section, own: unknown): Section {
  if (!isObject(own)) return under;
  const result: Record<string, unknown> = { ...under };
  for (const key of ['nodes', 'edges', 'styles']) {
    if (!isObject(own[key])) continue;
    const map: Record<string, unknown> = { ...(isObject(under[key]) ? under[key] : {}) };
    for (const [name, value] of Object.entries(own[key])) {
      const below = map[name];
      map[name] = key === 'styles' || !isObject(below) || !isObject(value) ? merged(below, value) : { ...below, ...value, ...(below.style !== undefined && isObject(value.style) && isObject(below.style) ? { style: merged(below.style, value.style) } : {}) };
    }
    result[key] = map;
  }
  return result;
}

/** Interprets `viewpoints`. With none, the one viewpoint `main` shows everything (DISL 3.5). */
export function interpretViewpoints(specification: Specification, metamodel: Metamodel, parts: ViewpointParts): Loaded<Viewpoints> {
  const findings: Finding[] = [];
  const report = (message: string): void => void findings.push(finding('disl.viewpoints', 'warning', message));
  const declared = specification.viewpoints ?? {};
  const names = Object.keys(declared).filter((name) => isObject(declared[name]));
  if (names.length === 0) {
    const main: Viewpoint = { name: 'main', label: 'Main', variants: [], coordinateSystem: parts.coordinates.default, exclude: [], notation: parts.notation };
    return { value: { all: { main }, default: 'main' }, findings };
  }

  const bases: Record<string, string | undefined> = {};
  for (const name of names) {
    const of = declared[name].variantOf;
    if (typeof of !== 'string') continue;
    if (!names.includes(of) || of === name) report(`The viewpoint \`${name}\` is a variant of \`${of}\`, which is no other viewpoint, so it is read as a viewpoint of its own.`);
    else if (typeof declared[of].variantOf === 'string') report(`The viewpoint \`${name}\` is a variant of the variant \`${of}\`, so it is read as a viewpoint of its own.`);
    else bases[name] = of;
  }

  const all: Record<string, Viewpoint> = {};
  for (const name of names) {
    const own = declared[name];
    const under = bases[name];
    // What a variant does not say is what the viewpoint it varies says.
    const from = <T>(key: string, read: (value: unknown) => T | undefined): T | undefined => read(own[key]) ?? (under === undefined ? undefined : read(declared[under][key]));
    const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

    let system = from('coordinateSystem', text) ?? parts.coordinates.default;
    if (!Object.hasOwn(parts.coordinates.systems, system)) {
      report(`The viewpoint \`${name}\` names the coordinate system \`${system}\`, which is not declared; \`${parts.coordinates.default}\` is used.`);
      system = parts.coordinates.default;
    }

    const wanted = own.layout ?? (under === undefined ? undefined : declared[under].layout);
    let layout: LayoutConfig | undefined;
    if (typeof wanted === 'string') {
      layout = parts.layout.algorithms[wanted];
      if (!layout) report(`The viewpoint \`${name}\` names the layout \`${wanted}\`, which is not declared.`);
    } else if (isObject(wanted)) {
      layout = readLayoutConfig(name, wanted, report);
    }

    const section = over(under === undefined ? parts.notation.declared : over(parts.notation.declared, declared[under].notation), own.notation);
    const notation = section === parts.notation.declared ? parts.notation : readNotation(section, metamodel).value;

    const toggle = isObject(own.toggle) ? own.toggle : undefined;
    const label = (own.label as Message | undefined) ?? labelOf(name);
    all[name] = {
      name, label,
      variantOf: under,
      variants: names.filter((other) => bases[other] === name),
      toggle: under === undefined ? undefined : { label: (toggle?.label as Message | undefined) ?? label, icon: toggle?.icon, position: toggle?.position as Position | undefined },
      coordinateSystem: system,
      layout,
      include: from('include', strings),
      exclude: from('exclude', strings) ?? [],
      members: from('members', (value) => (typeof value === 'string' || isObject(value) ? (value as Expression) : undefined)),
      toolbox: from('toolbox', strings),
      notation,
    };
  }

  const roots = names.filter((name) => all[name].variantOf === undefined);
  const marked = roots.filter((name) => declared[name].default === true);
  if (marked.length > 1) report(`More than one viewpoint is the default; \`${marked[0]}\` is used.`);
  return { value: { all, default: marked[0] ?? roots[0] ?? names[0] }, findings };
}
