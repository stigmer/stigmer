# The kit's gallery

Every hero component of the React kit, drawn from fixed data, one scene per state, in light and dark. The visual suite compares each scene with its approved screenshot and audits it with axe, so the look changes only on purpose (`KIT-03` and `KIT-04` on the UX bar, `test/ux-bar.json`). The layer and its rules are in `test/README.md`, "The test standard" and "The UX bar".

## Run it

- `make test-visual` runs the package's unit checks, then the suite. Every picture is drawn by the browser of the pinned image (`playwright-image.json`), which Docker runs: `run-in-image.mjs` starts its browser server and points Playwright at it, and the suite itself runs on this machine's install.
- `make test-visual UPDATE=1` mints the screenshots again. Read the difference in review before committing it; the difference is the change.
- `npm run gallery -w @stigmer/visual-tests` serves the gallery to browse. Its index lists every scene; `?scene=<id>&mode=<light|dark>` draws one.

In CI the `visual` job of `ci.ts-workspace.yaml` runs inside the same image, on GitHub's arm64 runner, and uploads the expected, actual and diff pictures when a comparison fails.

## How a scene is drawn

- `src/catalog.ts` lists the scenes as plain data: an id, a title, the widths it is drawn at, and the acts that bring a component to its state (`opens`): a button's name to press, `{ press, role }` for any other control (a tab, a radio, a menu item, a picker's option; a radio drawn as its label, the input visually hidden, is pressed on that label), or `{ fill, with }` to type into a labelled field. A name matches as a part of the control's or label's, case aside, as Playwright's locators do (a label that wraps its hint names the field with both); `exact: true` holds it to the whole, for a name that is part of another's or one held to a page's word. The spec, the index page and the unit checks read it. A control the scene cannot reach by its role and name has no accessible name: that is the kit's defect to fix, never the scene's to work around.
- `src/scenes/` draws each id, inside `StigmerProvider` with the scene's colour mode, over the stylesheet the kit ships and the theme presets. The map in `src/scenes/index.ts` is typed by the catalogue's ids, so a scene listed without a drawing fails the typecheck.
- `src/fake-server.ts` gives every scene a real client over an in-memory router: the kit's hooks run their own code. A drawing answers the calls its components make (`routes`); every other call answers `Unimplemented`, so a forgotten call shows the component's error state and fails its screenshot.
- Data comes from the scenario catalogue and `samples` in `@stigmer/react-sdk/test`, and from `src/fixtures.ts` for what they do not hold (the model registry, provider keys, the dashboard's figures). The clock is the catalogue's, the typefaces are the console's vendored files (`client-apps/web/src/app/fonts`), and the page reads no network.

## Add a scene

1. Add its id to `SceneId` and its entry to `SCENES` in `src/catalog.ts`.
2. Draw it in `src/scenes/`, answering every call its components make, and add it to `DRAWINGS`.
3. `make test-visual UPDATE=1` mints its pictures. The spec fails while a scene has no picture, and while a picture has no scene.
4. If the audit finds a critical or serious violation that is not this change's to fix, file it and list the rule in `KNOWN_VIOLATIONS` in `tests/gallery.spec.ts` against the issue, for the scene and mode it fails in. Add the issue to `KIT-04`'s `pending` in `test/ux-bar.json`.

A new state in the scenario catalogue needs its thread scene, or a line in `THREAD_DRAWN_ELSEWHERE` saying what draws it: the scene sweep (`src/__tests__/catalog.test.ts`) fails until it has one.

## Shown pictures

The site and the docs show some scenes as pictures: `<Screen name="approval" alt="…" />` on a page, never a captured screenshot. `src/shown.ts` lists them as plain data, each with a name pages use, its scene, the CSS size it is drawn at and an optional `clip` for one card. The `shown` project in `playwright.config.ts` draws each one as its scene's screenshot is drawn (`tests/draw.ts`), in dark, the site's one mode, at the device scale the site serves (`SHOWN_SCALE`), and compares it with `tests/__shown__/<name>.png`. `make test-visual UPDATE=1` mints them with the rest, so a change that moves a shown scene fails both its screenshot and its shown picture until both are minted again.

The site's build converts each approved picture into the files it serves (`site/scripts/generate-screens.ts`), so the redrawn picture reaches stigmer.ai in the same pull request; both website workflows trigger on `src/shown.ts` and `tests/__shown__/`. To show a new one:

1. Add its entry to `SHOWN` in `src/shown.ts`. Its scene must be in the catalogue; `src/__tests__/shown.test.ts` fails otherwise, and when a clip leaves the viewport.
2. `make test-visual UPDATE=1` mints its picture. `tests/shown.spec.ts` fails while an entry has no picture, and while a picture has no entry.
3. Embed it with `<Screen name="…" alt="…" />`.

A docs page's picture draws the values the page prints (a routine's name, its message, an Environment's hosts) from that page's example in `src/docs-examples.ts`: the scene builds its fixtures from it (`src/docs-fixtures.ts`) and its acts type them, and the site's `docs-screens` test holds every value to the page's source. A control the page names in bold is a value named `…Label` there, which the act presses or fills by, matched `exact` unless the control's name carries more than the page's word (then a rename that keeps the page's word inside the name, or a change of case, goes unheld), and which the check holds to the page's bold. Change the page and the example together.

## Live demos

The docs embed some scenes live: `<Live name="chat-popup" alt="…" />` on a page frames the gallery in its docs mode (`&embed=1`), which the site builds under `/gallery/` (`site/scripts/generate-gallery.ts`). `src/live.ts` lists them as plain data, each with a name pages use, its scene, its frame's height and whether a reader can talk to it. In the docs mode the page:

- draws only the scenes `src/live.ts` names, and under `/gallery/` sends an address with no scene to the docs' Gallery page;
- gives the kit an in-memory storage, so a demo neither reads nor writes the docs site's own;
- answers a scene's conversation through the scripted server (`src/live-server.ts`): a send plays the scripted turn from the kit's scenario catalogue (`scriptedTurn`), an approval or a denial lets it go on, Stop ends it, and a message sent while a turn works waits in the queue, as on the real server. A drawing opts in with `liveRoutes`;
- takes its look from its address (`preset`, `mode`, `radius`), then from the theme messages the docs' playground posts from the same origin.

`tests/live.spec.ts` draws every demo in both modes and audits it (`KIT-12`), and drives a send, an approval and a stop (`KIT-13`); `src/__tests__/live.test.ts` holds every entry to the catalogue and `src/__tests__/live-server.test.ts` the scripted server. The pictures stay the scenes' own screenshots. To embed a new one:

1. Add its entry to `LIVE` in `src/live.ts`. Its scene must be in the catalogue; a demo a reader can talk to needs a drawing with `liveRoutes`.
2. Embed it with `<Live name="…" alt="…" />`.

## The drawings' facts and whole pictures

The screenshots hold the build to its own approved look; the `whole` project holds it to the drawing that passed the owner's look. `tests/design.spec.ts` draws each scene a drawing names, whole, and checks it against the drawing's facts in `design/` (its words with their type, its buttons' names and heights), with each known difference listed against the change that fixes it or the ruling that keeps it. It also audits every scene for the kit's layout rules: text on the type scale, no paragraph or heading keeping the browser's margin, paddings and gaps in half spacing units. `design/README.md` has the file format, how a fact holds and how a new design's facts come in.

A scene the catalogue marks `whole` (the session view and the console pages the shared parts are drawn on) is pictured in a viewport grown until nothing in it scrolls, so its screenshot holds the whole turn or page, its top included. For a Built look, `WHOLE_OUT=<folder> node test/visual/run-in-image.mjs --project=whole whole.spec.ts` writes every scene the facts name, whole, in light and dark at two device pixels per CSS pixel.

## The browser image

`playwright-image.json` names the official Playwright image by tag and digest, in its arm64 manifest, which an Apple-silicon Mac and GitHub's arm64 runner both run natively; an x64 machine runs it under emulation, with the same pixels. `src/__tests__/image-pin.test.ts` holds the `visual` job's `container.image` and runner, and the Playwright the lockfile pins, to it. Moving the pin re-mints every screenshot in one reviewed change. The file is a gate file (`test/README.md`, rule 5).
