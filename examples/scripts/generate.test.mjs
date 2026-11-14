// Holds the one list of example agents to its files: the committed module is
// what the generator writes now, and every rule an example keeps (each folder
// listed, each listed file present, the output named in the instructions, the
// first message naming its samples, a message for a person's own file, no two
// ids or agent slugs alike) and every rule a ready-made skill keeps (its
// SKILL.md present, its frontmatter naming it by its id with a description)
// is both met by the tree and caught when broken.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GENERATED, GENERATED_SLUGS, ROOT, displayName, frontmatterOf, problems, readTree, render, renderSlugs } from "./generate.mjs";

const tree = readTree();

test("the tree keeps every rule", () => {
  assert.deepEqual(problems(tree), []);
});

test("the committed modules are what the generator writes now", () => {
  assert.equal(readFileSync(join(ROOT, GENERATED), "utf8"), render(tree));
  assert.equal(readFileSync(join(ROOT, GENERATED_SLUGS), "utf8"), renderSlugs(tree));
});

test("an agent's display name is its slug in words", () => {
  assert.equal(displayName("variance-reporter"), "Variance Reporter");
});

/** The real tree with one change, for proving a rule is caught. */
function broken(change) {
  const catalogue = structuredClone(tree.catalogue);
  const copy = { catalogue, folders: [...tree.folders], read: tree.read };
  change(copy);
  return problems(copy);
}

const first = tree.catalogue.examples[0];

test("a folder the catalogue doesn't list is caught", () => {
  assert.ok(broken((t) => t.folders.push("stray")).includes("stray: a folder catalogue.json doesn't list"));
});

test("a listed sample missing from its folder is caught", () => {
  const found = broken((t) => t.catalogue.examples[0].samples.push("missing.csv"));
  assert.ok(found.includes(`${first.id}: sample missing.csv is not in its folder`), found.join("\n"));
});

test("a first message that doesn't name its sample is caught", () => {
  const found = broken((t) => (t.catalogue.examples[0].message = "Do the job."));
  assert.ok(found.includes(`${first.id}: the first message doesn't name ${first.samples[0]}`), found.join("\n"));
});

test("an output the instructions don't name is caught", () => {
  const found = broken((t) => (t.catalogue.examples[0].output = "elsewhere.md"));
  assert.ok(found.includes(`${first.id}: the instructions don't name the output elsewhere.md`), found.join("\n"));
});

test("two examples with one id, or one agent, are caught", () => {
  const found = broken((t) => t.catalogue.examples.push(structuredClone(t.catalogue.examples[0])));
  assert.ok(found.includes(`${first.id}: two examples share this id`), found.join("\n"));
  assert.ok(found.some((line) => line.endsWith("two examples make the agent variance-reporter")), found.join("\n"));
});

test("a sample an agent can't be sure to read is caught", () => {
  const found = broken((t) => {
    t.catalogue.examples[0].samples = ["contract.pdf"];
    t.catalogue.examples[0].message = "Read contract.pdf.";
  });
  assert.ok(found.includes(`${first.id}: sample contract.pdf is not a text type an agent reads`), found.join("\n"));
});

test("every example has a message for the person's own file", () => {
  for (const entry of tree.catalogue.examples) assert.ok(typeof entry.ownFileMessage === "string" && entry.ownFileMessage.trim() !== "", entry.id);
  const found = broken((t) => delete t.catalogue.examples[0].ownFileMessage);
  assert.ok(found.includes(`${first.id}: "ownFileMessage" is missing`), found.join("\n"));
});

test("every skill's SKILL.md names it by its id, with a description", () => {
  assert.ok(tree.catalogue.skills.length > 0);
  for (const skill of tree.catalogue.skills) {
    const front = frontmatterOf(tree.read(".", skill.file));
    assert.equal(front?.name, skill.id);
    assert.ok(typeof front?.description === "string" && front.description !== "");
  }
});

test("a skill whose frontmatter names another skill, or is missing, is caught", () => {
  const renamed = broken((t) => (t.catalogue.skills[0].id = "other-name"));
  assert.ok(renamed.includes("skill other-name: its frontmatter names it spreadsheet-export"), renamed.join("\n"));
  const missing = broken((t) => (t.catalogue.skills[0].file = "skills/none/SKILL.md"));
  assert.ok(missing.includes("skill spreadsheet-export: skills/none/SKILL.md is not in the package"), missing.join("\n"));
  const bare = broken((t) => (t.read = (folder, file) => (file.endsWith("SKILL.md") ? "# no frontmatter\n" : tree.read(folder, file))));
  assert.ok(bare.includes("skill spreadsheet-export: skills/spreadsheet-export/SKILL.md opens with no frontmatter"), bare.join("\n"));
});

test("the catalogue holds the skill the React kit's agent page offers by id", () => {
  // sdk/react/src/journey/MakeItYoursTab.tsx offers `spreadsheet-export` by
  // this id; renaming it here without there would leave the tab's skill card
  // with nothing to offer.
  assert.ok(tree.catalogue.skills.some((skill) => skill.id === "spreadsheet-export"));
});
