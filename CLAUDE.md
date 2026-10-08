# etalii.adp.ide.notion

The Notion add-ons of ADP. A Notion add-on is a web page that shows one ADP tool inside a Notion page, and this repository builds and publishes them at <https://etalii.net/adp-notion>. There is one add-on, the Gartner hype cycle graph, in `addons/gartner-hype-cycle-graph/`. Every ADP tool is a diagram, a designer or an editor; these words, host, Notion add-on, store, and the specification and definition languages (DISL/DID, DESL/DED, EDSL/EDD), mean what [ADP terminology](https://github.com/etalii-adp/etalii.adp/blob/develop/docs/terminology.md) says they mean, which is their single source.

The repository's principles are in etalii.adp, at [.specify/memory/repositories/etalii.adp.ide.notion.md](https://github.com/etalii-adp/etalii.adp/blob/develop/.specify/memory/repositories/etalii.adp.ide.notion.md).

## How work is done here: spec-driven development (GitHub Spec Kit)

Every change starts as a specification, written in [etalii.adp](https://github.com/etalii-adp/etalii.adp) rather than here: this repository has no Spec Kit setup of its own. A feature is `specs/NNN-feature-name/` in etalii.adp, specified, planned and split into tasks with etalii.adp's Spec Kit skills as its `CLAUDE.md` describes; its tasks name files here as `etalii.adp.ide.notion/...`, and the code arrives here in a pull request of its own, on a branch named as the feature's. That pull request's description links the feature's folder in etalii.adp and names the etalii.adp commit its tasks were taken from, and the tasks are ticked in etalii.adp only once it is merged. Work on it from etalii.adp's folder, with this repository's clone beside it, or set `SPECIFY_INIT_DIR` to etalii.adp's folder.

Specs say *what* and *why*; plans say *how*. Do not put implementation choices in a spec.

The add-ons, their address, their store, the service and the shared parts are specified by etalii.adp's spec `012-notion-hype-cycle-addon`; its `contracts/` are what the code here is written against.

## What is where

| Folder | Holds |
| --- | --- |
| `addons/<id>/` | One add-on: its page, `addon.json`, and the copies of its specification and binding. [addons/README.md](addons/README.md) says how a second one is made |
| `src/` | The shared parts, compiled once into the `addon.js` and `addon.css` of every add-on |
| `service/` | The service between an add-on and Notion: one handler |
| `scripts/` | The build, the checks, the local service and the scripts that refresh the copies |
| `test/` | The tests, with the copied examples and fixtures they read |
| `docs/` | [set-up-a-graph.md](docs/set-up-a-graph.md), [service.md](docs/service.md), [disl-support.md](docs/disl-support.md) |

## The shared parts

Every add-on is drawn and edited by the same code. An add-on brings no script and no style; what a tool type needs and the shared parts lack is added to the shared parts, for every add-on.

| Part | Folder | Does |
| --- | --- | --- |
| FBL library | `src/fbl/` | Reads a body through a binding and plans edits as splices. A copy, never edited here |
| DISL interpreter | `src/disl/` | Makes the metamodel, the notation, the toolbox, the forms, the constraints and the behavior of a specification, and evaluates its expressions |
| History | `src/history/` | Commands, their handlers, a dispatcher and the history stack: run, undo, redo |
| Store | `src/store/` | The open document of a Notion database: read, edit, undo, redo, and the calls to Notion through the service |
| Canvas | `src/canvas/` | The drawing and its gestures |
| Panels | `src/panels/` | The toolbox and the property grid, and `notion.css`, the one place a colour, a size or a spacing is stated |
| Frame | `src/frame/` | The page: its states, keys, status and findings. A story's wiring is a module of its own under `src/frame/parts/`, attached through `onPage` of `src/frame/page.ts`; the build bundles every module there |

`src/shims/` holds what the build puts in the place of a module of Node; no source imports it.

The rules, each enforced by a test:

- **The shared parts name no tool type.** No file under `src/` holds an element, attribute, relation, enum value, rule or sentence of a tool type as a whole identifier or as a whole word of a string literal. `test/words.test.ts` takes those names from every specification and binding under `addons/` and fails on one. A name that DISL, FBL, TypeScript or the web platform uses as a word too is exempt only by a line of `test/words.exempt.json` that says which of them uses it. Read a name from the specification; never write it. `scripts/check-tree.mjs` checks the same of the built `addon.js`.
- **A part imports only parts above it in the table**, imports of types included. The history imports no other part, the panels import neither the store nor the canvas, and the frame alone imports all. `test/parts.test.ts` reads the imports of every file under `src/`.
- **Only `src/store/session.ts` and `src/store/notion.ts` know the service or a token**, and only `src/frame/config.ts` holds the service's address. `test/parts.test.ts` checks both.
- **Every edit is a command.** `edit`, `undo` and `redo` of an open document are dispatches through its history stack; there is no second way of applying a change. One gesture is one command and one step of undo.
- **Styles use the `--notion-*` properties of `src/panels/notion.css`** and no literal colour, and every class the shared parts write begins with `adp-`.

What the interpreter supports of DISL, and what it does not, is listed in [docs/disl-support.md](docs/disl-support.md). A feature is added to `src/disl/support.ts` and to that page by the change that builds it.

## The copies that are never edited

Three sets of files are copies of what another repository owns, taken byte for byte from a git object of the clone beside this one, each with a `PROVENANCE.md` that records the repository, path, commit and SHA-256. A correction goes to the owning repository and arrives with a newer copy; `.gitattributes` keeps git from converting a line ending in them.

| Copy | From | Refreshed by |
| --- | --- | --- |
| `addons/<id>/<id>.dis` and its `.fbl` | The specification in `etalii.adp`, and the binding in the repository its `persistence.binding` names | `node scripts/sync-specifications.mjs` |
| `src/fbl/` | `src/core/fbl` of `etalii.adp.ide.vscode` | `node scripts/sync-fbl.mjs` |
| `test/examples/` and `test/fixtures/` | The examples and fixtures of each add-on's tool type, `mindmap.dis` and DISL's JSON Schema | `node scripts/sync-examples.mjs` |

Each script takes `<repository>=<git ref>` to copy from another commit than `origin/develop`, and `--check`, which copies nothing, reads no other repository, and exits with a code other than 0 when a copy differs from its record. The Build workflow runs all three checks. `src/fbl/` is not linted here.

## Scripts

| Command | Does |
| --- | --- |
| `node scripts/build.mjs --out <dir>` | Writes the published tree: the add-on index and one folder per add-on, with `addon.js` and `addon.css`. It installs the dependencies itself (`scripts/ensure-dependencies.mjs`) and runs the checks of the copies. `npm run build` writes to `dist/` |
| `node scripts/check-tree.mjs <dir>` | Checks a built tree: the files of every add-on, no name of a tool type in `addon.js`, nothing that reads as a secret |
| `node scripts/service.mjs [--memory] [--port 8787]` | Runs the local service |
| `node scripts/store.mjs put\|take <database> <file>` | Moves a document between a file and a store, with the token of `NOTION_TOKEN` |
| `node scripts/sync-specifications.mjs`, `sync-fbl.mjs`, `sync-examples.mjs` | Refresh the copies, as above |

## The service

An add-on reaches Notion through one small service, which completes Notion's grant of access and forwards the calls a store makes. It keeps no state, and the client secret is in no file of the repository, no page and no log.

- `service/handler.ts` is all of it, and it knows no platform: a request and its configuration in, a response out.
- The local service, `node scripts/service.mjs`, runs that handler at `http://localhost:8787`. With `--memory` an in-memory Notion answers and no account is needed. A page served from `localhost` uses it.
- The Cloudflare Worker that is to run the handler for the published pages is not written yet. It is the last step of spec 012; until then `src/frame/config.ts` holds no deployed address, and a page at `etalii.net` cannot open a store. Do not write that it can.

[docs/service.md](docs/service.md) has the endpoints, the secrets and how the service is run.

## Tests and checks

| Command | Does |
| --- | --- |
| `npm test` | vitest, in two projects: `parts` in Node, and `browser` in jsdom for `test/panels/`, `test/frame/` and `test/canvas/` |
| `npx vitest run <path>` | The tests of one file or folder |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit`, over `src/`, `service/` and `test/` |
| `python .github/scripts/check-files.py` | JSON, YAML and the links of the markdown files |

The store is tested against an in-memory Notion, `test/support/memoryNotion.ts`, and the page against the real handler in front of it; `test/support/openExample.ts` opens an example as the page does. No test calls Notion. What only Notion shows, such as embedding, the grant of access and both appearances, is a manual pass in a workspace.

The Build workflow runs all of the above on every pull request, builds the published tree and checks it, and checks the vocabulary of the documents against etalii.adp's glossary.

## Branches and delivery

- `develop` is the integration branch.
- Feature work happens on its own branch named `features/<name>`, in its own worktree; a Spec Kit feature's branch is named as etalii.adp's Spec Kit named it, `features/<number>-<name>`. The one exception is `claude/<name>`, which Claude's cloud sessions are handed by their harness.
- A feature branch is never merged locally into `develop`. When its work is done, push the branch from the worktree it was built in to `origin` and open a pull request into `develop`; nothing reaches `develop` except through a pull request.
- Pull requests are merged with a merge commit, never a squash or a rebase.
- When the pull request is merged or closed, delete the branch locally and on `origin`, and remove the worktree.

## Publication

A merge into `develop` is published at <https://etalii.net/adp-notion> with no manual step: the `deploy` workflow of `etalii.adp.site` checks this repository out, runs `node scripts/build.mjs --out <dir>` and serves the result beside the site. The repository has no GitHub Pages site of its own. The service is not published that way: it is deployed on its own once its Worker exists.

## Conventions

- Use ADP's words: Notion add-on, tool type, specification, binding, store, reader, and user for the person who changes a diagram.
- The smallest thing that works: plain functions and plain data, and comments that say why.
- The repository, its `README.md` and the add-on index claim nothing that is not published or does not work; planned work is labelled as planned.
- End commit messages written by an agent with a `Co-Authored-By:` trailer naming the model.
- When writing markdown files do not split lines to ensure a maximum line length is honored.
