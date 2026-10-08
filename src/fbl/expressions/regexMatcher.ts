import { messages } from '../messages';
import { defaultRegexSteps } from '../model';
import { isAsciiLetterCode, parseRegex, type ClassItem, type RegexNode } from './regexSubset';

/** A match: its range and those of the named groups that took part, in UTF-16 code units of the text matched. */
export interface RegexMatch {
  readonly start: number;
  readonly end: number;
  readonly groups: ReadonlyMap<string, { readonly start: number; readonly end: number }>;
  /** The text a named group matched; nothing when it took no part in the match. */
  value(name: string): string | undefined;
}

/** A match attempt took more steps than its budget (FBL 16): the text is read as not matching, with a finding. */
export class RegexBudgetError extends Error {
  constructor() {
    super(messages.regexTooLong);
  }
}

const enum Op {
  Char,
  CharAnyCase,
  Any,
  Class,
  Split,
  Jump,
  Save,
  Start,
  End,
  Mark,
  Progress,
  Match,
}

interface CharacterClass {
  /** One flag for each code unit below 128. */
  readonly ascii: Uint8Array;
  /** Whether a code unit of 128 or more is in the class. */
  readonly other: (code: number) => boolean;
}

/**
 * A compiled expression of FBL's common subset (FBL 2.5), matched by backtracking over a small
 * program with a count of its steps: a match that takes more than the budget stops with a
 * `RegexBudgetError` instead of hanging (FBL 16). `\d` and `\w` are ASCII, `.` is anything but a
 * line feed, alternation is leftmost-first, and `caseInsensitive` folds ASCII letters and nothing
 * else. Positions are UTF-16 code units, as the platform's own matcher counts them.
 */
export class BoundedRegex {
  private readonly program: number[] = [];
  private readonly classes: CharacterClass[] = [];
  private readonly names: string[] = [];
  private marks = 0;
  private readonly anchored: boolean;
  private slots = 0;

  constructor(readonly expression: string, readonly caseInsensitive = false, private readonly steps = defaultRegexSteps) {
    const tree = parseRegex(expression);
    collectNames(tree, this.names);
    this.emitNode(tree);
    this.emit(Op.Match);
    this.slots = this.names.length * 2 + this.marks;
    this.anchored = startsAtStart(tree);
  }

  /** The names of the expression's named groups, in the order they open. */
  get groupNames(): readonly string[] {
    return this.names;
  }

  isMatch(input: string): boolean {
    return this.match(input) !== undefined;
  }

  /** The leftmost match, or nothing; throws a `RegexBudgetError` when the search takes more steps than the budget. */
  match(input: string): RegexMatch | undefined {
    const budget = { left: this.steps };
    const last = this.anchored ? 0 : input.length;
    for (let start = 0; start <= last; start++) {
      const found = this.run(input, start, budget);
      if (!found) continue;
      const groups = new Map<string, { start: number; end: number }>();
      this.names.forEach((name, index) => {
        if (found.slots[index * 2] >= 0 && found.slots[index * 2 + 1] >= 0) groups.set(name, { start: found.slots[index * 2], end: found.slots[index * 2 + 1] });
      });
      return {
        start,
        end: found.end,
        groups,
        value: (name) => {
          const range = groups.get(name);
          return range ? input.slice(range.start, range.end) : undefined;
        },
      };
    }
    return undefined;
  }

  // ---- the matcher ----

  private run(input: string, start: number, budget: { left: number }): { end: number; slots: Int32Array } | undefined {
    const program = this.program;
    const length = input.length;
    const stackPc: number[] = [];
    const stackPosition: number[] = [];
    const stackSlots: Int32Array[] = [];
    let slots: Int32Array = new Int32Array(this.slots).fill(-1);
    let pc = 0;
    let position = start;
    for (;;) {
      if (--budget.left < 0) throw new RegexBudgetError();
      const at = pc * 3;
      let failed = false;
      switch (program[at] as Op) {
        case Op.Char:
          if (position < length && input.charCodeAt(position) === program[at + 1]) {
            position++;
            pc++;
          } else failed = true;
          break;
        case Op.CharAnyCase:
          if (position < length && (input.charCodeAt(position) | 0x20) === program[at + 1]) {
            position++;
            pc++;
          } else failed = true;
          break;
        case Op.Any:
          if (position < length && input.charCodeAt(position) !== 0x0a) {
            position++;
            pc++;
          } else failed = true;
          break;
        case Op.Class: {
          if (position >= length) {
            failed = true;
            break;
          }
          const code = input.charCodeAt(position);
          const set = this.classes[program[at + 1]];
          if (code < 128 ? set.ascii[code] === 1 : set.other(code)) {
            position++;
            pc++;
          } else failed = true;
          break;
        }
        case Op.Split:
          stackPc.push(program[at + 2]);
          stackPosition.push(position);
          stackSlots.push(slots);
          pc = program[at + 1];
          break;
        case Op.Jump:
          pc = program[at + 1];
          break;
        case Op.Save:
        case Op.Mark:
          slots = slots.slice();
          slots[program[at + 1]] = position;
          pc++;
          break;
        case Op.Start:
          if (position === 0) pc++;
          else failed = true;
          break;
        case Op.End:
          if (position === length) pc++;
          else failed = true;
          break;
        case Op.Progress:
          // An iteration that matched nothing would repeat for ever; it is not taken.
          if (slots[program[at + 1]] !== position) pc++;
          else failed = true;
          break;
        case Op.Match:
          return { end: position, slots };
      }
      if (!failed) continue;
      if (stackPc.length === 0) return undefined;
      pc = stackPc.pop()!;
      position = stackPosition.pop()!;
      slots = stackSlots.pop()!;
    }
  }

