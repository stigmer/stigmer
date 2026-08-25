// Pins the shared runtimes-install contract both acquirers depend on: the
// no-clobber root manifest (the runner and the server install into ONE
// per-version root), the dev-version gate, and the actionable install
// failure.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ensureRuntimesRoot, isAcquirableRelease, npmInstallIntoRuntimes } from "./runtimes-install.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "stigmer-runtimes-"));
}

describe("ensureRuntimesRoot", () => {
  it("creates the root with the stable manifest when absent", () => {
    const dir = join(tempDir(), "0.5.0");
    ensureRuntimesRoot(dir);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(manifest).toEqual({ name: "stigmer-runtime", private: true, version: "0.0.0" });
  });

  it("never clobbers an existing root manifest — the shared-root contract", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), '{"name":"stigmer-runtime","marker":"first-installer"}\n');
    ensureRuntimesRoot(dir);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain("first-installer");
  });
});

describe("isAcquirableRelease", () => {
  it("admits releases and rc/next versions, refuses dev builds", () => {
    expect(isAcquirableRelease("0.5.0")).toBe(true);
    expect(isAcquirableRelease("0.5.0-rc.1")).toBe(true);
    expect(isAcquirableRelease("0.0.0-dev")).toBe(false);
    expect(isAcquirableRelease("0.5.0-dev.20260825")).toBe(false);
  });
});

describe("npmInstallIntoRuntimes", () => {
  it("wraps an install failure in an actionable CliExitError with remediation hints", () => {
    // /dev/null/x is unwritable on every POSIX system, so the real npm spawn
    // fails deterministically without network access.
    const attempt = (): void => npmInstallIntoRuntimes("/dev/null/x", "@stigmer/nonexistent@0.0.0");
    expect(attempt).toThrow(CliExitError);
    try {
      attempt();
    } catch (err) {
      const hints = (err as CliExitError).hints?.join("\n") ?? "";
      expect(hints).toMatch(/npm install/);
      expect(hints).toMatch(/remove/i);
    }
  });
});
