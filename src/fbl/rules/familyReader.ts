import type { AttributeBinding, BlockRule, FblBinding, HeaderSettings, Rule, Slot } from '../documents/types';
import { BoundedRegex } from '../expressions/regexMatcher';
import type { Finding, FindingSeverity, SourceLocation } from '../finding';
import type { ResolvedOptions } from '../model';
import type { Span } from '../span';
import type { BodyText } from '../text/bodyText';

const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;

/**
 * A node a rule can match (FBL 4.1.1): its own span, its line span when it starts and ends its
 * lines, and the entries it contains.
 */
export abstract class Entry {
  /** The line span (FBL 4.1.1), leading comments included; nothing when the entry shares a line. */
  lineSpan?: Span;

  parent?: Entry;

  readonly children: Entry[] = [];

  constructor(
    public own: Span,
    /** The key of a member, the name of an xml element; nothing for a sequence item or a statement. */
    readonly name: string | undefined,
    /** The byte column of the entry's first byte on its line. */
    readonly indent: number,
  ) {}

  /** The span a removal takes: the line span when there is one, else the own span. */
  get removalSpan(): Span {
    return this.lineSpan ?? this.own;
  }
}

/** An entry a rule's selector or line matched, with the captures or groups the match bound. */
export interface Candidate {
  readonly rule?: Rule;
  readonly block?: BlockRule;
  readonly entry: Entry;
  readonly captures: ReadonlyMap<string, string>;
}

/** A word of a lines or blocks group (FBL 4.6), with its span (quotes included) and its text (quotes excluded). */
export interface Word {
  readonly text: string;
  readonly span: Span;
  readonly quoted: boolean;
}

/** What reading one slot of one entry gave. */
export interface SlotRead {
  readonly value: unknown;
  readonly span?: Span;
  readonly present: boolean;
  readonly writable: boolean;
  readonly reason?: string;
  /** The family's own node for the slot (a yaml member, an xml attribute, a lines group), for writing. */
  readonly node?: unknown;
  /** For a group read as words: every word of the group, so references inside it can be rewritten one by one. */
  readonly words?: readonly Word[];
  /** The quote the value is written in on the wire, when the span includes one. */
  readonly quote?: string;
  /** The value as written, before maps or conversion, for keeping a map's wire value. */
  readonly wire?: string;
}

export const absentSlot: SlotRead = { value: null, present: false, writable: true };

export const readOnlyAbsent = (reason: string): SlotRead => ({ value: null, present: false, writable: false, reason });

/** An element or relation as the engine keeps it: the public element plus where each value lives. */
export class ReadElement {
  id = '';

  idStored = false;

  idRead?: SlotRead;

  /** The value references name this element by: its stored id, or the attribute its own rules reference it by. */
  key = '';

  /** The attribute whose value is `key`, when it is an attribute. */
  keyAttribute?: string;

  readonly slots = new Map<string, SlotRead>();

  readonly attributes = new Map<string, unknown>();

  parent?: ReadElement;

  sourceRead?: SlotRead;

  targetRead?: SlotRead;

  sourceElement?: ReadElement;

  targetElement?: ReadElement;

  constructor(readonly rule: Rule, readonly candidate: Candidate, readonly line: number) {}

  get entry(): Entry {
    return this.candidate.entry;
  }

  get isRelation(): boolean {
    return this.rule.isRelation;
  }
}

/** An attribute to write, after the engine's checks: its binding, how it is read now, and its new value. */
export interface SlotChange {
  readonly attribute: string;
  readonly binding: AttributeBinding;
  readonly rule: Rule;
  readonly read: SlotRead;
  readonly value: unknown;
  readonly isEmpty: boolean;
}

/** What adding an element or relation needs to know (FBL 6.2). */
export interface InsertRequest {
  readonly rule: Rule;
  readonly id?: string;
  readonly values: ReadonlyMap<string, unknown>;
  readonly parent?: ReadElement;
  readonly source?: ReadElement;
  readonly target?: ReadElement;
}

/** Thrown inside planning when a change cannot be made; the edit is refused with its message (FBL 6.4). */
export class RefusedException extends Error {}

