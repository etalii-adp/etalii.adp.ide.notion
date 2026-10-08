// A command is plain data that cannot change: what is to happen, never how. It holds no live
// state, so the same command can be run again, which is what a redo does.
export interface Command {
  readonly type: string;
}

// Done without an inverse means nothing changed, so there is nothing to record.
export type CommandResult =
  | { readonly done: true; readonly inverse?: Command }
  | { readonly done: false; readonly sentence: string };

export interface CommandHandler<C extends Command = Command> {
  readonly type: C['type'];
  // Checks its own preconditions each time it runs: an undo or a redo arrives here as any other
  // command does, possibly long after the first run.
  handle(command: C): CommandResult;
}

export interface HistoryEntry {
  readonly command: Command;
  readonly inverse: Command;
}
