// The menu a context menu of a specification is shown in, in Notion's manner: a popover of entries
// with icon, label and shortcut, in groups with a line between them. It is used with the keyboard as
// with the pointer, and gives the focus back to where it was when it closes.

import { icon } from './icons';
import { make } from './panel';

/** One entry. An entry the behavior offers (`OfferedEntry`) is one as it is. */
export interface MenuEntry {
  readonly label: string;
  readonly icon?: string;
  readonly shortcut?: string;
  /** False for an entry that is shown and cannot be picked now. */
  readonly enabled?: boolean;
  /** Why it cannot be picked. */
  readonly reason?: string;
}

export interface MenuOptions<Entry extends MenuEntry> {
  /** The entry that was picked; the menu is closed by then. */
  onPick(entry: Entry): void;
  /** The menu closed, with or without a pick. */
  onClose?(): void;
  /** The name assistive technology reads for the menu. */
  readonly label?: string;
}

export interface Menu {
  close(): void;
}

// How long the letters typed to find an entry count as one word.
const TYPEAHEAD = 600;

/** Opens a menu under a control, or at a point of the window, with the groups of entries shown apart. */
export function openMenu<Entry extends MenuEntry>(at: HTMLElement | { readonly x: number; readonly y: number }, groups: readonly (readonly Entry[])[], options: MenuOptions<Entry>): Menu {
  const anchor = 'ownerDocument' in at ? at : undefined;
  const document = anchor?.ownerDocument ?? globalThis.document;
  const view = document.defaultView!;
  const before = document.activeElement;
  const menu = make(document, 'div', 'adp-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', options.label ?? 'Menu');
  const items: HTMLButtonElement[] = [];
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener('pointerdown', outside, true);
    view.clearTimeout(forget);
    menu.remove();
    if (before instanceof view.HTMLElement || before instanceof view.SVGElement) before.focus();
    options.onClose?.();
  };
  // A press anywhere else closes the menu, and is left to do what it does there.
  const outside = (event: Event): void => {
    if (!menu.contains(event.target as Node)) close();
  };

  groups.filter((group) => group.length > 0).forEach((group, index) => {
    if (index > 0) menu.appendChild(make(document, 'div', 'adp-menu-separator')).setAttribute('role', 'separator');
    for (const entry of group) {
      const item = make(document, 'button', 'adp-menu-item');
      item.type = 'button';
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitem');
      // The name is the label alone: the shortcut is said as a shortcut.
      item.setAttribute('aria-label', entry.label);
      if (entry.shortcut !== undefined) item.setAttribute('aria-keyshortcuts', entry.shortcut);
      const slot = make(document, 'span', 'adp-menu-icon');
      if (entry.icon !== undefined) slot.append(icon(document, entry.icon));
      item.append(slot, make(document, 'span', 'adp-menu-label', entry.label));
      if (entry.shortcut !== undefined) item.append(make(document, 'kbd', 'adp-menu-shortcut', entry.shortcut));
      // Not `disabled`: the entry stays where the pointer finds the reason.
      if (entry.enabled === false) {
        item.setAttribute('aria-disabled', 'true');
        if (entry.reason !== undefined) item.title = entry.reason;
      }
      item.addEventListener('click', () => {
        if (entry.enabled === false) return;
        close();
        options.onPick(entry);
      });
      items.push(item);
      menu.append(item);
    }
  });

  const available = (): HTMLButtonElement[] => items.filter((item) => item.getAttribute('aria-disabled') !== 'true');
  let typed = '';
  let forget: number | undefined;
  menu.addEventListener('keydown', (event) => {
    const reach = available();
    const from = reach.indexOf(document.activeElement as HTMLButtonElement);
    const to = (index: number): void => {
      event.preventDefault();
      reach[(index + reach.length) % reach.length]?.focus();
    };
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') to(from + 1);
    else if (event.key === 'ArrowUp') to(from < 0 ? -1 : from - 1);
    else if (event.key === 'Home') to(0);
    else if (event.key === 'End') to(-1);
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typed += event.key;
      view.clearTimeout(forget);
      forget = view.setTimeout(() => void (typed = ''), TYPEAHEAD);
      const starts = (word: string) => (item: HTMLButtonElement): boolean => item.querySelector('.adp-menu-label')!.textContent!.toLowerCase().startsWith(word.toLowerCase());
      const turned = (first: number): HTMLButtonElement[] => [...reach.slice(first), ...reach.slice(0, first)];
      // A word is looked for from the entry that has the focus; one letter goes on to the next entry that starts with it.
      const found = (typed.length > 1 ? turned(Math.max(from, 0)).find(starts(typed)) : undefined) ?? turned(from + 1).find(starts(event.key));
      if (found) to(reach.indexOf(found));
    }
    // Keys pressed in a menu are the menu's: the page's own keys do not act under it.
    event.stopPropagation();
  });
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  document.body.append(menu);
  const point = anchor ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : (at as { x: number; y: number });
  // Kept inside the window, as far as the menu has a size to keep it by.
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(point.x, view.innerWidth - box.width))}px`;
  menu.style.top = `${Math.max(0, Math.min(point.y, view.innerHeight - box.height))}px`;
  document.addEventListener('pointerdown', outside, true);
  available()[0]?.focus();
  return { close };
}
