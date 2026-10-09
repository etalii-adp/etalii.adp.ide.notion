// What the page asks a person in more than one place (etalii.adp spec 012,
// contracts/addon-address.md): the notice of a grant of access under way, and the properties a
// database lacks with the choice for each. The reading part shows them for a store the address
// names, and the selection for a database that was just chosen. This module attaches nothing.

import type { OpenDocument } from '../../store/document';
import { NotionError } from '../../store/notion';
import { ViewsError } from '../../store/schema';
import { ConnectError, type Waiting } from '../../store/session';

export function actionButton(document: Document, id: string, text: string, act: () => void): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  if (id !== '') made.id = id;
  made.className = 'adp-action';
  made.textContent = text;
  made.addEventListener('click', act);
  return made;
}

export function sentence(document: Document, text: string): HTMLParagraphElement {
  const line = document.createElement('p');
  line.textContent = text;
  return line;
}

/**
 * While a grant of access is under way: it goes on in a window of its own, or, where the page is
 * embedded in an app that opens none, in the person's browser. The link is the way there, and the
 * service hands the token to this page either way.
 */
export function waitingNotice(document: Document, waiting: Waiting, what: string): HTMLElement[] {
  const link = document.createElement('a');
  link.id = 'open-in-tab';
  link.className = 'adp-link';
  link.href = waiting.address;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'No window opened? Open the sign-in in your browser';
  const cancel = actionButton(document, 'cancel-connect', 'Cancel', () => waiting.cancel());
  cancel.classList.add('adp-action-quiet');
  return [sentence(document, `The sign-in continues in a browser window. Once access is granted there, ${what} here by itself.`), link, cancel];
}

/** Why a grant of access gave no token, as a sentence; nothing when the person stopped it. */
export function connectFailure(error: unknown): string | undefined {
  const reason = error instanceof ConnectError ? error.reason : undefined;
  if (reason === 'cancelled') return undefined;
  return reason === 'refused' ? 'Access was not granted.'
    : reason === 'timeout' ? 'Access was not granted in time. Connect again to try once more.'
      : `Connecting to Notion failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Why preparing a database failed, as a sentence. `prepared` says that the database is a store all
 * the same and only its views were left as they were; `forbidden` that this person may not change it.
 */
export function prepareFailure(error: unknown): { readonly sentence: string; readonly prepared: boolean; readonly forbidden: boolean } {
  if (error instanceof ViewsError) return { sentence: error.message, prepared: true, forbidden: false };
  if (error instanceof NotionError && error.kind === 'refused' && error.status === 403) {
    return { sentence: 'You may not change this database, so it cannot be prepared from here. Ask somebody who may.', prepared: false, forbidden: true };
  }
  return { sentence: `The database could not be prepared: ${error instanceof Error ? error.message : String(error)}`, prepared: false, forbidden: false };
}

const typeNames: Record<string, string> = { rich_text: 'text', multi_select: 'multi-select' };
const typeName = (type: string): string => typeNames[type] ?? type;

/**
 * What a database lacks to be a store, for the person to agree to (FR-034, FR-035): `id="properties"`
 * has one item per missing property, with the choice between a new property and each existing one
 * that can be given its name, and `id="prepare"` agrees. Nothing is changed before that.
 */
export function propertiesNotice(
  document: Document,
  lacking: NonNullable<OpenDocument['lacking']>,
  agree: (project: Record<string, string>) => void,
): HTMLElement[] {
  const list = document.createElement('ul');
  list.id = 'properties';
  list.className = 'adp-properties';
  const choices: HTMLSelectElement[] = [];
  const item = (name: string, type: string, ...what: (string | HTMLElement)[]): void => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'adp-property-name';
    label.textContent = `${name} (${typeName(type)})`;
    row.append(label, ...what);
    list.append(row);
  };

  if (lacking.rename) item(lacking.rename.to, 'title', `The title property ${lacking.rename.from} is given this name.`);
  for (const property of lacking.add) {
    const offered = lacking.projectable[property.name] ?? [];
    if (offered.length === 0) {
      item(property.name, property.type, 'A new property is added.');
      continue;
    }
    const choice = document.createElement('select');
    choice.className = 'adp-choice';
    choice.dataset.property = property.name;
    choice.setAttribute('aria-label', `Where the property ${property.name} comes from`);
    choice.append(new Option('Add a new property', ''), ...offered.map((existing) => new Option(`Use the existing property ${existing}, which is given this name`, existing)));
    // One property cannot be given two names: the choice made last takes it.
    choice.addEventListener('change', () => choices.forEach((other) => {
      if (other !== choice && other.value !== '' && other.value === choice.value) other.value = '';
    }));
    choices.push(choice);
    item(property.name, property.type, choice);
  }
  if (list.childElementCount === 0) return [];

  const prepare = actionButton(document, 'prepare', 'Prepare this database', () =>
    agree(Object.fromEntries(choices.filter((choice) => choice.value !== '').map((choice) => [choice.dataset.property!, choice.value]))));
  return [sentence(document, 'To be the store of a diagram, the database gets these properties. Nothing of it is changed until you agree, and no property is removed and no row is touched.'), list, prepare];
}
