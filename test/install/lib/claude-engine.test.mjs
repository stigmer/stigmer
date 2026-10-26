// Pins the image smokes' Claude probe (claude-engine.mjs): the ready line
// names the version the runner's lockfile pins under the engines directory
// the image carries, and a runner whose boot logged anything else (the
// refusal, a download, another version) fails the probe naming the Claude
// lines it did log. The real lockfile is read, so a pin bump moves the line
// with no edit here.
// Run via `node --test test/install/lib/claude-engine.test.mjs` (wired into root `npm run test:root`).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { claudeEnginePinFromLockfile } from "../../../backend/services/runner/scripts/claude-engine-pin.mjs";
import { ALL_IN_ONE_ENGINES, LAYER_ENGINES, assertClaudeReady, claudeReadyLine } from "./claude-engine.mjs";

test("the ready line names the runner's pinned version under the engines the image carries", () => {
  const lockfile = fileURLToPath(new URL("../../../backend/services/runner/package-lock.json", import.meta.url));
  const { version } = claudeEnginePinFromLockfile(lockfile);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(claudeReadyLine(LAYER_ENGINES), `[claude] engine ready ${version} (/runner/engines/claude/${version})`);
  assert.equal(claudeReadyLine(ALL_IN_ONE_ENGINES), `[claude] engine ready ${version} (/opt/stigmer/engines/claude/${version})`);
});

test("a boot that logged the ready line passes; any other boot fails naming its Claude lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-engine-probe-"));
  try {
    const lockfile = join(dir, "package-lock.json");
    const entry = (name) => ({ version: "1.2.3", resolved: `https://registry.npmjs.org/${name}.tgz`, integrity: "sha512-AAAA" });
    writeFileSync(
      lockfile,
      JSON.stringify({
        packages: {
          "node_modules/@anthropic-ai/claude-agent-sdk": { ...entry("sdk"), optionalDependencies: { "@anthropic-ai/claude-agent-sdk-linux-x64": "1.2.3" } },
          "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64": entry("linux-x64"),
        },
      }),
    );
    const ready = "[claude] engine ready 1.2.3 (/runner/engines/claude/1.2.3)";
    assert.equal(assertClaudeReady(`boot\n${ready}\nWorker ready`, LAYER_ENGINES, lockfile), ready);
    assert.throws(
      () => assertClaudeReady("[claude] the Claude engine is not installed on this runner; Claude turns will be refused: no engine 1.2.3 under /runner/engines", LAYER_ENGINES, lockfile),
      /did not log the Claude engine ready \("\[claude\] engine ready 1\.2\.3 \(\/runner\/engines\/claude\/1\.2\.3\)"\); its Claude lines: \[claude\] the Claude engine is not installed/,
    );
    assert.throws(() => assertClaudeReady("nothing about it", LAYER_ENGINES, lockfile), /its Claude lines: none$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
