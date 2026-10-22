import { scalarText, scalarValue } from '../documents/jsonReader';
import { allRules, type AttributeBinding, type Family, type FblBinding, type ReferenceBinding, type Slot } from '../documents/types';
import { CelError, CelException, compileCel, type CelContext, type CelProgram } from '../expressions/cel';
import { JsonFamily } from '../families/json/jsonFamily';
import { LinesFamily } from '../families/lines/linesFamily';
import { XmlElement, XmlFamily } from '../families/xml/xmlFamily';
import { YamlFamily } from '../families/yaml/yamlFamily';
import { typed } from '../families/yaml/yamlScalars';
import { extensionOf } from '../files/paths';
import { findingCodes, type Finding } from '../finding';
import { messages } from '../messages';
import { FblModel, resolveOptions, type FblOptions, type FblView, type ResolvedOptions } from '../model';
import { plain } from '../planning/newText';
import type { Span } from '../span';
import { BodyText } from '../text/bodyText';
import { OverrideNode, ReadElement, readOnlyAbsent, type Candidate, type Entry, type FamilyReader, type Reading, type SlotRead } from './familyReader';
import { celOf, isQuoted, plainText, TreeEntry } from './treeFamily';
import { convert, isTextType, reads } from './typedValue';

/** The reader of a binding's family for a body; a body whose extension names a family of `alsoRead` is read as that one. */
export function createFamily(text: BodyText, binding: FblBinding, options: ResolvedOptions): FamilyReader {
  let family = binding.body.family;
  if (family === undefined) throw new Error(messages.noFamily(binding.name));
  const extension = extensionOf(options.fileName).toLowerCase();
  for (const also of binding.body.alsoRead) {
    if (familyOfExtension(extension) === also) family = also;
  }
  switch (family) {
    case 'lines': return new LinesFamily(text, binding, options, false);
    case 'blocks': return new LinesFamily(text, binding, options, true);
    case 'yaml': return new YamlFamily(text, binding, options);
    case 'json': return new JsonFamily(text, binding, options);
    case 'xml': return new XmlFamily(text, binding, options);
  }
}

function familyOfExtension(extension: string): Family | undefined {
  switch (extension) {
    case '.yml': case '.yaml': return 'yaml';
    case '.json': return 'json';
    case '.xml': return 'xml';
    default: return undefined;
  }
}

/** Reads a body through a binding. Reading is a pure function of the bytes, the binding and the options, and never throws on content (FBL 7.4). */
export function readBody(bytes: Uint8Array, binding: FblBinding, options?: FblOptions): BodyReading {
  const resolved = resolveOptions(options);
  const text = new BodyText(bytes);
  const family = createFamily(text, binding, resolved);
  const reading = new BodyReading(text, binding, resolved, family);
  reading.read();
  return reading;
}

/**
 * A body read through a binding (FBL 5): the family's lossless reading, which rule claimed which
 * entry, the elements and relations with where each value lives, and the findings.
 */
export class BodyReading implements Reading {
  private readonly claims = new Map<Entry, string>();
  private readonly byEntry = new Map<Entry, ReadElement>();
  private readonly programs = new Map<string, CelProgram | undefined>();

  // An entry's parent as CEL reads it, converted once for each reading: every item of a list shares
  // the list as its parent, so converting it for each item made reading quadratic in the list's length.
  private readonly parents = new Map<object, unknown>();

  // While claiming, the variables of the candidate being claimed: its when and its computed slots read the same ones.
  private isClaiming = false;
  private claiming?: { readonly candidate: Candidate; readonly variables: Record<string, unknown> };

  // For each reference, the first element of each key, built on first use once the elements are final.
  private readonly referenced = new Map<ReferenceBinding, Map<string, ReadElement>>();
  private allFindings: Finding[] = [];
  /** The resource the registration's `resource` header selects; without it, the first in document order (FBL 8.2). */
  private resource?: string;

  /** Elements and relations in document order; relations whose ends name nothing are not among them. */
  elements: ReadElement[] = [];

  /** The views the body's view blocks define (FBL 4.7), in document order. */
  readonly views: FblView[] = [];

  /** The values of the binding's resource capture (FBL 8.2) in document order: the resources the body holds. */
  readonly resources: string[] = [];

