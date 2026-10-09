// Making the embed block of an add-on name the store that was selected for it (etalii.adp spec
// 012, FR-033; contracts/addon-address.md, "Selecting a store"). An embedded page is not told
// which block it is in, so the block is looked for beside the database: on the page that holds
// it, and on the pages directly under that page.

import { NotionError, type NotionBlock, type NotionCalls } from './notion';

/** Whether the block was given its address; where it was not, why, and whether that is a refusal rather than a count. */
export type Named =
  | { readonly set: true }
  | { readonly set: false; readonly sentence: string; readonly refused: boolean };

const withoutSlash = (path: string): string => path.replace(/\/$/, '');

/** Whether `address` is the add-on's own address, `own`, with no store: any other parameter is ignored. */
export function namesNoStore(address: string, own: string): boolean {
  try {
    const one = new URL(address);
    const other = new URL(own);
    return one.origin === other.origin && withoutSlash(one.pathname) === withoutSlash(other.pathname) && (one.searchParams.get('store') ?? '').trim() === '';
  } catch {
    return false;
  }
}

/** `address` with `store` as its store; its other parameters stay. */
export function withStore(address: string, store: string): string {
  const named = new URL(address);
  named.searchParams.set('store', store);
  return named.href;
}

async function blocksOf(calls: NotionCalls, pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  for (let cursor: string | undefined, more = true; more;) {
    const page = await calls.children(pageId, cursor);
    blocks.push(...page.results);
    more = page.has_more && page.next_cursor !== null;
    cursor = page.next_cursor ?? undefined;
  }
  return blocks;
}

/**
 * Makes the one embed block of the add-on at `own` that names no store name `store`: its address
 * keeps its other parameters. Nothing is changed where there is none, or more than one: which of
 * them is meant cannot be told.
 */
export async function nameStore(calls: NotionCalls, databaseId: string, own: string, store: string): Promise<Named> {
  const mine = (block: NotionBlock): boolean => block.type === 'embed' && typeof block.embed?.url === 'string' && namesNoStore(block.embed.url, own);
  try {
    const parent = (await calls.database(databaseId)).parent;
    if (parent?.type !== 'page_id' || !parent.page_id) {
      return { set: false, refused: true, sentence: 'The database is on no page, so there is no page on which the embed block of this add-on could be looked for.' };
    }
    const blocks = await blocksOf(calls, parent.page_id);
    const found = blocks.filter(mine);
    for (const under of blocks.filter((block) => block.type === 'child_page')) found.push(...(await blocksOf(calls, under.id)).filter(mine));
    if (found.length !== 1) {
      return {
        set: false,
        refused: false,
        sentence: found.length === 0
          ? 'No embed block of this add-on that names no database was found on the page of the database, or on the pages directly under it.'
          : `${found.length} embed blocks of this add-on that name no database were found, so none of them was changed.`,
      };
    }
    await calls.edit((writes) => writes.updateEmbed(found[0].id, withStore(found[0].embed!.url!, store)));
    return { set: true };
  } catch (error) {
    if (!(error instanceof NotionError)) throw error;
    return { set: false, refused: true, sentence: `The embed block of this add-on could not be found or changed: ${error.message}` };
  }
}
