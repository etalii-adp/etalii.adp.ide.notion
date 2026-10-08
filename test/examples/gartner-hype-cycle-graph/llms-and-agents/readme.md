# LLMs and agents

Thirty-five trends in large language models and agentic development, from word embeddings in 2013 through the Transformer, ChatGPT, retrieval, tool use and reasoning models to coding agents, spec-driven development and ideas that have not started yet, drawn as a Gartner hype cycle graph and related by the influences they had on one another.

It is the close-up of the last few trends in [digital-trends](../digital-trends/readme.md): the same notation over thirteen years instead of sixty.

## Hand-authored, and why

**This example was written for ADP, and it is exempt from the published-data rule**, for the reason the technology-trends readme gives: the notation is ADP's own, so no published corpus of it exists.

**Its dates and influences are illustrative, not a claim.** Every start date up to 2026 is plausible to the month, and every influence is one a history of the field would recognise. **Dates after 2026 are projections**: human-agent teams, autonomous research agents, continual learning, verified code generation, agent economies, recursive self-improvement and the stop of every trend still running are guesses, drawn so the diagram can show what is expected as well as what happened.

**Each influence is dated, and its anchors are spread by the rule every example follows.** An influence attaches to the phase each trend was in at the month it acted. Where on that phase it sits is placed by the anchor-spreading rule shared by all the examples: an influence never arrives before it leaves, and the influences sharing one edge of a phase spread across it rather than stacking in one spot.

## What it shows

| Part | In this example |
| --- | --- |
| Trends | 35, in five clusters of rows: foundations, models, tooling, agents, and what comes next, with an empty row between every two rows of trends |
| Influences | 67, each attached to the phase of each trend in which it acted, and never arriving before it leaves |
| Triggers | 7, each a circle at the month it happened, with an influence on every trend it set off |
| Anchors | Placed by [`spread-anchors.py`](../spread-anchors.py): each influence arrives no earlier than it leaves, and the ends sharing one edge of a phase are spread across it in date order |
| Phase counts | Every count from 1 to 4: word embeddings and the Transformer show all four phases, most agent trends only a Peak |
| Upcoming and conceptual ideas | Human-agent teams and agent-to-agent protocols are tagged `upcoming`; autonomous research agents, continual learning, verified code generation, agent economies and recursive self-improvement are tagged `conceptual` |
| Both directions | Autonomous agents pushed for tool use in 2023, and tool use pulled autonomous agents out of their trough in 2025: one influence per direction is allowed |
| Dragged boundaries | Scaling laws, large language models, chat assistants, prompt engineering, tool use, autonomous agents, multi-agent systems and vibe coding have phase boundaries placed on a dated turn in their story; every other trend's phases are even |
| Descriptions | On most trends and some influences, kept in the document and never drawn |

**Tags make meaningful filters**, for example `agents` alone; `agents` and `coding` with the filter on All; and `upcoming` and `conceptual` on Any. The other tags are `language`, `architecture`, `models`, `alignment`, `multimodal`, `products`, `society`, `tooling`, `data`, `techniques` and `science`.

## Triggers

A trigger is a moment that set trends off - an invention, a political decision, a disaster. Each is drawn as a circle at the month it happened, on a row beside the trend it acted on most, and influences only ever leave it. **Its date is illustrative, like every date here, and is not a historical claim**; each influence lands on the phase the trend was in at that month, or on its Peak when the trend had not begun.

- **AlexNet wins ImageNet**, September 2012: on Word embeddings.
- **Attention Is All You Need**, June 2017: on Transformer.
- **GPT-3 paper**, May 2020: on Large language models and Scaling laws.
- **ChatGPT launched**, November 2022: on Chat assistants, Prompt engineering and Alignment research.
- **LLaMA weights released**, February 2023: on Open-weight models.
- **EU AI Act enters into force**, August 2024: on Alignment research.
- **DeepSeek-R1 released**, January 2025: on Reasoning models and Open-weight models.

**No trend here was a moment**: each spans years, so none was rewritten as a trigger.

## What it does not demonstrate

- **A document that breaks the rules.** The validator reports nothing for it; the broken documents are the test fixtures.
- **A hidden influence.** Every influence here attaches to a phase its trends show; technology-trends has one that is hidden.
- **Trends before 2013.** For the longer view, see digital-trends and technology-trends.
- **A trend whose phases are researched.** The dragged boundaries sit on well-known turns, not on a measured hype curve.
- **Influences that are uncertain or disputed.** The notation has no way to say so, and the projections after 2026 are the most uncertain of all.