  unreadable?: { offset: number; message: string };

  constructor(readonly text: BodyText, readonly binding: FblBinding, readonly options: ResolvedOptions, readonly family: FamilyReader) {}

  get findings(): readonly Finding[] {
    return this.allFindings;
  }

  readonly claimedBy = (entry: Entry): string | undefined => this.claims.get(entry);

  elementOf(entry: Entry): ReadElement | undefined {
    return this.byEntry.get(entry);
  }

  find(id: string): ReadElement | undefined {
    return this.elements.find((element) => element.id === id);
  }

  read(): void {
    const { text, family, binding, options } = this;
    if (text.length > options.maxBodyBytes) return this.makeUnreadable(0, messages.bodyTooLarge(options.maxBodyBytes));
    if (text.invalidOffset !== undefined) return this.makeUnreadable(text.invalidOffset, messages.notUtf8);
    family.parse();
    if (family.unreadable) return this.makeUnreadable(family.unreadable.offset, family.unreadable.message);
    if (family.entries.length > options.maxEntries) return this.makeUnreadable(0, messages.tooManyEntries(options.maxEntries));
    const header = binding.header;
    if (header && !family.headerHolds(header)) {
      const mark = header.key !== undefined ? messages.headerKeyMark(header.key, header.value ? scalarText(header.value) : '') : messages.headerLineMark;
      if (header.required) return this.makeUnreadable(0, messages.headerRequired(mark));
      family.report(findingCodes.headerMismatch, 'warning', messages.headerMismatch(mark), { start: text.bomLength, end: text.lines[0].contentEnd });
    }
    this.isClaiming = true;
    this.claim();
    this.isClaiming = false;
    this.claiming = undefined;
    this.resolve();
    if (options.reportUnboundKeys) this.reportUnboundKeys();
    family.afterRead(this.claimedBy);
    this.allFindings = [...family.findings, ...this.allFindings];
  }

  /**
   * Reports each key of a read entry that nothing in the binding reads: not an attribute of a
   * rule that reads there, not its id, not a key such a rule writes, and not the container of a
   * rule that reads further down. In xml that is an attribute or a child element of a read
   * element. What is reported is kept as it is; this only says that it is there.
   */
  private reportUnboundKeys(): void {
    const known = new Map<string, KnownNames>();
    const seen = new Set<Entry>();
    for (const element of this.elements) {
      const at = element.rule.at;
      if (at === undefined || seen.has(element.entry)) continue;
      seen.add(element.entry);
      let names = known.get(at);
      if (!names) {
        names = this.knownNames(at);
        known.set(at, names);
      }
      const entry = element.entry;
      if (entry instanceof TreeEntry) {
        if (entry.value.kind !== 'mapping' || entry.value.viaAlias) continue;
        for (const member of entry.value.entries) {
          const key = member.name;
          if (key !== undefined && !names.keys.has(key) && !names.children.has(key)) this.unbound(messages.unboundKeyKind, key, member.keySpan ?? member.own);
        }
      } else if (entry instanceof XmlElement) {
        for (const attribute of entry.attributes) {
          // A namespace declaration and an xml: attribute are the format's own, not a value of the entry.
          if (!names.keys.has(attribute.name) && !attribute.name.startsWith('xml')) this.unbound(messages.unboundAttributeKind, attribute.name, attribute.own);
        }
        for (const child of entry.elements) {
          if (!names.anyChild && child.name !== undefined && !names.children.has(child.name)) this.unbound(messages.unboundElementKind, child.name, child.startTag);
        }
      }
    }
  }

  private unbound(kind: string, name: string, at: Span): void {
    this.family.report(findingCodes.unboundKey, 'info', messages.unboundKey(kind, name), at);
  }

