# Digital trends

Thirty digital trends of roughly the past sixty years, from mainframes and minicomputers through the personal computer, the internet, the web, smartphones and the cloud to deep learning, large language models and AI agents, drawn as a Gartner hype cycle graph and related by the influences they had on one another.

It is the smaller companion to [technology-trends](../technology-trends/readme.md): the same notation over one domain, small enough to read at a glance.

## Hand-authored, and why

**This example was written for ADP, and it is exempt from the published-data rule**, for the reason the technology-trends readme gives: the notation is ADP's own, so no published corpus of it exists.

**Its dates and influences are illustrative, not a historical claim.** Every start date is plausible to the year, and every influence is one a history of computing would recognise. The phase an influence attaches to is the phase each trend was in shortly after the later one began, and the boundaries are even except where noted below.

## What it shows

| Part | In this example |
| --- | --- |
| Trends | 30, placed in rows so that no two in a row overlap in time |
| Influences | 52, each attached to the phase of each trend in which it acted |
| Triggers | 8, each a circle at the month it happened, with an influence on every trend it set off |
| Anchors | Placed by [`spread-anchors.py`](../spread-anchors.py): each influence arrives no earlier than it leaves, and the ends sharing one edge of a phase are spread across it in date order |
| Phase counts | Every count from 1 to 4: settled trends show all four phases, recent ones such as quantum computing and AI agents only a Peak |
| Dragged boundaries | The dot-com bubble, blockchain and virtual reality have phase boundaries placed by hand; every other trend's phases are even |
| Descriptions | On some trends and some influences, kept in the document and never drawn |

**Tags make meaningful filters**, for example `ai` alone; `communication` and `computing` with the filter on All; and `media` and `commerce` on Any. The other tags are `data`, `security`, `society`, `finance` and `science`.

## Triggers

A trigger is a moment that set trends off - an invention, a political decision, a disaster. Each is drawn as a circle at the month it happened, on a row beside the trend it acted on most, and influences only ever leave it. **Its date is illustrative, like every date here, and is not a historical claim**; each influence lands on the phase the trend was in at that month, or on its Peak when the trend had not begun.

- **IBM PC launched**, August 1981: on Personal computer.
- **Morris worm**, November 1988: on Cybersecurity.
- **Mosaic browser released**, April 1993: on World Wide Web and Search engines.
- **Nasdaq peak and crash**, March 2000: on Dot-com bubble.
- **iPhone announced**, January 2007: on Smartphones and Mobile phones.
- **Bitcoin white paper**, October 2008: on Blockchain and cryptocurrency.
- **AlexNet wins ImageNet**, September 2012: on Deep learning.
- **ChatGPT launched**, November 2022: on Large language models and AI agents.

**No trend here was a moment**: each spans years, so none was rewritten as a trigger.

## What it does not demonstrate

- **A document that breaks the rules.** The validator reports nothing for it; the broken documents are the test fixtures.
- **A hidden influence.** Every influence here attaches to a phase its trends show; technology-trends has one that is hidden.
- **Trends before 1960.** For the long view, see technology-trends.
- **A trend whose phases are researched.** Most boundaries are even, as the diagram draws them until one is dragged.
