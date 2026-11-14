#!/usr/bin/env node
/**
 * Merges a design page's exported facts into the repository's facts files.
 *
 * A design that passed the owner's look exports what each drawing says
 * (its blocks' words and type, its buttons' names and heights) as
 * `design-facts.json`: the page's Export facts button, or
 * `window.stigmerDesignFacts()` in its console. This script writes each
 * drawing's facts into `test/visual/design/<screen>.json`, where
 * `tests/design.spec.ts` checks the built scene against them.
 *
 * What a facts file holds besides the drawing's own facts is the
 * repository's, and a re-export keeps it: a later look that replaced the
 * screen (`replacedBy`, and then no drawings), which scenes build each drawing
 * (`built`) or why none does yet (`unbuilt`), and the facts a person has
 * judged (`sample`: data the drawing invents, such as a time; `ruled`: a
 * difference the owner ruled; `pending`: a known failure and the change
 * that fixes it). A drawing new to a file gets `built: []` and an
 * `unbuilt` reason to fill in, which the spec refuses until it is.
 *
 * Usage: node test/visual/scripts/import-design-facts.mjs <design-facts.json> <source>
 *   <source> names the page and version the facts came from, as the files
 *   record it ("the session page, version 15").
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the facts files are: `design/`, or the folder `DESIGN_FACTS_DIR` names (the import's own test writes into a scratch one). */
const DESIGN = process.env.DESIGN_FACTS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "design");

/** A screen's id, as the facts files are named and read: s01, p03, g10, s29b. */
const SCREEN_ID = /^[spg]\d+[a-z]?$/;

/** The drawing's own facts, as the page exported them, in the file's shape. */
function factsOf(drawing) {
  return {
    words: drawing.blocks.map((block) => ({ text: block.text, type: block.type })),
    buttons: drawing.buttons.map((button) => ({ name: button.name, height: button.height })),
  };
}

/** One screen's facts file, merged: the export's facts over what the file already judged. */
export function merge(existing, screen, drawings, source) {
  return {
    screen: screen.screen,
    title: screen.title,
    source,
    ...(existing?.replacedBy === undefined ? {} : { replacedBy: existing.replacedBy }),
    // A screen a later look replaced keeps no drawings: nothing builds it.
    drawings: (existing?.replacedBy === undefined ? drawings : []).map((drawing) => {
      const kept = existing?.drawings?.[drawing.drawing];
      return {
        caption: drawing.caption,
        narrow: drawing.narrow,
        built: kept?.built ?? [],
        ...(kept?.unbuilt === undefined && (kept?.built ?? []).length > 0 ? {} : { unbuilt: kept?.unbuilt ?? "" }),
        ...factsOf(drawing),
        sample: kept?.sample ?? {},
        ruled: kept?.ruled ?? {},
        pending: kept?.pending ?? {},
      };
    }),
  };
}

function main([exportFile, source]) {
  if (exportFile === undefined || source === undefined) {
    console.error("usage: import-design-facts.mjs <design-facts.json> <source>");
    process.exit(2);
  }
  const exported = JSON.parse(readFileSync(exportFile, "utf8"));
  const byScreen = new Map();
  for (const drawing of exported) {
    // The readers take only these names (design.spec.ts, whole.spec.ts):
    // a screen named otherwise would be written and never checked.
    if (!SCREEN_ID.test(String(drawing.id))) {
      console.error(`import-design-facts: refusing screen id ${JSON.stringify(drawing.id)}: a screen is s, p or g, its number, and an optional letter (s29b)`);
      process.exit(1);
    }
    byScreen.set(drawing.id, [...(byScreen.get(drawing.id) ?? []), drawing]);
  }
  for (const [id, drawings] of byScreen) {
    const file = join(DESIGN, `${id}.json`);
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    writeFileSync(file, `${JSON.stringify(merge(existing, drawings[0], drawings, source), null, 2)}\n`);
  }
  console.log(`${byScreen.size} screens written to ${DESIGN}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
