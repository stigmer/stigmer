// The pure parts of the coding-agent plugin's install check
// (coding-agent-plugin-install.mjs): reading the version each tool reports
// from its own `plugin list --json`, in the shapes Claude Code 2.1.325 and
// Codex 0.161.0 print, and the command line, run as the lane runs it up to
// its refusal of bad arguments. The installs themselves run in the reconcile
// lane against the public repository.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { claudeInstalledVersion, codexInstalledVersion, parseArgs, DEFAULT_SOURCE } from "./coding-agent-plugin-install.mjs";

test("claudeInstalledVersion reads the plugin's entry and nothing else", () => {
  const list = JSON.stringify([
    { id: "other@stigmer", version: "9.9.9", scope: "user" },
    { id: "stigmer@stigmer", version: "0.2.0", scope: "project", enabled: true },
  ]);
  assert.equal(claudeInstalledVersion(list), "0.2.0");
  assert.equal(claudeInstalledVersion("[]"), undefined);
  assert.throws(() => claudeInstalledVersion("{}"), /expected an array/);
});

test("codexInstalledVersion reads the installed plugin's entry and nothing else", () => {
  const list = JSON.stringify({
    installed: [{ pluginId: "stigmer@stigmer", name: "stigmer", version: "0.2.0", installed: true, enabled: true }],
    available: [{ pluginId: "other@stigmer", version: "9.9.9" }],
  });
  assert.equal(codexInstalledVersion(list), "0.2.0");
  assert.equal(codexInstalledVersion(JSON.stringify({ installed: [], available: [] })), undefined);
  assert.throws(() => codexInstalledVersion("[]"), /expected an `installed` array/);
});

test("parseArgs needs a version and defaults the source to the public repository", () => {
  assert.deepEqual(parseArgs(["--version=0.2.0"]), { source: DEFAULT_SOURCE, version: "0.2.0" });
  assert.deepEqual(parseArgs(["--version=0.2.0", "--source=/tmp/tree"]), { source: "/tmp/tree", version: "0.2.0" });
  assert.equal(DEFAULT_SOURCE, "stigmer/coding-agent-plugin");
  assert.throws(() => parseArgs([]), /--version=<v> is required/);
  assert.throws(() => parseArgs(["--version=0.2.0", "--force"]), /unknown argument --force/);
});

/** The script run as the lane runs it; resolves with its exit code and output. */
function runScript(args) {
  const script = fileURLToPath(new URL("./coding-agent-plugin-install.mjs", import.meta.url));
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { encoding: "utf8" }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

test("the command line refuses a missing version or an unknown argument before installing anything", async () => {
  const missing = await runScript([]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^coding-agent-plugin-install: --version=<v> is required/);
  const unknown = await runScript(["--version=0.2.0", "--force"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /unknown argument --force/);
  assert.equal(missing.stdout + unknown.stdout, "");
});
