# How the Notion add-ons are styled, and where that differs from Notion

Everything a Notion add-on of ADP shows around its diagram (the toolbox, the property grid, the menus, the controls, the findings and the messages) is styled to read as a part of the Notion page it is embedded in. This page says where each value of that styling comes from, where the add-ons depart from Notion's own styling and why, and what contrast each pair of a text or a control and its background has in the light and in the dark appearance.

**No value on this page was measured in a running Notion client.** An embedded page cannot read the stylesheet of the page around it, so the values were taken from write-ups about Notion's interface, recalled, or estimated, all on 2026-10-08, and each is marked with which of those it is. The pass beside Notion (task T122 of spec 012-notion-hype-cycle-addon of `etalii.adp`) sets the panels beside Notion's own in both appearances and corrects the values and this page with them. Until then every value marked R or E, and every departure that follows from one, is provisional.

## Where the styling lives

| File | Holds |
| --- | --- |
| [`src/panels/notion.css`](../src/panels/notion.css) | Every colour, type size, spacing, corner and focus ring, as custom properties whose names begin with `--notion-`: a light set on `:root`, and a dark set under `:root[data-theme="dark"]`. Nothing else states one |
| [`src/panels/panels.css`](../src/panels/panels.css) | The toolbox, the property grid, their controls and the menu, from those properties alone |
| [`src/panels/icons.ts`](../src/panels/icons.ts) | The paths of the icons the specifications name |
| `src/frame/*.css`, `src/canvas/canvas.css` | Where the regions of the page sit, and what a specification leaves open in a drawing, from the same properties |

Every class begins with `adp-`, and an add-on's page has no style of its own: a second add-on gets this look by using the shared parts. The drawing of a diagram is not styled here: its notation and its colours are its specification's. [`test/styles.test.ts`](../test/styles.test.ts) holds all of this, and the contrast table below, on every run of the tests.

The appearance follows `?theme=light` or `?theme=dark` in the add-on's address, else the browser's `prefers-color-scheme`. It cannot follow Notion's own appearance setting where that differs from the system's, because an embedded page cannot read it.

## The values of notion.css

Kind of value: **S** sourced, quoted from a write-up read on 2026-10-08. **R** recalled, the value Notion's web client is known to have carried, written from memory and found in no source read on that date: an estimate. **E** estimate, the nearest consistent value where nothing was found. **A** adjusted: Notion's value fails WCAG AA here, so it is strengthened, and each is a departure listed below. Every value was read or chosen on 2026-10-08.

