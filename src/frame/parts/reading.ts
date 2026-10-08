// Reading: the part of the page that opens the store and shows it (etalii.adp spec 012,
// contracts/addon-address.md, "States"). It asks for access only from a click, opens the document,
// draws it, lists its findings and relays its status. It changes nothing in a store but to
// prepare one, when the user asks for that.

import { createCanvas } from '../../canvas/canvas';
import { sentenceOf } from '../../canvas/filters';
import { emptyModel, type Finding } from '../../disl/model';
import { isObject, type Message } from '../../disl/specification';
import { openDocument, type DocumentEvent, type OpenDocument } from '../../store/document';
import { NotionError } from '../../store/notion';
import { ConnectError } from '../../store/session';
import { onPage, type Page } from '../page';
import { interpretedOf, share } from './shared';

// The id DISL gives the sentence of a document that could not be read (DISL 9.1); the sentence
// itself is the specification's, and this one stands in for a specification that gives none.
const UNREADABLE = 'std.readOnly';
const unreadableOtherwise = 'The document could not be read, so it cannot be edited.';

const severities: Record<Finding['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Information' };

const isUnshared = (error: unknown): boolean => error instanceof NotionError && error.kind === 'refused' && (error.status === 404 || error.code === 'object_not_found');
const isForbidden = (error: unknown): boolean => error instanceof NotionError && error.kind === 'refused' && error.status === 403;
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function attach(page: Page): () => void {
  const { regions, specification } = page;
  const document = regions.canvas.ownerDocument;
  const window = document.defaultView;

  // Interpreted once for the page: the parts that edit work with the same.
  const { tool, constraints, findings } = interpretedOf(page);
  // What loading and interpreting the specification found: shown with every document.
  const ofSpecification: readonly Finding[] = [...page.findings, ...findings];

  const canvas = createCanvas(regions.canvas, { tool, onSelect: (ids) => page.select(ids), onView: () => list() });
  const stopSelection = page.on('selection', (ids) => canvas.select(ids));
  share(page, { canvas });

  const notice = document.createElement('div');
  notice.className = 'adp-notice';
  regions.canvas.after(notice);
  if (!regions.findings.hasAttribute('aria-label')) regions.findings.setAttribute('aria-label', 'Findings');

  let current: OpenDocument | undefined;
  let stopEvents = (): void => undefined;
  let closed = false;
  // Each opening has a number, so that an answer that arrives after a later one is dropped.
  let opening = 0;
  // How many reads are under way: the page is not read again while one is.
  let busy = 0;
  // The sentence this part showed last, so that it takes back no sentence but its own.
  let said = '';

  // ---- what the page is made of ----

  function tell(sentence: string): void {
    said = sentence;
    page.say(sentence);
  }

  function takeBack(): void {
    if (said !== '' && page.message === said) page.clearMessage();
    said = '';
  }

  function button(id: string, text: string, act: () => void): HTMLButtonElement {
    const made = document.createElement('button');
    made.type = 'button';
    made.id = id;
    made.className = 'adp-action';
    made.textContent = text;
    made.addEventListener('click', act);
    return made;
  }

  function say(sentences: readonly string[], ...more: HTMLElement[]): void {
    notice.replaceChildren(...sentences.map((sentence) => {
      const line = document.createElement('p');
      line.textContent = sentence;
      return line;
    }), ...more);
  }

  // `id="disconnect"` is there in every state that has a token, and in no other.
  function offerDisconnect(): void {
    const has = page.session.hasToken();
    const shown = regions.bar.querySelector('#disconnect');
    if (has && !shown) {
      const made = button('disconnect', 'Disconnect', disconnect);
      made.classList.add('adp-action-quiet');
      made.setAttribute('aria-label', 'Disconnect from Notion');
      regions.bar.insertBefore(made, regions.status);
    } else if (!has) shown?.remove();
  }

  function list(): void {
    const found = current ? [...ofSpecification, ...current.findings, ...(canvas.scene?.findings ?? [])] : [];
    regions.findings.replaceChildren(...found.map((finding) => {
      const item = document.createElement('li');
      item.className = 'adp-finding';
      item.dataset.severity = finding.severity;
      const severity = document.createElement('span');
      severity.className = 'adp-finding-severity';
      severity.textContent = severities[finding.severity];
      const element = finding.element;
      const sentence = document.createElement(element === undefined ? 'span' : 'button');
      sentence.className = 'adp-finding-sentence';
      sentence.textContent = finding.message;
      if (element !== undefined) {
        item.dataset.element = element;
        (sentence as HTMLButtonElement).type = 'button';
        sentence.addEventListener('click', () => {
          page.select([element]);
          canvas.select([element]);
          canvas.reveal(element);
        });
      }
      item.append(severity, sentence);
      return item;
    }));
  }

  // ---- the document ----

  function leave(): void {
    opening++;
    stopEvents();
    stopEvents = () => undefined;
    current?.close();
    current = undefined;
    page.open(undefined);
    page.select([]);
    canvas.show(emptyModel);
    list();
  }

  function render(): void {
    if (!current) return;
    const state = current.state;
    page.setState(state);
    canvas.show(current.model);
    list();
    if (state === 'unprepared') {
      say(
        ['This database is not prepared as a store yet.', ...current.findings.map((finding) => finding.message)],
        button('prepare', 'Prepare this database', prepare),
      );
    } else if (state === 'unreadable') {
      const messages = isObject(specification.behavior?.messages) ? specification.behavior.messages : {};
      say([sentenceOf(messages[UNREADABLE] as Message | undefined, { tool, model: emptyModel }) || unreadableOtherwise]);
    } else say([]);
  }

  function hear(event: DocumentEvent): void {
    if (event.kind === 'status') page.setStatus(event.status);
    else render();
  }

  // Why a store could not be read, as a state of the page or as a sentence.
  function failed(error: unknown): void {
    if (error instanceof NotionError && error.kind === 'connect') {
      leave();
      invite();
    } else if (isUnshared(error)) {
      leave();
      page.setState('unshared');
      page.setStatus('idle');
      say(
        ['This database is not shared with the connection of this add-on, so it cannot be read. Share it under Connections in the menu of the database, or connect again and choose it.'],
        button('connect', 'Connect again', () => {
          // A grant starts only when no token is kept, so the one that does not reach the database goes first.
          page.session.disconnect();
          connect();
        }),
      );
    } else if (error instanceof NotionError && error.kind === 'offline') {
      page.setStatus('offline');
      tell(`Notion could not be reached, so ${current ? 'the diagram shows what was read last' : 'the diagram is not shown'}. It is read again when the page regains the focus.`);
    } else {
      page.setStatus('failed');
      tell(`The database could not be read: ${reasonOf(error)}`);
    }
    offerDisconnect();
  }

  async function open(): Promise<void> {
    const mine = ++opening;
    busy++;
    takeBack();
    page.setState('loading');
    page.setStatus('loading');
    say([]);
    offerDisconnect();
    try {
      const opened = await openDocument({
        specification, binding: page.fbl, database: page.database, notion: page.notion,
        constraints: (model, read) => constraints.check(model, read),
      });
      if (closed || mine !== opening) {
        opened.close();
        return;
      }
      current = opened;
      stopEvents = opened.subscribe(hear);
      page.open(opened);
      page.setStatus(page.notion.status());
      render();
    } catch (error) {
      if (!closed && mine === opening) failed(error);
    } finally {
      busy--;
    }
  }

  function prepare(): void {
    const held = current;
    if (!held) return;
    takeBack();
    held.prepare().catch((error: unknown) => {
      if (closed || held !== current) return;
      if (!isForbidden(error)) {
        tell(`The database could not be prepared: ${reasonOf(error)}`);
        return;
      }
      // Nothing was changed, and this person cannot: the control goes.
      notice.querySelector('#prepare')?.remove();
      tell('You may not change this database, so it cannot be prepared from here. Ask somebody who may.');
    });
  }

  // ---- access ----

  function invite(): void {
    page.setState('connect');
    page.setStatus('idle');
    say(['Connect to Notion to see this diagram. Notion asks which pages this add-on may reach: choose the database of this diagram.'], button('connect', 'Connect to Notion', connect));
    offerDisconnect();
  }

  // Called from a click only: a browser opens no window at any other moment.
  function connect(): void {
    takeBack();
    offerDisconnect();
    page.session.token().then(
      () => void (closed || open()),
      (error: unknown) => {
        if (closed) return;
        const reason = error instanceof ConnectError ? error.reason : undefined;
        if (page.state !== 'connect') invite();
        if (reason === 'blocked' && !notice.querySelector('#open-in-tab')) {
          const link = document.createElement('a');
          link.id = 'open-in-tab';
          link.className = 'adp-link';
          link.href = document.location.href;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'Open this add-on in a tab of its own';
          notice.append(link);
        }
        tell(
          reason === 'blocked' ? 'The browser did not open the window to connect in. Open this add-on in a tab of its own and connect there.'
            : reason === 'closed' ? 'The window was closed before access was granted.'
              : reason === 'refused' ? 'Access was not granted.'
                : `Connecting to Notion failed: ${reasonOf(error)}`,
        );
      },
    );
  }

  function disconnect(): void {
    page.session.disconnect();
    takeBack();
    leave();
    invite();
  }

  // Back on the page: somebody may have changed the store meanwhile, or granted access in a tab.
  function onFocus(): void {
    if (closed || busy > 0 || page.status === 'storing') return;
    const held = current;
    if (!held) {
      if (page.session.hasToken()) void open();
      return;
    }
    busy++;
    held.reload().then(takeBack, (error: unknown) => void (closed || held !== current || failed(error))).finally(() => busy--);
  }

  window?.addEventListener('focus', onFocus);
  if (page.session.hasToken()) void open();
  else invite();

  return () => {
    closed = true;
    opening++;
    window?.removeEventListener('focus', onFocus);
    stopSelection();
    stopEvents();
    current?.close();
    current = undefined;
    share(page, { canvas: undefined });
    canvas.dispose();
    notice.remove();
    regions.findings.replaceChildren();
    regions.bar.querySelector('#disconnect')?.remove();
  };
}

onPage(attach);