  /**
   * What the binding knows of an entry read at a path: the keys the rules there read and write, and
   * the next step of every rule that reads further down. A step that is not a plain name admits any child.
   */
  private knownNames(at: string): KnownNames {
    const names: KnownNames = { keys: new Set(), children: new Set(), anyChild: false };
    const step = (path: string): void => {
      const name = path.split('/')[0].split('[')[0];
      if (name.length === 0 || name === '*' || name.includes('{')) names.anyChild = true;
      else names.children.add(name);
    };
    const prefix = at.endsWith('/') ? at : `${at}/`;
    for (const rule of allRules(this.binding)) {
      if (rule.at === at) {
        for (const slot of [...rule.attributes.map(([, attribute]): Slot => attribute), ...(rule.id?.from ? [rule.id.from] : [])]) {
          if (slot.child !== undefined) step(slot.child);
          else {
            const key = slot.key ?? slot.attribute;
            if (key !== undefined) names.keys.add(key);
          }
        }
        for (const key of rule.insert?.keys ?? []) names.keys.add(key);
      } else if (rule.at?.startsWith(prefix)) {
        step(rule.at.slice(prefix.length));
      }
    }
    if (at === '/') {
      // The root also holds the marks a file is known by, and may name its schema.
      if (this.binding.header?.key !== undefined) names.keys.add(this.binding.header.key);
      if (this.binding.claims.marker?.rootKey !== undefined) names.keys.add(this.binding.claims.marker.rootKey);
      names.keys.add('$schema');
    }
    return names;
  }

  private makeUnreadable(offset: number, message: string): void {
    this.unreadable = { offset, message };
    this.claims.clear();
    this.byEntry.clear();
    this.elements = [];
    const { line, column } = this.text.position(Math.min(offset, this.text.length));
    this.allFindings = [{ code: findingCodes.unparseable, severity: 'error', message, location: { file: this.options.fileName, line, column, length: 0 } }];
  }

  // ---- claiming entries (FBL 5.1) ----

  private claim(): void {
    const offered = new Map<Entry, Candidate[]>();
    const offer = (candidate: Candidate): void => {
      const list = offered.get(candidate.entry);
      if (list) list.push(candidate);
      else offered.set(candidate.entry, [candidate]);
    };
    for (const block of this.binding.blocks) this.family.blockCandidates(block).forEach(offer);
    for (const rule of allRules(this.binding)) this.family.candidates(rule).forEach(offer);
    for (const entry of this.family.entries) {
      const candidates = offered.get(entry);
      if (!candidates) continue;
      let error: string | undefined;
      for (const candidate of candidates) {
        const within = candidate.rule?.within ?? candidate.block?.within;
        if (!this.family.admits(within, entry, this.claimedBy)) continue;
        const rule = candidate.rule;
        if (rule) {
          if (!this.selectedResource(candidate)) continue;
          if (rule.when !== undefined) {
            const { value, problem } = this.evaluate(rule.when, candidate);
            if (problem !== undefined) error ??= problem;
            if (value !== true) continue;
          }
          const element = new ReadElement(rule, candidate, this.text.position(entry.own.start).line);
          const unconverted: Unconverted[] = [];
          const mistyped = this.readSlots(element, unconverted);
          if (mistyped !== undefined) {
            // The entry is this rule's and no other's: it is not offered to a later candidate,
            // which would read as an element what the rule could not.
            error = mistyped;
            break;
          }
          this.claims.set(entry, rule.name);
          this.byEntry.set(entry, element);
          this.elements.push(element);
          for (const { attribute, type, read } of unconverted) {
            const text = writtenText(read);
            this.family.report(findingCodes.unconvertedValue, 'warning', messages.unconvertedValue(attribute, text, type), read.span ?? entry.own, { attribute, text });
          }
        } else {
          const block = candidate.block!;
          this.claims.set(entry, block.name);
          const view = block.view === undefined ? undefined : candidate.captures.get(block.view);
          if (view !== undefined) this.views.push({ name: view, block: block.name, span: entry.own, line: this.text.position(entry.own.start).line });
        }
        error = undefined;
        break;
      }
      if (error !== undefined) this.family.report(findingCodes.unreadableEntry, 'warning', messages.entryUnreadable(error), entry.own);
    }
  }

  /**
   * The registration's `resource` header selects one value of the binding's resource capture;
   * without it, the first value in document order (FBL 8.2).
   */
  private selectedResource(candidate: Candidate): boolean {
    const capture = this.binding.registration.resourceCapture;
    if (capture === undefined) return true;
    const value = candidate.captures.get(capture);
    if (value === undefined) return true;
    if (!this.resources.includes(value)) this.resources.push(value);
    this.resource ??= this.options.resource ?? value;
    return value === this.resource;
  }

  // ---- CEL ----

