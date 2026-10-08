// The toolbox of a specification (DISL 7.1 to 7.3): the groups with their tools, what each tool
// creates, and the sets of context tools and context menus. It is plain data: whether an entry is
// shown or available for a model is the behavior's to say, which evaluates the expressions kept here.

import { isRelation, type Metamodel } from './metamodel';
import { finding, type Finding, type Loaded, type Value } from './model';
import { isCel, isObject, labelOf, localized, type CelValue, type Doc, type Expression, type LocalizedText, type Message, type Reason, type Specification } from './specification';

// ---- as the schema has them ----

/** `$defs/DropSpec` (DISL 7.2). */
export interface DropSpec {
  readonly targets?: readonly (ContextToolDeclaration & { readonly on: readonly string[] })[];
  readonly elsewhere?: 'create' | 'ignore' | 'refuse' | 'menu';
  readonly refusal?: Reason;
  readonly place?: string;
  readonly doc?: Doc;
}

/** `$defs/CreateEnd` (DISL 7.2). */
export interface CreateEnd {
  readonly type: string;
  readonly initial?: Readonly<Record<string, unknown>>;
  readonly size?: readonly [number, number];
}

/** `$defs/Tool` (DISL 7.2). */
export interface ToolDeclaration {
  readonly id: string;
  readonly kind?: string;
  readonly label?: Message;
  readonly icon?: unknown;
  readonly creates?: string;
  readonly initial?: Readonly<Record<string, unknown>>;
  readonly size?: readonly [number, number];
  readonly variantOf?: string;
  readonly mode?: 'click' | 'drag' | 'stamp' | 'click-click' | 'chain' | 'auto' | 'drop';
  readonly sticky?: boolean;
  readonly shortcut?: string;
  readonly enabled?: Expression;
  readonly visible?: Expression;
  readonly unavailable?: readonly Reason[];
  readonly after?: 'select' | 'editLabel' | 'openForm' | 'none';
  readonly template?: string;
  readonly operation?: string;
  readonly drop?: DropSpec;
  readonly createSource?: string | CreateEnd;
  readonly createTarget?: string | CreateEnd;
  readonly doc?: Doc;
}

/** `$defs/ToolGroup` (DISL 7.1). An entry of `tools` is a tool, or the id of one in the library. */
export interface ToolGroupDeclaration {
  readonly id: string;
  readonly label?: LocalizedText;
  readonly icon?: unknown;
  readonly collapsed?: boolean;
  readonly visible?: Expression;
  readonly viewpoints?: readonly string[];
  readonly tools?: readonly (ToolDeclaration | string)[];
  readonly groups?: readonly ToolGroupDeclaration[];
  readonly doc?: Doc;
}

/** `$defs/ContextTool` (DISL 7.3). */
export interface ContextToolDeclaration {
  readonly kind: string;
  readonly creates?: string;
  readonly via?: string;
  readonly direction?: 'outgoing' | 'incoming';
  readonly slot?: string;
  readonly operation?: string;
  readonly label?: Message;
  readonly icon?: unknown;
  readonly shortcut?: string;
  readonly enabled?: Expression;
  readonly visible?: Expression;
  readonly unavailable?: readonly Reason[];
  readonly group?: string;
  readonly forEach?: Expression;
  readonly args?: Readonly<Record<string, Expression>>;
  readonly doc?: Doc;
  readonly [name: string]: unknown;
}

/** `$defs/ContextToolSet` (DISL 7.3). */
export interface ContextToolSet {
  readonly for?: readonly string[];
  readonly when?: Expression;
  readonly placement?: 'around' | 'toolbar' | 'menu' | 'radial';
  readonly tools: readonly ContextToolDeclaration[];
  readonly standardEntries?: boolean;
  readonly runSingle?: boolean;
  readonly doc?: Doc;
}

/** `$defs/Toolbox` (DISL 7.1). */
export interface ToolboxSection {
  readonly groups?: readonly ToolGroupDeclaration[];
  readonly tools?: Readonly<Record<string, ToolDeclaration>>;
  readonly layout?: string;
  readonly position?: string;
  readonly searchable?: boolean;
  readonly showRecent?: number;
  readonly contextTools?: readonly ContextToolSet[];
  readonly contextMenus?: readonly ContextToolSet[];
  readonly doc?: Doc;
}

// ---- interpreted ----

