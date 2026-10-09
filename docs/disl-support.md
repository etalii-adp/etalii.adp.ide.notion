# What the Notion add-ons support of DISL

Every Notion add-on of ADP is drawn and edited by the same shared parts, which interpret the DISL specification of its tool type. This page says what those parts read of DISL and what they do not, which behaviours they had to choose because the specification of the Gartner hype cycle graph leaves them unstated, which differences are raised with `etalii.adp` and settled nowhere here, and what is known not to hold yet.

A specification that asks for more than this page lists still opens: what is not supported is read as the nearest thing that is, and reported as a finding in the page's list of findings. For the Gartner hype cycle graph no such finding is raised.

## Conformance class and features

The list is the one of [`src/disl/support.ts`](../src/disl/support.ts): a feature is added there by the change that builds it, and to this table with it. A specification whose `language.requires` names another feature, or a higher conformance class, opens with one finding for each (`disl.unsupported-feature`, `disl.unsupported-conformance`).

The conformance class is `standard`.

| Feature | What is built |
| --- | --- |
| `axis.yearMonth` | A time axis whose values are a year and a month, counted in months, with a unit of a month or coarser that may be bound to an attribute of the diagram |
| `ruler.adaptive` | A ruler whose levels are shown by the room their labels have on screen (`minSpacingPx`, `minZoom`, `maxZoom`, `step`), never finer than `minUnit` |
| `snap.byGesture` | Snapping rules per gesture, read with the coordinate system and the node notation |
| `anchor.part` | An edge end on a part of a composite shape, on a side of it and a fraction along that side |
| `canvas.filters` | The filters of `notation.canvas.filters` with the controls `chips`, `switch`, `select` and `search`, the effects `hide` and `dim`, and matching any or all |
| `viewpoint.variants` | A viewpoint that varies another, offered as its `toggle` |
| `placement.bound` | A node placed by its attributes on both axes, with `x2`, `y2`, `width`, `height`, `offset` and an anchor |
| `shape.custom` | A shape declared as path segments with parameters and handles |
| `shape.composite` | A shape made of parts, each with its own shape, box, style, condition and tooltip |
| `edge.bezier` | An edge drawn as a cubic curve, with `startDirection`, `endDirection`, `reach` and `maxReach` |
| `label.parse` | A label whose edited text is parsed and written by the specification's own rule |
| `persistence.fbl` | A document read and written through an FBL binding |

## What is read of each section

