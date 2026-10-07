# etalii.adp.ide.notion

The Notion add-ons of ADP. A Notion add-on is a web page that shows one ADP tool inside a Notion page, and this repository builds and publishes them at <https://etalii.net/adp-notion>. There is no add-on yet. Every ADP tool is a diagram, a designer or an editor; these words, host, Notion add-on, and the specification and definition languages (DISL/DID, DESL/DED, EDSL/EDD), mean what [ADP terminology](https://github.com/etalii-adp/etalii.adp/blob/develop/docs/terminology.md) says they mean, which is their single source.

The repository's principles are in etalii.adp, at [.specify/memory/repositories/etalii.adp.ide.notion.md](https://github.com/etalii-adp/etalii.adp/blob/develop/.specify/memory/repositories/etalii.adp.ide.notion.md).

## How work is done here: spec-driven development (GitHub Spec Kit)

Every change starts as a specification, written in [etalii.adp](https://github.com/etalii-adp/etalii.adp) rather than here: this repository has no Spec Kit setup of its own. A feature is `specs/NNN-feature-name/` in etalii.adp, specified, planned and split into tasks with etalii.adp's Spec Kit skills as its `CLAUDE.md` describes; its tasks name files here as `etalii.adp.ide.notion/...`, and the code arrives here in a pull request of its own, on a branch named as the feature's. That pull request's description links the feature's folder in etalii.adp and names the etalii.adp commit its tasks were taken from, and the tasks are ticked in etalii.adp only once it is merged. Work on it from etalii.adp's folder, with this repository's clone beside it, or set `SPECIFY_INIT_DIR` to etalii.adp's folder.

Specs say *what* and *why*; plans say *how*. Do not put implementation choices in a spec.

## Branches and delivery

- `develop` is the integration branch.
- Feature work happens on its own branch named `features/<name>`, in its own worktree; a Spec Kit feature's branch is named as etalii.adp's Spec Kit named it, `features/<number>-<name>`. The one exception is `claude/<name>`, which Claude's cloud sessions are handed by their harness.
- A feature branch is never merged locally into `develop`. When its work is done, push the branch from the worktree it was built in to `origin` and open a pull request into `develop`; nothing reaches `develop` except through a pull request.
- Pull requests are merged with a merge commit, never a squash or a rebase.
- When the pull request is merged or closed, delete the branch locally and on `origin`, and remove the worktree.

## Publication

A merge into `develop` is published at <https://etalii.net/adp-notion> with no manual step: the `deploy` workflow of `etalii.adp.site` checks this repository out, runs `node scripts/build.mjs --out <dir>` and serves the result beside the site. The repository has no GitHub Pages site of its own.

## Conventions

- End commit messages written by an agent with a `Co-Authored-By:` trailer naming the model.
- When writing markdown files do not split lines to ensure a maximum line length is honored.
