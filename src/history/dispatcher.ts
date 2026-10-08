import type { Command, CommandHandler, CommandResult } from './command';

export interface Dispatcher {
  register(handler: CommandHandler): void;
  dispatch(command: Command): CommandResult;
}

export function createDispatcher(): Dispatcher {
  const handlers = new Map<string, CommandHandler>();

  return {
    register(handler) {
      // A second handler would silently replace the first, and its commands would go elsewhere.
      if (handlers.has(handler.type)) {
        throw new Error(`A handler for the command '${handler.type}' is already registered.`);
      }
      handlers.set(handler.type, handler);
    },

    dispatch(command) {
      const handler = handlers.get(command.type);
      if (!handler) {
        return { done: false, sentence: `Nothing can carry out the command '${command.type}'.` };
      }
      return handler.handle(command);
    },
  };
}
