// Holds the example smoke's checks to the catalogue: every example has a
// structure check and a scripted file for the offline run, the scripted file
// passes its own check (so the offline run proves the path, not the words),
// and a file that leaves an item out is refused (so the live run's check can
// fail).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FOLDER_WORDS, STRUCTURE, scriptedOutput } from "./smoke-examples.mjs";

const catalogue = JSON.parse(readFileSync(new URL("../../examples/catalogue.json", import.meta.url), "utf8"));

test("every example has a structure check, and its scripted file keeps it", () => {
  for (const example of catalogue.examples) {
    assert.equal(typeof STRUCTURE[example.id], "function", `${example.id}: no structure check`);
    assert.deepEqual(STRUCTURE[example.id](scriptedOutput(example)), [], example.id);
  }
});

test("a file that leaves an item out is refused", () => {
  assert.deepEqual(STRUCTURE["ticket-replies"]("T-1042 only"), [
    "does not name T-1043",
    "does not name T-1044",
    "does not name T-1045",
    "does not name T-1046",
    "does not name T-1047",
    "does not name T-1048",
    "does not name T-1049",
  ]);
  assert.equal(STRUCTURE["contract-check"]("# Review\n\n## 7. Liability\n").length, 1);
});

test("a live reply that speaks of the runner's outputs folder is caught, one that names the file is not (#3200)", () => {
  for (const reply of ["Saved variance-report.md to your outputs folder.", "It is in /work/.stigmer/outputs/variance-report.md"]) {
    assert.match(reply, FOLDER_WORDS);
  }
  assert.doesNotMatch("Done. I've created `variance-report.md` with a two-sentence summary.", FOLDER_WORDS);
});
