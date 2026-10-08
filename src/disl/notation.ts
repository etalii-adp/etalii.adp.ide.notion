// The notation of a specification (DISL 6): the text metric, the theme and its tokens, styles with
// their `extends` worked out, custom shapes, and how each node type and relation type is drawn.
// The types mirror the schema's `$defs`; what an element's values turn them into is the scene's.

import type { Placement, Snapping } from './coordinates';
import { isRelation, type Metamodel } from './metamodel';
import { finding, type Finding, type Loaded, type Value } from './model';
import { isObject, type Bindable, type CelValue, type Doc, type Expression, type LocalizedText, type Message, type Section, type Specification, type TextMetric } from './specification';

// ---- as the schema has them ----

/** `$defs/Paint` as far as it is read: a colour, or where one comes from. */
export type Paint = Bindable<string>;

export interface Stroke {
  readonly color?: Paint;
  readonly width?: Bindable<number>;
  readonly dash?: unknown;
  readonly [name: string]: unknown;
}

export interface Font {
  readonly family?: Bindable<string>;
  readonly size?: Bindable<number>;
  readonly color?: Paint;
  readonly weight?: number | string;
  readonly lineHeight?: number;
  readonly [name: string]: unknown;
}

/** `$defs/Style` (DISL 6.6). */
export interface Style {
  readonly extends?: string | readonly string[];
  readonly fill?: Paint;
  readonly fillOpacity?: number;
  readonly stroke?: Stroke;
  readonly opacity?: number;
  readonly cornerRadius?: number | readonly number[];
  readonly font?: Font;
  readonly textAlign?: string;
  readonly verticalAlign?: string;
  readonly padding?: number | readonly number[];
  readonly visible?: Bindable<boolean>;
  readonly [name: string]: unknown;
}

export type StyleRef = string | Style;

/** A number of canvas units, a percentage of the dimension it is along, or CEL (DISL 2.5c). */
export type GeomExpr = number | string;

/** One step of a path as it is declared (DISL 6.8). */
export interface PathSegment {
  readonly op: 'M' | 'L' | 'H' | 'V' | 'Q' | 'C' | 'A' | 'R' | 'E' | 'Z';
  readonly x?: GeomExpr;
  readonly y?: GeomExpr;
  readonly cx?: GeomExpr;
  readonly cy?: GeomExpr;
  readonly c1x?: GeomExpr;
  readonly c1y?: GeomExpr;
  readonly c2x?: GeomExpr;
  readonly c2y?: GeomExpr;
  readonly when?: Expression;
  readonly [name: string]: unknown;
}

export interface PathDef {
  readonly viewBox?: readonly [number, number, number, number];
  readonly d?: string;
  readonly segments?: readonly PathSegment[];
  readonly fillRule?: 'nonzero' | 'evenodd';
}

/** `$defs/ShapeRef` (DISL 6.7): a name, a shape with its parameters, or a shape written in place. */
export type ShapeRef = string | { readonly type: string; readonly params?: Readonly<Record<string, Bindable<Value>>> } | { readonly path: PathDef };

export interface ShapeParam {
  readonly type: 'number' | 'int' | 'bool' | 'enum' | 'color' | 'string';
  readonly default?: Value | CelValue;
  readonly min?: GeomExpr;
  readonly max?: GeomExpr;
  readonly values?: readonly string[];
  readonly unit?: 'length' | 'fraction' | 'angle' | 'count';
  readonly persist?: 'view' | 'none';
  readonly label?: LocalizedText;
  readonly doc?: Doc;
}

export interface GeomBox {
  readonly x?: GeomExpr;
  readonly y?: GeomExpr;
  readonly w?: GeomExpr;
  readonly h?: GeomExpr;
}

