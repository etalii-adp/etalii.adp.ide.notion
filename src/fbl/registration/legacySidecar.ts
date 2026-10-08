import { bindingOf, bodyOf } from '../documents/types';
import { JsonFamily, quote } from '../families/json/jsonFamily';
import { baseNameOf, folderOf, join } from '../files/paths';
import { SplicedFile } from '../history/splicedFile';
import { messages } from '../messages';
import { resolveOptions } from '../model';
import { formatNumber } from '../planning/newText';
import type { PlanResult } from '../planning/plan';
import type { TreeEntry, TreeValue } from '../rules/treeFamily';
import { BodyText } from '../text/bodyText';
import type { Position } from './registrationDocument';

const json = bindingOf({ name: 'sidecar', body: bodyOf({ family: 'json' }) });

/**
 * A sidecar file hosts wrote before FBL (FBL 8.7): a legacy layout, keyed by view key and then by
 * element id with `{"x", "y"}`, or legacy identities, a natural key mapped to an id. It is read
 * when the registration has no matching block and written back by json splices while it exists;
 * this library never creates one.
 */
export class LegacySidecar extends SplicedFile {
  private reading!: JsonFamily;

  private constructor(bytes: Uint8Array) {
    super(bytes);
    this.reread();
  }

  static open(bytes: Uint8Array): LegacySidecar {
    return new LegacySidecar(bytes);
  }

  /**
   * The sidecar path a registration's binding names (`{base}.layout.json` and the like), with
   * `{base}` the body's base name, beside the body.
   */
  static pathFor(pattern: string, bodyPath: string): string {
    return join(folderOf(bodyPath), pattern.replaceAll('{base}', baseNameOf(bodyPath)));
  }

  /** Whether the sidecar is not one JSON object; it is then neither applied nor written. */
  get isUnreadable(): boolean {
    return this.reading.unreadable !== undefined || this.reading.root?.value.kind !== 'mapping';
  }

  private get root(): TreeValue {
    return this.reading.root!.value;
  }

  /** The positions of one view, its key matched ignoring case (FBL 8.7); without a view, the first. */
  positions(view?: string): ReadonlyMap<string, Position> {
    const positions = new Map<string, Position>();
    const entry = this.view(view);
    if (entry?.value.kind !== 'mapping') return positions;
    for (const element of entry.value.entries) {
      if (element.name === undefined || element.value.kind !== 'mapping') continue;
      const x = numberOf(element.value, 'x');
      const y = numberOf(element.value, 'y');
      if (x !== undefined && y !== undefined) positions.set(element.name, { x, y });
    }
    return positions;
  }

  /** Legacy identities: natural key to id. */
  identities(): ReadonlyMap<string, string> {
    const identities = new Map<string, string>();
    if (this.isUnreadable) return identities;
    for (const entry of this.root.entries) {
      if (entry.name !== undefined && entry.value.kind === 'scalar' && typeof entry.value.typed === 'string') identities.set(entry.name, entry.value.typed);
    }
    return identities;
  }

  /** Places an element in a view: its numbers replaced in place, or a new member at the end of the view's object. */
  planPlace(view: string | undefined, id: string, x: number, y: number): PlanResult {
    if (this.isUnreadable) return { refused: messages.layoutFileUnreadable };
    const xText = formatNumber(x, 3);
    const yText = formatNumber(y, 3);
    const viewEntry = this.view(view);
    if (!viewEntry) {
      if (view === undefined) return { refused: messages.layoutFileNoView };
      return this.insert(this.root, quote(view), (indent) => `{${this.lines(indent, `${quote(id)}: ${this.position(indent + this.step, xText, yText)}`)}}`);
    }
    if (viewEntry.value.kind !== 'mapping') return { refused: messages.layoutFileViewNotObject };
    const existing = viewEntry.value.member(id);
    const xMember = existing?.value.kind === 'mapping' ? existing.value.member('x') : undefined;
    const yMember = existing?.value.kind === 'mapping' ? existing.value.member('y') : undefined;
    if (xMember?.value.kind === 'scalar' && yMember?.value.kind === 'scalar') {
      const text = this.reading.text;
      const splices = [xMember, yMember].flatMap((member, index) => {
        const written = index === 0 ? xText : yText;
        return text.textOf(member.value.span) === written ? [] : [{ operation: 'replace-value' as const, start: member.value.span.start, end: member.value.span.end, text: written }];
      });
      return { planned: { splices } };
    }
    return this.insert(viewEntry.value, quote(id), (indent) => this.position(indent, xText, yText));
  }