| Property | Light | Dark | Kind | Source |
| --- | --- | --- | --- | --- |
| `--notion-font-family` | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"` | the same | R | The stack Notion's web client is recalled to use. NotionKit [1] gives a shorter stack with the same head |
| `--notion-font-family-mono` | `"SFMono-Regular", Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace` | the same | R | Close to the code stack of react-notion's stylesheet [2] |
| `--notion-font-size` | `14px` | the same | R | Recalled from Notion's web client |
| `--notion-font-size-small` | `12px` | the same | E | Nothing was found |
| `--notion-font-size-caption` | `11px` | the same | E | Nothing was found |
| `--notion-line-height` | `20px` | the same | E | Nothing was found |
| `--notion-line-height-small` | `16px` | the same | E | Nothing was found |
| `--notion-line-height-caption` | `14px` | the same | E | Nothing was found |
| `--notion-font-weight` | `400` | the same | E | Nothing was found |
| `--notion-font-weight-medium` | `500` | the same | E | Nothing was found |
| `--notion-font-weight-bold` | `600` | the same | E | Nothing was found |
| `--notion-text` | `rgb(55, 53, 47)` | `rgba(255, 255, 255, 0.81)` | S | [1]; [3] gives the same colours within rounding |
| `--notion-text-secondary` | `rgba(55, 53, 47, 0.75)` | `rgba(255, 255, 255, 0.56)` | A | Notion: `rgba(55, 53, 47, 0.65)` and `rgba(255, 255, 255, 0.46)` per [1] |
| `--notion-text-tertiary` | `rgba(55, 53, 47, 0.6)` | `rgba(255, 255, 255, 0.4)` | A | Notion: `rgba(55, 53, 47, 0.45)` and `rgba(255, 255, 255, 0.28)` per [1] |
| `--notion-text-on-accent` | `rgb(255, 255, 255)` | the same | S | [1] |
| `--notion-icon` | `rgba(55, 53, 47, 0.6)` | `rgba(255, 255, 255, 0.4)` | A | Notion: `rgba(55, 53, 47, 0.45)` and `rgba(255, 255, 255, 0.28)` per [1] |
| `--notion-background` | `rgb(255, 255, 255)` | `rgb(25, 25, 25)` | S | [1] and [3] |
| `--notion-background-panel` | `rgb(247, 246, 243)` | `rgb(32, 32, 32)` | S | [1]; [2] has the light value as well |
| `--notion-background-menu` | `rgb(255, 255, 255)` | `rgb(37, 37, 37)` | S/R | Dark: [1] and [4]. Light is recalled |
| `--notion-background-input` | `rgba(242, 241, 238, 0.6)` | `rgba(255, 255, 255, 0.055)` | R | Recalled from Notion's web client |
| `--notion-background-hover` | `rgba(55, 53, 47, 0.08)` | `rgba(255, 255, 255, 0.055)` | S/R | Dark: [1]. Light is recalled; [1] gives `rgba(0, 0, 0, 0.045)` instead, so the pass beside Notion checks this first |
| `--notion-background-active` | `rgba(55, 53, 47, 0.16)` | `rgba(255, 255, 255, 0.08)` | S/R | Dark: [1]. Light is recalled; [1] gives `rgba(0, 0, 0, 0.06)` instead |
| `--notion-background-selected` | `rgba(35, 131, 226, 0.14)` | `rgba(35, 131, 226, 0.18)` | R/E | Light is recalled, Notion's halo on a selected block. Dark is an estimate |
| `--notion-border` | `rgba(55, 53, 47, 0.09)` | `rgba(255, 255, 255, 0.094)` | S | [1]; [2] has the light value as well |
| `--notion-border-strong` | `rgba(55, 53, 47, 0.16)` | `rgba(255, 255, 255, 0.16)` | S | [1]; [2] has the light value as well |
| `--notion-border-control` | `rgba(55, 53, 47, 0.55)` | `rgba(255, 255, 255, 0.36)` | A | Notion draws the edge of an input at about 1.3:1 |
| `--notion-accent` | `rgb(35, 131, 226)` | the same | S | [1] and [5] |
| `--notion-accent-hover` | `rgb(0, 119, 212)` | the same | R | Recalled; [5] gives `#1B6EC2` instead |
| `--notion-accent-fill` | `rgb(0, 119, 212)` | the same | A | Notion: `rgb(35, 131, 226)` per [1] and [5] |
| `--notion-accent-fill-hover` | `rgb(0, 106, 190)` | the same | A | Chosen one step darker than the fill |
| `--notion-accent-text` | `rgb(0, 98, 178)` | `rgb(104, 172, 214)` | A | Notion: `rgb(35, 131, 226)` light, and `#529CCA` dark per [1] |
| `--notion-error-text` | `rgb(176, 76, 69)` | `rgb(205, 122, 116)` | A | Notion's red text per [3] |
| `--notion-error-background` | `rgb(250, 236, 236)` | `rgb(51, 37, 35)` | S | Notion's red per [3]; the border is the text colour of the pair, unchanged |
| `--notion-error-border` | `rgb(196, 85, 77)` | `rgb(190, 82, 75)` | S | Notion's red per [3]; the border is the text colour of the pair, unchanged |
| `--notion-warning-text` | `rgb(155, 91, 36)` | `rgb(206, 130, 65)` | A | Notion's orange text per [3] |
| `--notion-warning-background` | `rgb(248, 236, 223)` | `rgb(54, 41, 31)` | S/E | Notion's orange per [3]. Orange and not yellow is a choice: Notion has both |
| `--notion-warning-border` | `rgb(204, 120, 47)` | `rgb(203, 123, 55)` | S/E | Notion's orange per [3]. Orange and not yellow is a choice: Notion has both |
| `--notion-info-text` | `rgb(66, 113, 150)` | `rgb(100, 145, 212)` | A | Notion's blue text per [3] |
| `--notion-info-background` | `rgb(233, 243, 247)` | `rgb(31, 40, 45)` | S | Notion's blue per [3]; the border is the text colour of the pair, unchanged |
| `--notion-info-border` | `rgb(72, 124, 165)` | `rgb(68, 122, 203)` | S | Notion's blue per [3]; the border is the text colour of the pair, unchanged |
| `--notion-space-1` | `2px` | the same | E | Nothing was found |
| `--notion-space-2` | `4px` | the same | E | Nothing was found |
| `--notion-space-3` | `6px` | the same | E | Nothing was found |
| `--notion-space-4` | `8px` | the same | E | Nothing was found |
| `--notion-space-5` | `12px` | the same | E | Nothing was found |
| `--notion-space-6` | `16px` | the same | E | Nothing was found |
| `--notion-space-7` | `24px` | the same | E | Nothing was found |
| `--notion-radius-small` | `4px` | the same | E | [1] says cards and modals use 8 to 12px |
| `--notion-radius-control` | `6px` | the same | S | [1] |
| `--notion-radius-card` | `8px` | the same | E | [1] says cards and modals use 8 to 12px |
| `--notion-radius-menu` | `10px` | the same | E | [1] says cards and modals use 8 to 12px |
| `--notion-shadow-menu` | `rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px` | `rgba(15, 15, 15, 0.2) 0 0 0 1px, rgba(15, 15, 15, 0.4) 0 3px 6px, rgba(15, 15, 15, 0.6) 0 9px 24px` | S | [1] |
| `--notion-shadow-card` | `rgba(0, 0, 0, 0.04) 0 1px 2px` | `none` | S | [1] |
| `--notion-focus-ring` | `inset 0 0 0 1px rgb(35, 131, 226), 0 0 0 2px rgba(35, 131, 226, 0.35)` | the same | A | Recalled from Notion's focused input: `rgba(35, 131, 226, 0.57) 0 0 0 1px inset, rgba(35, 131, 226, 0.35) 0 0 0 2px`. [5] gives `rgba(35, 131, 226, 0.30) 0 0 0 2px inset` |
| `--notion-control-height` | `28px` | the same | E | Nothing was found |
| `--notion-control-height-large` | `32px` | the same | E | Nothing was found |
| `--notion-transition-hover` | `background 20ms ease-in` | the same | R | Recalled from Notion's inline styles |
| `--notion-disabled-opacity` | `0.4` | the same | E | Nothing was found |
| `--notion-canvas-background` | `rgb(255, 255, 255)` | `rgb(25, 25, 25)` | S | The page background, as Notion's own embeds and boards sit on the page |
| `--notion-selection` | `rgb(35, 131, 226)` | the same | S | The accent [1] |
| `--notion-selection-fill` | `rgba(35, 131, 226, 0.14)` | `rgba(35, 131, 226, 0.2)` | R/E | The recalled halo of a selected block; the dark value is an estimate |

