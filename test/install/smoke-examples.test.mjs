// Holds the example smoke's checks to the catalogue: every example has a
// structure check and a scripted file for the offline run, the scripted file
// passes its own check (so the offline run proves the path, not the words),
// and a file that leaves an item out is refused (so the live run's check can
// fail).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { STRUCTURE, scriptedOutput } from "./smoke-examples.mjs";

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
