# The service

The Notion add-ons reach Notion through one small service. It completes Notion's grant of access, which needs a client secret that no published page may hold, and it forwards the calls a store makes to the Notion API, which a page cannot call itself. It keeps no state: no token, no document, no session and no log of either.

Its rules are in the [service contract](https://github.com/etalii-adp/etalii.adp/blob/develop/specs/012-notion-hype-cycle-addon/contracts/service.md) in `etalii.adp`. This page says what exists here and how it is run.

## What exists

The service is one handler, [service/handler.ts](../service/handler.ts), that knows no platform: it takes a request and its configuration and answers a response. Two things are to run it.

| What runs it | State |
| --- | --- |
| The local service, [scripts/service.mjs](../scripts/service.mjs), at `http://localhost:8787` | Exists. The add-ons are built and checked against it |
| The Cloudflare Worker, [service/worker.ts](../service/worker.ts), at `https://adp-notion.notion-adp.workers.dev` | Deployed. The published pages talk to it; the `service` job of `Build` deploys it on every push to `develop` |

The address of the service is written in one place, [src/frame/config.ts](../src/frame/config.ts). A page served from `localhost` or `127.0.0.1` uses the local service. Any other page uses the deployed one.

## Endpoints

| Method and path | Does |
| --- | --- |
| `GET /authorize?state=<state>` | Redirects to Notion's grant of access. The add-on opens it in a window of its own |
| `GET /callback?code=<code>&state=<state>` | Exchanges the code for a token, the only use of the client secret, and answers a page that posts the token to the window that opened it and closes |
| `POST /refresh` | Exchanges a refresh token for a new access token and a new refresh token |
| `OPTIONS /notion/<path>` | Answers the browser's preflight |
| `GET`, `POST`, `PATCH` `/notion/<path>` | Forwards the call to `https://api.notion.com/<path>` with the token the page sent, and passes Notion's answer on unchanged |
| Anything else | `404` |

Only the calls a store makes are forwarded; any other is answered `403` and never reaches Notion:

| Method | Path | For |
| --- | --- | --- |
| `GET` | `v1/users/me` | Whether the token is still valid |
| `GET` | `v1/databases/<id>` | The database's data source |
| `GET` | `v1/data_sources/<id>` | The properties |
| `PATCH` | `v1/data_sources/<id>` | Preparing a database |
| `POST` | `v1/data_sources/<id>/query` | Reading the rows |
| `POST` | `v1/pages` | A new row |
| `PATCH` | `v1/pages/<id>` | A changed row, and a row moved to or from the trash |

A call without a token is answered `401`, and one with a query string `403`. When Notion cannot be reached the answer is `502` with the code `bad_gateway`. Every answer carries `Cache-Control: no-store`, and only pages of the allowed origin are given the header that lets a browser read it.

## Configuration and secrets

| Name | What |
| --- | --- |
| `NOTION_CLIENT_ID` | The client id of the public Notion integration |
| `NOTION_CLIENT_SECRET` | Its client secret. It is in no repository, no page and no log |
| `ALLOWED_ORIGIN` | The one origin whose pages may call the service and receive the token |

The local service reads all three from the environment. `ALLOWED_ORIGIN` is `http://localhost:8080` when it is not set: the origin a local build of the add-ons is served from.

## What a maintainer does once

Register a Notion integration, at <https://www.notion.so/profile/integrations>:

- as a public integration, so that it grants access through OAuth;
- with two redirect addresses: `https://adp-notion.notion-adp.workers.dev/callback` for the Worker and `http://localhost:8787/callback` for the local service;
- with the capabilities to read, update and insert content.

Notion then shows the client id and the client secret. Keep the secret out of every file of the repository.

The Worker gets the two secrets with `npx wrangler secret put NOTION_CLIENT_ID --config service/wrangler.toml` and the same for `NOTION_CLIENT_SECRET`; each asks for the value, so it lands in no file. `Build` deploys the Worker with the token in the repository's Actions secret `CLOUDFLARE_API_TOKEN`, a Cloudflare token that may edit Workers. The Worker's `ALLOWED_ORIGIN` is `https://etalii.net`, in [service/wrangler.toml](../service/wrangler.toml).

## Running the local service

```text
node scripts/service.mjs [--memory] [--port 8787]
```

### Against Notion

Set `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` to those of the integration, and `ALLOWED_ORIGIN` when the add-ons are not served from `http://localhost:8080`, then run `node scripts/service.mjs`. Without the two it prints what is missing and stops. With another `--port`, the redirect address of the integration must name that port.

The service then answers at `http://localhost:8787`. A local build of an add-on, opened from `localhost`, grants access through it and reads and writes real databases with the rights of the person who granted. [scripts/store.mjs](../scripts/store.mjs) uses it by default too, with the token of `NOTION_TOKEN`; see [set-up-a-graph.md](set-up-a-graph.md).

### With `--memory`

`node scripts/service.mjs --memory` needs no account anywhere. An in-memory Notion, the one the tests use, answers the calls, and the grant of access is given at once, without asking. It holds one empty database with the title property `Name`, whose id the service prints when it starts:

```text
11111111-1111-4111-8111-111111111111
```

Give an add-on that id as its `store` to see it working, the preparing of the database included. A script that brings its own token uses `memory-token`:

```text
NOTION_TOKEN=memory-token node scripts/store.mjs put 11111111-1111-4111-8111-111111111111 test/examples/gartner-hype-cycle-graph/electric-vehicles/electric-vehicles.ghg
```

Everything is gone when the service stops.

## The Worker

Not written yet. What the service contract plans for it: a file `service/worker.ts` that hands each request to the same handler, a `service/wrangler.toml` that sets `ALLOWED_ORIGIN` to `https://etalii.net`, and the two secrets set on the Worker. The `Build` workflow is to deploy it with `wrangler deploy` on a push to `develop` only, with an Actions secret `CLOUDFLARE_API_TOKEN` that may deploy this one Worker and nothing else; a pull request deploys nothing and sees no secret. Creating the Cloudflare account, setting the secrets and registering the Worker's redirect address are a maintainer's to do. This section is written out when the Worker is.
