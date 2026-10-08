import { messages } from '../messages';
import { applySplices, type Edit, type FblSplice } from '../splice';
import { digestOf } from './digest';
import { EditHistory } from './editHistory';

/** FBL 7.2's sentence for an undo refused because the file changed underneath it. */
export const driftUndo = messages.driftUndo;

export const driftRedo = messages.driftRedo;

/** What an undo or a redo did: the splices it applied, or why it was refused. */
export type UndoResult = { readonly done: readonly FblSplice[] } | { readonly refused: string };

/**
 * A file written only by splices, with the one history of its edits (FBL 7.1): a body, or a
 * registration. Applying an edit applies its splices and reads the file again. Undo and redo check
 * for drift first and refuse with FBL 7.2's sentence, writing nothing.
 */
export abstract class SplicedFile {
  private readonly history = new EditHistory();
  private current: Uint8Array;

  protected constructor(bytes: Uint8Array) {
    this.current = bytes;
  }

  /** The file's bytes after every applied edit. */
  get bytes(): Uint8Array {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Applies an edit planned against the current bytes, records it, and reads the file again. */
  apply(edit: Edit): void {
    if (edit.splices.length === 0) return;
    const before = this.current;
    const after = applySplices(before, edit.splices);
    this.history.record(before, after, edit);
    this.replace(after);
  }

  /**
   * Undoes the most recent edit. `current` is the file as it is now on disk or in another editor's
   * buffer; when it differs from what the history expects, the undo is refused and nothing is written.
   */
  undo(current?: Uint8Array): UndoResult {
    if (!this.history.canUndo) return { refused: messages.nothingToUndo };
    const entry = this.history.peekUndo();
    if (digestOf(current ?? this.current) !== entry.afterDigest) return { refused: driftUndo };
    this.history.undone();
    this.replace(entry.snapshot ?? applySplices(this.current, entry.inverse));
    return { done: entry.inverse };
  }

  /** Redoes the most recently undone edit, refused on drift as an undo is. */
  redo(current?: Uint8Array): UndoResult {
    if (!this.history.canRedo) return { refused: messages.nothingToRedo };
    const entry = this.history.peekRedo();
    if (digestOf(current ?? this.current) !== entry.beforeDigest) return { refused: driftRedo };
    this.history.redone();
    this.replace(applySplices(this.current, entry.edit.splices));
    return { done: entry.edit.splices };
  }

  /** Replaces the bytes after an external change the host has accepted (FBL 7.3): reads again and clears the history. */
  reload(bytes: Uint8Array): void {
    this.history.clear();
    this.replace(bytes);
  }

  /** Called whenever the bytes change, to read them again. */
  protected abstract reread(): void;

  private replace(bytes: Uint8Array): void {
    this.current = bytes;
    this.reread();
  }
}
