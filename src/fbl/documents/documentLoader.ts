import { CelException, compileCel, type CelContext } from '../expressions/cel';
import { checkRegex } from '../expressions/regexSubset';
import type { FblFiles } from '../files/fblFiles';
import { folderOf, join } from '../files/paths';
import { messages } from '../messages';
import { isAsciiLetter, isAsciiLetterOrDigit } from '../text/utf8';
import { JsonSyntaxError, memberOf, pointerToken, readJson, scalarText, type JsonNode } from './jsonReader';
import {
  allRules, defaultText,
  type AttributeBinding, type BlockRule, type BodySettings, type Claims, type CreateChild, type CreateContainer, type Family, type FblBinding, type FblDocument,
  type IdBinding, type InsertSettings, type Marker, type ParentBinding, type PluginReader, type ReadingClaim, type ReferenceBinding, type RegistrationSettings,
  type RemoveSettings, type Rule, type Slot, type TextDefaults,
} from './types';

/** A problem in an FBL document, at the JSON Pointer of its location (FBL 14.1). */
export interface LoadProblem {
  readonly pointer: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface Loaded {
  /** The document, when it loaded without an error. */
  readonly document?: FblDocument;
  readonly problems: readonly LoadProblem[];
}

export const supportedMajor = 0;

const error = (pointer: string, message: string): LoadProblem => ({ pointer, severity: 'error', message });

/**
 * Loads an FBL document as FBL 14.1 says, apart from validating against the JSON Schema (left to
 * etalii.adp's own checks): parse rejecting duplicate keys, check the version, map every construct,
 * resolve names, compile every regular expression and CEL expression, and check the rules. Every
 * problem is collected; a document with an error yields no document.
 */
export function loadDocument(json: Uint8Array, path?: string): Loaded {
  const problems: LoadProblem[] = [];
  let root: JsonNode;
  try {
    root = readJson(json, json.length >= 3 && json[0] === 0xef && json[1] === 0xbb && json[2] === 0xbf ? 3 : 0);
  } catch (failure) {
    if (!(failure instanceof JsonSyntaxError)) throw failure;
    return { problems: [error('', messages.notJson(failure.message))] };
  }
  duplicateKeys(root, problems);
  if (problems.length > 0) return { problems };

  if (root.kind !== 'object') return { problems: [error('', messages.documentNotObject)] };
  const version = str(root, 'fbl');
  if (version === undefined) return { problems: [error('/fbl', messages.noVersion)] };
  const parts = version.split('.');
  if (parts.length < 2 || !/^[0-9]+$/.test(parts[0]) || !/^[0-9]+$/.test(parts[1])) return { problems: [error('/fbl', messages.notAVersion(version))] };
  if (Number(parts[0]) !== supportedMajor) return { problems: [error('/fbl', messages.versionNotSupported(version, supportedMajor))] };
  if (Number(parts[1]) > 1) problems.push({ pointer: '/fbl', severity: 'warning', message: messages.versionNewer(version) });
  const bindings = memberOf(root, 'bindings');
  if (bindings?.kind !== 'object' || bindings.members.length === 0) {
    problems.push(error('/bindings', messages.noBindings));
    return { problems };
  }

  const result = new Map<string, FblBinding>();
  for (const property of bindings.members) {
    const pointer = `/bindings/${pointerToken(property.name)}`;
    if (!isName(property.name)) problems.push(error(pointer, messages.bindingName(property.name)));
    const binding = readBinding(property.name, property.value, pointer, problems);
    if (binding) {
      checkBinding(binding, pointer, problems);
      result.set(property.name, binding);
    }
  }
  if (problems.some((problem) => problem.severity === 'error')) return { problems };
  return { document: { version, path, bindings: result }, problems };
}

/** Loads the FBL document at a path; a file that cannot be read is a problem, not an exception. */
export function loadDocumentAt(path: string, files: FblFiles): Loaded {
  const bytes = files.read(path);
  if (!bytes) return { problems: [error('', messages.notJson(`'${path}' cannot be read.`))] };
  return loadDocument(bytes, path);
}

/** Resolves a binding reference, `doc.fbl#name` or `#name`, against `referrer` (FBL 2.3). Throws when it resolves to nothing. */
export function resolveReference(reference: string, referrer: string, files: FblFiles): FblBinding {
  const hash = reference.lastIndexOf('#');
  if (hash < 0) throw new Error(messages.notAReference(reference));
  const file = reference.slice(0, hash);
  const name = reference.slice(hash + 1);
  const path = file.length === 0 ? referrer : join(folderOf(referrer), file);
  const { document, problems } = loadDocumentAt(path, files);
  if (!document) {
    const listed = problems.map((problem) => messages.loadProblem(problem.severity === 'error' ? 'Error' : 'Warning', problem.pointer, problem.message));
    throw new Error(messages.documentDoesNotLoad(path, listed.join('; ')));
  }
  const binding = document.bindings.get(name);
  if (!binding) throw new Error(messages.documentHasNoBinding(path, name));
  return binding;
}

/** A duplicate key anywhere in the document, at its pointer (FBL 2.1). */
function duplicateKeys(node: JsonNode, problems: LoadProblem[]): void {
  if (node.kind === 'object') {
    for (const member of node.members) {
      if (member.duplicate) problems.push(error(`${node.pointer}/${pointerToken(member.name)}`, messages.keyTwice(member.name)));
      duplicateKeys(member.value, problems);
    }
  } else if (node.kind === 'array') {
    for (const item of node.items) duplicateKeys(item.value, problems);
  }
}

function isName(name: string): boolean {
  if (name.length === 0) return false;
  if (!(isAsciiLetter(name[0]) || name[0] === '_')) return false;
  for (const c of name) {
    if (!(isAsciiLetterOrDigit(c) || c === '_' || c === '.' || c === '-')) return false;
  }
  return true;
}

// ---- reading the JSON ----

const str = (json: JsonNode | undefined, name: string): string | undefined => {
  const value = memberOf(json, name);
  return value?.kind === 'string' ? value.value : undefined;
};

const bool = (json: JsonNode | undefined, name: string): boolean => memberOf(json, name)?.kind === 'true';

const integer = (json: JsonNode | undefined): number | undefined => (json?.kind === 'number' && /^-?[0-9]+$/.test(json.raw) ? Number(json.raw) : undefined);

function strings(json: JsonNode | undefined, name: string): string[] {
  const value = memberOf(json, name);
  if (value?.kind !== 'array') return [];
  return value.items.flatMap((item) => (item.value.kind === 'string' ? [item.value.value] : []));
}

const optionalStrings = (json: JsonNode | undefined, name: string): string[] | undefined => (memberOf(json, name) ? strings(json, name) : undefined);

function array(json: JsonNode | undefined, name: string): JsonNode[] {
  const value = memberOf(json, name);
  return value?.kind === 'array' ? value.items.map((item) => item.value) : [];
}

const members = (json: JsonNode | undefined): readonly { name: string; value: JsonNode }[] => (json?.kind === 'object' ? json.members.filter((member) => !member.duplicate) : []);

const stringOf = (json: JsonNode | undefined): string | undefined => (json?.kind === 'string' ? json.value : undefined);

/** A text that may be written for several languages: the English one, else the first. */
function localized(json: JsonNode | undefined): string | undefined {
  if (!json) return undefined;
  if (json.kind === 'string') return json.value;
  return str(json, 'en') ?? stringOf(members(json)[0]?.value);
}

function readOnlyOf(json: JsonNode): string | undefined {
  const value = memberOf(json, 'readOnly');
  switch (value?.kind) {
    case 'true': return '';
    case 'string': return value.value;
    case 'object': return localized(value);
    default: return undefined;
  }
}

export function parseFamily(name: string | undefined): Family | undefined {
  return name === 'yaml' || name === 'json' || name === 'xml' || name === 'lines' || name === 'blocks' ? name : undefined;
}

/** Maps a binding's JSON onto the typed values, reporting what it cannot map. */
function readBinding(name: string, json: JsonNode, pointer: string, problems: LoadProblem[]): FblBinding | undefined {
  if (json.kind !== 'object') {
    problems.push(error(pointer, messages.bindingNotObject));
    return undefined;
  }
  const claims = memberOf(json, 'claims');
  const body = memberOf(json, 'body');
  const reader = memberOf(json, 'reader');
  if (!claims) problems.push(error(`${pointer}/claims`, messages.bindingClaims));
  if (!body) problems.push(error(`${pointer}/body`, messages.bindingBody));
  if (!reader) problems.push(error(`${pointer}/reader`, messages.bindingReader));
  if (problems.some((problem) => problem.severity === 'error' && problem.pointer.startsWith(pointer))) return undefined;

  let plugin: PluginReader | undefined;
  if (reader!.kind === 'object') plugin = { plugin: str(reader, 'plugin') ?? '', version: str(reader, 'version'), args: memberOf(reader, 'args') };
  else if (reader!.kind !== 'string' || reader!.value !== 'declared') problems.push(error(`${pointer}/reader`, messages.readerKind));

  const header = memberOf(json, 'header');
  const template = memberOf(json, 'template');
  return {
    name,
    title: localized(memberOf(json, 'title')),
    claims: readClaims(claims!),
    body: readBody(body!, `${pointer}/body`, problems),
    plugin,
    readOnly: readOnlyOf(json),
    text: readText(json),
    header: header ? { key: str(header, 'key'), value: memberOf(header, 'value'), line: str(header, 'line'), required: bool(header, 'required') } : undefined,
    comment: str(json, 'comment'),
    reportUnmatched: str(json, 'unmatched') === 'report',
    blocks: array(json, 'blocks').map((block): BlockRule => ({
      name: str(block, 'name') ?? '', line: str(block, 'line') ?? '', within: optionalStrings(block, 'within'), caseInsensitive: bool(block, 'caseInsensitive'), view: str(block, 'view'),
    })),
    elements: array(json, 'elements').map((rule) => readRule(rule, false)),
    relations: array(json, 'relations').map((rule) => readRule(rule, true)),
    registration: readRegistration(json),
    template: template
      ? { text: str(template, 'text') ?? '', byOrigin: new Map(members(memberOf(template, 'byOrigin')).map((member) => [member.name, stringOf(member.value) ?? ''])) }
      : undefined,
  };
}

function readClaims(json: JsonNode): Claims {
  const markerJson = memberOf(json, 'marker');
  const marker: Marker | undefined = markerJson
    ? { rootKey: str(markerJson, 'rootKey'), rootValue: memberOf(markerJson, 'value'), firstLine: str(markerJson, 'firstLine'), pattern: str(markerJson, 'pattern'), lines: integer(memberOf(markerJson, 'lines')) ?? 20 }
    : undefined;
  const readings = new Map<string, ReadingClaim>();
  for (const member of members(memberOf(json, 'readings'))) {
    readings.set(member.name, { bare: bool(member.value, 'bare'), suggest: strings(memberOf(member.value, 'suggest'), 'contains') });
  }
  return {
    extensions: strings(json, 'extensions'),
    names: strings(json, 'names'),
    shared: bool(json, 'shared'),
    registrationOnly: bool(json, 'registrationOnly'),
    marker,
    suggest: strings(memberOf(json, 'suggest'), 'contains'),
    origins: strings(json, 'origins'),
    readings,
  };
}

function readBody(json: JsonNode, pointer: string, problems: LoadProblem[]): BodySettings {
  const kind = str(json, 'kind');
  if (kind !== 'file' && kind !== 'folder') problems.push(error(`${pointer}/kind`, messages.bodyKind));
  const recognise = memberOf(json, 'recognise');
  return {
    isFolder: kind === 'folder',
    family: parseFamily(str(json, 'family')),
    alsoRead: strings(json, 'alsoRead').flatMap((name) => parseFamily(name) ?? []),
    recogniseAll: strings(recognise, 'all'),
    recogniseAny: strings(recognise, 'any'),
    recogniseNone: strings(recognise, 'none'),
    files: array(json, 'files').map((file) => ({ name: str(file, 'name'), glob: str(file, 'glob') ?? '', family: parseFamily(str(file, 'family')), readOnly: bool(file, 'readOnly') })),
    ignore: strings(json, 'ignore'),
    settle: integer(memberOf(json, 'settle')) ?? 400,
  };
}

function readText(json: JsonNode): TextDefaults {
  const text = memberOf(json, 'text');
  if (!text) return defaultText;
  const indent = memberOf(text, 'indent');
  const newline = str(text, 'newline');
  return {
    newline: newline === 'crlf' ? '\r\n' : newline === 'cr' ? '\r' : '\n',
    // A number of spaces, or "tab".
    indent: indent ? (indent.kind === 'number' ? Number(indent.raw) : 0) : 2,
    sequenceFlush: str(text, 'sequenceIndent') === 'flush',
    finalNewline: memberOf(text, 'finalNewline')?.kind !== 'false',
    quote: str(text, 'quote') ?? 'double',
  };
}

function readRule(json: JsonNode, relation: boolean): Rule {
  const idJson = memberOf(json, 'id');
  const from = memberOf(idJson, 'from');
  const id: IdBinding | undefined = idJson ? { from: from ? readSlot(from) : undefined, sidecarKey: str(memberOf(idJson, 'sidecar'), 'key') } : undefined;
  const parentJson = memberOf(json, 'parent');
  const parent: ParentBinding | undefined = parentJson ? { rules: strings(parentJson, 'rules'), slot: str(parentJson, 'slot') } : undefined;
  const attributes = members(memberOf(json, 'attributes')).map((member) => [member.name, readAttribute(member.value)] as const);

  let insert: InsertSettings | undefined;
  const insertJson = memberOf(json, 'insert');
  if (insertJson) {
    const placeJson = memberOf(insertJson, 'place');
    const createJson = memberOf(insertJson, 'create');
    let create: CreateContainer | undefined;
    if (createJson) {
      const at = memberOf(createJson, 'at');
      const first = members(at)[0];
      create = at?.kind === 'string'
        ? { at: at.value, text: str(createJson, 'text') }
        : { at: first?.name ?? '', argument: stringOf(first?.value), text: str(createJson, 'text') };
    }
    insert = {
      place: placeJson?.kind === 'object' ? 'before' : stringOf(placeJson) ?? 'end',
      placeBefore: placeJson?.kind === 'object' ? str(placeJson, 'before') : undefined,
      container: str(insertJson, 'container'),
      create,
      keys: strings(insertJson, 'keys'),
      emit: str(insertJson, 'emit'),
      skeleton: str(insertJson, 'skeleton'),
      when: str(insertJson, 'when'),
    };
  }
  const removeJson = memberOf(json, 'remove');
  const remove: RemoveSettings | undefined = removeJson ? { cascade: strings(removeJson, 'cascade'), removeContainerWhenEmpty: str(removeJson, 'container') === 'remove-when-empty' } : undefined;
  const source = memberOf(json, 'source');
  const target = memberOf(json, 'target');
  return {
    name: str(json, 'name') ?? '',
    type: str(json, 'type') ?? '',
    isRelation: relation,
    at: str(json, 'at'),
    line: str(json, 'line'),
    within: optionalStrings(json, 'within'),
    opens: bool(json, 'opens'),
    caseInsensitive: bool(json, 'caseInsensitive'),
    files: strings(json, 'files'),
    when: str(json, 'when'),
    id,
    parent,
    attributes,
    source: source ? readAttribute(source) : undefined,
    target: target ? readAttribute(target) : undefined,
    insert,
    remove,
    snapshotUndo: str(json, 'undo') === 'snapshot',
    readOnly: readOnlyOf(json),
  };
}

function readSlot(json: JsonNode): Slot {
  return {
    key: str(json, 'key'),
    attribute: str(json, 'attribute'),
    text: bool(json, 'text'),
    child: str(json, 'child'),
    group: str(json, 'group'),
    parent: str(json, 'parent'),
    capture: str(json, 'capture'),
    value: str(json, 'value'),
    word: str(json, 'word'),
    flag: bool(json, 'flag'),
  };
}

function readAttribute(json: JsonNode): AttributeBinding {
  const mapJson = memberOf(json, 'map');
  const createJson = memberOf(json, 'create');
  let create: CreateChild | undefined;
  if (createJson) {
    const place = memberOf(createJson, 'place');
    create = place?.kind === 'object'
      ? { emit: str(createJson, 'emit') ?? '', place: 'before', before: str(place, 'before') }
      : { emit: str(createJson, 'emit') ?? '', place: stringOf(place) ?? 'last' };
  }
  const referenceJson = memberOf(json, 'reference');
  const reference: ReferenceBinding | undefined = referenceJson ? { to: strings(referenceJson, 'to'), by: str(referenceJson, 'by') ?? '' } : undefined;
  const override = memberOf(json, 'override');
  return {
    ...readSlot(json),
    empty: str(json, 'empty'),
    absent: new Map(members(memberOf(json, 'absent')).map((member) => [member.name, stringOf(member.value) ?? 'insert'])),
    default: memberOf(json, 'default'),
    decimals: integer(memberOf(memberOf(json, 'number'), 'decimals')),
    keepTimePrecision: str(json, 'time') === 'keep-precision',
    style: str(json, 'style'),
    reference,
    map: mapJson?.kind === 'object' ? members(mapJson).map((member) => [member.name, scalarText(member.value)] as const) : undefined,
    override: override ? readSlot(override) : undefined,
    htmlParagraphs: str(json, 'content') === 'html-paragraphs',
    create,
    readOnly: readOnlyOf(json),
  };
}

function readRegistration(json: JsonNode): RegistrationSettings {
  const registration = memberOf(json, 'registration');
  return {
    headers: members(memberOf(registration, 'headers')).map((member) => member.name),
    createOnFirstPlacement: bool(registration, 'createOnFirstPlacement'),
    resourceCapture: str(memberOf(registration, 'resource'), 'capture'),
    legacyLayout: str(registration, 'legacyLayout'),
    legacyIdentities: str(registration, 'legacyIdentities'),
  };
}

// ---- the checks of FBL 14.1, steps 4 to 6, that need no DISL specification ----

function checkBinding(binding: FblBinding, pointer: string, problems: LoadProblem[]): void {
  const rules = allRules(binding);
  const names = new Set<string>();
  const ruleNames = new Set([...rules.map((rule) => rule.name), ...binding.blocks.map((block) => block.name)]);
  const fileRules = new Set(binding.body.files.flatMap((file) => file.name ?? []));

  binding.blocks.forEach((block, index) => {
    const at = `${pointer}/blocks/${index}`;
    if (names.has(block.name)) problems.push(error(`${at}/name`, messages.ruleNameTwice(block.name)));
    names.add(block.name);
    checkExpression(block.line, `${at}/line`, problems);
    checkWithin(block.within, ruleNames, `${at}/within`, problems);
  });

  const elementCount = binding.elements.length;
  rules.forEach((rule, index) => {
    const at = rule.isRelation ? `${pointer}/relations/${index - elementCount}` : `${pointer}/elements/${index}`;
    if (!isName(rule.name)) problems.push(error(`${at}/name`, messages.ruleName(rule.name)));
    if (names.has(rule.name)) problems.push(error(`${at}/name`, messages.ruleNameTwice(rule.name)));
    names.add(rule.name);
    if ((rule.at === undefined) === (rule.line === undefined) && !binding.plugin) problems.push(error(at, messages.atOrLine));
    if (rule.line !== undefined) checkExpression(rule.line, `${at}/line`, problems);
    checkWithin(rule.within, ruleNames, `${at}/within`, problems);
    for (const file of rule.files) {
      if (!fileRules.has(file)) problems.push(error(`${at}/files`, messages.noFileRule(file)));
    }
    for (const name of rule.parent?.rules ?? []) requireRule(name, rules, `${at}/parent/rules`, problems);
    for (const name of rule.remove?.cascade ?? []) requireRule(name, rules, `${at}/remove/cascade`, problems);
    const context: CelContext = rule.at !== undefined ? 'tree' : 'lines';
    compile(rule.when, context, `${at}/when`, problems);
    compile(rule.insert?.when, 'insert', `${at}/insert/when`, problems);
    if (rule.id?.from) checkSlot(rule.id.from, context, `${at}/id/from`, problems);
    if (rule.id?.sidecarKey !== undefined) compile(rule.id.sidecarKey, context, `${at}/id/sidecar/key`, problems);
    if (rule.isRelation && (!rule.source || !rule.target)) problems.push(error(at, messages.relationEnds));
    for (const [name, attribute] of rule.attributes) {
      const a = `${at}/attributes/${pointerToken(name)}`;
      checkSlot(attribute, context, a, problems);
      for (const to of attribute.reference?.to ?? []) requireRule(to, rules, `${a}/reference/to`, problems);
      if (attribute.override) checkSlot(attribute.override, context, `${a}/override`, problems);
      if (countSlots(attribute) !== 1) problems.push(error(a, messages.oneSlot));
    }
    if (rule.source) checkSlot(rule.source, context, `${at}/source`, problems);
    if (rule.target) checkSlot(rule.target, context, `${at}/target`, problems);
  });

  if (!binding.plugin) {
    if (!binding.body.isFolder && binding.body.family === undefined) problems.push(error(`${pointer}/body/family`, messages.familyMissing));
    if (rules.length === 0) problems.push(error(pointer, messages.noRules));
  } else if (rules.length > 0) {
    problems.push(error(pointer, messages.pluginWithRules));
  }
  if (binding.claims.shared && !binding.claims.marker && !binding.claims.registrationOnly) problems.push(error(`${pointer}/claims`, messages.sharedClaim));
  if ([...binding.claims.readings.values()].filter((reading) => reading.bare).length > 1) problems.push(error(`${pointer}/claims/readings`, messages.oneBare));
  if (binding.comment !== undefined) checkExpression(binding.comment, `${pointer}/comment`, problems);
  if (binding.header?.line !== undefined) checkExpression(binding.header.line, `${pointer}/header/line`, problems);
  if (binding.claims.marker?.pattern !== undefined) checkExpression(binding.claims.marker.pattern, `${pointer}/claims/marker/pattern`, problems);
}

const countSlots = (slot: Slot): number =>
  [slot.key !== undefined, slot.attribute !== undefined, slot.text, slot.group !== undefined, slot.parent !== undefined, slot.capture !== undefined, slot.value !== undefined].filter(Boolean).length;

function checkSlot(slot: Slot, context: CelContext, pointer: string, problems: LoadProblem[]): void {
  if (slot.value !== undefined) compile(slot.value, context, `${pointer}/value`, problems);
  if (slot.word !== undefined) checkExpression(slot.word, `${pointer}/word`, problems);
}

function requireRule(name: string, rules: readonly Rule[], pointer: string, problems: LoadProblem[]): void {
  if (rules.every((rule) => rule.name !== name)) problems.push(error(pointer, messages.noRule(name)));
}

function checkWithin(within: readonly string[] | undefined, names: ReadonlySet<string>, pointer: string, problems: LoadProblem[]): void {
  for (const name of within ?? []) {
    if (name !== '^' && !names.has(name)) problems.push(error(pointer, messages.noRule(name)));
  }
}

function checkExpression(expression: string, pointer: string, problems: LoadProblem[]): void {
  const problem = checkRegex(expression);
  if (problem !== undefined) problems.push(error(pointer, problem));
}

function compile(expression: string | undefined, context: CelContext, pointer: string, problems: LoadProblem[]): void {
  if (expression === undefined) return;
  try {
    compileCel(expression, context);
  } catch (failure) {
    if (!(failure instanceof CelException)) throw failure;
    problems.push(error(pointer, failure.message));
  }
}
