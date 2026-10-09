// The open document of a store (etalii.adp spec 012, contracts/shared-parts.md, "Interfaces").
// `openDocument` reads a store whole and gives the frame the contract's `OpenDocument`; `storeOf`
// gives the store's own modules what a write needs, which the frame is not shown.

import { interpretMetamodel, type Metamodel } from '../disl/metamodel';
import { emptyModel, finding, type Finding, type Model } from '../disl/model';
import { bindingOf, interpretPersistence, readModel, type InterpretedPersistence } from '../disl/persistence';
import type { Specification } from '../disl/specification';
import type { FblBinding, FblDocument } from '../fbl/documents/types';
import type { ModelChange } from '../fbl/planning/modelChange';
import type { Command, CommandHandler, CommandResult } from '../history/command';
import { createDispatcher } from '../history/dispatcher';
import { createHistoryStack } from '../history/historyStack';
import { NotionError, type NotionCalls, type NotionDataSource, type NotionRow } from './notion';
import { readRows, type RowsRead } from './rows';
import { internalProperties } from './internal';
import { hide, missing, prepare, projectable, storeSchema, type Missing, type StoreSchema } from './schema';

export interface OpenDocument {
  /** Elements and relations, as the specification's metamodel types them. */
  readonly model: Model;
  readonly findings: readonly Finding[];
  readonly state: 'ready' | 'read-only' | 'unreadable' | 'unprepared';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The handlers of this document's commands, brought by the store and by a part. */
  register(handler: CommandHandler): void;
  /** One gesture, one command, one step: several changes are carried out together or not at all. */
  edit(change: ModelChange | readonly ModelChange[]): EditResult;
  undo(): EditResult;
  redo(): EditResult;
  /**
   * While the state is `unprepared` and the database can be prepared: the properties it lacks, and
   * for each of them, by its name, the properties it has that can be projected on it.
   */
  readonly lacking: (Missing & { readonly projectable: Readonly<Record<string, readonly string[]>> }) | undefined;
  /**
   * Makes the database a store, once the person has agreed: `project` names, by the missing
   * property, the existing one that is given its name; the others are added. The internal
   * properties are then hidden in the database's views; where Notion refuses that, the store is
   * prepared all the same and this rejects with a `ViewsError`.
   */
  prepare(project?: Readonly<Record<string, string>>): Promise<void>;
  reload(): Promise<void>;
  subscribe(listener: (event: DocumentEvent) => void): () => void;
  close(): void;
}

/** A refusal carries the specification's or the binding's sentence. */
export type EditResult =
  | { readonly done: true }
  | { readonly done: false; readonly sentence: string };

export type DocumentEvent =
  /** The model differs; draw again. */
  | { readonly kind: 'changed' }
  | { readonly kind: 'status'; readonly status: 'idle' | 'loading' | 'storing' | 'offline' | 'failed' }
  /** The store was read again; the history is empty. */
  | { readonly kind: 'reloaded'; readonly sentence: string };

/** The type of the command an edit runs. Its handler is the store's; an inverse may be of any type. */
export const CHANGE = 'model.change';

export interface ChangeCommand extends Command {
  readonly type: typeof CHANGE;
  /** The changes of one intent, in order. */
  readonly change: ModelChange | readonly ModelChange[];
}

/** What the modules of `src/store/` need of an open document to write its store. */
export interface OpenStore {
  readonly schema: StoreSchema;
  readonly binding: FblBinding;
  readonly metamodel: Metamodel;
  readonly persistence: InterpretedPersistence;
  readonly notion: NotionCalls;
  /** Nothing while the database has no data source that can be a store. */
  readonly dataSourceId: string | undefined;
  /** What the rows read as: the body the FBL library plans against, and which row is which entry. */
  readonly rows: RowsRead;
  /** The time of the newest row edit the last read saw, as Notion gave it; nothing when it saw no row. */
  readonly lastRead: string | undefined;
  /** The rows as the last read gave them: where each stands in its kind, and who edited it last and when. */
  readonly held: readonly NotionRow[];
  /** Whoever writes the store says when its queued writes are settled; a read waits for that, so that it reads what they left. */
  writes(settled: () => Promise<unknown>): void;
  /** After a change: what the rows now read as. The model and the findings follow, and `changed` is told. */
  replace(rows: RowsRead): void;
  /** Notion refused a write of this person with `403`: read-only from now on, with an empty history. */
  markReadOnly(): void;
  /** Reads the store again, empties the history and tells `reloaded` with the sentence. */
  reload(sentence: string): Promise<void>;
}

