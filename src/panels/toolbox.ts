// The toolbox (etalii.adp spec 012, contracts/shared-parts.md): every tool of the specification's
// `toolbox`, in its groups and order, with its label, icon and description. What a tool does is not
// its business: it says which tool was picked.

import { interpretMetamodel, type Metamodel } from '../disl/metamodel';
import { isCel, labelOf, localized, type Specification } from '../disl/specification';
import { groupsIn, interpretToolbox, type Tool, type Toolbox, type ToolGroup } from '../disl/toolbox';
import { icon } from './icons';
import { createPanel, make, nextId, type Panel } from './panel';

export type { Panel } from './panel';

export interface ToolboxOptions {
  readonly specification: Specification;
  /** Nothing may be changed: no tool is shown. */
  readonly readOnly: boolean;
  /** The tool's id in the specification's toolbox. */
  onPick(tool: string): void;
  /** The specification's toolbox and metamodel when they are interpreted already; read from the specification when absent. */
  readonly toolbox?: Toolbox;
  readonly metamodel?: Metamodel;
}

const moves: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

export function createToolbox(host: HTMLElement, options: ToolboxOptions): Panel {
  const document = host.ownerDocument;
  const { panel, body } = createPanel(host, { id: 'toolbox', label: 'Toolbox' });
  if (options.readOnly) return panel;

  const { specification } = options;
  const toolbox = options.toolbox ?? interpretToolbox(specification, options.metamodel ?? interpretMetamodel(specification).value).value;
  const locale = specification.language.defaultLocale ?? 'en';
  const items: HTMLButtonElement[] = [];
  // A tool in a folded group is not shown; one in a collapsed panel is, once the panel opens.
  const shown = (): HTMLButtonElement[] => items.filter((entry) => !tools.contains(entry.closest('[hidden]')));
  // One tool is in the Tab order, and the arrow keys reach the others.
  const stopAt = (one: HTMLButtonElement | undefined): void => items.forEach((entry) => void (entry.tabIndex = entry === one ? 0 : -1));

  const item = (tool: Tool): HTMLElement => {
    const button = make(document, 'button', 'adp-tool');
    button.type = 'button';
    button.dataset.tool = tool.id;
    const label = (isCel(tool.label) ? undefined : localized(tool.label, locale, locale)) ?? labelOf(tool.id);
    // The name is the label alone: the description is read as one.
    button.setAttribute('aria-label', label);
    if (tool.shortcut !== undefined) button.setAttribute('aria-keyshortcuts', tool.shortcut);
    const text = make(document, 'span', 'adp-tool-text');
    text.append(make(document, 'span', 'adp-tool-label', label));
    if (tool.doc !== undefined) {
      const doc = make(document, 'span', 'adp-tool-doc', tool.doc);
      doc.id = nextId();
      button.setAttribute('aria-describedby', doc.id);
      text.append(doc);
    }
    button.append(icon(document, tool.icon), text);
    if (tool.shortcut !== undefined) button.append(make(document, 'kbd', 'adp-shortcut', tool.shortcut));
    button.addEventListener('click', () => options.onPick(tool.id));
    items.push(button);
    return button;
  };

  const group = (declared: ToolGroup): HTMLElement => {
    const section = make(document, 'div', 'adp-tools-group');
    section.setAttribute('role', 'group');
    const content = make(document, 'div', 'adp-tools-items');
    if (declared.label === undefined) {
      section.setAttribute('aria-label', labelOf(declared.id));
    } else {
      // A group with a heading folds from it, and starts as the specification says.
      const heading = make(document, 'button', 'adp-tools-heading');
      heading.type = 'button';
      heading.id = nextId();
      section.setAttribute('aria-labelledby', heading.id);
      const fold = (folded: boolean): void => {
        heading.setAttribute('aria-expanded', String(!folded));
        heading.replaceChildren(icon(document, folded ? 'mdi-menu-right' : 'mdi-menu-down'), make(document, 'span', 'adp-tools-heading-label', declared.label));
        content.hidden = folded;
      };
      fold(declared.collapsed);
      heading.addEventListener('click', () => {
        fold(!content.hidden);
        // A tool in a folded group cannot be the one Tab stops at.
        stopAt(shown().find((entry) => entry.tabIndex === 0) ?? shown()[0]);
      });
      if (declared.doc !== undefined) heading.title = declared.doc;
      section.append(heading);
    }
    content.append(...declared.tools.map(item), ...declared.groups.map(group));
    section.append(content);
    return section;
  };

  const tools = make(document, 'div', 'adp-tools');
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'Tools');
  tools.setAttribute('aria-orientation', 'vertical');
  tools.append(...groupsIn(toolbox, undefined).map(group));
  tools.addEventListener('keydown', (event) => {
    const at = items.indexOf(event.target as HTMLButtonElement);
    const move = Object.hasOwn(moves, event.key) ? moves[event.key] : undefined;
    if (at < 0 || !move) return;
    event.preventDefault();
    const reach = shown();
    const next = reach[move(reach.indexOf(items[at]), reach.length)];
    stopAt(next);
    next.focus();
  });
  body.append(tools);
  stopAt(shown()[0]);
  return panel;
}