  private program(expression: string, context: CelContext): { program?: CelProgram; problem?: string } {
    const key = `${context}:${expression}`;
    if (this.programs.has(key)) return { program: this.programs.get(key) };
    let program: CelProgram | undefined;
    let problem: string | undefined;
    try {
      program = compileCel(expression, context);
    } catch (error) {
      if (!(error instanceof CelException)) throw error;
      problem = error.message;
    }
    this.programs.set(key, program);
    return { program, problem };
  }

  private get ruleContext(): CelContext {
    return this.family instanceof LinesFamily ? 'lines' : this.family instanceof XmlFamily ? 'xml' : 'tree';
  }

  /** A rule's expression on an entry: its value, or the problem that left it without one. */
  evaluate(expression: string, candidate: Candidate): { value?: unknown; problem?: string } {
    const { program, problem } = this.program(expression, this.ruleContext);
    if (!program) return { problem };
    const value = program.evaluate(this.claimVariables(candidate));
    return value instanceof CelError ? { problem: value.message } : { value };
  }

  insertAllowed(expression: string, attributes: ReadonlyMap<string, unknown>): boolean {
    const { program } = this.program(expression, 'insert');
    return program ? program.isTrue({ attributes: new Map(attributes) }) : false;
  }

  /**
   * The variables of `candidate`, kept while it is the one being read: while claiming, nothing
   * they are made of changes between its `when` and its computed slots.
   */
  private claimVariables(candidate: Candidate): Record<string, unknown> {
    if (!this.isClaiming) return this.variables(candidate);
    if (this.claiming?.candidate === candidate) return this.claiming.variables;
    const variables = this.variables(candidate);
    this.claiming = { candidate, variables };
    return variables;
  }

  private variables(candidate: Candidate): Record<string, unknown> {
    const variables: Record<string, unknown> = {
      entry: this.family.celValue(candidate),
      line: BigInt(this.text.position(candidate.entry.own.start).line),
      registration: new Map<string, unknown>(this.options.registrationHeaders),
    };
    const extra = this.family.celExtra(candidate);
    variables[extra.name] = extra.value;
    // The nearest enclosing entry: as the rule that claimed it reads it, or as it stands.
    const enclosing = this.family.enclosing(candidate.entry)[0];
    const claimed = enclosing ? this.byEntry.get(enclosing) : undefined;
    variables.parent = !enclosing
      ? null
      : claimed
        ? this.parentValue(claimed, () => this.family.celValue(claimed.candidate))
        : this.parentValue(enclosing, () => this.family.celValue({ entry: enclosing, captures: new Map() }));
    if (this.ruleContext === 'tree') {
      // The entry's written text and styles (FBL 2.4), made when an expression first asks for them.
      for (const view of ['text', 'style'] as const) {
        let made = false;
        let value: unknown;
        Object.defineProperty(variables, view, {
          enumerable: true,
          get: () => {
            if (!made) {
              value = this.family.celWritten(candidate, view);
              made = true;
            }
            return value;
          },
        });
      }
    }
    return variables;
  }

  /** The CEL value of a parent, by the element or the entry it is a pure function of, converted on first use. */
  private parentValue(key: object, convert: () => unknown): unknown {
    if (!this.parents.has(key)) this.parents.set(key, convert());
    return this.parents.get(key);
  }

  // ---- slots (FBL 5.2) ----