export interface OpenDocumentOptions {
  specification: Specification;
  /** The FBL document; the binding used is the fragment of `persistence.binding`. */
  binding: FblDocument;
  /** The `store` parameter of the address. */
  database: string;
  notion: NotionCalls;
  /**
   * The specification's constraints: the findings of a model, given what reading it found. They
   * restate the reading's findings and add their own, as `check` of `src/disl/constraints.ts` does.
   */
  constraints?: (model: Model, read: readonly Finding[]) => readonly Finding[];
}

const stores = new WeakMap<OpenDocument, OpenStore>();

/** For the modules of `src/store/` only. */
export function storeOf(document: OpenDocument): OpenStore {
  const store = stores.get(document);
  if (!store) throw new Error('The document was not opened by openDocument.');
  return store;
}

/** Every row of a data source that is not in the trash, 100 a call, in the order of creation. */
export async function allRows(notion: NotionCalls, dataSourceId: string): Promise<NotionRow[]> {
  const rows: NotionRow[] = [];
  for (let cursor: string | undefined, more = true; more;) {
    // Sorted, so that a row created while the pages are asked for moves no row to another page.
    const page = await notion.query(dataSourceId, { cursor, pageSize: 100, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] });
    rows.push(...page.results);
    more = page.has_more && page.next_cursor !== null;
    cursor = page.next_cursor ?? undefined;
  }
  return rows;
}

/** The sentence of a reading nobody's change asked for, as when the page regained the focus: there is nothing in it to tell the user. */
export const READ_AGAIN = 'The database was read again.';

/** The model is about to be replaced by what the database holds, so an edit made now would be lost. */
const READING = 'The database is being read, so nothing can be changed for a moment.';

const refusals: Record<Exclude<OpenDocument['state'], 'ready'>, string> = {
  'read-only': 'You may not change this database, so the diagram cannot be edited.',
  unreadable: 'The document could not be read, so it cannot be edited.',
  unprepared: 'The database is not prepared as a store, so the diagram cannot be edited.',
};

const isForbidden = (error: unknown): boolean => error instanceof NotionError && error.kind === 'refused' && error.status === 403;

/**
 * Opens a store: the whole of it is read before anything is given. It rejects with the calls'
 * error when the database cannot be asked for at all, as when it is not shared with the person or
 * the person has not connected.
 */
