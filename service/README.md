# The service

The one service beside the published pages: it completes Notion's grant of access and forwards the calls a store makes to the Notion API. [handler.ts](handler.ts) is all of it, and it knows no platform. `node scripts/service.mjs` runs it locally; the Cloudflare Worker that is to run it for the published pages is not written yet.

What it answers, its configuration and secrets, what a maintainer does once and how it is run are in [docs/service.md](../docs/service.md).
