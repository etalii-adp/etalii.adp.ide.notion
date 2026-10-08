import { scalarText, scalarValue } from '../documents/jsonReader';
import { allRules, type AttributeBinding, type Family, type FblBinding, type ReferenceBinding, type Slot } from '../documents/types';
import { CelError, CelException, compileCel, type CelContext, type CelProgram } from '../expressions/cel';
import { JsonFamily } from '../families/json/jsonFamily';
import { LinesFamily } from '../families/lines/linesFamily';
import { XmlFamily } from '../families/xml/xmlFamily';
import { YamlFamily } from '../families/yaml/yamlFamily';
import { extensionOf } from '../files/paths';
import { findingCodes, type Finding } from '../finding';
import { messages } from '../messages';
import { FblModel, resolveOptions, type FblOptions, type FblView, type ResolvedOptions } from '../model';
import { plain } from '../planning/newText';
import { BodyText } from '../text/bodyText';
import { OverrideNode, ReadElement, readOnlyAbsent, type Candidate, type Entry, type FamilyReader, type Reading, type SlotRead } from './familyReader';

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
    this.claim();
    this.resolve();
    family.afterRead(this.claimedBy);
    this.allFindings = [...family.findings, ...this.allFindings];
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
          this.claims.set(entry, rule.name);
          const element = new ReadElement(rule, candidate, this.text.position(entry.own.start).line);
          this.byEntry.set(entry, element);
          this.elements.push(element);
          this.readSlots(element);
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
    return this.family instanceof LinesFamily ? 'lines' : 'tree';
  }

  /** A rule's expression on an entry: its value, or the problem that left it without one. */
  evaluate(expression: string, candidate: Candidate): { value?: unknown; problem?: string } {
    const { program, problem } = this.program(expression, this.ruleContext);
    if (!program) return { problem };
    const value = program.evaluate(this.variables(candidate));
    return value instanceof CelError ? { problem: value.message } : { value };
  }

  insertAllowed(expression: string, attributes: ReadonlyMap<string, unknown>): boolean {
    const { program } = this.program(expression, 'insert');
    return program ? program.isTrue({ attributes: new Map(attributes) }) : false;
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
    variables.parent = enclosing ? this.family.celValue(this.byEntry.get(enclosing)?.candidate ?? { entry: enclosing, captures: new Map() }) : null;
    return variables;
  }

  // ---- slots (FBL 5.2) ----

  private readSlots(element: ReadElement): void {
    const rule = element.rule;
    for (const [name, binding] of rule.attributes) {
      const read = this.readSlot(element.candidate, binding, element);
      element.slots.set(name, read);
      let value: unknown = read.present ? read.value : null;
      if (read.present && binding.map && typeof value === 'string') {
        const mapped = binding.map.find(([wire]) => wire === value);
        if (mapped) value = mapped[1];
      }
      if (binding.flag) value = read.present;
      else if (read.present && binding.reference && !binding.reference.to.includes(rule.name) && read.words && read.words.length > 0) {
        value = read.words.map((word) => word.text);
      }
      if (!read.present && !binding.flag && binding.default) value = scalarValue(binding.default);
      if (read.present || binding.flag || binding.default) element.attributes.set(name, value);
    }
    if (rule.source) element.sourceRead = this.readSlot(element.candidate, rule.source, element);
    if (rule.target) element.targetRead = this.readSlot(element.candidate, rule.target, element);
    if (rule.id?.from) element.idRead = this.readSlot(element.candidate, rule.id.from, element);
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
    for (const element of this.elements) this.checkReferences(element);
  }

  private assignId(element: ReadElement): void {
    const rule = element.rule;
    if (rule.id?.from) {
      const read = element.idRead;
      const id = read?.present && read.value !== null && read.value !== undefined ? plain(read.value) : '';
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
    }) ?? placeId(element);
  }

  private end(relation: ReadElement, read: SlotRead | undefined, end: string): ReadElement | undefined {
    if (!read?.present || read.value === null || read.value === undefined) {
      this.family.report(findingCodes.danglingReference, 'warning', messages.relationWithoutEnd(relation.rule.type, end), relation.entry.own);
      return undefined;
    }
    const key = plain(read.value);
    const found = this.elements.find((element) => !element.isRelation && element.key === key);
    if (!found) this.family.report(findingCodes.danglingReference, 'warning', messages.relationEndNamesNothing(end, key, relation.rule.type), read.span ?? relation.entry.own);
    return found;
  }

  private checkReferences(element: ReadElement): void {
    for (const [name, binding] of element.rule.attributes) {
      const reference = binding.reference;
      if (!reference || reference.to.includes(element.rule.name)) continue;
      const read = element.slots.get(name);
      if (!read?.present) continue;
      const value = element.attributes.get(name);
      const names = Array.isArray(value) ? value.map((item) => plain(item)) : [plain(read.value)];
      for (const key of names) {
        if (!this.referencedBy(reference, key)) {
          this.family.report(findingCodes.danglingReference, 'warning', messages.referenceNamesNothing(key, name, reference.to), read.span ?? element.entry.own);
        }
      }
    }
  }

  referencedBy(reference: ReferenceBinding, key: string): ReadElement | undefined {
    return this.elements.find((element) => reference.to.includes(element.rule.name) && plain(element.attributes.get(reference.by)) === key);
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
  if (element.rule.id?.from && element.idRead?.present) return plain(element.idRead.value);
  return element.id;
}
