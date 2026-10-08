# Energy breakthroughs

Thirty-three energy trends from the first fission and fusion experiments of the 1950s to ideas that have not started yet, drawn as a Gartner hype cycle graph and related by the influences they had on one another. Fusion is the centre of it, in nine variants: the stellarator, the tokamak, inertial confinement, the field-reversed configuration, magnetized target fusion, pulsed magneto-inertial fusion, the sheared-flow Z-pinch, the compact high-field tokamak and, as a warning, cold fusion. Around them sit fission, renewables, storage, hydrogen and the grid, and the new demand from AI data centres that is pulling several of them out of their troughs.

## Hand-authored, and why

**This example was written for ADP, and it is exempt from the published-data rule**, for the reason the technology-trends readme gives: the notation is ADP's own, so no published corpus of it exists.

**Its dates and influences are illustrative, not a claim.** Every start date up to 2026 is plausible to the year, and every influence is one an account of energy research would recognise. **Dates after 2026 are projections**: fusion power plants, lunar helium-3, superhot rock geothermal and the stop of every trend still running are guesses, drawn so the diagram can show what is expected as well as what happened.

**Each influence is dated, and its anchors are spread by the rule every example follows.** An influence attaches to the phase each trend was in at the month it acted. Where on that phase it sits is placed by the anchor-spreading rule shared by all the examples: an influence never arrives before it leaves, and the influences sharing one edge of a phase spread across it rather than stacking in one spot.

## What it shows

| Part | In this example |
| --- | --- |
| Trends | 33, in five clusters of rows: fusion, fission, renewables, storage and hydrogen, and the grid, with an empty row between every two rows of trends |
| Influences | 57, each attached to the phase of each trend in which it acted, and never arriving before it leaves |
| Triggers | 7, each a circle at the month it happened, with an influence on every trend it set off |
| Anchors | Placed by [`spread-anchors.py`](../spread-anchors.py): each influence arrives no earlier than it leaves, and the ends sharing one edge of a phase are spread across it in date order |
| Phase counts | Every count from 1 to 4: fission, solar and lithium-ion show all four phases; most fusion variants a Peak or a Trough |
| Upcoming and conceptual ideas | Fusion power plants are tagged `upcoming`; lunar helium-3, space-based solar power, superhot rock geothermal and room-temperature superconductors are tagged `conceptual` |
| A trend that fizzled | Cold fusion and room-temperature superconductors show a Peak and a Trough and stop there |
| Dragged boundaries | The stellarator, the tokamak, inertial confinement fusion, cold fusion, fission power, molten salt reactors, small modular reactors, solar photovoltaics and room-temperature superconductors have phase boundaries placed on a dated event; every other trend's phases are even |
| Descriptions | On most trends and some influences, kept in the document and never drawn |

**Tags make meaningful filters**, for example `fusion` alone; `nuclear` and `fusion` with the filter on Any; and `upcoming` and `conceptual` on Any. The other tags are `science`, `materials`, `space`, `solar`, `wind`, `geothermal`, `storage`, `hydrogen`, `transport`, `grid` and `ai`.

## Triggers

A trigger is a moment that set trends off - an invention, a political decision, a disaster. Each is drawn as a circle at the month it happened, on a row beside the trend it acted on most, and influences only ever leave it. **Its date is illustrative, like every date here, and is not a historical claim**; each influence lands on the phase the trend was in at that month, or on its Peak when the trend had not begun.

- **Atoms for Peace**, December 1953: on Nuclear fission power.
- **1973 oil crisis**, October 1973: on Solar photovoltaics and Wind power.
- **Three Mile Island accident**, March 1979: on Nuclear fission power.
- **Chernobyl disaster**, April 1986: on Nuclear fission power.
- **Fukushima Daiichi accident**, March 2011: on Nuclear fission power and Small modular reactors.
- **Paris Agreement**, December 2015: on Offshore wind and Green hydrogen.
- **NIF achieves ignition**, December 2022: on Inertial confinement fusion and Fusion power plants.

**No trend here was a moment**: each spans years, so none was rewritten as a trigger.

## What it does not demonstrate

- **A document that breaks the rules.** The validator reports nothing for it; the broken documents are the test fixtures.
- **A hidden influence.** Every influence here attaches to a phase its trends show; technology-trends has one that is hidden.
- **A trend whose phases are researched.** The dragged boundaries sit on well-known events, not on a measured hype curve.
- **Influences that are uncertain or disputed.** The notation has no way to say so, and the projections after 2026 are the most uncertain of all.
