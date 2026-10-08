# Screenshots

The images of the ADP tools in Notion, and how each was taken, precisely enough that anyone (or an agent) retakes a comparable image after a change. **When the add-on changes so that one of these no longer shows what a reader sees, retake it**; a stale screenshot is a false claim with a picture attached. The website shows these images, read from this folder.

## The shared setup, for every image

- **Source material**: only documents from [`test/examples/`](../../test/examples/) appear in any image, so every capture is reproducible from repository content alone.
- **The add-on**: built from the repository with `node scripts/build.mjs`, served from `http://localhost:8080`, and opened by its own address with a `store`, as an embed block of a Notion page opens it. The image is the add-on's page alone: the Notion page around an embed block is not in it.
- **The store**: the one database of the local service's in-memory Notion (`node scripts/service.mjs --memory`), filled with the example by `node scripts/store.mjs put`. No account is used, and the page starts with the token it would have after the grant of access.
- **Window**: viewport **1600×900 CSS px, device pixel ratio 1**, the whole page.
- **Appearance**: dark, unless the image's name ends in `-light`.
- **Layout**: the toolbox and the property grid both open, the bar with undo, redo and disconnect above, no message.
- **Selection**: the element drawn nearest the middle selected, so the property grid shows its properties.
- **Centred**: the middle of the drawing in the middle of the canvas, three steps of zoom in from the fitted view. A hype cycle, whose year axis spans decades, is then at a readable size with only its middle in view.
- **Format and budget**: PNG; each image ≤ 300 KB.

The whole procedure is executable: [`capture.mjs`](capture.mjs) drives all of the above with puppeteer-core over the Chrome DevTools protocol, in an installed Chrome or Edge. Run `npm i --no-save puppeteer-core`, then `node docs/screenshots/capture.mjs` from the repository root; image names as arguments retake those alone (`node docs/screenshots/capture.mjs gartner-hype-cycle-graph.png`). Retaking an image means re-running the script and committing the changed file; the entries below say what each image must show, which is what to check before committing a retake. The script exits non-zero naming any image whose diagram drew nothing, or whose toolbox or property grid stayed empty.

## The images

| Image | Document opened | What must be visible |
|---|---|---|
| `gartner-hype-cycle-graph.png` | `gartner-hype-cycle-graph/digital-trends/` → `digital-trends.ghg` | The digital trends as banners on the year axis, coloured by phase, with their names, the triggers as dated dots and the influences as curves between them; the tag filter, the Peak/Trough/Slope/Plateau key and the Compact toggle above; the toolbox showing Trend, Trigger and Note; the trend nearest the middle selected, with its properties in the property grid. Dark appearance. |
| `gartner-hype-cycle-graph-light.png` | `gartner-hype-cycle-graph/digital-trends/` → `digital-trends.ghg` | The same in the light appearance. |
