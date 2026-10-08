// The commands of an open document and their handlers (etalii.adp spec 012, contracts/store.md,
// "Reading and writing"; data model: Edit and History). A handler answers at once: the change is
// planned as splices by the FBL library, each splice is resolved to its row writes, the body and
// the model in memory follow, and the inverse command is reported. The store is written afterwards,
// in the order of the commands, each one's writes behind a check for somebody else's change.

import type { Constraints, Gesture } from '../disl/constraints';
import { attributesOf, isRelation, valueKind, zeroOf } from '../disl/metamodel';
import type { Model } from '../disl/model';
import { fromStored, readModel } from '../disl/persistence';
import { digestOf } from '../fbl/history/digest';
import { planEdit } from '../fbl/planning/editPlanner';
import type { ModelChange } from '../fbl/planning/modelChange';
import { isEmpty } from '../fbl/planning/newText';
import type { BodyReading } from '../fbl/rules/bodyReading';
import { inverseSplices, type FblSplice } from '../fbl/splice';
import type { Command, CommandHandler, CommandResult } from '../history/command';
import { CHANGE, storeOf, type ChangeCommand, type OpenDocument } from './document';
import { editOf, findDrift, type RowEdit } from './drift';
import { NotionError, type NotionRow, type NotionValues, type NotionWrites } from './notion';
import { KIND, ORDER } from './schema';
import { folded, recordOf, resolve, type RowWrite, type StoreRecord } from './writes';

/** The type of the command that undoes a change: the splices that put the body back, step by step. */
export const SPLICES = 'store.splices';

export interface SplicesCommand extends Command {
  readonly type: typeof SPLICES;
  /** The splices of each step refer to the body the step before it left. */
  readonly steps: readonly (readonly FblSplice[])[];
  /** The body the first step refers to: the command is carried out on that body and no other. */
  readonly digest: string;
}

export interface HandlerOptions {
  /** The specification's constraints: what refuses a gesture before it is applied. */
  readonly constraints?: Pick<Constraints, 'refusals'>;
}

const DRIFTED = 'Somebody else changed the database, so your edit was not stored. The database was read again.';
const FORBIDDEN = 'You may not change this database, so your edit was not stored.';
const PARTLY = 'Your edit was stored in part. The database was read again, and the diagram shows what it holds.';
const NOT_STORED = 'Your edit could not be stored. The database was read again, and the diagram shows what it holds.';
const NOT_READ = 'Your edit was not stored, and the database could not be read again. Nothing can be changed until it is.';
const ANOTHER_BODY = 'The document is no longer as this step left it, so the step cannot be taken.';

class Drifted extends Error {}

/** What the handlers keep of one reading of the store; a new reading starts a new one. */
interface Basis {
  record: StoreRecord;
  /** What the store knows of each row's last edit: from the read, then from its own writes. */
  readonly edits: Map<string, RowEdit>;
  /** Notion's ids of the rows the store named itself, once they are created. */
  readonly ids: Map<string, string>;
  /** The newest edit time a read or a check saw: the next check asks from its minute on. */
  since: string | undefined;
  /** Why nothing more is taken: a write failed, and the model no longer shows what the database holds. */
  broken?: string;
}

/** A change while it is carried out, step by step, with nothing told or written yet. */
interface Progress {
  record: StoreRecord;
  readonly writes: RowWrite[];
  /** The splices that undo each step, the last step first. */
  readonly undo: FblSplice[][];
}

const sentenceOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Registers the handlers of the document's commands: a change, and the splices that undo one. */
export function registerHandlers(document: OpenDocument, options: HandlerOptions = {}): void {
  const store = storeOf(document);
  const { schema, binding, metamodel, persistence, notion } = store;
  let basis: Basis | undefined;
  let last: Promise<void> = Promise.resolve();
  store.writes(() => last);

  function current(): Basis {
    if (basis?.record.rows !== store.rows) {
      basis = { record: recordOf(store.rows, store.held), edits: new Map(store.held.map((held) => [held.id, editOf(held)])), ids: new Map(), since: store.lastRead };
    }
    return basis;
  }

  // ---- from a command to the body, the model and the row writes ----

  function step(progress: Progress, splices: readonly FblSplice[]): string | undefined {
    const result = resolve(progress.record, splices, schema, binding);
    if ('refused' in result) return result.refused;
    if (splices.length > 0) progress.undo.unshift(inverseSplices(progress.record.rows.body, splices));
    progress.writes.push(...result.writes);
    progress.record = result.record;
    return undefined;
  }

  function planned(record: StoreRecord, changes: readonly ModelChange[]): Progress | { refused: string } {
    const progress: Progress = { record, writes: [], undo: [] };
    for (const change of changes) {
      const plan = planEdit(progress.record.rows.reading, change);
      if ('refused' in plan) return plan;
      const refused = step(progress, plan.planned.splices);
      if (refused !== undefined) return { refused };
    }
    return progress;
  }

  function finish(now: Basis, progress: Progress): CommandResult {
    // Nothing changed, so there is nothing to record.
    const digest = digestOf(progress.record.rows.body);
    if (progress.undo.length === 0 || digest === digestOf(now.record.rows.body)) return { done: true };
    const { writes, record } = folded(progress.writes, progress.record);
    now.record = record;
    store.replace(record.rows);
    queue(now, writes);
    const inverse: SplicesCommand = { type: SPLICES, steps: progress.undo, digest };
    return { done: true, inverse };
  }

  // The library writes a text of several lines into a new entry with the wrong indentation, so
  // such a value is set once the entry is there (the same is done when the rows are read).
  function stepsOf(change: ModelChange): ModelChange[] {
    if (change.kind !== 'add' || change.id === undefined) return [change];
    const later = Object.entries(change.attributes).filter(([, value]) => typeof value === 'string' && /[\r\n]/.test(value));
    if (later.length === 0) return [change];
    const first = Object.entries(change.attributes).filter(([, value]) => !(typeof value === 'string' && /[\r\n]/.test(value)));
    return [{ ...change, attributes: Object.fromEntries(first) }, { kind: 'set', id: change.id, attributes: Object.fromEntries(later) }];
  }

  // The gestures a change is, in the specification's own names, for its constraints.
  function gesturesOf(change: ModelChange, reading: BodyReading): Gesture[] {
    const entryOf = (type: string) => (Object.hasOwn(persistence.typeMap, type) ? persistence.typeMap[type] : { as: type, attributes: undefined });
    const mapped = (attributes: Readonly<Record<string, string | null>> | undefined, name: string): string | null =>
      (attributes && Object.hasOwn(attributes, name) ? attributes[name] : name);
    if (change.kind === 'remove') return [{ kind: 'delete', self: change.id }];
    if (change.kind !== 'add' && change.kind !== 'set') return [];

    const stored = change.kind === 'add' ? change.type : reading.find(change.id)?.rule.type;
    if (stored === undefined) return [];
    const entry = entryOf(stored);
    const type = metamodel.types[entry.as];
    const declared = attributesOf(metamodel, entry.as);
    const gestures: Gesture[] = [];
    const ends: { source?: string; target?: string } = {};
    for (const [name, value] of Object.entries(change.attributes)) {
      const to = mapped(entry.attributes, name);
      if (to === null) continue;
      if (to === 'source' || to === 'target') ends[to] = isEmpty(value) ? undefined : String(value);
      else if (change.kind === 'set' && Object.hasOwn(declared, to)) {
        const newValue = isEmpty(value) ? zeroOf(valueKind(metamodel, declared[to].type), declared[to].many === true) : fromStored(value, declared[to], metamodel);
        gestures.push({ kind: 'change', self: change.id, values: { attribute: to, newValue } });
      }
    }
    if (change.kind === 'add' && !isRelation(type)) gestures.push({ kind: 'create', values: { type: entry.as } });
    else if (isRelation(type) && (change.kind === 'add' || Object.keys(ends).length > 0)) {
      // An end that is not changed is the one the relation has.
      const held = change.kind === 'set' ? document.model.relations.find((relation) => relation.id === change.id) : undefined;
      gestures.push({ kind: 'connect', ...(held ? { self: held.id } : {}), elements: { source: ends.source ?? held?.source, target: ends.target ?? held?.target }, values: { relationType: entry.as } });
    }
    return gestures;
  }

  function refusal(change: ModelChange, now: Basis, after?: Model): string | undefined {
    if (!options.constraints) return undefined;
    for (const gesture of gesturesOf(change, now.record.rows.reading)) {
      const [first] = options.constraints.refusals(gesture, document.model, after);
      if (first) return first.message;
    }
    return undefined;
  }

  const change: CommandHandler<ChangeCommand> = {
    type: CHANGE,
    handle(command) {
      const now = current();
      if (now.broken !== undefined) return { done: false, sentence: now.broken };
      let result: Progress | { refused: string };
      try {
        result = planned(now.record, stepsOf(command.change));
      } catch (error) {
        // The library cannot always plan several attributes of one entry as one edit; one by one it can.
        const each = command.change.kind === 'set' ? Object.entries(command.change.attributes).map(([name, value]): ModelChange => ({ kind: 'set', id: (command.change as { id: string }).id, attributes: { [name]: value } })) : [];
        try {
          result = each.length > 1 ? planned(now.record, each) : { refused: sentenceOf(error) };
        } catch (again) {
          result = { refused: sentenceOf(again) };
        }
      }
      // The specification's sentence comes before the binding's.
      if ('refused' in result) return { done: false, sentence: refusal(command.change, now) ?? result.refused };
      const after = options.constraints && result.undo.length > 0 ? readModel(result.record.rows.reading.toModel(), binding, metamodel, persistence).value : undefined;
      const sentence = refusal(command.change, now, after);
      return sentence === undefined ? finish(now, result) : { done: false, sentence };
    },
  };

  const splices: CommandHandler<SplicesCommand> = {
    type: SPLICES,
    handle(command) {
      const now = current();
      if (now.broken !== undefined) return { done: false, sentence: now.broken };
      if (digestOf(now.record.rows.body) !== command.digest) return { done: false, sentence: ANOTHER_BODY };
      const progress: Progress = { record: now.record, writes: [], undo: [] };
      for (const each of command.steps) {
        const refused = step(progress, each);
        if (refused !== undefined) return { done: false, sentence: refused };
      }
      return finish(now, progress);
    },
  };

  // ---- from the row writes to Notion ----

  // The writes of one command are one edit of the calls, queued at once, so that the status is
  // `storing` until it is stored and a failure discards every edit queued behind it.
  function queue(mine: Basis, writes: readonly RowWrite[]): void {
    const dataSourceId = store.dataSourceId;
    if (writes.length === 0 || dataSourceId === undefined) return;
    let stored = 0;
    last = notion.edit(async (send) => {
      const drift = await findDrift(notion, dataSourceId, mine.since, mine.edits);
      if (drift.changed) throw new Drifted();
      if (drift.newest !== undefined && (mine.since === undefined || drift.newest > mine.since)) mine.since = drift.newest;
      await sendWrites(send, dataSourceId, mine, writes, () => stored++);
    }).then(() => undefined, (error: unknown) => failed(mine, error, stored));
  }

  async function sendWrites(send: NotionWrites, dataSourceId: string, mine: Basis, writes: readonly RowWrite[], sent: () => void): Promise<void> {
    const idOf = (row: string): string => mine.ids.get(row) ?? row;
    const relation = (rows: readonly string[]): Record<string, unknown> => ({ relation: rows.map((row) => ({ id: idOf(row) })) });
    const wrote = (held: NotionRow): void => {
      mine.edits.set(held.id, editOf(held));
      sent();
    };
    for (let index = 0; index < writes.length; index++) {
      const write = writes[index];
      if (write.write === 'create') {
        const related = Object.fromEntries(Object.entries(write.relations).map(([property, rows]) => [property, relation(rows)]));
        const made = await send.createRow(dataSourceId, { ...write.values, [KIND]: { select: { name: write.kind } }, ...(write.order === undefined ? {} : { [ORDER]: { number: write.order } }), ...related });
        mine.ids.set(write.row, made.id);
        wrote(made);
      } else if (write.write === 'trash' || write.write === 'restore') {
        wrote(await send.trashRow(idOf(write.row), write.write === 'trash'));
      } else {
        // The properties of one row that follow each other are one call: Notion's limit is on calls.
        const values: NotionValues = {};
        for (let next: RowWrite | undefined = write; next !== undefined && next.row === write.row; next = writes[++index]) {
          if (next.write === 'update') values[next.property] = next.value;
          else if (next.write === 'relate') values[next.property] = relation(next.rows);
          else if (next.write === 'reorder') values[ORDER] = { number: next.order };
          else break;
        }
        index--;
        wrote(await send.updateRow(idOf(write.row), values));
      }
    }
  }

  function failed(mine: Basis, error: unknown, stored: number): void {
    // Not sent because a write before it failed, and that failure is the one told.
    if (error instanceof NotionError && error.kind === 'discarded') return;
    if (mine.broken !== undefined) return;
    const forbidden = error instanceof NotionError && error.kind === 'refused' && error.status === 403;
    const sentence = error instanceof Drifted ? DRIFTED : forbidden ? FORBIDDEN : stored > 0 ? PARTLY : NOT_STORED;
    mine.broken = sentence;
    if (forbidden) store.markReadOnly();
    // The stored writes are not taken back: the store is read again, and the model shows what it holds.
    store.reload(sentence).catch(() => void (mine.broken = NOT_READ));
  }

  document.register(change);
  document.register(splices);
}