Sources, all read on 2026-10-08:

1. NotionKit 1.1.1, a CSS kit that copies Notion's interface: <https://cdn.jsdelivr.net/npm/@jungherz-de/notionkit@1.1.1/SKILL.md>
2. A copy of react-notion's stylesheet: <https://huggingface.co/spaces/sandy-try/blog/blob/main/styles/notion.css>
3. Matthias Frank, "Notion Colors", updated 2026-07-07: <https://matthiasfrank.de/en/notion-colors/>
4. The userstyle "notion.so basic boost dark", which finds Notion's dark elements by their inline style: <https://userstyles.world/style/12608/notion-so-basic-boost-dark>
5. A design-system gallery's page on Notion: <https://www.oppadu.com/tools/design-systems-site/brand/notion.html>

Read and not used: <https://docs.super.site/notion-colors> (Notion's palette before 2022) and <https://open-design.ai/plugins/design-system-notion/> (notion.com, the marketing site, not the client).

The icons are those of Material Design Icons by Pictogrammers, under the Apache License 2.0, copied on 2026-10-08 from <https://github.com/Templarian/MaterialDesign>: one path for each icon id that the specification of an add-on, or the mind map's that the tests use, names.

## Departures from Notion's styling

Each row is a place where the add-ons knowingly differ from Notion. A difference that is not in this list is a defect (SC-011). The list holds what the values of `notion.css` and the panels depart in; a part that departs elsewhere adds its row with the change that does so.

