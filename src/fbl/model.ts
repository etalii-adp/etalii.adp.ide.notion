import type { Finding } from './finding';
import type { Span } from './span';

/**
 * An element or a relation read from a body (FBL 5). `idIsStored` is false when the id is not kept
 * in the body: derived by the caller's id strategy, or a place-based address. An integer is a
 * `bigint` and any other number a `number`.
 */
export interface FblElement {
  readonly id: string;
  readonly idIsStored: boolean;
  readonly type: string;
  readonly rule: string;
  readonly isRelation: boolean;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly parentId?: string;
  readonly parentSlot?: string;
  readonly source?: string;
  readonly target?: string;
  readonly ownSpan: Span;
  readonly line: number;
}

/** A view a block of the body defines (FBL 4.7): its name, the block rule that matched it, and where it is. */
export interface FblView {
  readonly name: string;
  readonly block: string;
  readonly span: Span;
  readonly line: number;
}

/** What reading a body gives: its elements and relations in document order, and its findings. */
export class FblModel {
  constructor(
    readonly elements: readonly FblElement[],
    readonly findings: readonly Finding[],
    readonly unreadable: boolean,
    /** The views a blocks body defines (FBL 4.7), in document order. */
    readonly views: readonly FblView[] = [],
    /** The resources a body holds (FBL 8.2): the values of the binding's resource capture, in document order. */
    readonly resources: readonly string[] = [],
  ) {}

  get nodes(): FblElement[] {
    return this.elements.filter((element) => !element.isRelation);
  }

  get relations(): FblElement[] {
    return this.elements.filter((element) => element.isRelation);
  }

  find(id: string): FblElement | undefined {
    return this.elements.find((element) => element.id === id);
  }

  /**
   * The view a registration's `view` header selects (FBL 9.3): the one of that name, ignoring case;
   * without the header, the first in document order; nothing when there is none.
   */
  selectView(header?: string): FblView | undefined {
    if (header === undefined) return this.views[0];
    const wanted = header.toUpperCase();
    return this.views.find((view) => view.name.toUpperCase() === wanted);
  }
}

/** What an id strategy is asked when a rule stores no id (FBL 5.3, DISL 11.5). */
export interface IdRequest {
  readonly rule: string;
  readonly type: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly source?: string;
  readonly target?: string;
  readonly line: number;
  /**
   * The id of the element that contains this one (FBL 5.5), or nothing at the top level. Known
   * before this element's id is asked for: an element is read after the one that contains it.
   */
  readonly parentId?: string;
  /** The containment slot of the parent this element is in, or nothing at the top level. */
  readonly parentSlot?: string;
  /**
   * The element's zero-based place among the elements of the same parent and slot, in document
   * order: what an id strategy that addresses an element by its position derives from.
   */
  readonly positionInSlot: number;
}

/** The caller's settings for reading and writing one body. */
export interface FblOptions {
  /** The body's file name, relative to the subject, for findings. Default `body`. */
  readonly fileName?: string;
  /** A body larger than this is unreadable rather than read in part (FBL 16). Default 32 MiB. */
  readonly maxBodyBytes?: number;
  /** A body with more entries than this is unreadable rather than read in part (FBL 16). Default 500,000. */
  readonly maxEntries?: number;
  /** The steps one match attempt of a regular expression may take (FBL 16). Default 1,000,000. */
  readonly regexSteps?: number;
  /**
   * The id strategy for rules that store no id: the derived id, or nothing to address the element
   * by its place. FBL defines no derivation of its own (FBL 5.3); this is where DISL comes in.
   */
  readonly deriveId?: (request: IdRequest) => string | undefined;
  /**
   * The type the tool type's specification gives an attribute of an element type, by the two
   * names, or nothing where it gives none. A binding does not carry it, and FBL 5.2 needs it: a
   * string attribute reads a scalar's written text and every other its typed value, converted. An
   * entry holding a value that does not convert is an unreadable entry: reported, no element, and
   * never rewritten (FBL 7.4). Where no type is given, a value reads as what its family makes of it.
   */
  readonly attributeType?: (elementType: string, attribute: string) => string | undefined;
  /**
   * The attributes whose type, in the tool type's specification, is a date or a date-time, each
   * as `rule.attribute`. FBL does not know an attribute's type and section 6.3 needs it: a new
   * value that reads as a timestamp is written plain when it is one, and quoted when it is a
   * string that only looks like one. Without this, every such value is taken for a string.
   */
  readonly timeAttributes?: ReadonlySet<string>;
  /**
   * Whether a key of a read entry that no rule of the binding reads is reported, as
   * `fbl.unbound-key` of severity info. Such a key is kept on every write either way (FBL 6.1);
   * this only says so, for a tool type whose specification asks that its author is told. Off
   * unless asked for; in xml it is an attribute or a child element of a read element.
   */
  readonly reportUnboundKeys?: boolean;
  /** The registration's headers, visible to CEL as `registration`. */
  readonly registrationHeaders?: ReadonlyMap<string, string>;
  /** The registration's `resource` header (FBL 8.2): which value of the binding's resource capture is read. */
  readonly resource?: string;
  /** The registration's `identities` block, for rules with `id.sidecar`. */
  readonly identities?: ReadonlyMap<string, string>;
}

/** The options with every default filled in. */
export interface ResolvedOptions {
  readonly fileName: string;
  readonly maxBodyBytes: number;
  readonly maxEntries: number;
  readonly regexSteps: number;
  readonly deriveId?: (request: IdRequest) => string | undefined;
  readonly attributeType?: (elementType: string, attribute: string) => string | undefined;
  readonly timeAttributes: ReadonlySet<string>;
  readonly reportUnboundKeys: boolean;
  readonly registrationHeaders: ReadonlyMap<string, string>;
  readonly resource?: string;
  readonly identities: ReadonlyMap<string, string>;
}

export const defaultRegexSteps = 1_000_000;

export function resolveOptions(options: FblOptions = {}): ResolvedOptions {
  return {
    fileName: options.fileName ?? 'body',
    maxBodyBytes: options.maxBodyBytes ?? 32 * 1024 * 1024,
    maxEntries: options.maxEntries ?? 500_000,
    regexSteps: options.regexSteps ?? defaultRegexSteps,
    deriveId: options.deriveId,
    attributeType: options.attributeType,
    timeAttributes: options.timeAttributes ?? new Set(),
    reportUnboundKeys: options.reportUnboundKeys === true,
    registrationHeaders: options.registrationHeaders ?? new Map(),
    resource: options.resource,
    identities: options.identities ?? new Map(),
  };
}
