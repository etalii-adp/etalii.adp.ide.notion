# Eras of innovation

Forty-two innovations that each opened a new era in human development, from horse riding, the wheel, cities and writing around 3500 BCE, through iron, coinage, paper, printing and the scientific method, to electricity, the computer, the internet and artificial intelligence. They are drawn as a Gartner hype cycle graph and related by the influences they had on one another.

It is the long companion to [technology-trends](../technology-trends/readme.md) and [digital-trends](../digital-trends/readme.md): the same notation, over five and a half thousand years rather than three centuries or sixty years.

## Drawn in decades

**The document names its time unit: `unit: decade`.** Every step of the axis is a decade, four canvas units wide, so the whole span fits on a canvas and a drag snaps to a year ending in 0. The dates themselves are still written to the month, as in every hype cycle graph. The ruler labels decades, centuries and millennia as the view widens.

**Years before 1 are written as ISO 8601 writes them**: signed and astronomical, so `-3500-01` is 3501 BCE and `0000-01` would be 1 BCE. The ruler labels them the same way.

## Hand-authored, and why

**This example was written for ADP, and it is exempt from the published-data rule**, for the reason the technology-trends readme gives: the notation is ADP's own, so no published corpus of it exists.

**Its dates and influences are illustrative, not a historical claim.** A start date is when an innovation began to spread, to the nearest round number where history is vague, and a stop date is when it stopped opening new ground rather than when it fell out of use. The phase an influence attaches to is the phase each trend was in shortly after the later one began. Where the earlier trend had already ended, the influence leaves its last phase and lands on the later one's Peak. Every phase boundary is even.

## What it shows

| Part | In this example |
| --- | --- |
| Time unit | Decades, named in the document's `unit:` key |
| Trends | 42, from the year -3500 to 2050, placed so that a trend shares a row only where its label clears the trend before it, with an empty row between any two rows of trends |
| Influences | 71, each attached to the phase of each trend in which it acted |
| Triggers | 13, each a circle at the month it happened, with an influence on every trend it set off |
| Anchors | Placed by `spread-anchors.py` in the examples folder: each influence arrives no earlier than it leaves, and the ends sharing one edge of a phase are spread across it in date order |
| Phase counts | Every count from 1 to 4: ancient and early modern innovations show all four phases, recent ones such as renewables and artificial intelligence fewer |
| Descriptions | On some trends and some influences, kept in the document and never drawn |

**Tags make meaningful filters**, for example `knowledge` alone; `energy` and `transport` with the filter on Any; and `economy` and `transport` on All. The other tags are `society`, `materials`, `health`, `communication`, `computing` and `food`.

## Triggers

A trigger is a moment that set trends off - an invention, a political decision, a disaster. Each is drawn as a circle at the month it happened, on a row beside the trend it acted on most, and influences only ever leave it. **Its date is illustrative, like every date here, and is not a historical claim**; each influence lands on the phase the trend was in at that month, or on its Peak when the trend had not begun.

- **Code of Hammurabi**, January -1754: on Written law.
- **Late Bronze Age collapse**, January -1177: on Iron and The alphabet.
- **Library of Alexandria founded**, January -285: on Philosophy.
- **Cai Lun presents paper to the emperor**, January 105: on Paper.
- **Black Death reaches Europe**, October 1347: on Banking and double-entry bookkeeping.
- **Gutenberg Bible printed**, January 1455: on Printing press.
- **Columbus reaches the Americas**, October 1492: on Ocean navigation.
- **Watt's separate condenser patent**, January 1769: on Steam engine and Factory production.
- **Jenner's smallpox inoculation**, May 1796: on Vaccination.
- **Wright brothers' first flight**, December 1903: on Powered flight.
- **Fleming notices penicillin**, September 1928: on Antibiotics.
- **Chicago Pile-1 goes critical**, December 1942: on Nuclear power.
- **Sputnik 1**, October 1957: on Space flight and Internet.

**No trend here was a moment**: each spans years, so none was rewritten as a trigger.

## What it does not demonstrate

- **A document that breaks the rules.** The validator reports nothing for it; the broken documents are the test fixtures.
- **A hidden influence.** Every influence here attaches to a phase its trends show; technology-trends has one that is hidden.
- **Dragged boundaries.** Every trend's phases are even; digital-trends has three trends with boundaries placed by hand.
- **Prehistory.** Agriculture, fire and stone tools are older than its first date, and are left out rather than squeezed in.
- **A researched history.** It is a reasonable reading of when each innovation spread, not a sourced one.
