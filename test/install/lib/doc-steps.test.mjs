// Pins how a Getting Started page becomes the steps the smoke runs
// (doc-steps.mjs): titled fences are files, bash lines are commands, the
// Stigmer Cloud tab is skipped, the install's own lines are the harness's,
// and a command the smoke cannot run as written refuses the parse. The last
// case reads the real path pages, so a page edit that the smoke could not
// run fails here before any stack boots. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HARNESS_LINES, docSteps, parseInfo } from "./doc-steps.mjs";

const fence = (info, body) => ["```" + info, ...body, "```"].join("\n");

test("a titled fence is a file, a bash fence is one command per line, and every other fence is prose", () => {
  const mdx = [
    fence('yaml title="agent.yaml"', ["kind: Agent", "metadata:", "  name: a"]),
    fence("bash", ["stigmer apply -f agent.yaml", "", "# a comment", "stigmer run a -m hi"]),
    fence("md", ["# Sample output"]),
    fence("typescript", ["const fragment = 1;"]),
  ].join("\n\n");
  assert.deepEqual(docSteps(mdx), [
    { kind: "file", path: "agent.yaml", content: "kind: Agent\nmetadata:\n  name: a\n" },
    { kind: "command", line: "stigmer apply -f agent.yaml" },
    { kind: "command", line: "stigmer run a -m hi" },
  ]);
});

test("the Stigmer Cloud tab is skipped, files and commands alike, and the tab beside it runs", () => {
  const mdx = [
    '<Tabs items={["On your machine", "Stigmer Cloud"]}>',
    '<Tab value="On your machine">',
    fence("bash", ["stigmer up"]),
    fence('typescript title="client.ts"', ["export const org = 'stigmer';"]),
    "</Tab>",
    '<Tab value="Stigmer Cloud">',
    fence("bash", ["stigmer config context set --org <your-org>"]),
    fence('typescript title="client.ts"', ["export const org = process.env.STIGMER_ORG!;"]),
    "</Tab>",
    "</Tabs>",
    fence("bash", ["stigmer down"]),
  ].join("\n\n");
  assert.deepEqual(docSteps(mdx), [
    { kind: "command", line: "stigmer up" },
    { kind: "file", path: "client.ts", content: "export const org = 'stigmer';\n" },
    { kind: "command", line: "stigmer down" },
  ]);
});

test("a one-line tab opens and closes on its line", () => {
  const mdx = ['<Tab value="Stigmer Cloud">Sign in first.</Tab>', fence("bash", ["stigmer up"])].join("\n\n");
  assert.deepEqual(docSteps(mdx), [{ kind: "command", line: "stigmer up" }]);
});

test("each install line is the harness's, matched exactly", () => {
  for (const { line, performs } of HARNESS_LINES) {
    assert.deepEqual(docSteps(fence("bash", [line])), [{ kind: "harness", line, performs }]);
  }
});

test("a command with a placeholder the harness does not perform refuses the parse", () => {
  assert.throws(() => docSteps(fence("bash", ["export ANTHROPIC_API_KEY=<my key>"])), /placeholder/);
  assert.throws(() => docSteps(fence("bash", ["stigmer run … -m hi"])), /placeholder/);
});

test("a CLI install the harness does not name refuses the parse rather than installing another CLI", () => {
  assert.throws(() => docSteps(fence("bash", ["brew install stigmer/tap/stigmer@3"])), /installs the CLI/);
  assert.throws(() => docSteps(fence("bash", ["npm i -g @stigmer/cli@latest"])), /installs the CLI/);
});

test("a fence left open refuses the parse, naming its line", () => {
  assert.throws(() => docSteps(["intro", "```bash", "stigmer up"].join("\n")), /line 2 never closes/);
});

test("a fence's title is read beside other attributes", () => {
  assert.deepEqual(parseInfo('yaml validate-as="Agent" title="a.yaml"'), { language: "yaml", title: "a.yaml" });
  assert.deepEqual(parseInfo("bash"), { language: "bash", title: undefined });
});

test("the path pages parse, run on the machine tab, and hand the harness its lines", () => {
  const page = (name) =>
    readFileSync(fileURLToPath(new URL(`../../../docs/getting-started/${name}.mdx`, import.meta.url)), "utf8");
  const quickstart = docSteps(page("quickstart"));
  assert.ok(quickstart.some((step) => step.kind === "command" && step.line === "stigmer up"));
  assert.ok(quickstart.some((step) => step.kind === "harness" && step.performs === "model-key"));
  assert.ok(quickstart.some((step) => step.kind === "file" && step.path === "variance-reporter.yaml"));
  const fromCode = docSteps(page("call-from-your-app"));
  assert.ok(fromCode.some((step) => step.kind === "harness" && step.performs === "sdk"));
  assert.deepEqual(
    fromCode.filter((step) => step.kind === "file").map((step) => step.path),
    ["client.ts", "variance-report.ts"],
  );
});
