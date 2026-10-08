// The store's calls against the in-memory Notion, through the real service, with a clock that
// only the sleeps move: no test waits out Notion's limit in real time.

import { createNotionCalls, type NotionCalls, type NotionRow } from '../../src/store/notion';
import { createSession } from '../../src/store/session';
import type { MemoryNotion } from './memoryNotion';
import { createMemoryService, createMemoryStorage, type MemoryService } from './memoryService';

export interface MemoryCalls {
  readonly service: MemoryService;
  readonly notion: MemoryNotion;
  readonly calls: NotionCalls;
  /** Every row that is not in the trash, 100 a call. */
  allRows(dataSourceId: string): Promise<NotionRow[]>;
}

export function createMemoryCalls(): MemoryCalls {
  const service = createMemoryService();
  const storage = createMemoryStorage();
  storage.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: null, workspace: 'A workspace' }));
  const session = createSession({ service: service.address, storage, fetch: service.fetch, open: () => null, listen: () => () => undefined });
  let clock = 0;
  const calls = createNotionCalls({
    service: service.address,
    session,
    fetch: service.fetch,
    now: () => clock,
    sleep: async (milliseconds) => void (clock += milliseconds),
  });
  return {
    service,
    notion: service.notion,
    calls,
    async allRows(dataSourceId) {
      const rows: NotionRow[] = [];
      for (let cursor: string | undefined, more = true; more;) {
        const page = await calls.query(dataSourceId, { cursor });
        rows.push(...page.results);
        more = page.has_more;
        cursor = page.next_cursor ?? undefined;
      }
      return rows;
    },
  };
}