  // ---- the compiler ----

  private emit(op: Op, a = 0, b = 0): number {
    this.program.push(op, a, b);
    return this.program.length / 3 - 1;
  }

  private get next(): number {
    return this.program.length / 3;
  }

  private patch(instruction: number, a: number, b?: number): void {
    this.program[instruction * 3 + 1] = a;
    if (b !== undefined) this.program[instruction * 3 + 2] = b;
  }

  private emitNode(node: RegexNode): void {
    switch (node.kind) {
      case 'empty':
        return;
      case 'char':
        if (this.caseInsensitive && isAsciiLetterCode(node.code)) this.emit(Op.CharAnyCase, node.code | 0x20);
        else this.emit(Op.Char, node.code);
        return;
      case 'any':
        this.emit(Op.Any);
        return;
      case 'class':
        this.classes.push(classOf(node.negated, node.items, this.caseInsensitive));
        this.emit(Op.Class, this.classes.length - 1);
        return;
      case 'start':
        this.emit(Op.Start);
        return;
      case 'end':
        this.emit(Op.End);
        return;
      case 'group': {
        const index = node.name === undefined ? -1 : this.names.indexOf(node.name);
        if (index >= 0) this.emit(Op.Save, index * 2);
        this.emitNode(node.node);
        if (index >= 0) this.emit(Op.Save, index * 2 + 1);
        return;
      }
      case 'concat':
        for (const child of node.nodes) this.emitNode(child);
        return;
      case 'alternation': {
        const jumps: number[] = [];
        node.nodes.forEach((branch, index) => {
          if (index === node.nodes.length - 1) {
            this.emitNode(branch);
            return;
          }
          const split = this.emit(Op.Split);
          this.patch(split, this.next);
          this.emitNode(branch);
          jumps.push(this.emit(Op.Jump));
          this.patch(split, this.program[split * 3 + 1], this.next);
        });
        for (const jump of jumps) this.patch(jump, this.next);
        return;
      }
      case 'repeat': {
        for (let i = 0; i < node.min; i++) this.emitNode(node.node);
        if (node.max === Infinity) {
          // loop: split(body, out); body; jump loop; out:
          const mark = nullable(node.node) ? this.names.length * 2 + this.marks++ : -1;
          const split = this.emit(Op.Split);
          const body = this.next;
          if (mark >= 0) this.emit(Op.Mark, mark);
          this.emitNode(node.node);
          if (mark >= 0) this.emit(Op.Progress, mark);
          this.emit(Op.Jump, split);
          if (node.lazy) this.patch(split, this.next, body);
          else this.patch(split, body, this.next);
          return;
        }
        // Each optional repetition is inside the one before it: split(body, out); body; split(...
        const splits: number[] = [];
        for (let i = node.min; i < node.max; i++) {
          splits.push(this.emit(Op.Split));
          this.patch(splits[splits.length - 1], this.next);
          this.emitNode(node.node);
        }
        for (const split of splits) {
          const body = this.program[split * 3 + 1];
          if (node.lazy) this.patch(split, this.next, body);
          else this.patch(split, body, this.next);
        }
        return;
      }
    }
  }
}

function collectNames(node: RegexNode, names: string[]): void {
  switch (node.kind) {
    case 'group':
      if (node.name !== undefined) names.push(node.name);
      collectNames(node.node, names);
      return;
    case 'concat':
    case 'alternation':
      for (const child of node.nodes) collectNames(child, names);
      return;
    case 'repeat':
      collectNames(node.node, names);
      return;
  }
}

/** Whether a node can match the empty text, so a loop around it needs its progress checked. */
function nullable(node: RegexNode): boolean {
  switch (node.kind) {
    case 'empty':
    case 'start':
    case 'end':
      return true;
    case 'char':
    case 'any':
    case 'class':
      return false;
    case 'group':
      return nullable(node.node);
    case 'concat':
      return node.nodes.every(nullable);
    case 'alternation':
      return node.nodes.some(nullable);
    case 'repeat':
      return node.min === 0 || nullable(node.node);
  }
}

/** Whether every match starts at the text's start, so only that position is tried. */
function startsAtStart(node: RegexNode): boolean {
  switch (node.kind) {
    case 'start': return true;
    case 'group': return startsAtStart(node.node);
    case 'concat': return node.nodes.length > 0 && startsAtStart(node.nodes[0]);
    case 'alternation': return node.nodes.every(startsAtStart);
    default: return false;
  }
}

function classOf(negated: boolean, items: readonly ClassItem[], caseInsensitive: boolean): CharacterClass {
  const inItem = (item: ClassItem, code: number): boolean => item.ranges.some(([from, to]) => code >= from && code <= to) !== item.negated;
  const inSet = (code: number): boolean => items.some((item) => inItem(item, code));
  const ascii = new Uint8Array(128);
  for (let code = 0; code < 128; code++) {
    let member = inSet(code);
    // Folding is of ASCII letters only: a letter is in the class when either of its cases is.
    if (!member && caseInsensitive && isAsciiLetterCode(code)) member = inSet(code ^ 0x20);
    ascii[code] = member !== negated ? 1 : 0;
  }
  return { ascii, other: (code) => inSet(code) !== negated };
}
