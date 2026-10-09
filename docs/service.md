# The service

The Notion add-ons reach Notion through one small service. It completes Notion's grant of access, which needs a client secret that no published page may hold, and it forwards the calls a store makes to the Notion API, which a page cannot call itself. It keeps one thing, and briefly: the outcome of a grant in progress, for at most two minutes and for one reading. It keeps no document and no session, and it logs nothing.

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
| `GET /callback?code=<code>&state=<state>` | Exchanges the code for a token, the only use of the client secret, keeps the outcome for the add-on to ask for, and answers a page that posts the token to the window that opened it and closes. A page that no window opened stays and says to go back to Notion |
| `POST /grant` | Hands the outcome of a grant to the add-on that started it, once |
| `POST /refresh` | Exchanges a refresh token for a new access token and a new refresh token |
| `OPTIONS /notion/<path>`, `/refresh`, `/grant` | Answers the browser's preflight |
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
| `POST` | `v1/search` | The databases a person's access reaches, for the selection of a store |
| `GET` | `v1/blocks/<id>/children`, alone or with `?start_cursor=<id>` | The blocks of the page that holds a database and of the pages directly under it, to find the embed block |
| `PATCH` | `v1/blocks/<id>` | Setting the address of that embed block to name its store |
| `GET` | `v1/views?data_source_id=<id>`, alone or with `&start_cursor=<cursor>` | The views of a database, to hide the internal properties in them |
| `GET` | `v1/views/<id>` | Which properties a view shows |
| `PATCH` | `v1/views/<id>` | Hiding the internal properties in a view |

A call without a token is answered `401`. A call with a query string is answered `403`, but for the two the table gives: Notion takes the cursor of a list of blocks and the data source of a list of views in the query string and nowhere else. When Notion cannot be reached the answer is `502` with the code `bad_gateway`. Every answer carries `Cache-Control: no-store`, and only pages of the allowed origin are given the header that lets a browser read it.

## The grant in progress

A page embedded in the Notion desktop app cannot be handed a token by the window it opened: the app gives the address to the system's browser, a window with no opener, and keeps a storage of its own. So the service hands the token over, to the add-on that asks for it.

- The add-on makes a random `verifier`, 48 characters of `A-Z`, `a-z`, `0-9`, `-` and `_`, and sends as `state` its SHA-256 in base64url without padding, 43 characters. The state goes through addresses; the verifier leaves the page only in the body of `POST /grant`. Whoever reads the state can so ask for nothing.
- `/callback` keeps what it posts, `{ "source": "adp-notion", "state": "<state>", "token": "...", "refresh": "...", "workspace": "..." }` or, for a refusal or a failed exchange, `{ "source": "adp-notion", "state": "<state>", "error": "<code>" }`, under the state, for 120 seconds.
- `POST /grant` takes the body `{ "verifier": "<verifier>" }`. A verifier that is not 32 to 128 characters of that set is answered `400`. Otherwise the service computes the state from it and takes what is kept there: `200` with that object, or `204` with no body when the grant is still in progress or was never made. What it answers it has removed, so a grant is read once. It answers the allowed origin only, with the preflight of `/refresh`, and `Cache-Control: no-store`.
- The add-on asks every two seconds while it waits, for five minutes at most. When the window's message arrives first, it asks once more so that the kept copy is removed at once.

That is all the service keeps: a token is there for at most 120 seconds and is gone after one reading. Nothing of it is logged.

The Worker keeps a grant in a Durable Object, the class `Grant` of [service/worker.ts](../service/worker.ts), one object per state, bound as `GRANTS` in [service/wrangler.toml](../service/wrangler.toml). A key-value store would not do, since it may answer "not there" for a minute after a write. A put stores the value with the time it expires and sets an alarm for that time, which deletes it; a take answers the value if the time has not come, and deletes it. The local service keeps the grants in memory, in both of its modes, with the same two functions and the same 120 seconds.

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

`node scripts/service.mjs --memory` needs no account anywhere. An in-memory Notion, the one the tests use, answers the calls, and the grant of access is given at once, without asking; its outcome is kept for `POST /grant` as any other. It holds one empty database with the title property `Name`, on a page, and under that page a page with an embed block for each add-on that names no store yet. The service prints the id of the database when it starts:

```text
11111111-1111-4111-8111-111111111111
```

Open an add-on without a `store` to choose that database in it, or give the add-on that id as its `store`; either way the preparing of the database is seen. A script that brings its own token uses `memory-token`:

```text
NOTION_TOKEN=memory-token node scripts/store.mjs put 11111111-1111-4111-8111-111111111111 test/examples/gartner-hype-cycle-graph/electric-vehicles/electric-vehicles.ghg
```

Everything is gone when the service stops.

## The Worker

[service/worker.ts](../service/worker.ts) hands each request to the same handler, with the Worker's settings and its place for the grants in progress. [service/wrangler.toml](../service/wrangler.toml) sets `ALLOWED_ORIGIN` to `https://etalii.net`, binds the Durable Object class `Grant` as `GRANTS` and declares it with a migration, as a class with SQLite storage, which Cloudflare's free plan allows. The two secrets are set on the Worker. The `service` job of `Build` deploys it with `wrangler deploy` on a push to `develop` only; a pull request deploys nothing and sees no secret. `npx wrangler deploy --dry-run --config service/wrangler.toml --outdir <dir>` shows what would be deployed, the binding included, and deploys nothing.