  /**
   * Reads every slot of an element. Gives the reason the entry is unreadable when a value does not
   * convert to the type its specification gives the attribute and the binding gives no `fallback`
   * (FBL 5.2, 7.4); a value read as its fallback is added to `unconverted`.
   */
  private readSlots(element: ReadElement, unconverted: Unconverted[]): string | undefined {
    const rule = element.rule;
    let mistyped: string | undefined;
    for (const [name, binding] of rule.attributes) {
      const read = this.readSlot(element.candidate, binding, element);
      element.slots.set(name, read);
      const type = this.options.attributeType?.(rule.type, name);
      const scalar = read.present && !binding.flag ? this.readScalar(binding, read, type) : undefined;
      // A key with no value leaves a typed attribute absent, and its default applies (FBL 5.2).
      const present = read.present && scalar?.absent !== true;
      let failed = scalar?.unconverted === true;
      let value: unknown = present && scalar ? scalar.value : present ? read.value : null;
      if (present && binding.map && typeof value === 'string') {
        const mapped = binding.map.find(([wire]) => wire === value);
        if (mapped) value = mapped[1];
      }
      if (binding.flag) value = read.present;
      else if (read.present && binding.reference && !binding.reference.to.includes(rule.name) && read.words && read.words.length > 0) {
        value = read.words.map((word) => word.text);
      }
      // What its family reads as text, or translates with a map, is held to the type as it then stands.
      if (!failed && present && !binding.flag && type !== undefined && scalar?.checked !== true && value !== null && value !== undefined && !reads(type, value)) failed = true;
      if (failed && type !== undefined) {
        if (binding.fallback) {
          value = scalarValue(binding.fallback.value);
          if (binding.fallback.report) unconverted.push({ attribute: name, type, read });
        } else {
          mistyped ??= messages.mistyped(name, type);
        }
      }
      if (!present && !binding.flag && binding.default) value = scalarValue(binding.default);
      if (present || binding.flag || binding.default) element.attributes.set(name, value);
    }
    if (rule.source) element.sourceRead = this.readSlot(element.candidate, rule.source, element);
    if (rule.target) element.targetRead = this.readSlot(element.candidate, rule.target, element);
    if (rule.id?.from) element.idRead = this.readSlot(element.candidate, rule.id.from, element);
    return mistyped;
  }

  /**
   * What a slot of a yaml or json body reads from its value (FBL 5.2, "Reading a scalar"): the
   * written text for `read: "text"`, a reference and a string attribute; else the typed value,
   * converted to the attribute's type where the host gives one. A slot of another family, which
   * reads text and nothing else, reads what its family gave.
   */
  private readScalar(binding: AttributeBinding, read: SlotRead, type: string | undefined): { value?: unknown; absent?: boolean; unconverted?: boolean; checked?: boolean } {
    const tree = read.tree;
    if (!tree) return { value: read.value };
    if (binding.read === 'text' || binding.reference || (binding.read === undefined && isTextType(type))) return { value: celOf(tree, 'text'), checked: true };
    let value = read.value;
    // `quoted: "convert"`: a quoted scalar is first read by the core schema from its written text.
    if (binding.convertQuoted === true && tree.kind === 'scalar' && isQuoted(tree)) value = typed((tree.aliasOf ?? tree).text);
    if (type === undefined || binding.map) return { value };
    if (value === null || value === undefined) return { absent: true };
    const converted = convert(type, value, plainText(tree));
    return converted ? { value: converted.value, checked: true } : { unconverted: true };
  }

  readSlot(candidate: Candidate, slot: Slot, element: ReadElement): SlotRead {
    const read = this.readSlotUnchecked(candidate, slot, element);
    const reason = (slot as Partial<AttributeBinding>).readOnly ?? element.rule.readOnly ?? this.binding.readOnly;
    return reason !== undefined && read.writable ? { ...read, writable: false, reason } : read;
  }

  private readSlotUnchecked(candidate: Candidate, slot: Slot, element: ReadElement): SlotRead {
    if (slot.value !== undefined) {
      const { value, problem } = this.evaluate(slot.value, candidate);
      return problem === undefined
        ? { value, present: true, writable: false, reason: messages.valueComputed }
        : readOnlyAbsent(messages.valueNotComputed(problem));
    }
    if (slot.parent !== undefined) {
      for (const enclosing of this.family.enclosing(candidate.entry)) {
        const parent = this.byEntry.get(enclosing);
        if (!parent) continue;
        const containment = element.rule.parent;
        if (containment && !containment.rules.includes(parent.rule.name)) continue;
        return parent.slots.get(slot.parent) ?? this.family.readRaw(enclosing, slot.parent);
      }
      return readOnlyAbsent(messages.noEnclosingEntry);
    }
    const override = (slot as Partial<AttributeBinding>).override;
    if (override) {
      const overriding = this.family.read(candidate, { ...override, parent: undefined, value: undefined, flag: false, htmlParagraphs: (slot as AttributeBinding).htmlParagraphs } as Slot);
      if (overriding.present) return { ...overriding, node: new OverrideNode(overriding.node, override) };
    }
    return this.family.read(candidate, slot);
  }