### Values strengthened for contrast

| What | Notion's | Here | Reason |
| --- | --- | --- | --- |
| Secondary text: a heading, a description, the label of a field, a placeholder | `rgba(55, 53, 47, 0.65)` light, `rgba(255, 255, 255, 0.46)` dark | 0.75 and 0.56 | Notion's reaches about 4.2:1 and 4.6:1 on the page and less on a panel; text keeps 4.5:1 here (NFR-007) |
| Tertiary text and an icon | `rgba(55, 53, 47, 0.45)` light, `rgba(255, 255, 255, 0.28)` dark | 0.6 and 0.4 | Notion's is about 2.5:1; an icon that says what a control does keeps 3:1 |
| The edge of a control | About 1.3:1 against its surroundings | `rgba(55, 53, 47, 0.55)` light, `rgba(255, 255, 255, 0.36)` dark | The edge is what shows that there is a control; it keeps 3:1 |
| An accent fill that carries text | `rgb(35, 131, 226)` | `rgb(0, 119, 212)`, and `rgb(0, 106, 190)` under the pointer | White on Notion's blue is 3.88:1 |
| Accent as text | `rgb(35, 131, 226)` light, `#529CCA` dark | `rgb(0, 98, 178)` light, `rgb(104, 172, 214)` dark | 3.88:1 on the light page, and 4.3:1 on a hovered row of a dark menu |
| The text of an error, a warning and a note of information | Notion's red, orange and blue text | Each darkened (light) or lightened (dark) in its own hue | Notion's reach 2.9:1 to 4.3:1 on their own backgrounds; each is brought to 4.6:1 |
| The focus ring | An inner line at `rgba(35, 131, 226, 0.57)` and a halo | The inner line solid `rgb(35, 131, 226)`, the halo unchanged | At 0.57 the line is about 2:1 on the page; the focus keeps 3:1 (NFR-006) |

### Choices where Notion has several or none

| What | Notion's | Here | Reason |
| --- | --- | --- | --- |
| A warning | Yellow and orange both | Orange | Orange stays legible as text; yellow turns brown when it is darkened to 4.5:1 |
| The selected background in the dark appearance | Not found | `rgba(35, 131, 226, 0.18)` | An estimate, a little stronger than the light halo so that it shows on a dark panel |

### The panels and their controls

