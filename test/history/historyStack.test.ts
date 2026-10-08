import { beforeEach, describe, expect, it } from 'vitest';
import type { Command, CommandHandler } from '../../src/history/command';
import { createDispatcher, type Dispatcher } from '../../src/history/dispatcher';
import { createHistoryStack, type HistoryStack } from '../../src/history/historyStack';

// A counter stands in for a document: 'add' changes it and reports the 'add' that reverses it.
interface Add extends Command {
  readonly type: 'add';
  readonly amount: number;
}

const add = (amount: number): Add => ({ type: 'add', amount });

let value: number;
let refuse: boolean;
let dispatcher: Dispatcher;
let stack: HistoryStack;

const adding: CommandHandler<Add> = {
  type: 'add',
  handle(command) {
    if (refuse) {
      return { done: false, sentence: 'The counter is locked.' };
    }
    if (command.amount === 0) {
      return { done: true };
    }
    value += command.amount;
    return { done: true, inverse: add(-command.amount) };
  },
};

beforeEach(() => {
  value = 0;
  refuse = false;
  dispatcher = createDispatcher();
  dispatcher.register(adding);
  stack = createHistoryStack(dispatcher);
});

const available = () => ({ undo: stack.canUndo, redo: stack.canRedo });

describe('the dispatcher', () => {
  it('runs the handler of the command type', () => {
    expect(dispatcher.dispatch(add(2))).toEqual({ done: true, inverse: add(-2) });
    expect(value).toBe(2);
  });

  it('refuses a second handler for the same command type', () => {
    expect(() => dispatcher.register(adding)).toThrow(/add/);
  });

  it('answers a command with no handler with a sentence', () => {
    const result = dispatcher.dispatch({ type: 'unknown' });
    expect(result.done).toBe(false);
    expect(result).toHaveProperty('sentence', expect.stringContaining('unknown'));
  });

  it('records nothing', () => {
    dispatcher.dispatch(add(2));
    expect(available()).toEqual({ undo: false, redo: false });
  });
});

describe('the transitions of the history', () => {
  it('page opened: both empty', () => {
    expect(available()).toEqual({ undo: false, redo: false });
  });

  it('store read again: both emptied', () => {
    stack.run(add(1));
    stack.run(add(2));
    stack.undo();
    expect(available()).toEqual({ undo: true, redo: true });

    stack.clear();

    expect(available()).toEqual({ undo: false, redo: false });
    expect(value).toBe(1);
  });

  it('edit stored: the undo entries gain the edit, the redo entries are emptied', () => {
    stack.run(add(1));
    stack.undo();
    expect(available()).toEqual({ undo: false, redo: true });

    expect(stack.run(add(5))).toEqual({ done: true, inverse: add(-5) });

    expect(available()).toEqual({ undo: true, redo: false });
    expect(value).toBe(5);
  });

  it('undo: the undo entries lose their newest entry, the redo entries gain it', () => {
    stack.run(add(1));
    stack.run(add(2));

    expect(stack.undo().done).toBe(true);
    expect(value).toBe(1);
    expect(available()).toEqual({ undo: true, redo: true });

    stack.undo();
    expect(value).toBe(0);
    expect(available()).toEqual({ undo: false, redo: true });
  });

  it('redo: the undo entries gain the entry, the redo entries lose their newest', () => {
    stack.run(add(1));
    stack.run(add(2));
    stack.undo();
    stack.undo();

    expect(stack.redo().done).toBe(true);
    expect(value).toBe(1);
    expect(available()).toEqual({ undo: true, redo: true });

    stack.redo();
    expect(value).toBe(3);
    expect(available()).toEqual({ undo: true, redo: false });
  });

  it('undo or redo with nothing to take: unchanged', () => {
    expect(stack.undo()).toEqual({ done: true });
    expect(stack.redo()).toEqual({ done: true });
    expect(available()).toEqual({ undo: false, redo: false });
    expect(value).toBe(0);
  });

  it('20 edits and 20 undos leave the state it started with', () => {
    for (let amount = 1; amount <= 20; amount++) {
      stack.run(add(amount));
    }
    for (let count = 0; count < 20; count++) {
      stack.undo();
    }
    expect(value).toBe(0);
    expect(available()).toEqual({ undo: false, redo: true });
  });
});

describe('what is not recorded', () => {
  it('a refused command, which also keeps the redo entries', () => {
    stack.run(add(1));
    stack.undo();
    refuse = true;

    expect(stack.run(add(5))).toEqual({ done: false, sentence: 'The counter is locked.' });

    expect(available()).toEqual({ undo: false, redo: true });
  });

  it('a command that changes nothing, which also keeps the redo entries', () => {
    stack.run(add(1));
    stack.undo();

    expect(stack.run(add(0))).toEqual({ done: true });

    expect(available()).toEqual({ undo: false, redo: true });
  });

  it('a command with no handler', () => {
    expect(stack.run({ type: 'unknown' }).done).toBe(false);
    expect(available()).toEqual({ undo: false, redo: false });
  });
});

describe('a refused undo or redo', () => {
  it('leaves the entry on the undo entries, to be tried again', () => {
    stack.run(add(1));
    refuse = true;

    expect(stack.undo()).toEqual({ done: false, sentence: 'The counter is locked.' });
    expect(available()).toEqual({ undo: true, redo: false });
    expect(value).toBe(1);

    refuse = false;
    expect(stack.undo().done).toBe(true);
    expect(value).toBe(0);
  });

  it('leaves the entry on the redo entries, to be tried again', () => {
    stack.run(add(1));
    stack.undo();
    refuse = true;

    expect(stack.redo()).toEqual({ done: false, sentence: 'The counter is locked.' });
    expect(available()).toEqual({ undo: false, redo: true });
    expect(value).toBe(0);

    refuse = false;
    expect(stack.redo().done).toBe(true);
    expect(value).toBe(1);
  });
});

describe('the listeners', () => {
  it('are told when what can be undone or redone changes, and only then', () => {
    const seen: { undo: boolean; redo: boolean }[] = [];
    stack.subscribe(() => seen.push(available()));

    stack.run(add(1)); // canUndo becomes true
    stack.run(add(2)); // nothing changes
    stack.undo(); // canRedo becomes true
    stack.undo(); // canUndo becomes false
    stack.undo(); // nothing to take
    stack.redo(); // canUndo becomes true
    stack.redo(); // canRedo becomes false
    stack.clear(); // canUndo becomes false
    stack.clear(); // already empty

    expect(seen).toEqual([
      { undo: true, redo: false },
      { undo: true, redo: true },
      { undo: false, redo: true },
      { undo: true, redo: true },
      { undo: true, redo: false },
      { undo: false, redo: false },
    ]);
  });

  it('are not told of a refusal', () => {
    let told = 0;
    stack.run(add(1));
    stack.subscribe(() => told++);
    refuse = true;

    stack.run(add(2));
    stack.undo();

    expect(told).toBe(0);
  });

  it('are no longer told once unsubscribed', () => {
    let told = 0;
    const unsubscribe = stack.subscribe(() => told++);
    stack.run(add(1));
    unsubscribe();
    stack.undo();

    expect(told).toBe(1);
  });
});
