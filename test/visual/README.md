# The kit's gallery

Every hero component of the React kit, drawn from fixed data, one scene per state, in light and dark. The visual suite compares each scene with its approved screenshot and audits it with axe, so the look changes only on purpose (`KIT-03` and `KIT-04` on the UX bar, `test/ux-bar.json`). The layer and its rules are in `test/README.md`, "The test standard" and "The UX bar".

## Run it

- `make test-visual` runs the package's unit checks, then the suite. Every picture is drawn by the browser of the pinned image (`playwright-image.json`), which Docker runs: `run-in-image.mjs` starts its browser server and points Playwright at it, and the suite itself runs on this machine's install.
- `make test-visual UPDATE=1` mints the screenshots again. Read the difference in review before committing it; the difference is the change.
- `npm run gallery -w @stigmer/visual-tests` serves the gallery to browse. Its index lists every scene; `?scene=<id>&mode=<light|dark>` draws one.

In CI the `visual` job of `ci.ts-workspace.yaml` runs inside the same image, on GitHub's arm64 runner, and uploads the expected, actual and diff pictures when a comparison fails.

## How a scene is drawn

- `src/catalog.ts` lists the scenes as plain data: an id, a title, the widths it is drawn at, and a button to press first for a component whose state opens on a click. The spec, the index page and the unit checks read it.
- `src/scenes/` draws each id, inside `StigmerProvider` with the scene's colour mode, over the stylesheet the kit ships and the theme presets. The map in `src/scenes/index.ts` is typed by the catalogue's ids, so a scene listed without a drawing fails the typecheck.
- `src/fake-server.ts` gives every scene a real client over an in-memory router: the kit's hooks run their own code. A drawing answers the calls its components make (`routes`); every other call answers `Unimplemented`, so a forgotten call shows the component's error state and fails its screenshot.
- Data comes from the scenario catalogue and `samples` in `@stigmer/react-sdk/test`, and from `src/fixtures.ts` for what they do not hold (the model registry, provider keys, the dashboard's figures). The clock is the catalogue's, the typefaces are the console's vendored files (`client-apps/web/src/app/fonts`), and the page reads no network.

## Add a scene

1. Add its id to `SceneId` and its entry to `SCENES` in `src/catalog.ts`.
2. Draw it in `src/scenes/`, answering every call its components make, and add it to `DRAWINGS`.
3. `make test-visual UPDATE=1` mints its pictures. The spec fails while a scene has no picture, and while a picture has no scene.
4. If the audit finds a critical or serious violation that is not this change's to fix, file it and list the rule in `KNOWN_VIOLATIONS` in `tests/gallery.spec.ts` against the issue, for the scene and mode it fails in. Add the issue to `KIT-04`'s `pending` in `test/ux-bar.json`.

A new state in the scenario catalogue needs its thread scene, or a line in `THREAD_DRAWN_ELSEWHERE` saying what draws it: the scene sweep (`src/__tests__/catalog.test.ts`) fails until it has one.

## The browser image

`playwright-image.json` names the official Playwright image by tag and digest, in its arm64 manifest, which an Apple-silicon Mac and GitHub's arm64 runner both run natively; an x64 machine runs it under emulation, with the same pixels. `src/__tests__/image-pin.test.ts` holds the `visual` job's `container.image` and runner, and the Playwright the lockfile pins, to it. Moving the pin re-mints every screenshot in one reviewed change. The file is a gate file (`test/README.md`, rule 5).