| What | Notion's | Here | Reason |
| --- | --- | --- | --- |
| The icons | Notion's own set | Material Design Icons, in Notion's icon colour and at the size of a line of text | A specification names its icons by their Material Design id, and nothing may be fetched from another host. An id the table of `icons.ts` lacks is drawn as three plain shapes |
| The mark that collapses a panel or folds a group | A double chevron on the sidebar, a triangle on a toggle block | A triangle everywhere | The id of a chevron holds a name the Gartner hype cycle graph declares, and no file under `src/` may hold such a name as a word of its own (FR-004). A triangle is Notion's own mark for something that folds |
| A field of the property grid | The name at the left and the value at the right, on one line | The label above the value | The panel is a narrow column inside an embed block, capped at 40% of its width; side by side, a value would have too little room |
| The edge of a text control, of each of a few choices and of a button of a form | No edge until the pointer or the focus is on it | An edge always | Without it nothing shows that a value can be changed, and Notion's cue under the pointer does not exist for the keyboard or for touch |
| A placeholder | Tertiary text | Secondary text | A placeholder is text and keeps 4.5:1 |
| A few choices (`segmented`, `radio`) | Nothing of its own; the nearest is a row of filter chips | A row of chips with an edge, the chosen one in the accent | The browser's radio buttons carry the keyboard; the chips are their labels |
| A slider and a checkbox | No slider; a checkbox drawn by Notion | The browser's own controls, coloured with the accent | The browser's controls are used with the keyboard and read by assistive technology with no code of the add-on. Their exact shape is the browser's |
| A refusal beside its control | A red text, or a notice at the bottom of the window | A small block in Notion's red text on Notion's red background, under the control | The sentence stays beside the control it is about (FR-019), and the red text keeps 4.5:1 only on its own background |
| A control that holds a refused value | A red edge | No change to the edge | A red edge on a panel has no computed contrast here; the refusal under the control and `aria-invalid` say it |
| The width of a panel | The sidebar is resized by dragging | 264px, and never more than 40% of the embed block; collapsed, the width of its toggle | An embed block is small; a panel that is collapsed gives the diagram its room (FR-017) |
| The menu | Opens with a short fade | Opens at once | No animation is stated in `notion.css`; none was sourced |
| An entry of a menu that cannot be picked | Dimmed | Dimmed to `--notion-disabled-opacity`, below 4.5:1 | As Notion's. WCAG asks no contrast of a control that is not available; its reason is its tooltip |
| The font | Notion's own, where it is installed | The same stack of system fonts | An add-on loads no font: nothing is fetched from another host |

## Contrast

Computed from the values of `notion.css` with the WCAG 2 formula, `(L1 + 0.05) / (L2 + 0.05)` over the relative luminance of the two colours, on 2026-10-08. A translucent colour is first laid over its surface, layer by layer from the bottom, and a translucent foreground over the result. Each ratio is rounded down. Text keeps at least 4.5:1; the edge of a control, an icon and the focus ring keep at least 3:1. These are computed, not measured: they hold for the values above, and change with them at the pass beside Notion.