export async function openDocument(options: OpenDocumentOptions): Promise<OpenDocument> {
  const { specification, notion, constraints } = options;
  const metamodel = interpretMetamodel(specification).value;
  const persistence = interpretPersistence(specification, metamodel).value;
  const binding = bindingOf(persistence, options.binding);
  if (!binding) throw new Error('The FBL document does not hold the binding the specification names.');
  const schema = storeSchema(binding, metamodel, persistence);
  // A binding that cannot be stored is read as nothing, with the schema's sentences.
  const storable = !schema.findings.some((found) => found.severity === 'error');

  const dispatcher = createDispatcher();
  const history = createHistoryStack(dispatcher);
  const listeners = new Set<(event: DocumentEvent) => void>();

  let model = emptyModel;
  let findings: readonly Finding[] = [];
  let state: OpenDocument['state'] = 'unprepared';
  let rows = readRows([], schema, binding);
  let dataSource: NotionDataSource | undefined;
  let lacking: OpenDocument['lacking'];
  let lastRead: string | undefined;
  let held: readonly NotionRow[] = [];
  let settled: () => Promise<unknown> = () => Promise.resolve();
  let reads = 0;
  let readOnly = false;
  let closed = false;
  let told: string = notion.status();

  function tell(event: DocumentEvent): void {
    if (closed) return;
    for (const listener of [...listeners]) listener(event);
  }
  function tellStatus(status: (DocumentEvent & { kind: 'status' })['status']): void {
    if (status === told) return;
    told = status;
    tell({ kind: 'status', status });
  }
  const stopRelay = notion.onStatus(tellStatus);

  function unprepared(sentences: readonly Finding[]): void {
    model = emptyModel;
    findings = sentences;
    state = 'unprepared';
    rows = readRows([], schema, binding!);
    lastRead = undefined;
    held = [];
  }

  function take(next: RowsRead): void {
    rows = next;
    const loaded = readModel(next.reading.toModel(), binding!, metamodel, persistence);
    const read = [...next.findings, ...loaded.findings];
    const unreadable = !storable || next.reading.unreadable !== undefined || next.findings.some((found) => found.severity === 'error');
    model = unreadable ? emptyModel : loaded.value;
    findings = unreadable ? [...schema.findings, ...read] : (constraints?.(model, read) ?? read);
    state = unreadable ? 'unreadable' : readOnly ? 'read-only' : 'ready';
  }

  async function read(): Promise<void> {
    tellStatus('loading');
    try {
      lacking = undefined;
      const database = await notion.database(options.database);
      dataSource = undefined;
      const count = database.data_sources.length;
      if (count !== 1) {
        unprepared([finding('store.data-sources', 'error', `The database has ${count === 0 ? 'no data source' : `${count} data sources`}, and a store has one.`)]);
        return;
      }
      const source = await notion.dataSource(database.data_sources[0].id);
      dataSource = source;
      if (!storable) {
        held = [];
        take(readRows([], schema, binding!));
        return;
      }
      const lacks = missing(schema, source);
      if (!lacks.prepared) {
        lacking = { ...lacks, projectable: projectable(schema, source) };
        const names = [...(lacks.rename ? [lacks.rename.to] : []), ...lacks.add.map((property) => property.name)];
        unprepared([
          ...(names.length > 0 ? [finding('store.unprepared', 'warning', `The database lacks ${names.length === 1 ? 'the property' : 'the properties'} ${names.map((name) => `\`${name}\``).join(', ')}.`)] : []),
          ...lacks.wrong.map(({ property, has }) => finding('store.unprepared', 'error', `The property \`${property.name}\` of the database is ${has.replace('_', ' ')}, and a store holds it as ${property.type.replace('_', ' ')}. It is left as it is.`)),
        ]);
        return;
      }
      const read = await allRows(notion, source.id);
      lastRead = read.reduce<string | undefined>((newest, row) => (newest === undefined || row.last_edited_time > newest ? row.last_edited_time : newest), undefined);
      held = read;
      take(readRows(read, schema, binding!));
    } finally {
      tellStatus(notion.status());
    }
  }

  // One read at a time, so that the one asked for last is the one that stays.
  let reading: Promise<void> = Promise.resolve();
  function load(): Promise<void> {
    reads++;
    const next = reading.then(() => settled()).then(read).finally(() => void reads--);
    reading = next.catch(() => undefined);
    return next;
  }

  async function reload(sentence: string): Promise<void> {
    await load();
    history.clear();
    tell({ kind: 'reloaded', sentence });
  }

  const answer = (result: CommandResult): EditResult => (result.done ? { done: true } : result);
  const refused = (): EditResult | undefined =>
    (state !== 'ready' ? { done: false, sentence: refusals[state] } : reads > 0 ? { done: false, sentence: READING } : undefined);

  await load();

  const document: OpenDocument = {
    get model() {
      return model;
    },
    get findings() {
      return findings;
    },
    get state() {
      return state;
    },
    get lacking() {
      return state === 'unprepared' ? lacking : undefined;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    register: (handler) => dispatcher.register(handler),
    edit: (change) => refused() ?? answer(history.run({ type: CHANGE, change } as ChangeCommand)),
    undo: () => refused() ?? answer(history.undo()),
    redo: () => refused() ?? answer(history.redo()),

    async prepare(project) {
      if (state !== 'unprepared' || !dataSource) return;
      try {
        await prepare(schema, dataSource, notion, project);
      } catch (error) {
        // The refused write changed nothing. Once somebody else prepares the database, it opens read-only.
        if (isForbidden(error)) readOnly = true;
        throw error;
      }
      await load();
      tell({ kind: 'changed' });
      // After the read, which gives the properties as they are now, the added ones too.
      if (state !== 'unprepared' && dataSource) await hide(dataSource, internalProperties(specification, metamodel, persistence, schema), notion);
    },
    reload: () => reload(READ_AGAIN),

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      stopRelay();
      listeners.clear();
      history.clear();
    },
  };

  stores.set(document, {
    schema,
    binding,
    metamodel,
    persistence,
    notion,
    get dataSourceId() {
      return dataSource?.id;
    },
    get rows() {
      return rows;
    },
    get lastRead() {
      return lastRead;
    },
    get held() {
      return held;
    },
    writes(whenSettled) {
      settled = () => whenSettled().catch(() => undefined);
    },
    replace(next) {
      take(next);
      tell({ kind: 'changed' });
    },
    markReadOnly() {
      if (readOnly) return;
      readOnly = true;
      if (state !== 'ready') return;
      state = 'read-only';
      history.clear();
      tell({ kind: 'changed' });
    },
    reload,
  });
  return document;
}
