// Selecting a store: what the state `setup` offers beside its steps (etalii.adp spec 012, FR-033
// to FR-035; contracts/addon-address.md, "Selecting a store"). The person chooses a database from
// the ones their access reaches, agrees to the properties it gets, and the embed block is made to
// name it. Nothing is asked of the service before `id="choose-store"` is used. There is no page of
// a store yet, so this module attaches to none: the entry calls it.

import type { Specification } from '../../disl/specification';
import type { FblDocument } from '../../fbl/documents/types';
import { openDocument, type OpenDocument } from '../../store/document';
import { nameStore, withStore, type Named } from '../../store/embed';
import { NotionError, type NotionCalls, type NotionFound } from '../../store/notion';
import type { Session } from '../../store/session';
import { actionButton, connectFailure, prepareFailure, propertiesNotice, sentence, waitingNotice } from './notices';

/** What the page of a store is told of its embed block, when that block could not be set. */
export interface Carried {
  readonly store: string;
  readonly sentence: string;
  /** Notion refused, or there was no page to look on: the sentence is a failure, not a count. */
  readonly refused: boolean;
}

export interface SelectionOptions {
  readonly document: Document;
  /** The element of the state `setup` the selection is shown in. */
  readonly host: HTMLElement;
  /** Shows a refusal or a failure in `id="message"`; '' takes it back. */
  say(sentence: string): void;
  /** The address of this page, with whatever parameters it has. */
  readonly address: string;
  readonly specification: Specification;
  readonly binding: FblDocument;
  /** The session and the calls, made at the first use. */
  connect(): { readonly session: Session; readonly notion: NotionCalls };
  /** Keeps what the page of the store is to show; false where the browser keeps nothing. */
  carry(carried: Carried): boolean;
  navigate(address: string): void;
  copy(text: string): Promise<void>;
}

/** How many databases are listed at a time. */
const PAGE = 25;

const places: Record<string, string> = { page_id: 'On a page', block_id: 'On a page', workspace: 'At the top of the workspace', database_id: 'In another database' };
const titleOf = (found: NotionFound): string => found.title.map((part) => part.plain_text).join('').trim() || 'Untitled';
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * `id="store-address"` and `id="copy-store-address"`: the address with its store, for the person
 * to put in the embed block. `why` says why the add-on did not do so itself.
 */
export function storeAddressNotice(document: Document, address: string, why: string, copy: (text: string) => Promise<void>): HTMLElement[] {
  const field = document.createElement('input');
  field.id = 'store-address';
  field.className = 'adp-field';
  field.readOnly = true;
  field.value = address;
  field.setAttribute('aria-label', 'The address of this add-on with its database');
  field.addEventListener('focus', () => field.select());
  const button = actionButton(document, 'copy-store-address', 'Copy the address', () => {
    copy(address).then(
      () => void (button.textContent = 'Copied'),
      () => {
        // The browser lets an embedded page copy nothing: the address is selected for the keyboard.
        field.focus();
        field.select();
        button.textContent = 'Copy it with the keyboard';
      },
    );
  });
  return [sentence(document, `${why} Put this address in the embed block of this add-on, so that the block shows this diagram whenever its page is opened.`.trim()), field, button];
}

