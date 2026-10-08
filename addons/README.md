# Notion add-ons

Each Notion add-on is one folder here, named by the id of its tool type: the name of the tool type's specification file in `etalii.adp`, without its extension, in lowercase letters and digits with dashes between words. The folder `addons/<id>/` is served at `https://etalii.net/adp-notion/<id>/`. The address depends on the folder's name alone, so it does not change when another add-on is added or removed. No add-on has the id `index`, which is the add-on index's own name.

| Add-on | Folder | Address |
| --- | --- | --- |
| Gartner hype cycle graph | [gartner-hype-cycle-graph](gartner-hype-cycle-graph/index.html) | `https://etalii.net/adp-notion/gartner-hype-cycle-graph/` |

The add-on index at <https://etalii.net/adp-notion> is generated from the folders found here by [scripts/build.mjs](../scripts/build.mjs); it is never written by hand. A file in this folder, such as this one, is no add-on.

## What an add-on consists of

An add-on is its folder, and nothing under `src/`: the canvas, the toolbox, the property grid, the store and the page around them are the shared parts, which read everything about a tool type from its specification and its binding.

| File | Content | Written by |
| --- | --- | --- |
| `index.html` | The page, the same for every add-on but for its title | Hand, once |
| `addon.json` | The names of the add-on's specification and binding, and where the specification lives in `etalii.adp` | Hand, once |
| `<id>.dis` | The DISL specification of the tool type, copied byte for byte from `etalii.adp` | `node scripts/sync-specifications.mjs` |
| `<name>.fbl` | The FBL binding the specification's `persistence.binding` names, copied byte for byte from the repository it lives in | `node scripts/sync-specifications.mjs` |
| `PROVENANCE.md` | The repository, path, commit and SHA-256 of both copies | `node scripts/sync-specifications.mjs` |

The three files the script writes are never edited here. A difference between an add-on and its specification or binding is raised as a change in `etalii.adp`, and arrives with a newer copy.

## Making a second add-on

1. Create the folder `addons/<id>/`, where `<id>` is the name of the tool type's specification file under `definitions/` in `etalii.adp`, without its extension.
2. Copy `index.html` from [gartner-hype-cycle-graph](gartner-hype-cycle-graph/index.html) and change its `<title>` to the tool type's name. Nothing else in it differs: the page loads `addon.css` and `addon.js` and calls nothing.
3. Write `addon.json`:

   ```json
   {
     "specification": "<id>.dis",
     "source": "definitions/diagrams/<id>.dis",
     "binding": "<name>.fbl"
   }
   ```

   `specification` and `binding` are the names of the two files in the folder; `source` is the path of the specification in `etalii.adp`.
4. Run `node scripts/sync-specifications.mjs`, with the clones of `etalii.adp` and of the repository that holds the binding beside this one. It copies the specification and the binding and writes `PROVENANCE.md`. `node scripts/sync-specifications.mjs --check` compares the copies with that record, and the Build workflow runs it on every pull request.
5. Run `node scripts/sync-examples.mjs` when the tool type has examples to test against, and then `npm test`. The words test now reads the new specification and binding too: no file under `src/` may hold a name they declare.

No script and no style is written for an add-on. What a tool type needs and the shared parts lack is added to the shared parts, for every add-on, and to [docs/disl-support.md](../docs/disl-support.md).

## What the build adds

`node scripts/build.mjs --out <dir>` compiles the shared parts under `src/` once, into `addon.js` and `addon.css`, and writes both into every add-on's folder of the published tree, beside the folder's own files. It also writes the add-on index, which lists each add-on by the `language.label` of its specification. A folder that holds a file named `addon.js` or `addon.css`, or that lacks `index.html`, `addon.json` or `PROVENANCE.md`, stops the build.

## A feature the shared parts do not support

A specification that requires a DISL feature the interpreter does not support still opens. The page shows a finding that names the feature, and what is not supported is read as the nearest thing that is. [docs/disl-support.md](../docs/disl-support.md) lists what is supported and what is not; a feature is added to that page by the change that builds it.

A tool type whose specification names no FBL binding cannot be an add-on yet: the store reads and writes a document through a binding only.