| Section | Read | Not read, and what happens instead |
| --- | --- | --- |
| The specification as a whole | `disl`, `language`, `functions` and the sections below | `imports`, `plugins` and every `x-` extension are not read. A section that is not an object is not read and is reported |
| `metamodel` | Types with inheritance, relations with the types each end allows, enums, data types, the diagram's own attributes, defaults | The built-in findings a metamodel generates are not raised yet, `std.endpoints` apart: `std.required`, `std.facets`, `std.unique`, `std.multiplicity`, `std.containment`, `std.acyclic` and `std.axisBounds` |
| Expressions (DISL 12) | CEL, with elements, their attributes and their neighbours, and the functions `isA`, `label`, `elementById`, `nodesOfType`, `relationsOfType`, `outgoingOf`, `incomingOf`, `yearMonth`, `parseYearMonth`, `formatYearMonth`, `year`, `month`, `enumLabel`, `ordinal`, `clamp`, `textWidth`, `lower`, `upper`, `distinct`, `flatten`, `indexOf`, `range` and `math.abs`, `ceil`, `floor`, `round`, `sqrt`, `trunc` | Any other function of DISL 12.4. An expression that uses one fails where it is evaluated: a default is used and one finding says so |
| `coordinates` | Linear axes, time axes of year and month, cartesian systems with y down or up, snap profiles, placement | Another kind of axis is read as linear, another kind of system as cartesian, each with a finding. A time axis finer than a month is drawn in months. The grid is not drawn. A ruler is drawn for a time axis only, as one row, the finest that has room, at its edge of the view (`attach: "view"`); `attach: "canvas"` is drawn the same way |
| `notation`: shapes | `rect`, `roundedRect`, `pill`, `ellipse`, `circle`, `text`, `none`; custom shapes from path segments `M`, `L`, `H`, `V`, `Q`, `C`, `Z`; composite shapes; handles as data | Another built-in shape is drawn as a rectangle. A shape from `svg` or a plugin, and a path given as an SVG path string, is drawn as its bounds. A path segment `A`, `R` or `E` is drawn as a straight line. Each is reported. Icons are not drawn |
| `notation`: edges | Routing `bezier` and `straight`; anchors `outline`, `center`, `fixed`, `sides` and `part`; the end markers named arrow, triangle, diamond and circle, open or filled | Another routing is drawn as a straight line and reported. A `port` anchor is read as `outline`. A marker declared in `notation.markers`, a marker instance, a mid marker and a label on an edge are not drawn; a marker of another name is drawn as an arrow |
| `notation`: text | The text metric, `wrap` (`none`, `word`, `char`), `overflow` (`visible`, `clip`, `ellipsis`, `shrink`), alignment, the font's family, size, weight, colour and line height | `maxWidth` is not applied: a label is laid out in the box its position gives it |
| `notation`: theme and canvas | Theme tokens with the modes `light` and `dark`, chosen by the appearance of the page; the filters; a legend whose entries name an enum or a type | A legend `from: "drawn"` or `computed` is drawn from its declared entries. The `position` of a filter, the legend and a viewpoint's toggle is not read: all stand at the top left of the canvas. `canvas.notices`, `canvas.chrome` and `canvas.stretch` are not read |
| `viewpoints` | `include`, `exclude`, `members`, the coordinate system, the layout, the viewpoint's own notation, variants with their toggle | A specification with several viewpoints that are no variants opens in its default one and offers no control to change to another |
| `layout` | `rowPacked` to the right and `rows` | Another algorithm is not run: the nodes it should place stand at the origin, and a finding says so |
| `constraints` | Invariants and gesture constraints with `scope`, `forEach`, `when`, `rule`, `severity`, `message`, `target`, `location`, `subject`, `attribute`, `timing`, `enforcement`, `enabled` and `group`; `defaults`, `order`, `blockSaveOn`, `builtIn` | A rule `over` a view is left out and reported. Quick fixes and suppressions are not read |
| `behavior` | `messages`, `reasons`, `editGate`, hooks, operations, `deletion`, and the actions `set`, `unset`, `create`, `connect`, `delete`, `let`, `if`, `forEach`, `layout` (the `rows` algorithm), `abort`, `call`, `select`, `reveal`, `highlight`, `editLabel`, `openForm`, `notify` | Parent placements, the clipboard, retyping and simulations are not read. An action of another kind is reported and skipped |
| `toolbox`, `forms` | Groups, tools, context tools and menus; forms with their items | Nothing is known to be left out |
| `persistence` | A binding named as `<uri>#<name>` of an FBL document, `typeMap`, ids made as `uuid-v4` | An inline binding is not read. Another id strategy is replaced by `uuid-v4`, and id rules for single types by the one rule; each is reported |

## Four behaviours the specification leaves unstated