  // ---- ids, references, containment (FBL 5.3 to 5.5) ----

  private resolve(): void {
    // Containment first: it needs no id, and an id derived by the caller may be built from the id
    // of the element that contains this one. Elements are in document order, so a parent has its
    // id before any of its children is asked for theirs.
    for (const element of this.elements) {
      const containment = element.rule.parent;
      if (!containment) continue;
      for (const enclosing of this.family.enclosing(element.entry)) {
        const parent = this.byEntry.get(enclosing);
        if (parent && containment.rules.includes(parent.rule.name)) {
          element.parent = parent;
          break;
        }
      }
    }
    const positions = new Map<ReadElement | undefined, Map<string | undefined, number>>();
    for (const element of this.elements) {
      let slots = positions.get(element.parent);
      if (!slots) {
        slots = new Map();
        positions.set(element.parent, slots);
      }
      const slot = element.parent ? element.rule.parent?.slot : undefined;
      element.positionInSlot = slots.get(slot) ?? 0;
      slots.set(slot, element.positionInSlot + 1);
    }
    const nodes = this.elements.filter((element) => !element.isRelation);
    for (const element of nodes) this.assignId(element);
    for (const element of nodes) element.key = keyOf(element);
    const dangling = new Set<ReadElement>();
    for (const relation of this.elements.filter((element) => element.isRelation)) {
      relation.sourceElement = this.end(relation, relation.sourceRead, 'source');
      relation.targetElement = this.end(relation, relation.targetRead, 'target');
      if (!relation.sourceElement || !relation.targetElement) dangling.add(relation);
    }
    for (const relation of dangling) this.byEntry.delete(relation.entry);
    this.elements = this.elements.filter((element) => !dangling.has(element));
    for (const relation of this.elements.filter((element) => element.isRelation)) {
      this.assignId(relation);
      relation.key = keyOf(relation);
    }
    const seen = new Set<string>();
    for (const element of this.elements) {
      if (!seen.has(element.id)) {
        seen.add(element.id);
        continue;
      }
      this.family.report(findingCodes.duplicateId, 'warning', messages.duplicateId(element.id), element.entry.own);
      element.id = placeId(element);
      element.idStored = false;
      seen.add(element.id);
    }
    for (const element of this.elements) this.checkReferences(element);
  }

  private assignId(element: ReadElement): void {
    const rule = element.rule;
    if (rule.id?.from) {
      // The id is the slot's written text (FBL 5.3): an entry written `id: 007` has the id `007`.
      const read = element.idRead;
      const id = read?.present ? writtenText(read) : '';
      if (id.length > 0) {
        element.id = id;
        element.idStored = true;
        return;
      }
      this.family.report(findingCodes.missingId, 'warning', messages.missingId(rule.type), element.entry.own);
      element.id = placeId(element);
      return;
    }
    if (rule.id?.sidecarKey !== undefined) {
      const { value: key } = this.evaluate(rule.id.sidecarKey, element.candidate);
      const stored = key === null || key === undefined ? undefined : this.options.identities.get(plain(key));
      if (stored !== undefined) {
        element.id = stored;
        element.idStored = true;
        return;
      }
    }
    element.id = this.options.deriveId?.({
      rule: rule.name,
      type: rule.type,
      attributes: Object.fromEntries(element.attributes),
      source: element.sourceElement?.id,
      target: element.targetElement?.id,
      line: element.line,
      parentId: element.parent?.id,
      parentSlot: element.parent ? rule.parent?.slot : undefined,
      positionInSlot: element.positionInSlot,
    }) ?? placeId(element);
  }

  private end(relation: ReadElement, read: SlotRead | undefined, end: string): ReadElement | undefined {
    if (!read?.present || read.value === null || read.value === undefined) {
      this.family.report(findingCodes.danglingReference, 'warning', messages.relationWithoutEnd(relation.rule.type, end), relation.entry.own);
      return undefined;
    }
    // An end is compared as written text (FBL 5.7), and one that names nothing is reported on the entry (FBL 5.4).
    const key = writtenText(read);
    const found = this.elements.find((element) => !element.isRelation && element.key === key);
    if (!found) this.family.report(findingCodes.danglingReference, 'warning', messages.relationEndNamesNothing(end, key, relation.rule.type), relation.entry.own);
    return found;
  }

