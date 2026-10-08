// Whether somebody else changed a store since it was read (etalii.adp spec 012, contracts/store.md,
// "Reading and writing"; research D10). Notion has no conditional write, so the store asks just
// before it writes. A row somebody else moved to the trash is not found here: a query never
// returns it, and the write to it is refused instead.

import type { NotionCalls, NotionRow } from './notion';

/** When a row was last edited and by whom, as Notion says it. */
export interface RowEdit {
  readonly time: string;
  readonly editor: string;
}

export interface Drift {
  /** Somebody else edited or created a row. */
  readonly changed: boolean;
  /** Those rows. */
  readonly rows: readonly string[];
  /** The newest edit time among the rows that came back; the next check may ask from there on. */
  readonly newest: string | undefined;
}

export const editOf = (held: NotionRow): RowEdit => ({ time: held.last_edited_time, editor: held.last_edited_by.id });

/** Notion gives an edit time to the minute, so a time within a minute asks for that whole minute. */
export const minuteOf = (time: string): string => new Date(Math.floor(Date.parse(time) / 60_000) * 60_000).toISOString();

/**
 * Asks for the rows edited or created from the minute of `since` on; every row when the store had
 * none. A row whose edit time and editor are those the store knows of it, from its last read or
 * its own last write to it, is set aside. Any other row is somebody else's change.
 */
export async function findDrift(notion: NotionCalls, dataSourceId: string, since: string | undefined, own: ReadonlyMap<string, RowEdit>): Promise<Drift> {
  const rows: string[] = [];
  let newest: string | undefined;
  for (let cursor: string | undefined, more = true; more;) {
    const page = await notion.query(dataSourceId, { cursor, editedSince: since === undefined ? undefined : minuteOf(since) });
    for (const held of page.results) {
      const known = own.get(held.id);
      if (known?.time !== held.last_edited_time || known.editor !== held.last_edited_by.id) rows.push(held.id);
      if (newest === undefined || held.last_edited_time > newest) newest = held.last_edited_time;
    }
    more = page.has_more && page.next_cursor !== null;
    cursor = page.next_cursor ?? undefined;
  }
  return { changed: rows.length > 0, rows, newest };
}