/** `$defs/ShapePart` (DISL 6.8). */
export interface ShapePart {
  readonly id?: string;
  readonly shape?: ShapeRef;
  readonly box?: GeomBox;
  readonly style?: StyleRef;
  readonly rotate?: GeomExpr;
  readonly when?: Expression;
  readonly outline?: boolean;
  readonly hit?: boolean;
  readonly tooltip?: Message;
}

/** `$defs/Handle` (DISL 6.8): a point on a shape that edits one of its parameters. */
export interface Handle {
  readonly param: string;
  readonly x?: GeomExpr;
  readonly y?: GeomExpr;
  readonly axis?: 'x' | 'y' | 'both' | 'radial';
  readonly value?: Expression;
  readonly snap?: unknown;
  readonly visible?: Expression;
  readonly write?: readonly unknown[];
  readonly refusals?: { readonly move?: unknown };
  readonly label?: Message;
  readonly [name: string]: unknown;
}

/** A shape a specification declares (DISL 6.8). */
export interface CustomShape {
  readonly name: string;
  readonly label?: LocalizedText;
  readonly params: Readonly<Record<string, ShapeParam>>;
  readonly path?: PathDef;
  readonly parts?: readonly ShapePart[];
  /** What an edge attaches to and a pointer hits; without one, the path, or the bounds of a composite. */
  readonly outline?: 'path' | 'bounds' | 'ellipse' | PathDef;
  readonly textArea?: GeomBox;
  readonly handles: readonly Handle[];
  readonly defaultSize?: readonly [number | null, number | null];
}

export type Size = readonly [number | null, number | null];

/** `$defs/SizeSpec` (DISL 6.9). */
export interface SizeSpec {
  readonly default?: Size;
  readonly min?: Size;
  readonly max?: Size;
  readonly fixed?: Size;
  readonly resizable?: boolean | 'horizontal' | 'vertical';
  readonly width?: Bindable<number>;
  readonly height?: Bindable<number>;
  readonly [name: string]: unknown;
}

/** `$defs/Position` (DISL 6.9). */
export type Position = string | { readonly anchor?: readonly [number, number]; readonly offset?: unknown; readonly align?: string };

/** `$defs/Label` (DISL 6.12). */
export interface Label {
  readonly id?: string;
  readonly text?: Bindable<string>;
  readonly editable?: false | 'inline' | 'multiline' | 'form';
  readonly parse?: { readonly cel?: string; readonly write?: readonly unknown[] };
  readonly editText?: Message | { readonly attribute: string };
  readonly position?: Position;
  readonly distance?: number;
  readonly style?: StyleRef;
  readonly maxWidth?: number | 'parent';
  readonly wrap?: 'none' | 'word' | 'char';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis' | 'shrink';
  readonly visible?: Bindable<boolean>;
  readonly [name: string]: unknown;
}

export interface AnchorPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export type BoxSide = 'top' | 'right' | 'bottom' | 'left';

/** `$defs/AnchorSpec` (DISL 6.9): where edges attach to a node. */
export interface AnchorSpec {
  readonly mode?: 'outline' | 'center' | 'fixed' | 'sides';
  readonly points?: readonly AnchorPoint[];
  readonly gap?: number;
  readonly spread?: boolean;
  readonly sides?: readonly BoxSide[];
  readonly drawnFrom?: 'point' | 'outline';
}

/** `$defs/EndAnchor` (DISL 6.10): how one end of an edge attaches, over the node's own anchors. */
export interface EndAnchor {
  readonly mode?: 'outline' | 'center' | 'port' | 'fixed' | 'sides' | 'part';
  readonly gap?: number;
  readonly points?: readonly AnchorPoint[];
  readonly sides?: readonly BoxSide[];
  readonly part?: Bindable<string>;
  readonly side?: Bindable<string>;
  readonly at?: Bindable<number>;
  readonly movable?: boolean;
  readonly default?: { readonly part?: Bindable<string>; readonly side?: Bindable<string>; readonly at?: Bindable<number> };
}

