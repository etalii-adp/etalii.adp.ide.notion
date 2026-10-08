import { SplicedFile } from '../history/splicedFile';
import { messages } from '../messages';
import type { ModelChange } from '../planning/modelChange';
import { formatNumber } from '../planning/newText';
import type { PlanResult } from '../planning/plan';
import type { Span } from '../span';
import { emptyEdit, type FblSplice } from '../splice';
import type { BodyText } from '../text/bodyText';
import { encode } from '../text/utf8';
import { RegistrationDocument, type RegistrationBlock, type RegistrationEntry } from './registrationDocument';

/**
 * An open registration (FBL 8): its bytes, its line form, and its own history. Placing an element
 * writes its layout entry by splices, in the ordinal order of ids, with numbers in `{decimals: 3}`
 * form and the registration's own line ending (FBL 8.3).
 */
export class OpenRegistration extends SplicedFile {
  private read: RegistrationDocument;

  /**
   * The ids the reading has, when known. A layout entry for any other id is stale and is removed as
   * part of the next placement (FBL 8.5).
   */
  knownIds: ReadonlySet<string> | undefined;

  /** The natural keys the reading has, when known: an `identities` entry for any other key is stale (FBL 8.6). */
  knownKeys: ReadonlySet<string> | undefined;

  /** Whether DISL marks an id ephemeral: such an element's position is never stored (FBL 8.5). */
  isEphemeral: (id: string) => boolean = () => false;

  private constructor(bytes: Uint8Array) {
    super(bytes);
    this.read = RegistrationDocument.read(bytes);
  }

  static open(bytes: Uint8Array): OpenRegistration {
    return new OpenRegistration(bytes);
  }

  get document(): RegistrationDocument {
    return this.read;
  }

  plan(change: ModelChange): PlanResult {
    switch (change.kind) {
      case 'save':
        return { planned: emptyEdit };
      case 'place':
        if (this.isEphemeral(change.id)) return { refused: messages.ephemeralPosition(change.id) };
        return { planned: { splices: this.planPlace(change.id, change.x, change.y) } };
      case 'identify':
        return { planned: { splices: this.planIdentify(change.key, change.id) } };
      default:
        throw new Error(messages.registrationChange);
    }
  }

  change(change: ModelChange): PlanResult {
    const result = this.plan(change);
    if ('planned' in result) this.apply(result.planned);
    return result;
  }

  protected reread(): void {
    this.read = RegistrationDocument.read(this.bytes);
  }

  private planPlace(id: string, placedX: number, placedY: number): FblSplice[] {
    const document = this.read;
    const x = formatNumber(placedX, 3);
    const y = formatNumber(placedY, 3);
    return this.planEntry(document.layout, 'layout', document.afterHeaders, this.knownIds, id, `${x} ${y}`, (existing) => {
      const text = document.text;
      const parts = numbersIn(text, existing.valueSpan);
      if (parts.length !== 2) return [{ operation: 'replace-value', start: existing.valueSpan.start, end: existing.valueSpan.end, text: `${x} ${y}` }];
      const splices: FblSplice[] = [];
      if (text.textOf(parts[0]) !== x) splices.push({ operation: 'replace-value', start: parts[0].start, end: parts[0].end, text: x });
      if (text.textOf(parts[1]) !== y) splices.push({ operation: 'replace-value', start: parts[1].start, end: parts[1].end, text: y });
      return splices;
    });
  }

  private planIdentify(key: string, id: string): FblSplice[] {
    const document = this.read;
    const after = document.layout ? document.layout.span.end : document.afterHeaders;
    return this.planEntry(document.identities, 'identities', after, this.knownKeys, key, id, (existing) =>
      (document.text.textOf(existing.valueSpan) === id ? [] : [{ operation: 'replace-value', start: existing.valueSpan.start, end: existing.valueSpan.end, text: id }]));
  }

  /**
   * Writes one entry of a block (FBL 8.3, 8.6): its value replaced in place when it exists, else
   * inserted in the ordinal order of keys, creating the block at `createAt` first; stale entries
   * (keys not in `known`) are removed in the same edit (FBL 8.5).
   */
  private planEntry(
    block: RegistrationBlock | undefined, name: string, createAt: number, known: ReadonlySet<string> | undefined,
    key: string, value: string, replace: (existing: RegistrationEntry) => FblSplice[],
  ): FblSplice[] {
    const text = this.read.text;
    const lastLine = text.lines[text.lines.length - 1];
    const splices: FblSplice[] = [];
    const stale = !block || !known ? [] : block.entries.filter((entry) => entry.key !== key && !known.has(entry.key));
    for (const entry of stale) splices.push({ operation: 'remove-entry', start: entry.line.start, end: entry.line.end, text: '' });
    const existing = block?.entries.find((entry) => entry.key === key);
    if (existing) {
      splices.push(...replace(existing));
      return ordered(splices);
    }
    if (!block) {
      const offset = createAt;
      const newline = text.newlineAt(Math.max(0, offset - 1), '\n');
      const lead = offset === text.length && lastLine.ending.length === 0 && offset > 0;
      if (lead) {
        splices.push({ operation: 'ensure-container', start: offset, end: offset, text: `${newline}${name}:` });
        splices.push({ operation: 'insert-entry', start: offset, end: offset, text: `${newline}  ${key}: ${value}` });
      } else {
        splices.push({ operation: 'ensure-container', start: offset, end: offset, text: `${name}:${newline}` });
        splices.push({ operation: 'insert-entry', start: offset, end: offset, text: `  ${key}: ${value}${newline}` });
      }
      return splices;
    }
    const kept = block.entries.filter((entry) => !stale.includes(entry));
    const next = kept.find((entry) => compareUtf8(entry.key, key) > 0);
    const indent = ' '.repeat(kept[0]?.indent ?? 2);
    const at = next ? next.line.start : kept[kept.length - 1]?.line.end ?? block.nameLine.end;
    const ending = text.newlineAt(Math.max(0, at - 1), '\n');
    const entryText = at === text.length && lastLine.ending.length === 0
      ? `${ending}${indent}${key}: ${value}`
      : `${indent}${key}: ${value}${ending}`;
    splices.push({ operation: 'insert-entry', start: at, end: at, text: entryText });
    return ordered(splices);
  }
}

const ordered = (splices: FblSplice[]): FblSplice[] =>
  splices.map((splice, index) => ({ splice, index })).sort((a, b) => a.splice.start - b.splice.start || a.index - b.index).map(({ splice }) => splice);

/** The spans of the numbers of a layout entry's value, separated by spaces. */
function numbersIn(text: BodyText, value: Span): Span[] {
  const spans: Span[] = [];
  let i = value.start;
  while (i < value.end) {
    while (i < value.end && text.bytes[i] === 0x20) i++;
    const start = i;
    while (i < value.end && text.bytes[i] !== 0x20) i++;
    if (i > start) spans.push({ start, end: i });
  }
  return spans;
}

/** Ordinal order of ids: byte order of their UTF-8 encoding (FBL 8.3). */
export function compareUtf8(a: string, b: string): number {
  const left = encode(a);
  const right = encode(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