  private checkReferences(element: ReadElement): void {
    for (const [name, binding] of element.rule.attributes) {
      const reference = binding.reference;
      if (!reference || reference.to.includes(element.rule.name)) continue;
      const read = element.slots.get(name);
      if (!read?.present) continue;
      const value = element.attributes.get(name);
      const names = Array.isArray(value) ? value.map((item) => plain(item)) : [writtenText(read)];
      for (const key of names) {
        if (!this.referencedBy(reference, key)) {
          this.family.report(findingCodes.danglingReference, 'warning', messages.referenceNamesNothing(key, name, reference.to), read.span ?? element.entry.own);
        }
      }
    }
  }

  /**
   * The first element, in document order, that `reference` can name and whose key is `key`. Read
   * once the elements are final, so each reference's keys are indexed on first use and not
   * searched for each key. Public: a host resolves a reference through it too, as the Notion
   * add-ons' store turns a reference into a row.
   */
  referencedBy(reference: ReferenceBinding, key: string): ReadElement | undefined {
    let index = this.referenced.get(reference);
    if (!index) {
      index = new Map();
      for (const element of this.elements) {
        if (!reference.to.includes(element.rule.name)) continue;
        // `by: "id"` names an entry by the id its rule stores with `id.from` (FBL 5.2): `id` is
        // never an attribute's name, since DISL reserves it, so there is no attribute to read.
        const named = reference.by === 'id' && !element.attributes.has('id')
          ? (element.idStored ? element.id : undefined)
          : keyText(element, reference.by);
        if (named !== undefined && !index.has(named)) index.set(named, element);
      }
      this.referenced.set(reference, index);
    }
    return index.get(key);
  }

  // ---- the public model ----

  toModel(): FblModel {
    return new FblModel(
      this.elements.map((element) => ({
        id: element.id,
        idIsStored: element.idStored,
        type: element.rule.type,
        rule: element.rule.name,
        isRelation: element.isRelation,
        attributes: Object.fromEntries(element.attributes),
        parentId: element.parent?.id,
        parentSlot: element.parent ? element.rule.parent?.slot : undefined,
        source: element.sourceElement?.id,
        target: element.targetElement?.id,
        ownSpan: element.entry.own,
        line: element.line,
      })),
      [...this.allFindings],
      this.unreadable !== undefined,
      [...this.views],
      [...this.resources],
    );
  }
}

const placeId = (element: ReadElement): string => `${element.rule.name}@${element.line}`;

/** What the binding knows of an entry read at a path: its keys, the names read further down, and whether any child may be. */
interface KnownNames {
  readonly keys: Set<string>;
  readonly children: Set<string>;
  anyChild: boolean;
}

/** An attribute read as its fallback, to be reported as `fbl.unconverted-value` once its entry is claimed. */
interface Unconverted {
  readonly attribute: string;
  readonly type: string;
  readonly read: SlotRead;
}

/**
 * A slot's value as text: the written text of a yaml or json scalar (FBL 4.1.5), which is what an
 * id and a reference are read and compared as (FBL 5.3, 5.7); else the value's written form.
 */
export function writtenText(read: SlotRead): string {
  const written = read.tree ? celOf(read.tree, 'text') : undefined;
  return typeof written === 'string' ? written : plain(read.value);
}

/** The value of an element's attribute that a reference names it by, as written text where its slot holds a scalar. */
function keyText(element: ReadElement, attribute: string): string {
  const read = element.slots.get(attribute);
  const mapped = element.rule.attributes.some(([name, binding]) => name === attribute && binding.map !== undefined);
  return read?.present && read.tree && !mapped ? writtenText(read) : plain(element.attributes.get(attribute));
}

/**
 * The value references name an element by: the attribute its own rules reference it by, else its
 * stored id, else its id (FBL 5.7).
 */
function keyOf(element: ReadElement): string {
  for (const [name, binding] of element.rule.attributes) {
    if (binding.reference && binding.reference.to.includes(element.rule.name) && binding.reference.by === name) {
      element.keyAttribute = name;
      return plain(element.attributes.get(name));
    }
  }
  if (element.rule.id?.from && element.idRead?.present) return writtenText(element.idRead);
  return element.id;
}
