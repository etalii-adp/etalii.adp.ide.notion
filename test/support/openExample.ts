// A document of the add-on's tool type put into the in-memory Notion and opened as the frame opens
// it: with the specification's constraints and the store's handlers registered. A test edits it
// and looks at the calls that reached Notion and at the rows afterwards.

import { readFileSync } from 'node:fs';
import { loadDocument } from '../../src/fbl/documents/documentLoader';
import type { ModelChange } from '../../src/fbl/planning/modelChange';
import { interpretConstraints } from '../../src/disl/constraints';
import type { Model } from '../../src/disl/model';
import { openDocument, type DocumentEvent, type EditResult, type OpenDocument } from '../../src/store/document';
import { registerHandlers } from '../../src/store/handlers';
import { createRows, rowsOf, valueOf } from '../../src/store/rows';
import { prepare, storeSchema } from '../../src/store/schema';
import { tool } from '../disl/tool';
import { createMemoryCalls, type MemoryCalls } from './memoryCalls';
import type { MemoryDatabase, MemoryPage } from './memoryNotion';

const addon = 'addons/gartner-hype-cycle-graph/gartner-hype-cycle-graph';

/** A model without the lines its elements start at: those are the body's, and a store holds none. */
export const unlined = (model: Model): Model => ({
  diagram: model.diagram,
  elements: model.elements.map((element) => ({ ...element, line: 0 })),
  relations: model.relations.map((relation) => ({ ...relation, line: 0 })),
});

/** The rows of a store that are not in the trash, by kind and in the document's order, each as what its named properties hold. */
export type StoreContents = Record<string, Record<string, unknown>[]>;

export interface OpenExample extends MemoryCalls {
  readonly database: MemoryDatabase;
  readonly document: OpenDocument;
  /** Every event the document told, in order. */
  readonly events: DocumentEvent[];
  /** Makes one edit and waits until its writes are stored, or until their failure is told and the store is read again. */
  apply(change: ModelChange | readonly ModelChange[]): Promise<EditResult>;
  /** Waits until no write is queued and no read runs. */
  settled(): Promise<void>;
  /**
   * The calls that reached Notion since this was last asked, as `METHOD /path`, with the store's
   * data source written `store` and each row written as its title.
   */
  sent(): string[];
  /** Every row, in the order of creation, those in the trash too. */
  rows(): MemoryPage[];
  /** By title, the names of the properties of each row that differ from `before`; `in_trash` and `created` are names too. */
  written(before: readonly MemoryPage[]): Record<string, string[]>;
  /** What the store holds, to compare two stores by the store contract's meaning of "the same". */
  contents(): StoreContents;
  /** The same store opened again: what the database holds, read whole. */
  reopen(): Promise<OpenDocument>;
}

export interface OpenExampleOptions {
  /** Leave the handlers out, for a test that brings its own. */
  readonly handlers?: boolean;
  /** Leave the specification's constraints out of the handlers, so that only the binding refuses. */
  readonly constraints?: boolean;
}

/**
 * Puts a document in and opens it. `example` is the name of an example under
 * `test/examples/gartner-hype-cycle-graph`, or a document's text or bytes; without it the store is empty.
 */
export async function openExample(example?: string | Uint8Array, options: OpenExampleOptions = {}): Promise<OpenExample> {
  const { specification, binding, metamodel, persistence, expressions } = tool();
  const schema = storeSchema(binding, metamodel, persistence);
  const fbl = loadDocument(readFileSync(`${addon}.fbl`)).document!;
  const constraints = interpretConstraints(specification, metamodel, expressions).value;

  const memory = createMemoryCalls();
  const database = memory.notion.createDatabase();
  await prepare(schema, await memory.calls.dataSource(database.dataSourceId), memory.calls);
  if (example !== undefined) {
    const body = typeof example !== 'string' ? example
      : /[\r\n:]/.test(example) ? new TextEncoder().encode(example)
        : readFileSync(`test/examples/gartner-hype-cycle-graph/${example}/${example}.ghg`);
    await createRows(rowsOf(body, schema, binding).rows, database.dataSourceId, memory.calls);
  }

  const open = (): Promise<OpenDocument> =>
    openDocument({ specification, binding: fbl, database: database.id, notion: memory.calls, constraints: (model, read) => constraints.check(model, read) });
  const document = await open();
  if (options.handlers !== false) registerHandlers(document, options.constraints === false ? {} : { constraints });

  const events: DocumentEvent[] = [];
  let reading = false;
  document.subscribe((event) => {
    events.push(event);
    if (event.kind === 'status') reading = event.status === 'loading';
  });

  const rows = (): MemoryPage[] => memory.notion.rows(database.dataSourceId);
  const property = (name: string) => schema.properties.find((each) => each.name === name)!;
  const held = (page: MemoryPage, name: string): unknown => valueOf(property(name), page.properties[name] as never);
  const titleOf = (page: MemoryPage): string => String(held(page, schema.title) ?? '');
  let seen = memory.notion.calls.length;

  // Nothing here waits for a timer, so a turn of the event loop outlasts every call in flight.
  async function settled(): Promise<void> {
    for (let quiet = 0; quiet < 3;) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      quiet = memory.calls.status() === 'storing' || reading ? 0 : quiet + 1;
    }
  }

  return {
    ...memory,
    database,
    document,
    events,
    settled,
    rows,
    reopen: open,

    async apply(change) {
      const result = document.edit(change);
      await settled();
      return result;
    },

    sent() {
      const titles = new Map(rows().map((page) => [page.id, titleOf(page)]));
      const calls = memory.notion.calls.slice(seen).map((call) =>
        call.replace(database.dataSourceId, 'store').replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/, (id) => titles.get(id) ?? id));
      seen = memory.notion.calls.length;
      return calls;
    },

    written(before) {
      const was = new Map(before.map((page) => [page.id, page]));
      const changed: Record<string, string[]> = {};
      for (const page of rows()) {
        const old = was.get(page.id);
        const names = old ? Object.keys(page.properties).filter((name) => JSON.stringify(page.properties[name]) !== JSON.stringify(old.properties[name])) : ['created'];
        if (old && old.in_trash !== page.in_trash) names.push('in_trash');
        if (names.length > 0) changed[titleOf(page)] = names;
      }
      return changed;
    },

    contents() {
      const live = rows().filter((page) => !page.in_trash);
      const titles = new Map(live.map((page) => [page.id, titleOf(page)]));
      const order = (page: MemoryPage): number => (page.properties.Order?.number as number | null) ?? Infinity;
      const contents: StoreContents = {};
      for (const kind of schema.kinds) {
        contents[kind.name] = live.filter((page) => held(page, 'Kind') === kind.name)
          .sort((a, b) => (order(a) - order(b) || 0) || a.created_time.localeCompare(b.created_time))
          .map((page) => {
            const values: Record<string, unknown> = { [schema.title]: titleOf(page) };
            for (const { property: name } of kind.values) {
              const value = held(page, name);
              if (value === undefined) continue;
              // A relation is compared by the stored ids of the related rows.
              values[name] = property(name).type === 'relation' ? (value as string[]).map((id) => titles.get(id)).filter((title) => title !== undefined)
                : typeof value === 'bigint' ? Number(value) : value;
            }
            return values;
          });
      }
      return contents;
    },
  };
}
