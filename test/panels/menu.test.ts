import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMenu, type MenuEntry } from '../../src/panels/menu';
import { accessibleName, press } from './dom';

// The menu a context menu of a specification is shown in (etalii.adp spec 012, NFR-001, NFR-006).

const groups: MenuEntry[][] = [
  [{ label: 'Rename…', icon: 'mdi-pencil-outline', shortcut: 'F2' }, { label: 'Even out', enabled: false, reason: 'Nothing to even out.' }, { label: 'Remove', icon: 'mdi-delete-outline', shortcut: 'Delete' }],
  [{ label: 'Arrange diagram', icon: 'mdi-sitemap-outline' }],
];

const open = (at: HTMLElement | { x: number; y: number } = { x: 40, y: 30 }) => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const menu = openMenu(at, groups, { onPick, onClose, label: 'Actions' });
  const element = document.querySelector<HTMLElement>('[role="menu"]');
  return { menu, onPick, onClose, element, items: [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')] };
};

afterEach(() => document.body.replaceChildren());

describe('a menu', () => {
  it('is a popover with one item for each entry, its icon, label and shortcut, and a line between the groups', () => {
    const { element, items } = open();
    expect([element!.getAttribute('aria-label'), element!.parentElement]).toEqual(['Actions', document.body]);
    expect(items.map((item) => [accessibleName(item), item.querySelector('svg')?.dataset.icon, item.querySelector('.adp-menu-shortcut')?.textContent, item.getAttribute('aria-disabled')])).toEqual([
      ['Rename…', 'mdi-pencil-outline', 'F2', null], ['Even out', undefined, undefined, 'true'], ['Remove', 'mdi-delete-outline', 'Delete', null], ['Arrange diagram', 'mdi-sitemap-outline', undefined, null],
    ]);
    expect(items[1].title).toBe('Nothing to even out.');
    expect(element!.querySelectorAll('[role="separator"]').length).toBe(1);
    expect([...element!.querySelectorAll('*')].flatMap((part) => [...part.classList]).filter((name) => !name.startsWith('adp-'))).toEqual([]);
  });

  it('opens at the point it is given, or under the control it is opened from', () => {
    expect([open().element!.style.left, document.querySelector<HTMLElement>('[role="menu"]')!.style.top]).toEqual(['40px', '30px']);
    document.body.replaceChildren();
    const anchor = document.body.appendChild(document.createElement('button'));
    anchor.getBoundingClientRect = () => ({ left: 12, bottom: 50, top: 22, right: 80, width: 68, height: 28, x: 12, y: 22, toJSON: () => ({}) });
    const { element } = open(anchor);
    expect([element!.style.left, element!.style.top]).toEqual(['12px', '50px']);
  });

  it('takes the focus on its first entry and moves it with the arrow keys, Home and End, past an entry that is not available', () => {
    const { items } = open();
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    press(items[2], 'ArrowDown');
    press(items[3], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[3]);
    press(items[3], 'Home');
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'End');
    expect(document.activeElement).toBe(items[3]);
  });

  it('finds an entry by the letters that are typed', () => {
    vi.useFakeTimers();
    const { items } = open();
    press(items[0], 'a');
    expect(document.activeElement).toBe(items[3]);
    // A pause ends the word.
    vi.advanceTimersByTime(1000);
    press(items[3], 'r');
    expect(document.activeElement).toBe(items[0]);
    press(items[3], 'e');
    press(items[3], 'm');
    expect(document.activeElement).toBe(items[2]);
    vi.useRealTimers();
  });

  it('gives the entry that is picked with Enter, Space or the pointer, closes, and returns the focus to where it was', () => {
    for (const pick of [(item: HTMLElement) => press(item, 'Enter'), (item: HTMLElement) => press(item, ' '), (item: HTMLElement) => item.click()]) {
      document.body.replaceChildren();
      const before = document.body.appendChild(document.createElement('button'));
      before.focus();
      const { items, onPick, onClose } = open();
      pick(items[2]);
      expect(onPick.mock.calls).toEqual([[groups[0][2]]]);
      expect([document.querySelector('[role="menu"]'), document.activeElement, onClose.mock.calls.length]).toEqual([null, before, 1]);
    }
  });

  it('does not give an entry that is not available', () => {
    const { items, onPick, element } = open();
    items[1].click();
    expect([onPick.mock.calls.length, element!.isConnected]).toEqual([0, true]);
  });

  it('closes on Escape, on a press outside it and when it is told to, and gives nothing', () => {
    for (const close of [
      (item: HTMLElement) => void press(item, 'Escape'),
      () => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
      (_item: HTMLElement, menu: { close(): void }) => menu.close(),
    ]) {
      document.body.replaceChildren();
      const before = document.body.appendChild(document.createElement('button'));
      before.focus();
      const { items, onPick, onClose, menu } = open();
      close(items[0], menu);
      expect([document.querySelector('[role="menu"]'), document.activeElement, onPick.mock.calls.length, onClose.mock.calls.length]).toEqual([null, before, 0, 1]);
    }
  });

  it('stays open on a press inside it', () => {
    const { element, items } = open();
    items[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(element!.isConnected).toBe(true);
  });
});