/** `$defs/LineSpec` (DISL 6.10). */
export interface LineSpec {
  readonly stroke?: Stroke;
  readonly routing?: string | { readonly plugin: unknown };
  readonly startDirection?: 'auto' | 'up' | 'down' | 'left' | 'right' | 'normal';
  readonly endDirection?: 'auto' | 'up' | 'down' | 'left' | 'right' | 'normal';
  readonly bezier?: { readonly reach?: number | 'auto'; readonly backward?: 'direct' | 'loop'; readonly maxReach?: number };
  readonly bendpoints?: unknown;
  readonly [name: string]: unknown;
}

/** `$defs/Filter` (DISL 6.13.1), with its defaults filled in. */
export interface Filter {
  readonly id: string;
  readonly label: Message;
  readonly control: 'chips' | 'switch' | 'select' | 'search';
  /** The types the filter can hide; every node type when it names none. */
  readonly appliesTo?: readonly string[];
  readonly options?: CelValue;
  readonly default: Value | CelValue;
  readonly match: { readonly default: 'any' | 'all'; readonly userToggle: boolean };
  readonly keep: Expression;
  readonly effect: 'hide' | 'dim';
  readonly position?: Position;
}

export interface Legend {
  readonly visible: boolean;
  readonly position?: Position;
  readonly entries: readonly string[];
  readonly title?: Message;
  readonly from: 'declared' | 'drawn';
  readonly computed?: unknown;
}

// ---- interpreted ----

/** What a variant may replace of a node's notation: anything but its placement (DISL 6.9). */
export type NodeVariant = Partial<Omit<NodeNotation, 'placement' | 'variants'>> & { readonly when: Expression };

export interface NodeNotation {
  readonly shape: ShapeRef;
  /** The notation's own style, its `extends` worked out. */
  readonly style: Style;
  readonly partStyles: Readonly<Record<string, Style>>;
  readonly size: SizeSpec;
  readonly placement: Placement;
  readonly snapping?: Snapping;
  readonly labels: readonly Label[];
  readonly anchors: AnchorSpec;
  readonly variants: readonly NodeVariant[];
  readonly tooltip?: Message;
  readonly connectable: Bindable<boolean>;
  readonly selectable: Bindable<boolean>;
  readonly deletable: Bindable<boolean>;
}

export type EdgeVariant = Partial<Omit<EdgeNotation, 'variants'>> & { readonly when: Expression };

export interface EdgeNotation {
  readonly line: LineSpec;
  readonly style: Style;
  readonly sourceMarker: Bindable<string>;
  readonly targetMarker: Bindable<string>;
  readonly anchoring: { readonly source?: EndAnchor; readonly target?: EndAnchor };
  readonly labels: readonly Label[];
  readonly variants: readonly EdgeVariant[];
  readonly tooltip?: Message;
  readonly selectable: Bindable<boolean>;
  readonly deletable: Bindable<boolean>;
  readonly reconnectable: Bindable<boolean>;
}

export interface Theme {
  /** The base value of every token, and what each mode puts over it (DISL 6.2). */
  readonly tokens: Readonly<Record<string, Value>>;
  readonly modes: Readonly<Record<string, Readonly<Record<string, Value>>>>;
  readonly defaultMode?: string;
  readonly followSystem: boolean;
}

export interface Notation {
  readonly textMetric: TextMetric;
  readonly theme: Theme;
  /** Every declared style with its `extends` worked out. */
  readonly styles: Readonly<Record<string, Style>>;
  readonly shapes: Readonly<Record<string, CustomShape>>;
  /** By type name, for the types that declare a notation; `nodeNotation` and `edgeNotation` answer for every type. */
  readonly nodes: Readonly<Record<string, NodeNotation>>;
  readonly edges: Readonly<Record<string, EdgeNotation>>;
  readonly canvas: { readonly filters: Readonly<Record<string, Filter>>; readonly legend?: Legend; readonly declared: Section };
  /** The section as it is written, which a viewpoint's own notation is merged over (DISL 3.5). */
  readonly declared: Section;
}

