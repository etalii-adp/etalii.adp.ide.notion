import { messages } from '../messages';
import type { Reading, SplicePlan } from '../rules/familyReader';
import type { Span } from '../span';
import { spliceText, type Edit, type FblSplice, type SpliceOperation } from '../splice';

/** What planning a change gives: an edit to apply, or the reason it cannot be made (FBL 6.4). */
export type PlanResult = { readonly planned: Edit } | { readonly refused: string };

/** The splices of one edit while it is being planned, against the body before the edit. */
export class Plan implements SplicePlan {
  private readonly splices: FblSplice[] = [];

  snapshot = false;

  constructor(readonly reading: Reading) {}

  add(operation: SpliceOperation, start: number, end: number, text: string): void {
    if (start === end && text.length === 0) return;
    this.splices.push({ operation, start, end, text });
  }

  addAt(operation: SpliceOperation, range: Span, text: string): void {
    this.add(operation, range.start, range.end, text);
  }

  /** Whether a splice already replaces bytes overlapping `range`. */
  touches(range: Span): boolean {
    return this.splices.some((splice) => splice.start < range.end && range.start < splice.end);
  }

  /**
   * The splices in body order: sorted by start, those at one offset kept in the order they were
   * planned (FBL 6.5). Overlapping splices are a planning error.
   *
   * An insertion at the offset where a replaced span starts goes before that span: new text
   * written where an old key is taken out (a value that becomes another key's) is an insertion in
   * front of the removal, whichever of the two was planned first.
   */
  ordered(): FblSplice[] {
    const inserts = (splice: FblSplice): number => (splice.start === splice.end ? 0 : 1);
    const ordered = this.splices
      .map((splice, index) => ({ splice, index }))
      .sort((a, b) => a.splice.start - b.splice.start || inserts(a.splice) - inserts(b.splice) || a.index - b.index)
      .map((entry) => entry.splice);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].start < ordered[i - 1].end) throw new Error(messages.twoSplicesOverlap(spliceText(ordered[i - 1]), spliceText(ordered[i])));
    }
    return ordered;
  }
}
