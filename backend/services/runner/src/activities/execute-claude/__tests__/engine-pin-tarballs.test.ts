/**
 * Pins that the engine this runner pins can be installed by its own
 * installer's rules: the real published tarballs of the SDK and this
 * machine's platform package, at the lockfile's version, match the
 * integrity the pin records and extract under the strict rules
 * `extractPackageTarball` applies (regular files under `package/` only).
 *
 * Why it matters: every other fetch test runs on synthetic archives. A pin
 * bump whose tarball carried a directory entry, a link or a pax header would
 * pass them all and then fail every local runner's first Claude turn; this
 * fails the bump instead. The tarballs come from npm's own cache, which the
 * install that ran these tests filled, so the read is local. Each is packed
 * by the URL the pin records, never by `name@version`: a version names a
 * tarball through the package's metadata, and a cache whose metadata
 * predates a new pin answers ETARGET for a version that is published.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { extractPackageTarball } from "@stigmer/artifact-fetch";

import { claudeEnginePinFromLockfile } from "../../../../scripts/claude-engine-pin.mjs";
import { CLAUDE_SDK, currentPlatform, platformPackages } from "../engine-home.js";

const pin = claudeEnginePinFromLockfile(fileURLToPath(new URL("../../../../package-lock.json", import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "claude-engine-tarballs-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the pinned Claude engine's real tarballs", () => {
  it("pins the SDK and a platform package for every machine the SDK names, all at one version", () => {
    expect(Object.keys(pin.packages)).toContain(CLAUDE_SDK);
    expect(Object.keys(pin.packages).length).toBeGreaterThanOrEqual(2);
    for (const { resolved, integrity } of Object.values(pin.packages)) {
      expect(resolved.startsWith("https://registry.npmjs.org/")).toBe(true);
      expect(resolved.endsWith(`-${pin.version}.tgz`)).toBe(true);
      expect(integrity).toMatch(/^sha512-/);
    }
  });

  for (const name of [CLAUDE_SDK, platformPackages(currentPlatform())[0] as string]) {
    it(`match the pinned integrity and extract under the installer's rules: ${name}`, async () => {
      const packed = JSON.parse(
        execFileSync("npm", ["pack", pin.packages[name]?.resolved ?? "", "--pack-destination", dir, "--prefer-offline", "--json", "--silent"], { encoding: "utf8", cwd: dir }),
      ) as { filename: string }[];
      const tarball = join(dir, packed[0]?.filename ?? "");
      const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
      expect(integrity).toBe(pin.packages[name]?.integrity);
      const out = join(dir, "out", name);
      const { files } = await extractPackageTarball(tarball, out, { prefix: "package/", label: name });
      expect(files).toBeGreaterThan(1);
      expect((JSON.parse(readFileSync(join(out, "package.json"), "utf8")) as { version: string }).version).toBe(pin.version);
    }, 120_000);
  }
});