/** The shapes of DISL 6.7 this add-on draws; another one is drawn as a `rect` and reported. */
export const builtInShapes: readonly string[] = ['rect', 'roundedRect', 'pill', 'ellipse', 'circle', 'text', 'none'];

/** The default size of a node that states none (DISL B.1). */
export const defaultSize: readonly [number, number] = [120, 60];
export const defaultFontSize = 14;

// ---- reading ----

/** One object over another, key by key; an array or a plain value replaces what is under it (DISL 6.1). */
export function merged<T>(under: T, over: unknown): T {
  if (!isObject(under) || !isObject(over)) return (over === undefined ? under : over) as T;
  const result: Record<string, unknown> = { ...under };
  for (const [key, value] of Object.entries(over)) result[key] = merged(result[key], value);
  return result as T;
}

/** Interprets `notation`. With none, every type is drawn by the defaults of DISL B.1. */
export function interpretNotation(specification: Specification, metamodel: Metamodel): Loaded<Notation> {
  return readNotation(specification.notation ?? {}, metamodel);
}

/** Interprets a notation section: the specification's own, or one a viewpoint's is merged over. */
export function readNotation(section: Section, metamodel: Metamodel): Loaded<Notation> {
  const findings: Finding[] = [];
  const report = (message: string): void => void findings.push(finding('disl.notation', 'warning', message));
  const map = (value: unknown): Record<string, unknown> => (isObject(value) ? value : {});

  const theme = map(section.theme);
  const declaredStyles = map(section.styles);

  // A style with the styles it extends under it, the leftmost first; a style that extends itself stops there.
  const style = (ref: unknown, seen: readonly string[] = []): Style => {
    if (typeof ref === 'string') {
      if (!isObject(declaredStyles[ref])) report(`The style \`${ref}\` is not declared, so nothing is taken from it.`);
      else if (seen.includes(ref)) report(`The style \`${ref}\` extends itself, so it is read without what it extends.`);
      else return style(declaredStyles[ref], [...seen, ref]);
      return {};
    }
    if (Array.isArray(ref)) return ref.reduce<Style>((under, item) => merged(under, style(item, seen)), {});
    if (!isObject(ref)) return {};
    const { extends: bases, ...own } = ref as Style;
    return merged(style(bases === undefined ? [] : [bases].flat(), seen), own);
  };
  const styles: Record<string, Style> = {};
  for (const name of Object.keys(declaredStyles)) styles[name] = style(name);

  const shapes: Record<string, CustomShape> = {};
  for (const [name, value] of Object.entries(map(section.shapes))) {
    const declared = map(value);
    if (declared.path === undefined && declared.parts === undefined) report(`The shape \`${name}\` is drawn from \`svg\` or a plugin, which this add-on does not draw; it is drawn as its bounds.`);
    shapes[name] = {
      name,
      label: declared.label as LocalizedText | undefined,
      params: map(declared.params) as Record<string, ShapeParam>,
      path: isObject(declared.path) ? (declared.path as PathDef) : undefined,
      parts: Array.isArray(declared.parts) ? (declared.parts as ShapePart[]) : undefined,
      outline: declared.outline as CustomShape['outline'],
      textArea: isObject(declared.textArea) ? (declared.textArea as GeomBox) : undefined,
      handles: Array.isArray(declared.handles) ? (declared.handles as Handle[]) : [],
      defaultSize: Array.isArray(declared.defaultSize) ? (declared.defaultSize as unknown as Size) : undefined,
    };
  }
  const known = (ref: unknown, where: string): void => {
    const name = typeof ref === 'string' ? ref : isObject(ref) && typeof ref.type === 'string' ? ref.type : undefined;
    if (name !== undefined && !Object.hasOwn(shapes, name) && !builtInShapes.includes(name)) report(`${where} is drawn as the shape \`${name}\`, which this add-on does not draw; a rectangle is drawn.`);
  };
  for (const shape of Object.values(shapes)) for (const part of shape.parts ?? []) known(part.shape, `A part of the shape \`${shape.name}\``);

  // What both kinds of notation and their variants share: styles worked out, lists as lists.
  const common = (declared: Record<string, unknown>): Record<string, unknown> => ({
    ...declared,
    ...(declared.style === undefined ? {} : { style: style(declared.style) }),
    ...(isObject(declared.partStyles) ? { partStyles: Object.fromEntries(Object.entries(declared.partStyles).map(([part, ref]) => [part, style(ref)])) } : {}),
  });
  const variants = <T>(declared: unknown): T[] =>
    (Array.isArray(declared) ? declared : []).filter((variant) => isObject(variant) && (typeof variant.when === 'string' || isObject(variant.when))).map((variant) => common(variant as Record<string, unknown>) as T);

  const nodes: Record<string, NodeNotation> = {};
  for (const [type, value] of Object.entries(map(section.nodes))) {
    const meta = metamodel.types[type];
    if (!meta || isRelation(meta)) report(`The notation draws nodes of the type \`${type}\`, which is no node type of the metamodel.`);
    const declared = common(map(value));
    known(declared.shape, `A node of the type \`${type}\``);
    nodes[type] = {
      ...defaultNode(meta?.labelAttribute),
      ...declared,
      variants: variants<NodeVariant>(declared.variants),
    } as NodeNotation;
  }

  const edges: Record<string, EdgeNotation> = {};
  for (const [type, value] of Object.entries(map(section.edges))) {
    const meta = metamodel.types[type];
    if (!isRelation(meta)) report(`The notation draws edges of the type \`${type}\`, which is no relation type of the metamodel.`);
    const declared = common(map(value));
    edges[type] = { ...defaultEdge(isRelation(meta) ? meta.directed : true), ...declared, variants: variants<EdgeVariant>(declared.variants) } as EdgeNotation;
  }

  const canvas = map(section.canvas);
  const filters: Record<string, Filter> = {};
  for (const [id, value] of Object.entries(map(canvas.filters))) {
    const declared = map(value);
    const control = declared.control as Filter['control'];
    if (typeof declared.keep !== 'string' && !isObject(declared.keep)) {
      report(`The filter \`${id}\` does not say what it keeps, so it hides nothing.`);
      continue;
    }
    filters[id] = {
      id,
      label: (declared.label as Message | undefined) ?? id,
      control,
      appliesTo: Array.isArray(declared.appliesTo) ? (declared.appliesTo as string[]) : undefined,
      options: isObject(declared.options) ? (declared.options as unknown as CelValue) : undefined,
      default: (declared.default as Value | undefined) ?? (control === 'switch' ? false : control === 'chips' ? [] : ''),
      match: { default: map(declared.match).default === 'all' ? 'all' : 'any', userToggle: map(declared.match).userToggle !== false },
      keep: declared.keep as Expression,
      effect: declared.effect === 'dim' ? 'dim' : 'hide',
      position: declared.position as Position | undefined,
    };
  }
  const legend = isObject(canvas.legend)
    ? {
      visible: canvas.legend.visible !== false,
      position: canvas.legend.position as Position | undefined,
      entries: Array.isArray(canvas.legend.entries) ? (canvas.legend.entries as string[]) : [],
      title: canvas.legend.title as Message | undefined,
      from: canvas.legend.from === 'drawn' ? 'drawn' as const : 'declared' as const,
      computed: canvas.legend.computed,
    }
    : undefined;

  return {
    value: {
      textMetric: (section.textMetric as TextMetric | undefined) ?? 'host',
      theme: {
        tokens: map(theme.tokens) as Record<string, Value>,
        modes: map(theme.modes) as Record<string, Record<string, Value>>,
        defaultMode: typeof theme.defaultMode === 'string' ? theme.defaultMode : undefined,
        followSystem: theme.followSystem === true,
      },
      styles, shapes, nodes, edges,
      canvas: { filters, legend, declared: canvas },
      declared: section,
    },
    findings,
  };
}