| What is drawn | Foreground | Surface | At least | Light | Dark |
| --- | --- | --- | --- | --- | --- |
| A label, a tool, a value on the panel | `--notion-text` | `--notion-background-panel` | 4.5:1 | 11.34:1 | 11.06:1 |
| The same under the pointer, and a tag | `--notion-text` | `--notion-background-panel` under `--notion-background-hover` | 4.5:1 | 9.87:1 | 9.66:1 |
| The same while pressed | `--notion-text` | `--notion-background-panel` under `--notion-background-active` | 4.5:1 | 8.52:1 | 9.01:1 |
| A value in a control | `--notion-text` | `--notion-background-panel` under `--notion-background-input` | 4.5:1 | 11.04:1 | 9.66:1 |
| A heading, a description, a field's label on the panel | `--notion-text-secondary` | `--notion-background-panel` | 4.5:1 | 5.37:1 | 5.99:1 |
| A description under the pointer | `--notion-text-secondary` | `--notion-background-panel` under `--notion-background-hover` | 4.5:1 | 4.95:1 | 5.46:1 |
| A description while pressed | `--notion-text-secondary` | `--notion-background-panel` under `--notion-background-active` | 4.5:1 | 4.54:1 | 5.20:1 |
| A placeholder in a control | `--notion-text-secondary` | `--notion-background-panel` under `--notion-background-input` | 4.5:1 | 5.29:1 | 5.46:1 |
| The chosen one of a few choices | `--notion-accent-text` | `--notion-background-panel` under `--notion-background-selected` | 4.5:1 | 4.87:1 | 5.29:1 |
| A refusal beside its control | `--notion-error-text` | `--notion-error-background` | 4.5:1 | 4.60:1 | 4.63:1 |
| An entry of a menu | `--notion-text` | `--notion-background-menu` | 4.5:1 | 12.26:1 | 10.50:1 |
| An entry of a menu under the pointer or the focus | `--notion-text` | `--notion-background-menu` under `--notion-background-hover` | 4.5:1 | 10.64:1 | 9.11:1 |
| An entry of a menu while pressed | `--notion-text` | `--notion-background-menu` under `--notion-background-active` | 4.5:1 | 9.17:1 | 8.49:1 |
| A shortcut in a menu | `--notion-text-secondary` | `--notion-background-menu` | 4.5:1 | 5.61:1 | 5.79:1 |
| A shortcut in a menu under the pointer or the focus | `--notion-text-secondary` | `--notion-background-menu` under `--notion-background-hover` | 4.5:1 | 5.18:1 | 5.24:1 |
| A shortcut in a menu while pressed | `--notion-text-secondary` | `--notion-background-menu` under `--notion-background-active` | 4.5:1 | 4.74:1 | 4.97:1 |
| An icon on the panel | `--notion-icon` | `--notion-background-panel` | 3:1 | 3.54:1 | 3.75:1 |
| An icon under the pointer, and the mark that removes a tag | `--notion-icon` | `--notion-background-panel` under `--notion-background-hover` | 3:1 | 3.36:1 | 3.55:1 |
| An icon while pressed | `--notion-icon` | `--notion-background-panel` under `--notion-background-active` | 3:1 | 3.16:1 | 3.43:1 |
| An icon in a menu | `--notion-icon` | `--notion-background-menu` | 3:1 | 3.65:1 | 3.68:1 |
| An icon in a menu under the pointer or the focus | `--notion-icon` | `--notion-background-menu` under `--notion-background-hover` | 3:1 | 3.46:1 | 3.45:1 |
| The edge of a control against the panel | `--notion-border-control` | `--notion-background-panel` | 3:1 | 3.11:1 | 3.30:1 |
| The edge of a control against its own background | `--notion-border-control` | `--notion-background-panel` under `--notion-background-input` | 3:1 | 3.09:1 | 3.15:1 |
| The edge of the chosen one of a few choices, a ticked box, a slider | `--notion-accent` | `--notion-background-panel` | 3:1 | 3.58:1 | 4.20:1 |
| The focus ring on the panel | `--notion-focus-ring` | `--notion-background-panel` | 3:1 | 3.58:1 | 4.20:1 |
| The focus ring on a control | `--notion-focus-ring` | `--notion-background-panel` under `--notion-background-input` | 3:1 | 3.49:1 | 3.58:1 |
| The focus ring on a menu | `--notion-focus-ring` | `--notion-background-menu` | 3:1 | 3.87:1 | 3.95:1 |

The pairs are those of [`test/panels/contrast.ts`](../test/panels/contrast.ts), and `npx vitest run test/styles.test.ts` fails when a pair falls below its minimum, when `panels.css` draws with a colour that is in no pair, or when a row of this table differs from what is computed.

Below those minimums, and used for decoration alone, which no reader has to tell apart to use the add-on:

| What is drawn | Foreground | Surface | At least | Light | Dark |
| --- | --- | --- | --- | --- | --- |
| A line between groups (decoration) | `--notion-border` | `--notion-background-panel` | none | 1.16:1 | 1.32:1 |
| A line between groups of a menu (decoration) | `--notion-border` | `--notion-background-menu` | none | 1.17:1 | 1.33:1 |

An entry of a menu that cannot be picked is dimmed below 4.5:1 as well, as the list of departures says.