export interface Tool {
  readonly id: string;
  /** `create-node`, `create-edge`, `operation`, or another kind of DISL 7.2. */
  readonly kind: string;
  /** Its own label, else that of the type it creates, else one made from its id. */
  readonly label: Message;
  readonly icon?: string;
  /** The tooltip: the summary of its `doc`, else of the type it creates. */
  readonly doc?: string;
  /** The type it creates. */
  readonly creates?: string;
  /** The values a created element starts with, over the metamodel's defaults: a literal, or CEL in the `create` context. */
  readonly initial: Readonly<Record<string, Value | CelValue>>;
  readonly size?: readonly [number, number];
  readonly mode: NonNullable<ToolDeclaration['mode']>;
  readonly sticky: boolean;
  readonly after: NonNullable<ToolDeclaration['after']>;
  readonly shortcut?: string;
  /** For a tool of the kind `operation`. */
  readonly operation?: string;
  /** For a tool that draws a relation: its type and the types each end may have. */
  readonly relation?: { readonly type: string; readonly sources: readonly string[]; readonly targets: readonly string[] };
  readonly drop?: DropSpec;
  /**
   * Where the element goes when the tool is used without a pointer. DISL states no such place, so
   * it is always the centre of what the canvas shows.
   */
  readonly keyboardDrop: 'view-centre';
  readonly visible?: Expression;
  readonly enabled?: Expression;
  readonly unavailable: readonly Reason[];
}

export interface ToolGroup {
  readonly id: string;
  /** Absent for a group that shows no heading. */
  readonly label?: string;
  readonly icon?: string;
  readonly doc?: string;
  readonly collapsed: boolean;
  readonly visible?: Expression;
  /** The viewpoints the group is offered in; every viewpoint when absent. */
  readonly viewpoints?: readonly string[];
  readonly tools: readonly Tool[];
  readonly groups: readonly ToolGroup[];
}

/** One entry of a set of context tools: what it does, and the expressions that say when. */
export interface ContextEntry {
  /** `operation`, `delete`, `editLabel`, `connect`, `create-connected`, or another kind of DISL 7.3. */
  readonly kind: string;
  readonly label?: Message;
  readonly icon?: string;
  readonly shortcut?: string;
  /** Consecutive entries of one name are shown together, apart from the others (DISL 7.3). */
  readonly group?: string;
  readonly operation?: string;
  readonly creates?: string;
  readonly via?: string;
  readonly direction?: 'outgoing' | 'incoming';
  readonly visible?: Expression;
  readonly enabled?: Expression;
  readonly unavailable: readonly Reason[];
  readonly args: Readonly<Record<string, Expression>>;
}

export interface ContextSet {
  /** Types of the metamodel, `diagram` for the empty canvas and `connection` for a pending connection. */
  readonly for: readonly string[];
  readonly when?: Expression;
  readonly placement: NonNullable<ContextToolSet['placement']>;
  /** Whether the host adds its standard entries to the set. */
  readonly standardEntries: boolean;
  readonly runSingle: boolean;
  readonly entries: readonly ContextEntry[];
}