/** What a family's writing half adds its splices to, and may ask of the edit so far (planning/plan.ts). */
export interface SplicePlan {
  readonly reading: Reading;
  add(operation: import('../splice').SpliceOperation, start: number, end: number, text: string): void;
  addAt(operation: import('../splice').SpliceOperation, range: Span, text: string): void;
  /** Whether a splice already replaces bytes overlapping `range`. */
  touches(range: Span): boolean;
}

/** What a family's writing half may ask of the reading it writes for (rules/bodyReading.ts). */
export interface Reading {
  readonly elements: readonly ReadElement[];
  readonly family: FamilyReader;
  claimedBy(entry: Entry): string | undefined;
  elementOf(entry: Entry): ReadElement | undefined;
}

/**
 * One family's lossless reading of a body (FBL 4) and the splices it writes (FBL 6). The engine
 * (bodyReading.ts) does what is the same for every family: rule precedence, ids, references,
 * containment, findings and refusals; the planner does the shape of an edit.
 */
export abstract class FamilyReader {
  private readonly regexes = new Map<string, BoundedRegex>();

  /** Where and why the body is unreadable (FBL 7.5), or nothing. */
  unreadable?: { offset: number; message: string };

  readonly findings: Finding[] = [];

  constructor(readonly text: BodyText, readonly binding: FblBinding, readonly options: ResolvedOptions) {}

  abstract readonly familyName: string;

  /** Every entry in document order (FBL 4.1.3). */
  abstract readonly entries: readonly Entry[];

  /** Builds the lossless reading; sets `unreadable` when the body is not well-formed. */
  abstract parse(): void;

  /**
   * The leaf nodes of the reading (keys, scalars, statements, tags, comments), in body order.
   * Every byte outside them is trivia (FBL 4.1): the invariant every reader is held to, checked
   * with `isTrivia` on each gap.
   */
  abstract readonly leaves: readonly Span[];

  /** Whether the bytes of `gap` are trivia of this family: whitespace, line endings, punctuation. */
  abstract isTrivia(gap: Span): boolean;

  /** The gaps between leaves that are not trivia: empty when the reading accounts for every byte. */
  unaccounted(): Span[] {
    const gaps: Span[] = [];
    let position = this.text.bomLength;
    for (const leaf of [...this.leaves].sort((a, b) => a.start - b.start)) {
      if (leaf.start < position) continue;
      if (leaf.start > position && !this.isTrivia({ start: position, end: leaf.start })) gaps.push({ start: position, end: leaf.start });
      position = Math.max(position, leaf.end);
    }
    if (position < this.text.length && !this.isTrivia({ start: position, end: this.text.length })) gaps.push({ start: position, end: this.text.length });
    return gaps;
  }

  /** Whether a byte range holds only whitespace and line endings. */
  protected isWhitespace(range: Span): boolean {
    for (let i = range.start; i < range.end; i++) {
      const b = this.text.bytes[i];
      if (b !== SPACE && b !== TAB && b !== CR && b !== LF) return false;
    }
    return true;
  }

  abstract candidates(rule: Rule): Candidate[];

  blockCandidates(block: BlockRule): Candidate[] {
    void block;
    return [];
  }

  /** Whether `within` admits `entry`, given what claimed the entries around it (blocks). */
  admits(within: readonly string[] | undefined, entry: Entry, claimedBy: (entry: Entry) => string | undefined): boolean {
    void [within, entry, claimedBy];
    return true;
  }

  /** The entries that structurally enclose `entry`, nearest first. */
  enclosing(entry: Entry): Entry[] {
    const found: Entry[] = [];
    for (let parent = entry.parent; parent; parent = parent.parent) found.push(parent);
    return found;
  }

  /** The entry as CEL sees it (FBL 4.1.4). */
  abstract celValue(candidate: Candidate): unknown;

  /** The variable a rule's CEL has besides `entry`, `parent`, `line` and `registration`: `path` or `groups`. */
  abstract celExtra(candidate: Candidate): { name: string; value: unknown };

  /** Reads a slot that is the family's own: a key, an attribute, text, a group, a capture. */
  abstract read(candidate: Candidate, slot: Slot): SlotRead;