// ---- defaults (DISL B.1) ----

const defaultNode = (labelAttribute?: string): NodeNotation => ({
  shape: 'rect',
  style: {},
  partStyles: {},
  size: {},
  placement: {},
  labels: labelAttribute === undefined ? [] : [{ id: 'label', text: { attribute: labelAttribute }, position: 'center' }],
  anchors: {},
  variants: [],
  connectable: true,
  selectable: true,
  deletable: true,
});

const defaultEdge = (directed: boolean): EdgeNotation => ({
  line: {},
  style: {},
  sourceMarker: 'none',
  targetMarker: directed ? 'arrowFilled' : 'none',
  anchoring: {},
  labels: [],
  variants: [],
  selectable: true,
  deletable: true,
  reconnectable: true,
});

/** How nodes of a type are drawn: its own notation, that of its nearest supertype, or the default. */
export function nodeNotation(notation: Notation, metamodel: Metamodel, type: string): NodeNotation {
  const declaring = (metamodel.types[type]?.lineage ?? [type]).find((name) => Object.hasOwn(notation.nodes, name));
  return declaring === undefined ? defaultNode(metamodel.types[type]?.labelAttribute) : notation.nodes[declaring];
}

/** How relations of a type are drawn. */
export function edgeNotation(notation: Notation, metamodel: Metamodel, type: string): EdgeNotation {
  const meta = metamodel.types[type];
  const declaring = (meta?.lineage ?? [type]).find((name) => Object.hasOwn(notation.edges, name));
  return declaring === undefined ? defaultEdge(isRelation(meta) ? meta.directed : true) : notation.edges[declaring];
}