The specification of the Gartner hype cycle graph says nothing of these four, and its companion document names them. Until `etalii.adp` states them ([issue 93](https://github.com/etalii-adp/etalii.adp/issues/93)), the shared parts follow an interim rule for each. A rule names no tool type, and none of the four is taken from the specification.

| Behaviour | Interim rule | Where |
| --- | --- | --- |
| The property grid during a drag | While a drag lasts, the property grid shows the values the drag would write | The gestures and the property grid, which are built after reading |
| A tool dropped in a viewpoint that places by layout | The drop point is read back onto the axis of the viewpoint this one varies: between two placed elements the coordinate runs evenly from the one's own place to the other's, beyond the first and the last it runs at the scale of that axis, and with nothing placed it is the point itself | `baseCoordinate` in `src/disl/behavior.ts` |
| An edge end that names a part or a side its node does not have | The end is drawn at the first place it could name: the first part and the first side its attributes allow, halfway along. The scene marks such an end as `fallback`. An end on a part the node has and does not draw hides the edge, as the specification says | `onPart` in `src/canvas/scene.ts` |
| The text of a relation's end that names nothing | The end is shown empty. CEL holds such an end as null, and a store keeps no id for it: a Notion relation cannot hold the id of a row that does not exist | The forms, and `src/store/rows.ts` |

## Differences raised and not settled here

The add-on changes neither the specification nor the binding. Where they and the other hosts differ, or where something cannot hold in Notion, an issue in `etalii.adp` says so, and the add-on follows the specification until the issue is settled.

| Issue | What it is about |
| --- | --- |
| [91](https://github.com/etalii-adp/etalii.adp/issues/91) | The specification declares DISL `0.3` and points at the `0.2` schema |
| [92](https://github.com/etalii-adp/etalii.adp/issues/92) | The specification names its binding by an address into the `develop` branch of `etalii.adp.ide.standalone` |
| [93](https://github.com/etalii-adp/etalii.adp/issues/93) | The four behaviours above |
| [94](https://github.com/etalii-adp/etalii.adp/issues/94) | The binding says the unit and the header are changed in the file itself, and a store has no file: in Notion the unit is changed in the database's own table |
| [96](https://github.com/etalii-adp/etalii.adp/issues/96) | Findings the hosts give that the specification does not state: a key the binding does not read, a malformed value reported twice, the sentences of the reader, a value that is none of its enum's, and the line of a reference that names nothing |
| [97](https://github.com/etalii-adp/etalii.adp/issues/97) | Where the drawing the specification states differs from what the hosts draw: an end on an anchor that is drawn from the outline, the packed layout of the second viewpoint, the font size of a label, and an id that is used twice |

## Known limits

| Limit | Why | Requirement |
| --- | --- | --- |
| Somebody else's change can still be overwritten in the moment between the check and the write | The Notion API has no conditional write. Before it writes, the store asks for the rows edited since its last read, and it does so again when the page regains the focus; Notion gives edit times to the minute and returns no row that is in the trash, so the window between that check and the write stays open | FR-022, research D10 |
| A store of more than about 250 rows does not open within 3 seconds | Notion returns 100 rows a call, the calls follow one another, and about three are allowed a second. The largest example, 518 rows, takes six calls | SC-002, research R1 |
| An arrangement of many elements is not in the database within 5 seconds | Each moved element is one row to write, at three requests a second: about 70 seconds for 200 elements. The canvas shows the result at once and the status says `storing` until the database holds it | SC-004, research R2 |
| A property is hidden only in the views a database has when it is prepared, or when `scripts/store.mjs put` fills it | Notion's API says per view which properties it shows, and has no setting of a database that hides a property in every view. A view added later is as Notion makes it, and a database that was a store before is not looked at again | FR-036, FR-037 |
| A note's `at` is not hidden, though the list of FR-036 names it | The internal properties are found from the notation: a place on an axis that is no time axis, a size, a handle of a shape, the anchoring of an end. A note's `at` is its place on the time axis, a date, as a trend's `start` and a trigger's `date` are | FR-036, FR-004 |
| The list of databases says whether a database is on a page or at the top of the workspace, and not which page | The search answers the id of that page and not its title, and the service forwards no call that reads a page | FR-033 |
| An embed block inside another block, such as a column or a toggle, is not found, and its address is shown to copy | The blocks directly in the page of the database, and directly in the pages under it, are read; a block's own children are not | FR-033 |
| Somebody who may read the database and may not share it sees the invitation to connect, not a read-only diagram | A token reaches only what its person shared with the connection. A read-only diagram is what a person gets whose write Notion refuses | FR-021, research R3 |
