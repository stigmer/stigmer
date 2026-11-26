// Pins how a Getting Started page becomes the steps the smoke runs
// (doc-steps.mjs): titled fences are files (without the hidden setup above
// a `---cut---` line, which the reader never sees), bash lines are commands, the
// other target's tab is skipped (the Stigmer Cloud tab unless a run names
// it), the install's own lines are the harness's,
// and a command the smoke cannot run as written refuses the parse. The last
// case reads the real path pages, so a page edit that the smoke could not
// run fails here before any stack boots. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HARNESS_LINES, TARGET_TABS, docSteps, firstFence, parseInfo, registryPackagesOf } from "./doc-steps.mjs";

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

test("a titled fence is written as the reader copies it, without the hidden setup above its cut", () => {
  const mdx = [
    fence('tsx title="src/App.tsx"', ['import "vite/client";', "// ---cut---", 'import { AgentChat } from "@stigmer/react-sdk/chat";']),
    fence('python title="app.py"', ["user = None", "# ---cut---", "print(user)"]),
    fence('yaml title="agent.yaml"', ["# ---cut---", "kind: Agent"]),
  ].join("\n\n");
  assert.deepEqual(docSteps(mdx), [
    { kind: "file", path: "src/App.tsx", content: 'import { AgentChat } from "@stigmer/react-sdk/chat";\n' },
    { kind: "file", path: "app.py", content: "print(user)\n" },
    { kind: "file", path: "agent.yaml", content: "# ---cut---\nkind: Agent\n" },
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

test("a run that names the Stigmer Cloud tab reads it and skips the machine's", () => {
  const mdx = [
    '<Tabs items={["On your machine", "Stigmer Cloud"]}>',
    '<Tab value="On your machine">',
    fence("bash", ["stigmer up"]),
    "</Tab>",
    '<Tab value="Stigmer Cloud">',
    fence("bash", ["stigmer auth login"]),
    fence("bash", ["stigmer config context set --org <your-org>"]),
    "</Tab>",
    "</Tabs>",
    fence("bash", ["stigmer apply -f agent.yaml"]),
  ].join("\n\n");
  assert.deepEqual(docSteps(mdx, { target: "Stigmer Cloud" }), [
    { kind: "command", line: "stigmer auth login" },
    { kind: "harness", line: "stigmer config context set --org <your-org>", performs: "org-context" },
    { kind: "command", line: "stigmer apply -f agent.yaml" },
  ]);
  assert.deepEqual(TARGET_TABS, ["On your machine", "Stigmer Cloud"]);
});

test("a target that is not one of the two tabs refuses the parse", () => {
  assert.throws(() => docSteps(fence("bash", ["stigmer up"]), { target: "Cloud" }), /no target tab "Cloud"/);
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
  // The Cloud tab parses too: the first-hour journey runs it.
  const cloud = docSteps(page("quickstart"), { target: "Stigmer Cloud" });
  assert.ok(cloud.some((step) => step.kind === "command" && step.line === "stigmer auth login"));
  assert.ok(cloud.some((step) => step.kind === "harness" && step.performs === "org-context"));
  assert.ok(!cloud.some((step) => step.kind === "command" && step.line === "stigmer up"));
  assert.ok(cloud.some((step) => step.kind === "command" && step.line === "stigmer apply -f variance-reporter.yaml"));
  const fromCode = docSteps(page("call-from-your-app"));
  assert.ok(fromCode.some((step) => step.kind === "harness" && step.performs === "sdk"));
  assert.deepEqual(
    fromCode.filter((step) => step.kind === "file").map((step) => step.path),
    ["client.ts", "variance-report.ts"],
  );
});

test("the embedding tutorial parses into the app, its install, its files and its two servers", () => {
  const page = readFileSync(fileURLToPath(new URL("../../../docs/getting-started/embed-agent.mdx", import.meta.url)), "utf8");
  const steps = docSteps(page);
  assert.deepEqual(
    steps.filter((step) => step.kind === "harness").map((step) => step.performs),
    ["vite-app", "react-sdk", "backend", "dev-server"],
  );
  assert.deepEqual(
    steps.filter((step) => step.kind === "file").map((step) => step.path),
    ["server.ts", "vite.config.ts", "src/App.tsx"],
  );
  assert.deepEqual(
    steps.filter((step) => step.kind === "command").map((step) => step.line),
    ["cd my-app", "npm install"],
  );
});

test("make-the-chat-your-own parses into its five files, then App.tsx whole, and the tutorial's two servers", () => {
  const page = readFileSync(fileURLToPath(new URL("../../../docs/getting-started/make-the-chat-your-own.mdx", import.meta.url)), "utf8");
  const steps = docSteps(page);
  assert.deepEqual(
    steps.filter((step) => step.kind === "harness").map((step) => step.performs),
    ["backend", "dev-server"],
  );
  assert.deepEqual(
    steps.filter((step) => step.kind === "file").map((step) => step.path),
    ["src/brand.css", "src/open-account.tsx", "src/month-end-notes.tsx", "src/person-bubble.tsx", "src/agent-status.tsx", "src/App.tsx"],
  );
  assert.deepEqual(steps.filter((step) => step.kind === "command"), []);
});

test("an install line's registry half is every package outside @stigmer/*, in its order", () => {
  assert.deepEqual(registryPackagesOf("npm install @stigmer/client @connectrpc/connect-node"), ["@connectrpc/connect-node"]);
  assert.deepEqual(
    registryPackagesOf("npm install @stigmer/react-sdk @stigmer/client @stigmer/apis @bufbuild/protobuf @connectrpc/connect-node"),
    ["@bufbuild/protobuf", "@connectrpc/connect-node"],
  );
  assert.deepEqual(registryPackagesOf("npm i  @stigmer/client "), []);
  for (const line of ["npm install", "npm install -g @stigmer/cli", "npm install --save-dev x", "yarn add x", "pip install stigmer-sdk"]) {
    assert.throws(() => registryPackagesOf(line), /not an npm install of named packages/, line);
  }
});

test("each package install the harness performs from tarballs reads as one", () => {
  // The smoke's `sdk` and the tutorial's `react-sdk` install the tarballs plus
  // this half; a line that stopped reading as an npm install would fail here
  // before any stack boots.
  const performed = HARNESS_LINES.filter(({ performs }) => performs === "sdk" || performs === "react-sdk");
  assert.equal(performed.length, 2);
  for (const { line } of performed) assert.ok(registryPackagesOf(line).includes("@connectrpc/connect-node"), line);
});

test("firstFence reads the first fence of a language under a heading, and names what is missing", () => {
  const md = "# T\n\n## Quick Start\n\nText.\n\n```go\npackage main\n```\n\n```go\nsecond\n```\n\n## Next\n\n```python\nx\n```\n";
  assert.equal(firstFence(md, "Quick Start", "go"), "package main\n");
  assert.throws(() => firstFence(md, "Quick Start", "python"), /no ```python fence under "## Quick Start"/);
  assert.throws(() => firstFence(md, "Missing", "go"), /no "## Missing" section/);
});
