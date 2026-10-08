// Undo and redo: the two buttons of the bar and the keys (etalii.adp spec 012,
// contracts/addon-address.md, "Keys"; FR-023, FR-025). Both go through the open document, whose
// history decides what there is to take; this part only asks and shows.

import type { EditResult, OpenDocument } from '../../store/document';
import { onPage, type Page } from '../page';

function attach(page: Page): () => void {
  const { bar } = page.regions;
  const document = bar.ownerDocument;

  let stopEvents = (): void => undefined;
  let closed = false;
  // The sentence this part showed last, so that it takes back no sentence but its own.
  let said = '';

  function button(id: string, text: string, name: string, act: () => void): HTMLButtonElement {
    const made = document.createElement('button');
    made.type = 'button';
    made.id = id;
    made.className = 'adp-button adp-button-quiet adp-history-step';
    made.textContent = text;
    made.setAttribute('aria-label', name);
    made.disabled = true;
    made.addEventListener('click', act);
    return made;
  }
  const undo = button('undo', 'Undo', 'Undo the last edit', () => take('undo'));
  const redo = button('redo', 'Redo', 'Redo the last undone edit', () => take('redo'));

  /** The document steps are taken on: only a page that is ready has one. */
  const editable = (): OpenDocument | undefined => (page.state === 'ready' ? page.document : undefined);

  function show(): void {
    const open = closed ? undefined : editable();
    if (!open) {
      undo.remove();
      redo.remove();
      return;
    }
    if (!undo.isConnected) bar.prepend(undo, redo);
    undo.disabled = !open.canUndo;
    redo.disabled = !open.canRedo;
  }

  function take(step: 'undo' | 'redo'): void {
    const open = editable();
    // With nothing to take, nothing is changed and nothing is shown.
    if (!open || !(step === 'undo' ? open.canUndo : open.canRedo)) return;
    const result: EditResult = step === 'undo' ? open.undo() : open.redo();
    if (!result.done) {
      said = result.sentence;
      page.say(said);
    } else if (said !== '') {
      if (page.message === said) page.clearMessage();
      said = '';
    }
    show();
  }

  function onKey(event: KeyboardEvent): void {
    if (!editable() || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    // A text being typed has an undo of its own, which is the browser's.
    const target = event.target as Element | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    const step = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : undefined;
    if (!step) return;
    event.preventDefault();
    take(step);
  }

  function follow(): void {
    stopEvents();
    // The document tells a change before its history has recorded it, so the buttons follow a moment later.
    stopEvents = page.document?.subscribe(() => void Promise.resolve().then(show)) ?? (() => undefined);
    show();
  }

  const stops = [page.on('document', follow), page.on('state', show)];
  document.addEventListener('keydown', onKey);
  follow();

  return () => {
    closed = true;
    document.removeEventListener('keydown', onKey);
    stops.forEach((each) => each());
    stopEvents();
    show();
  };
}

onPage(attach);
