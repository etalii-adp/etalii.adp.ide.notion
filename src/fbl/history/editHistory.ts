import { inverseSplices, type Edit, type FblSplice } from '../splice';
import { digestOf } from './digest';

/** One recorded edit: its splices, those that undo it, the digests of the body before and after, and the body before for a snapshot. */
export interface HistoryEntry {
  readonly edit: Edit;
  readonly inverse: readonly FblSplice[];
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly snapshot?: Uint8Array;
}

/**
 * The history of one body (FBL 7.1): each edit with the splices that undo it and the digests of
 * the body before and after it. A snapshot edit keeps the whole body before it as well; its undo
 * gives the same bytes as the inverse splices.
 */
export class EditHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(before: Uint8Array, after: Uint8Array, edit: Edit): void {
    this.undoStack.push({
      edit,
      inverse: inverseSplices(before, edit.splices),
      beforeDigest: digestOf(before),
      afterDigest: digestOf(after),
      snapshot: edit.snapshot ? before : undefined,
    });
    this.redoStack.length = 0;
  }

  peekUndo(): HistoryEntry {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): HistoryEntry {
    return this.redoStack[this.redoStack.length - 1];
  }

  undone(): void {
    this.redoStack.push(this.undoStack.pop()!);
  }

  redone(): void {
    this.undoStack.push(this.redoStack.pop()!);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