  /** Reads the slot named `name` of an enclosing entry, for a `parent` slot naming no attribute. */
  abstract readRaw(entry: Entry, name: string): SlotRead;

  /** The header check (FBL 5.6): whether the mark is there with the right value. */
  abstract headerHolds(header: HeaderSettings): boolean;

  /** Findings about entries no rule claimed, once reading is done. */
  afterRead(claimedBy: (entry: Entry) => string | undefined): void {
    // Nothing, unless the family reports what was left unread.
    void claimedBy;
  }

  // ---- writing (FBL 6) ----

  /** The text that replaces a value's span: the new value in the value's own style when it fits (FBL 6.3). */
  abstract format(read: SlotRead, binding: AttributeBinding | undefined, value: unknown): string;

  /** Writes `changes` to `element`; the engine has already refused what must be refused. */
  abstract write(plan: SplicePlan, element: ReadElement, changes: readonly SlotChange[]): void;

  abstract insert(plan: SplicePlan, request: InsertRequest): void;

  abstract remove(plan: SplicePlan, element: ReadElement, removed: ReadonlySet<ReadElement>): void;

  // ---- shared helpers ----

  newlineAt(offset: number): string {
    return this.text.newlineAt(offset, this.binding.text.newline);
  }

  regex(expression: string, caseInsensitive: boolean): BoundedRegex {
    const key = (caseInsensitive ? 'i:' : 's:') + expression;
    let regex = this.regexes.get(key);
    if (!regex) {
      regex = new BoundedRegex(expression, caseInsensitive, this.options.regexSteps);
      this.regexes.set(key, regex);
    }
    return regex;
  }

  locate(range: Span): SourceLocation {
    const { line, column } = this.text.position(range.start);
    return { file: this.options.fileName, line, column, length: this.text.codePoints(range.start, range.end) };
  }

  report(code: string, severity: FindingSeverity, message: string, range: Span): void {
    this.findings.push({ code, severity, message, location: this.locate(range) });
  }

  /** Indentation of a number of columns, in the binding's indentation character. */
  indentation(columns: number): string {
    return this.indentCharacter.repeat(Math.max(0, columns));
  }

  get indentCharacter(): string {
    return this.binding.text.indent === 0 ? '\t' : ' ';
  }

  /**
   * The indentation step (FBL 6.3): the difference between the indentation of the first parent
   * and child pair in document order, else the binding's `text.indent`.
   */
  get step(): number {
    for (const entry of this.entries) {
      const parent = entry.parent;
      if (parent && entry.indent > parent.indent && entry.lineSpan && parent.lineSpan) return entry.indent - parent.indent;
    }
    return this.binding.text.indent === 0 ? 1 : this.binding.text.indent;
  }

  /** Whether the bytes of the line holding `offset` before it are all whitespace. */
  onlyWhitespaceBefore(offset: number): boolean {
    const line = this.text.lines[this.text.lineIndexAt(offset)];
    for (let i = Math.max(line.start, this.text.bomLength); i < offset; i++) {
      const b = this.text.bytes[i];
      if (b !== SPACE && b !== TAB) return false;
    }
    return true;
  }

  /** Whether only whitespace (and a comment, when `comment` is given) follows `offset` on its line. */
  onlyTriviaAfter(offset: number, comment?: number): boolean {
    const line = this.text.lines[this.text.lineIndexAt(offset)];
    for (let i = offset; i < line.contentEnd; i++) {
      const b = this.text.bytes[i];
      if (comment !== undefined && b === comment && (i === offset || this.text.bytes[i - 1] === SPACE || this.text.bytes[i - 1] === TAB)) return true;
      if (b !== SPACE && b !== TAB) return false;
    }
    return true;
  }
}

/** Refuses the change being planned, with the sentence a user is shown (FBL 6.4). */
export function refuse(reason: string): never {
  throw new RefusedException(reason);
}

/** A value read from an attribute's `override` slot, which writing removes (FBL 5.2). */
export class OverrideNode {
  constructor(readonly node: unknown, readonly slot: Slot) {}
}
