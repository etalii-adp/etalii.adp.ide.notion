import type { Command, CommandResult, HistoryEntry } from './command';
import type { Dispatcher } from './dispatcher';

export interface HistoryStack {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  run(command: Command): CommandResult;
  undo(): CommandResult;
  redo(): CommandResult;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createHistoryStack(dispatcher: Dispatcher): HistoryStack {
  // Both newest last.
  const undoEntries: HistoryEntry[] = [];
  const redoEntries: HistoryEntry[] = [];
  const listeners = new Set<() => void>();

  // Runs a change to the entries and tells the listeners only when what is available differs.
  function change(apply: () => void): void {
    const couldUndo = undoEntries.length > 0;
    const couldRedo = redoEntries.length > 0;
    apply();
    if (couldUndo !== undoEntries.length > 0 || couldRedo !== redoEntries.length > 0) {
      for (const listener of [...listeners]) {
        listener();
      }
    }
  }

  // Undo and redo are ordinary dispatches. A refused one leaves the entry where it was: the state
  // was not changed, so the entry still describes it and the step can be tried again.
  function step(from: HistoryEntry[], to: HistoryEntry[], pick: (entry: HistoryEntry) => Command): CommandResult {
    const entry = from.at(-1);
    if (!entry) {
      return { done: true };
    }
    const result = dispatcher.dispatch(pick(entry));
    if (result.done) {
      change(() => {
        from.pop();
        to.push(entry);
      });
    }
    return result;
  }

  return {
    get canUndo() {
      return undoEntries.length > 0;
    },
    get canRedo() {
      return redoEntries.length > 0;
    },

    run(command) {
      const result = dispatcher.dispatch(command);
      // A refused command, or one that changed nothing, keeps the redo entries: a failed attempt
      // does not cost what was undone.
      if (result.done && result.inverse) {
        const entry = { command, inverse: result.inverse };
        change(() => {
          undoEntries.push(entry);
          redoEntries.length = 0;
        });
      }
      return result;
    },

    undo: () => step(undoEntries, redoEntries, (entry) => entry.inverse),
    redo: () => step(redoEntries, undoEntries, (entry) => entry.command),

    clear() {
      change(() => {
        undoEntries.length = 0;
        redoEntries.length = 0;
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