export interface Toolbox {
  readonly groups: readonly ToolGroup[];
  /** Every tool by its id: those of the groups, and those of the library no group shows. */
  readonly tools: Readonly<Record<string, Tool>>;
  readonly contextTools: readonly ContextSet[];
  readonly contextMenus: readonly ContextSet[];
  readonly searchable: boolean;
  readonly showRecent: number;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Interprets `toolbox`. With none, a group for every 10 concrete types, in the order of their names (DISL 7.1). */
export function interpretToolbox(specification: Specification, metamodel: Metamodel): Loaded<Toolbox> {
  const section = specification.toolbox as ToolboxSection | undefined;
  const findings: Finding[] = [];
  const report = (message: string): void => void findings.push(finding('disl.toolbox', 'warning', message));
  const locale = specification.language.defaultLocale ?? 'en';
  const summary = (doc: Doc | undefined): string | undefined => localized(isObject(doc) ? (doc.summary as LocalizedText | undefined) : doc, locale, locale);
  const tools: Record<string, Tool> = {};

  const tool = (declared: ToolDeclaration, shared = false): Tool => {
    const type = declared.creates === undefined ? undefined : metamodel.types[declared.creates];
    if (declared.creates !== undefined && !type) report(`The tool \`${declared.id}\` creates \`${declared.creates}\`, which is not a type of this specification.`);
    const relation = isRelation(type) ? type : undefined;
    const kind = declared.kind ?? (relation ? 'create-edge' : type ? 'create-node' : declared.operation === undefined ? '' : 'operation');
    if (kind === '') report(`The tool \`${declared.id}\` has no \`kind\` and creates nothing, so it does nothing.`);
    if (declared.drop?.targets?.length || declared.drop?.place !== undefined) report(`The tool \`${declared.id}\` chooses what a drop does by what lies under it, which this add-on does not support; it creates at the drop point.`);
    const initial: Record<string, Value | CelValue> = {};
    for (const [name, value] of Object.entries(declared.initial ?? {})) initial[name] = isCel(value) ? value : (value as Value);
    const made: Tool = {
      id: declared.id, kind,
      label: declared.label ?? type?.label ?? labelOf(declared.id),
      icon: text(declared.icon) ?? text(type?.declared.icon),
      doc: summary(declared.doc) ?? summary(type?.declared.doc),
      creates: type?.name,
      initial,
      size: declared.size,
      mode: declared.mode ?? 'drag',
      sticky: declared.sticky === true || declared.mode === 'stamp',
      after: declared.after ?? (type?.labelAttribute === undefined ? 'select' : 'editLabel'),
      shortcut: declared.shortcut,
      operation: declared.operation,
      relation: relation && { type: relation.name, sources: relation.source.types, targets: relation.target.types },
      drop: declared.drop,
      keyboardDrop: 'view-centre',
      visible: declared.visible,
      enabled: declared.enabled,
      unavailable: declared.unavailable ?? [],
    };
    if (Object.hasOwn(tools, made.id) && !shared) report(`More than one tool has the id \`${made.id}\`; the last one is used where a tool is named.`);
    tools[made.id] = made;
    return made;
  };

  const library = section?.tools ?? {};
  const group = (declared: ToolGroupDeclaration): ToolGroup => ({
    id: declared.id,
    label: localized(declared.label, locale, locale),
    icon: text(declared.icon),
    doc: summary(declared.doc),
    collapsed: declared.collapsed === true,
    visible: declared.visible,
    viewpoints: declared.viewpoints,
    tools: (declared.tools ?? []).flatMap((entry) => {
      if (typeof entry !== 'string') return [tool(entry)];
      if (!Object.hasOwn(library, entry)) report(`The group \`${declared.id}\` names the tool \`${entry}\`, which the toolbox does not declare.`);
      return Object.hasOwn(library, entry) ? [tool({ ...library[entry], id: entry }, true)] : [];
    }),
    groups: (declared.groups ?? []).map(group),
  });

  const generated = (): ToolGroupDeclaration[] => {
    const concrete = Object.values(metamodel.types).filter((type) => !type.abstract).map((type) => type.name).sort();
    const groups: ToolGroupDeclaration[] = [];
    for (let first = 0; first < concrete.length; first += 10) {
      groups.push({ id: `group${groups.length + 1}`, tools: concrete.slice(first, first + 10).map((name) => ({ id: name, creates: name })) });
    }
    return groups;
  };

  const groups = (section ? section.groups ?? [] : generated()).map(group);
  for (const [id, declared] of Object.entries(library)) if (!Object.hasOwn(tools, id)) tool({ ...declared, id });

  const sets = (declared: readonly ContextToolSet[] | undefined, menu: boolean): ContextSet[] => (declared ?? []).map((set) => ({
    for: set.for ?? [],
    when: set.when,
    placement: set.placement ?? (menu ? 'menu' : 'around'),
    standardEntries: menu && set.standardEntries !== false,
    runSingle: set.runSingle === true,
    entries: set.tools.map((entry) => {
      if (entry.forEach !== undefined) report('A context tool is repeated for each item of a list (`forEach`), which this add-on does not support; it is shown once.');
      return {
        kind: entry.kind, label: entry.label, icon: text(entry.icon), shortcut: entry.shortcut, group: entry.group,
        operation: entry.operation, creates: entry.creates, via: entry.via, direction: entry.direction,
        visible: entry.visible, enabled: entry.enabled, unavailable: entry.unavailable ?? [], args: entry.args ?? {},
      };
    }),
  }));

  return {
    value: {
      groups, tools,
      contextTools: sets(section?.contextTools, false),
      contextMenus: sets(section?.contextMenus, true),
      searchable: section?.searchable !== false,
      showRecent: section?.showRecent ?? 0,
    },
    findings,
  };
}

/** The sets that are offered for a target: a type of the metamodel, `diagram` or `connection`. A type is offered what its supertypes are. */
export function setsFor(sets: readonly ContextSet[], metamodel: Metamodel, target: string): ContextSet[] {
  const names = metamodel.types[target]?.lineage ?? [target];
  return sets.filter((set) => set.for.some((name) => names.includes(name)));
}

/** The groups a viewpoint offers: those that name it, and those that name no viewpoint. */
export const groupsIn = (toolbox: Toolbox, viewpoint: string | undefined): ToolGroup[] =>
  toolbox.groups.filter((group) => group.viewpoints === undefined || viewpoint === undefined || group.viewpoints.includes(viewpoint));