export function offerSelection(options: SelectionOptions): void {
  const { document, host } = options;
  const area = document.createElement('div');
  area.className = 'adp-selection';
  area.setAttribute('aria-live', 'polite');
  host.append(actionButton(document, 'choose-store', 'Choose a database', start), area);

  let made: ReturnType<SelectionOptions['connect']> | undefined;
  const calls = (): ReturnType<SelectionOptions['connect']> => (made ??= options.connect());
  // Each step has a number, so that an answer that arrives after a later step is dropped.
  let step = 0;
  const show = (...elements: HTMLElement[]): void => area.replaceChildren(...elements);
  const busy = (text: string): void => show(sentence(document, text));
  const quiet = (id: string, text: string, act: () => void): HTMLButtonElement => {
    const button = actionButton(document, id, text, act);
    button.classList.add('adp-action-quiet');
    return button;
  };

  // Called from a click only: a browser opens no window at any other moment.
  function start(): void {
    const mine = ++step;
    options.say('');
    const { session } = calls();
    if (session.hasToken()) return void list('');
    session.token({ onWaiting: (waiting) => void (mine === step && show(...waitingNotice(document, waiting, 'the databases are listed'))) }).then(
      () => void (mine === step && list('')),
      (error: unknown) => {
        if (mine !== step) return;
        show();
        options.say(connectFailure(error) ?? '');
      },
    );
  }

  async function list(text: string, cursor?: string, before: readonly NotionFound[] = []): Promise<void> {
    const mine = ++step;
    if (cursor === undefined) busy('Looking for the databases this add-on may reach.');
    try {
      const page = await calls().notion.search({ text, cursor, pageSize: PAGE });
      if (mine === step) listed(text, [...before, ...page.results], page.has_more ? (page.next_cursor ?? undefined) : undefined);
    } catch (error) {
      if (mine !== step) return;
      show();
      options.say(error instanceof NotionError && error.kind === 'connect'
        ? 'Notion no longer takes the access that was kept. Choose a database again to grant it anew.'
        : `The databases could not be listed: ${reasonOf(error)}`);
    }
  }

  function listed(text: string, found: readonly NotionFound[], next: string | undefined): void {
    const find = document.createElement('form');
    find.className = 'adp-find';
    find.setAttribute('role', 'search');
    const field = document.createElement('input');
    field.id = 'find-store';
    field.type = 'search';
    field.className = 'adp-field';
    field.value = text;
    field.placeholder = 'Find a database by name';
    field.setAttribute('aria-label', 'Find a database by name');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'adp-action adp-action-quiet';
    submit.textContent = 'Find';
    find.append(field, submit);
    find.addEventListener('submit', (event) => {
      event.preventDefault();
      void list(field.value.trim());
    });

    const stores = document.createElement('ul');
    stores.id = 'stores';
    stores.className = 'adp-stores';
    stores.setAttribute('aria-label', 'Databases');
    // A database with several data sources is found once for each: it is listed once, as its first.
    const databases = new Map<string, NotionFound>();
    for (const each of found) {
      const database = each.parent.database_id;
      if (database && !databases.has(database)) databases.set(database, each);
    }
    for (const [database, each] of databases) {
      const item = document.createElement('li');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'adp-store';
      choice.dataset.store = database;
      const title = document.createElement('span');
      title.className = 'adp-store-title';
      title.textContent = titleOf(each);
      const where = document.createElement('span');
      where.className = 'adp-store-where';
      where.textContent = places[each.database_parent?.type ?? ''] ?? '';
      choice.append(title, where);
      choice.addEventListener('click', () => void choose(database, titleOf(each)));
      item.append(choice);
      stores.append(item);
    }

    const none = databases.size > 0 ? [] : [sentence(document, text === ''
      ? 'No database is shared with this add-on yet. In Notion, share one with the connection of this add-on, under Connections in the menu of the database, or grant access again and include it.'
      : `No database with "${text}" in its name is shared with this add-on.`)];
    const more = next === undefined ? [] : [quiet('more-stores', 'Show more databases', () => void list(text, next, found))];
    const again = quiet('connect', 'Grant access again', () => {
      // A grant starts only when no token is kept, so the one that does not reach the database goes first.
      calls().session.disconnect();
      start();
    });
    show(sentence(document, 'Choose the database that is to be the store of this diagram.'), find, ...none, stores, ...more, again);
    if (text !== '') field.focus();
  }

  async function choose(database: string, title: string): Promise<void> {
    const mine = ++step;
    options.say('');
    busy(`Checking the properties of ${title}.`);
    try {
      const opened = await openDocument({ specification: options.specification, binding: options.binding, database, notion: calls().notion });
      if (mine === step) checked(opened, database, title);
      else opened.close();
    } catch (error) {
      if (mine !== step) return;
      options.say(`The database could not be read: ${reasonOf(error)}`);
      void list('');
    }
  }

  // The same check as that of a store the address names: what the document says it lacks.
  function checked(opened: OpenDocument, database: string, title: string): void {
    if (opened.state !== 'unprepared') {
      opened.close();
      return void place(database);
    }
    const mine = step;
    const agree = (project: Record<string, string>): void => {
      options.say('');
      opened.prepare(project).catch((error: unknown) => {
        const said = prepareFailure(error);
        if (mine === step) options.say(said.sentence);
        if (!said.prepared) throw error;
      }).then(() => void (mine === step && checked(opened, database, title)), () => undefined);
    };
    const refused = opened.findings.filter((found) => found.severity === 'error').map((found) => sentence(document, found.message));
    const another = quiet('', 'Choose another database', () => {
      opened.close();
      void list('');
    });
    show(sentence(document, `${title} is not prepared as a store yet.`), ...refused, ...(opened.lacking ? propertiesNotice(document, opened.lacking, agree) : []), another);
  }

  async function place(database: string): Promise<void> {
    const mine = ++step;
    const store = database.replaceAll('-', '');
    const target = withStore(options.address, store);
    busy('Looking for the embed block of this add-on.');
    let named: Named;
    try {
      named = await nameStore(calls().notion, database, options.address, store);
    } catch (error) {
      named = { set: false, refused: true, sentence: `The embed block of this add-on could not be found: ${reasonOf(error)}` };
    }
    if (mine !== step) return;
    if (named.set || options.carry({ store, sentence: named.sentence, refused: named.refused })) return options.navigate(target);
    // Nothing can be carried to the page of the store, so the address is shown here, with the way on.
    if (named.refused) options.say(named.sentence);
    const on = document.createElement('a');
    on.className = 'adp-link';
    on.href = target;
    on.textContent = 'Show the diagram';
    show(...storeAddressNotice(document, target, named.refused ? '' : named.sentence, options.copy), on);
  }
}
