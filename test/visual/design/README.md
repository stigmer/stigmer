# The drawings' facts

What each drawing that passed the owner's look says, so the build is held to the drawing and not only to its own approved screenshot. `tests/design.spec.ts` checks every built screen against these files, and audits every scene of the catalogue for the kit's layout rules. The suite's `whole` project runs it (`playwright.config.ts`); `make test-visual` runs it with the rest.

## What a facts file holds

`<screen>.json` is one screen of a design page (`s01.json` is the session page's S01), with one entry per drawing the screen shows:

- `built`: the gallery scenes and widths that build the drawing. A drawing several scenes build between them (S53's strips) names each, and a fact holds when any of them holds it. A drawing no scene builds yet has `built: []` and says why in `unbuilt`.
- `words`: each block's own words and their type (size, line height, weight), and `buttons`: each button's name and height. These are the drawing's, exported by the design page; nobody edits them by hand.
- `sample`: words the drawing invents that the scene's data differs in (a time, a name, a figure), each with what the scene shows instead. Not checked.
- `ruled`: a difference the owner ruled, with his ruling and where it is recorded. Not checked.
- `pending`: a fact known to fail, with the change that fixes it. The test fails when a pending fact holds, so the change that fixes it takes its line out: the list is the work left.

A screen a later look replaced names it in `replacedBy` and has no drawings (S16 and S17, replaced by S53's strips).

`layout-pending.json` lists each scene's known layout breaks against the change that fixes them, in the same way.

## How a fact holds

The test draws each scene whole, in light, at its width (`tests/draw.ts`), and reads it with `tests/design-read.ts`, the rules the design page reads its drawings with:

- a word holds when a block of the built screen holds the drawn words (case and spacing aside);
- its type holds when the built block whose words are exactly the drawn words has the drawn size, line height and weight;
- a button holds when a built button's name holds the drawn name and one such button has the drawn height, to a pixel.

The layout audit reads every scene: text sizes with the line height their step pairs (`sdk/theme/src/tokens.css`), no paragraph or heading keeping the browser's margin, paddings and gaps in half spacing units.

## After a design passes his look

1. Export its facts from the design page: the Export facts button, or `window.stigmerDesignFacts()` in its console, saved as `design-facts.json`.
2. `node test/visual/scripts/import-design-facts.mjs design-facts.json "<page>, version <n>"` writes each screen's file, keeping its `built`, `sample`, `ruled` and `pending`.
3. Name the scenes a new drawing is built as, then run the suite with `DESIGN_FACTS_REPORT=<file>` set: each failing fact is written there, one JSON line per drawing and per scene, to judge as kit, sample, ruled or pending.

## The whole pictures

A Built look puts each scene's whole picture beside its whole drawing. `WHOLE_OUT=<folder> node test/visual/run-in-image.mjs --project=whole whole.spec.ts` draws every scene the facts name, whole, in light and dark at two device pixels per CSS pixel, into that folder.
