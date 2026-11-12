// Holds the one list of example agents to its files: the committed module is
// what the generator writes now, and every rule an example keeps (each folder
// listed, each listed file present, the output named in the instructions, the
// first message naming its samples, no two ids or agent slugs alike) is both
// met by the tree and caught when broken.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GENERATED, ROOT, displayName, problems, readTree, render } from "./generate.mjs";

const tree = readTree();

test("the tree keeps every rule", () => {
  assert.deepEqual(problems(tree), []);
});

test("the committed module is what the generator writes now", () => {
  assert.equal(readFileSync(join(ROOT, GENERATED), "utf8"), render(tree));
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
