// What every panel shares (etalii.adp spec 012, contracts/shared-parts.md and addon-address.md): a
// region with a name, a toggle that stays in view, `data-collapsed`, and the collapsed state kept in
// the browser's local storage per add-on and per panel.

import { icon } from './icons';

/** A panel of the page, as the shared-parts contract gives it. */
export interface Panel {
  collapsed: boolean;
  dispose(): void;
}

/**
 * What an edit answers. It is the `EditResult` of the store, stated here as well because the panels
 * import no store: an add-on with another store answers in the same two shapes.
 */
export type EditResult =
  | { readonly done: true }
  | { readonly done: false; readonly sentence: string };

export interface PanelOptions {
  /** The id of the region and of its key in the local storage; the toggle is `<id>-toggle`. */
  readonly id: string;
  /** The name assistive technology reads for the region. */
  readonly label: string;
}

export interface PanelParts {
  readonly panel: Panel;
  /** Where the panel's content goes: what a collapsed panel hides. */
  readonly body: HTMLElement;
}

/** An element of a class of the shared parts, with a text when one is given. */
export function make<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

let count = 0;
/** An id no other element of the page has, for a label to name its control by. */
export const nextId = (): string => `adp-${++count}`;

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';

/** Makes a region of the page a panel. The region is the frame's; what is added to it is taken away by `dispose`. */
export function createPanel(host: HTMLElement, options: PanelOptions): PanelParts {
  const document = host.ownerDocument;
  const storage = document.defaultView?.localStorage;
  const key = `adp-notion.${document.documentElement.dataset.addon ?? ''}.panel.${options.id}`;
  const name = options.label.toLowerCase();
  const before = { id: host.id, role: host.getAttribute('role'), label: host.getAttribute('aria-label') };

  // A browser may refuse the storage to an embedded page: the panel then opens expanded and keeps nothing.
  const kept = (): boolean => {
    try {
      return storage?.getItem(key) === COLLAPSED;
    } catch {
      return false;
    }
  };
  const keep = (collapsed: boolean): void => {
    try {
      storage?.setItem(key, collapsed ? COLLAPSED : EXPANDED);
    } catch {
      // Nothing is kept.
    }
  };

  host.id = options.id;
  host.classList.add('adp-panel');
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', options.label);

  const header = make(document, 'header', 'adp-panel-header');
  const toggle = make(document, 'button', 'adp-panel-toggle');
  toggle.type = 'button';
  toggle.id = `${options.id}-toggle`;
  const title = make(document, 'span', 'adp-panel-title', options.label);
  const body = make(document, 'div', 'adp-panel-body');
  body.id = `${options.id}-body`;
  toggle.setAttribute('aria-controls', body.id);
  header.append(toggle, title);
  host.append(header, body);

  let collapsed = false;
  const show = (): void => {
    host.dataset.collapsed = String(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? 'Open' : 'Collapse'} the ${name}`);
    toggle.title = toggle.getAttribute('aria-label')!;
    toggle.replaceChildren(icon(document, collapsed ? 'mdi-menu-right' : 'mdi-menu-down'));
    title.hidden = collapsed;
    body.hidden = collapsed;
  };
  const set = (next: boolean): void => {
    if (next === collapsed) return;
    collapsed = next;
    keep(collapsed);
    show();
  };
  collapsed = kept();
  show();
  toggle.addEventListener('click', () => set(!collapsed));

  return {
    body,
    panel: {
      get collapsed() {
        return collapsed;
      },
      set collapsed(next: boolean) {
        set(next);
      },
      dispose() {
        header.remove();
        body.remove();
        host.classList.remove('adp-panel');
        delete host.dataset.collapsed;
        host.id = before.id;
        for (const [attribute, value] of [['role', before.role], ['aria-label', before.label]] as const) {
          if (value === null) host.removeAttribute(attribute);
          else host.setAttribute(attribute, value);
        }
      },
    },
  };
}
