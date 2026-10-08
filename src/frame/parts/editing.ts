// Editing: the part of the page that changes the open document (etalii.adp spec 012, FR-015,
// FR-019, FR-020, NFR-008; contracts/addon-address.md, "What a reader and a user can rely on").
// Every way a user asks for a change ends in one intent of the interpreted behavior, and every
// intent takes one path: its outcome becomes the changes the store takes, and those are one edit
// of the document, one step of undo. A refusal at any step changes nothing and is told in
// `id="message"`. The part is at work while the page is `ready` and a document is open.

import type { Canvas } from '../../canvas/canvas';
import { attachGestures, type MenuPlace } from '../../canvas/gestures';
import { attachInPlaceEdit } from '../../canvas/inPlaceEdit';
import type { OfferedEntry, Outcome, Pending, Question, Situation } from '../../disl/behavior';
import { openMenu, type Menu } from '../../panels/menu';
import { modelChangesOf } from '../../store/changes';
import { READ_AGAIN, storeOf, type DocumentEvent, type EditResult, type OpenDocument } from '../../store/document';
import { registerHandlers } from '../../store/handlers';
import { onPage, type Page } from '../page';
import { interpretedOf, onShared, share, shared, type Editor } from './shared';

let made = 0;

function attach(page: Page): () => void {
  const { regions } = page;
  const document = regions.canvas.ownerDocument;
  const window = document.defaultView;

  // The handlers of a document are registered once, however often the page becomes ready with it.
  const registered = new WeakSet<OpenDocument>();
  let active: { readonly canvas: Canvas; readonly open: OpenDocument; leave(): void } | undefined;
  let followed: OpenDocument | undefined;
  let stopEvents = (): void => undefined;
  let menu: Menu | undefined;
  let closeQuestion = (): void => undefined;
  // The sentence this part showed last, so that it takes back no sentence but its own.
  let said = '';

  function refuse(sentence: string): EditResult {
    said = sentence;
    page.say(sentence);
    return { done: false, sentence };
  }

  function taken(): void {
    if (said !== '' && page.message === said) page.clearMessage();
    said = '';
  }

  // ---- a question before a removal or an operation, in Notion's manner ----

  function ask(question: Question, proceed: () => void): void {
    closeQuestion();
    const before = document.activeElement;
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text?: string): HTMLElementTagNameMap[K] => {
      const one = document.createElement(tag);
      one.className = name;
      if (text !== undefined) one.textContent = text;
      return one;
    };
    const backdrop = element('div', 'adp-confirm-backdrop');
    const box = element('div', 'adp-confirm');
    const title = element('h2', 'adp-confirm-title', question.title);
    const message = element('p', 'adp-confirm-message', question.message);
    const answers = element('div', 'adp-confirm-answers');
    const no = element('button', 'adp-action', question.cancelLabel);
    const yes = element('button', `adp-action ${question.danger ? 'adp-confirm-danger' : 'adp-confirm-yes'}`, question.confirmLabel);
    no.type = yes.type = 'button';
    title.id = `adp-confirm-title-${++made}`;
    message.id = `adp-confirm-message-${made}`;
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', title.id);
    box.setAttribute('aria-describedby', message.id);
    answers.append(no, yes);
    box.append(title, message, answers);
    backdrop.append(box);

    const close = (answer: boolean): void => {
      closeQuestion = () => undefined;
      backdrop.remove();
      if (before instanceof HTMLElement || before instanceof SVGElement) before.focus({ preventScroll: true });
      if (answer) proceed();
    };
    closeQuestion = () => close(false);
    no.addEventListener('click', () => close(false));
    yes.addEventListener('click', () => close(true));
    backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(false); });
    box.addEventListener('keydown', (event) => {
      // Keys pressed here are the question's: neither the canvas nor undo acts under it.
      event.stopPropagation();
      if (event.key === 'Escape') close(false);
      else if (event.key === 'Tab') (document.activeElement === no ? yes : no).focus();
      else return;
      event.preventDefault();
    });
    document.body.append(backdrop);
    // What cannot be taken back by the answer alone starts on no.
    (question.danger ? no : yes).focus();
  }

  // ---- the page at work ----

  function begin(canvas: Canvas, open: OpenDocument): void {
    const { tool, toolbox, behavior, constraints } = interpretedOf(page);
    if (!registered.has(open)) {
      registerHandlers(open, { constraints });
      registered.add(open);
    }
    const editable = (): boolean => active?.open === open && page.state === 'ready';
    const situation = (): Situation => ({ env: { viewpoint: canvas.view.viewpoint, mode: canvas.view.mode } });
    const select = (ids: readonly string[]): void => {
      page.select(ids);
      canvas.select(ids);
    };

    /** The one path of a change: from an outcome through the bridge into the document, then what the outcome asks of the page. */
    function apply(outcome: Outcome): EditResult {
      if (!editable()) return { done: false, sentence: '' };
      if (outcome.refused !== undefined) return refuse(outcome.refused);
      if (outcome.changes.length > 0) {
        const changes = modelChangesOf(outcome.changes, storeOf(open), open.model);
        if ('refused' in changes) return refuse(changes.refused);
        const result: EditResult = changes.length > 0 ? open.edit(changes) : { done: true };
        if (!result.done) return refuse(result.sentence);
      }
      taken();
      // The document told its change inside `edit`, and whoever draws it has drawn; this is for a page where nobody does.
      if (canvas.model !== open.model) canvas.show(open.model);
      for (const effect of outcome.effects) {
        if (effect.kind === 'select') select(effect.elements);
        else if (effect.kind === 'reveal') effect.elements.forEach((id) => canvas.reveal(id));
        else if (effect.kind === 'editLabel' && effect.elements.length > 0) {
          select([effect.elements[0]]);
          inPlace.open(effect.elements[0]);
        }
      }
      return { done: true };
    }

    function pick(entry: OfferedEntry, target: string | Pending | undefined, place: MenuPlace): void {
      if (!editable()) return;
      if (typeof target === 'object') {
        if (entry.via !== undefined) gestures.connect(entry.via, target.source, target.target, place.ends);
      } else if (entry.operation !== undefined) gestures.operate(entry.operation, place.point);
      else if (entry.kind === 'delete') gestures.remove();
      else if (entry.kind === 'editLabel' && target !== undefined) inPlace.open(target);
    }

    function onMenu(target: string | Pending | undefined, place: MenuPlace): void {
      menu?.close();
      // What a menu's entries act on is the selection: the element it was asked on, or nothing on the empty canvas.
      if (target === undefined) select([]);
      else if (typeof target === 'string' && !canvas.selection.includes(target)) select([target]);
      const { groups } = behavior.menu(canvas.model, target, situation());
      if (groups.length === 0) return;
      const mine = menu = openMenu(place.client, groups, {
        label: 'Diagram',
        onPick: (entry) => pick(entry, target, place),
        onClose: () => { if (menu === mine) menu = undefined; },
      });
    }

    const gestures = attachGestures(canvas, {
      tool, behavior, toolbox,
      onIntent: (outcome) => apply(outcome).done,
      onRefused: (sentence) => void refuse(sentence),
      onMenu,
      onConfirm: ask,
      onArmed: (armed) => share(page, { armed }),
      readOnly: () => !editable(),
    });
    const inPlace = attachInPlaceEdit(canvas, {
      behavior,
      onIntent: (outcome) => apply(outcome).done,
      onRefused: (sentence) => void refuse(sentence),
      readOnly: () => !editable(),
    });

    const editor: Editor = {
      gestures,
      run: (intent) => apply(intent(open.model, situation())),
      operate(operation, selection) {
        const state = behavior.availability(open.model, operation, selection, situation());
        const run = (): EditResult => apply(behavior.operate(open.model, operation, selection, situation()));
        if (!state.available || !state.confirm) return run();
        ask(state.confirm, run);
        return { done: true };
      },
    };
    active = {
      canvas, open,
      leave() {
        menu?.close();
        closeQuestion();
        inPlace.dispose();
        gestures.dispose();
      },
    };
    share(page, { editor, armed: undefined });
  }

  function end(): void {
    const was = active;
    if (!was) return;
    // Emptied first: nothing that closes may still change something.
    active = undefined;
    was.leave();
    share(page, { editor: undefined, armed: undefined });
  }

  function hear(event: DocumentEvent): void {
    // A reading made because of somebody else's change or a write that failed says why; one nobody's change asked for says nothing.
    if (event.kind === 'reloaded' && event.sentence !== READ_AGAIN) refuse(event.sentence);
  }

  function follow(): void {
    if (page.document !== followed) {
      stopEvents();
      followed = page.document;
      stopEvents = followed?.subscribe(hear) ?? (() => undefined);
    }
    const { canvas } = shared(page);
    const open = page.state === 'ready' ? page.document : undefined;
    if (active && (active.canvas !== canvas || active.open !== open)) end();
    if (!active && canvas && open) begin(canvas, open);
  }

  // ---- storing ----

  // While writes are queued, leaving the page loses those not sent: the browser is asked to warn first, where it lets an embedded page do so.
  function onLeave(event: BeforeUnloadEvent): void {
    if (page.status !== 'storing') return;
    event.preventDefault();
    event.returnValue = '';
  }

  // How many writes an edit is cannot be told, so the status says that it is storing and no more: the stylesheet shows that it goes on.
  function onStatus(): void {
    if (page.status === 'storing') regions.status.setAttribute('aria-busy', 'true');
    else regions.status.removeAttribute('aria-busy');
  }

  const stops = [page.on('state', follow), page.on('document', follow), page.on('status', onStatus), onShared(page, follow)];
  window?.addEventListener('beforeunload', onLeave);
  onStatus();
  follow();

  return () => {
    stops.forEach((each) => each());
    window?.removeEventListener('beforeunload', onLeave);
    stopEvents();
    end();
    regions.status.removeAttribute('aria-busy');
  };
}

onPage(attach);