  /** Stores an id for a natural key: replaced in place, or a new member at the end of the object. */
  planIdentify(key: string, id: string): PlanResult {
    if (this.isUnreadable) return { refused: messages.identitiesFileUnreadable };
    const existing = this.root.member(key);
    if (existing) {
      const text = quote(id);
      const span = existing.value.span;
      return { planned: { splices: this.reading.text.textOf(span) === text ? [] : [{ operation: 'replace-value', start: span.start, end: span.end, text }] } };
    }
    return this.insert(this.root, quote(key), () => quote(id));
  }

  /** Plans a change with one of the `plan` methods and applies it when it was planned. */
  change(plan: (sidecar: LegacySidecar) => PlanResult): PlanResult {
    const result = plan(this);
    if ('planned' in result) this.apply(result.planned);
    return result;
  }

  protected reread(): void {
    this.reading = new JsonFamily(new BodyText(this.bytes), json, resolveOptions());
    this.reading.parse();
  }

  private view(view: string | undefined): TreeEntry | undefined {
    if (this.isUnreadable) return undefined;
    const members = this.root.entries;
    if (view === undefined) return members[0];
    const wanted = view.toUpperCase();
    return members.find((member) => member.name?.toUpperCase() === wanted);
  }

  /** The indentation step of the file: a member's indentation minus its object's, else two. */
  private get step(): number {
    for (const entry of this.reading.treeEntries) {
      const parent = entry.parent as TreeEntry | undefined;
      if (parent && !parent.isRoot && entry.lineSpan && parent.lineSpan && entry.indent > parent.indent) return entry.indent - parent.indent;
    }
    return 2;
  }

  private get newline(): string {
    return this.reading.text.dominantEnding ?? '\n';
  }

  private lines(indent: number, member: string): string {
    return `${this.newline}${' '.repeat(indent + this.step)}${member}${this.newline}${' '.repeat(indent)}`;
  }

  private position(indent: number, x: string, y: string): string {
    const inner = ' '.repeat(indent + this.step);
    return `{${this.newline}${inner}"x": ${x},${this.newline}${inner}"y": ${y}${this.newline}${' '.repeat(indent)}}`;
  }

  /** A new member after the object's last, written as the file writes its members (FBL 6.3, json values). */
  private insert(container: TreeValue, key: string, value: (indent: number) => string): PlanResult {
    if (container.entries.length === 0) {
      const column = this.column(container.span.start);
      const indent = column + this.step;
      const text = `${this.newline}${' '.repeat(indent)}${key}: ${value(indent)}${this.newline}${' '.repeat(column)}`;
      return { planned: { splices: [{ operation: 'insert-entry', start: container.span.start + 1, end: container.span.start + 1, text }] } };
    }
    const last = container.entries[container.entries.length - 1];
    const text = last.lineSpan
      ? `,${this.newline}${' '.repeat(last.indent)}${key}: ${value(last.indent)}`
      : `, ${key}: ${value(last.indent)}`;
    return { planned: { splices: [{ operation: 'insert-entry', start: last.own.end, end: last.own.end, text }] } };
  }

  private column(offset: number): number {
    const text = this.reading.text;
    return offset - text.lines[text.lineIndexAt(offset)].start;
  }
}

function numberOf(mapping: TreeValue, key: string): number | undefined {
  const typed = mapping.member(key)?.value.typed;
  return typeof typed === 'bigint' ? Number(typed) : typeof typed === 'number' ? typed : undefined;
}
