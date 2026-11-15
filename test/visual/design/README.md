# The drawings' facts

What each drawing that passed the owner's look says, so the build is held to the drawing and not only to its own approved screenshot. `tests/design.spec.ts` checks every built screen against these files, and audits every scene of the catalogue for the kit's layout rules. The suite's `whole` project runs it (`playwright.config.ts`); `make test-visual` runs it with the rest.

## What a facts file holds

`<screen>.json` is one screen of a design page (`s01.json` is the session page's S01), with one entry per drawing the screen shows:

- `built`: the gallery scenes and widths that build the drawing. A drawing several scenes build between them (S53's strips) names each, and a fact holds when any of them holds it. A drawing no scene builds yet has `built: []` and says why in `unbuilt`.
- `words`: each block's own words and their type (size, line height, weight), and `buttons`: each button's name and height. These are the drawing's, exported by the design page; nobody edits them by hand.
- `sample`: words the drawing invents that the scene's data differs in (a time, a name, a figure), each with what the scene shows instead. Not checked.
- `ruled`: a difference the owner ruled, with his ruling in plain words and its date, or the issue or pull request that holds it. Not checked.
- `pending`: a fact known to fail, with the change that fixes it. The test fails when a pending fact holds, so the change that fixes it takes its line out: the list is the work left. A fact a page's own redesign settles (its words, its forms) says so with a reason that opens "When its page is redesigned:", as the layout list's later screens do, so it is demanded once that page is built.
- `reader`: the stamp of the reader the page read its drawings with (below). The import writes it; nobody edits it by hand.

A screen a later look replaced names it in `replacedBy` and has no drawings (S16 and S17, replaced by S53's strips).

`layout-pending.json` lists each scene's known layout breaks against the change that fixes them, in the same way.

## How a fact holds

The test draws each scene whole, in light, at its width (`tests/draw.ts`), and reads it with `readPage` in `tests/design-read.ts`, the same function every design page reads its drawings with (below). It reads each block's own words, and their type from the innermost element holding all of them (a pill in its line reads as the pill). A space between two elements is kept, and an inline box (a chip) ends a word. Text hidden from sight or from assistive technology is not read: a separator dot the kit hides is not a word. Then:

- a word holds when a block of the built screen holds the drawn words in their case and as whole words (spacing aside, and a curly quote or apostrophe the same as its plain form): a lower-case subject does not hold a sentence's capital, and "30s" is not held inside "1m 30s";
- its type holds when a built block whose words are exactly the drawn words has the drawn size, line height and weight (a file's name may show twice, at two weights);
- a button holds when a built button's name holds the drawn name as whole words (case aside) and one such button has the drawn height, to a pixel.

The layout audit reads every scene: text sizes with the line height their step pairs (`sdk/theme/src/tokens.css`), no paragraph or heading keeping the browser's margin (a margin a kit class on it or its parent sets is the kit's), paddings and gaps in half spacing units, and every opened step's body in its step's column (`auditSteps`: its left edge within a pixel of its words', and a body under the words alone ending before the step's trail). Its known breaks are listed per scene in `layout-pending.json`.

## One reader for the pages and the test

A design page reads its drawings with the repository's own reader, never a copy. `node test/visual/scripts/print-design-reader.mjs` prints `readPage` as one script that defines `window.stigmerReadPage` and `window.stigmerReaderStamp`. The page embeds that script as is, calls `stigmerReadPage({ root, skip, buttons })` on each drawing's frame (`skip` names its own notes: measurements, captions, frame bars; `buttons` its drawing's button classes), and writes the stamp into each drawing it exports. `--stamp` prints the stamp alone: 12 hex characters of the reader's hash, taken without its types or comments, so it moves only when what runs moves.

`src/__tests__/design-facts.test.ts` fails a facts file whose stamp is not the current one. So a change to `readPage` asks for every page to embed the newly printed script and export again. A page drawn later embeds it from the start.

## After a design passes his look

1. Export its facts from the design page: the Export facts button, or `window.stigmerDesignFacts()` in its console, saved as `design-facts.json`. The page must embed the reader the repository prints now (above).
2. `node test/visual/scripts/import-design-facts.mjs design-facts.json "<page>, version <n>"` writes each screen's file, keeping its `built`, `sample`, `ruled` and `pending`.
3. Name the scenes a new drawing is built as, then run the suite with `DESIGN_FACTS_REPORT=<file>` set: each failing fact is written there, one JSON line per drawing and per scene, to judge as kit, sample, ruled or pending.

## The whole pictures

A Built look puts each scene's whole picture beside its whole drawing. `WHOLE_OUT=<folder> node test/visual/run-in-image.mjs --project=whole whole.spec.ts` draws every scene the facts name, whole, in light and dark at two device pixels per CSS pixel, into that folder.