/** Styles laid over one another, the first undermost. A name is a declared style; one that is not declared gives nothing. */
export function styleOf(notation: Notation, ...refs: readonly (StyleRef | undefined)[]): Style {
  return refs.reduce<Style>((under, ref) => {
    if (ref === undefined) return under;
    if (typeof ref === 'string') return merged(under, notation.styles[ref] ?? {});
    const { extends: bases, ...own } = ref;
    return merged([bases ?? []].flat().reduce((below, name) => merged(below, notation.styles[name] ?? {}), under), own);
  }, {});
}

// ---- theme ----

/** Every token's value in a mode: the mode's own over the base (DISL 6.2). */
export const tokensOf = (theme: Theme, mode = 'light'): Readonly<Record<string, Value>> => ({ ...theme.tokens, ...theme.modes[mode] });

/** A paint as a colour in a mode: a token is looked up, a literal is itself. Nothing for a token the theme does not hold. */
export function colourOf(theme: Theme, paint: unknown, mode = 'light'): string | undefined {
  if (typeof paint === 'string') return paint;
  if (!isObject(paint) || typeof paint.token !== 'string') return undefined;
  const value = tokensOf(theme, mode)[paint.token];
  return typeof value === 'string' ? value : undefined;
}

// ---- text ----

/** The width of a text at a font size by the notation's metric; with the `host` metric, by the measure the host gives (DISL 6.5). */
export function textWidth(metric: TextMetric, text: string, fontSize: number, host?: (text: string, fontSize: number) => number): number {
  if (typeof metric !== 'object') return host ? host(text, fontSize) : text.length * fontSize * 0.5;
  const count = metric.count === 'codepoint' || metric.count === 'grapheme' ? [...text].length : text.length;
  return count * metric.advance * fontSize;
}

/** The height of one line of text at a font size. */
export const lineHeight = (metric: TextMetric, fontSize: number, font?: Font): number =>
  fontSize * (font?.lineHeight ?? (typeof metric === 'object' ? metric.lineHeight : undefined) ?? 1.3);
