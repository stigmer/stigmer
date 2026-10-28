/**
 * Pins how a local runner installs the Claude engine (`engine-fetch.ts`),
 * against a loopback registry serving a synthetic engine
 * (`__test-utils__/claude-engine-fixture.ts`) through Node's own fetch.
 *
 * An install downloads exactly the pinned SDK and platform package, verifies
 * each against its integrity before extracting, and renames a complete home
 * into place; the home it leaves is found and loads. Refused: bytes that do
 * not match (before extraction, leaving no home and no partial directory), an
 * archive holding a link or a `..` entry. Retried: a 5xx. A stop mid-download
 * leaves no partial directory and throws the stop's reason. Two processes
 * installing into one root at once download once and both load. Old homes:
 * another version's unused for 30 days is removed, a recently used one is
 * kept, and a dead install's partial directory is cleared. Inside one
 * process, turns waiting on one install share it, and it stops only when the
 * last of them stops.
 */

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTar } from "@stigmer/artifact-fetch/testing";

import { FIXTURE_MARKER, startFixtureRegistry, writeHome, type FixtureRegistry } from "../../../__test-utils__/claude-engine-fixture.js";
import { PARTIAL_STALE_MS, PRUNE_AFTER_MS, installClaudeEngine, installForTurn } from "../engine-fetch.js";
import { CLAUDE_SDK, LAST_USED_FILE, currentPlatform, engineExecutable, engineHomeDir, findClaudeEngine, platformPackages } from "../engine-home.js";

const execFileAsync = promisify(execFile);
const VERSION = "9.9.9-test";
const PLATFORM_PACKAGE = platformPackages(currentPlatform())[0] as string;
const CHILD = fileURLToPath(new URL("../../../__test-utils__/engine-install-child.ts", import.meta.url));
const noWait = async (): Promise<void> => {};

/** Resolves once `ready()` holds, checking every 10 ms. */
async function until(ready: () => boolean): Promise<void> {
  while (!ready()) await new Promise((resolve) => setTimeout(resolve, 10));
}

let registry: FixtureRegistry;
let root: string;

beforeEach(async () => {
  registry = await startFixtureRegistry(VERSION, PLATFORM_PACKAGE);
  root = realpathSync(mkdtempSync(join(tmpdir(), "claude-engine-fetch-")));
});

afterEach(async () => {
  await registry.close();
  rmSync(root, { recursive: true, force: true });
});

function install(signal: AbortSignal = new AbortController().signal): ReturnType<typeof installClaudeEngine> {
  return installClaudeEngine({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, signal, sleep: noWait, lockPollMs: 20 });
}

function claudeDirEntries(): string[] {
  return readdirSync(join(root, "claude")).filter((name) => name !== ".install.lock").sort();
}

describe("installClaudeEngine", () => {
  it("downloads the pinned packages, verifies them, and leaves a home that is found and loads", async () => {
    const progress: number[] = [];
    let activity = 0;
    const installed = await installClaudeEngine({
      root,
      pin: registry.pin,
      platformPackage: PLATFORM_PACKAGE,
      signal: new AbortController().signal,
      onProgress: (fraction) => progress.push(fraction),
      onActivity: () => (activity += 1),
    });
    const home = engineHomeDir(root, VERSION);
    expect(installed).toEqual({ home, downloaded: true });
    expect(registry.hits(CLAUDE_SDK)).toBe(1);
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
    expect(progress.at(-1)).toBe(1);
    expect(activity).toBeGreaterThan(0);
    expect(claudeDirEntries()).toEqual([VERSION]);
    expect(readdirSync(home).sort()).toEqual(["node_modules"]);

    const executable = join(home, "node_modules", ...PLATFORM_PACKAGE.split("/"), engineExecutable(process.platform));
    expect(readFileSync(executable, "utf8")).toContain("synthetic claude");
    if (process.platform !== "win32") expect(statSync(executable).mode & 0o777).toBe(0o755);

    const search = findClaudeEngine({ pin: registry.pin, root, resolveFromRunner: () => null });
    expect(search.kind).toBe("found");
    if (search.kind !== "found") return;
    const sdk = (await import(pathToFileURL(search.engine.entry).href)) as { marker: string };
    expect(sdk.marker).toBe(FIXTURE_MARKER);
  });

  it("finds the home already there and downloads nothing", async () => {
    await install();
    await expect(install()).resolves.toEqual({ home: engineHomeDir(root, VERSION), downloaded: false });
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
  });

  it("refuses bytes that do not match the pin before extracting them, leaving no home and no partial directory", async () => {
    registry.tamper(PLATFORM_PACKAGE, gzipSync(buildTar([{ name: "package/claude", content: "not Anthropic's" }])));
    await expect(install()).rejects.toThrow(`the Claude Agent SDK (${PLATFORM_PACKAGE}) checksum mismatch — refusing to use the download`);
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
    expect(claudeDirEntries()).toEqual([]);
  });

  it("refuses an archive holding a link or a .. entry, even one whose integrity the pin names", async () => {
    for (const evil of [
      [{ name: "package/claude", typeFlag: "2", linkName: "/bin/sh" }],
      [{ name: "package/../../outside", content: "x" }],
    ]) {
      const bytes = gzipSync(buildTar(evil));
      const { createHash } = await import("node:crypto");
      const pin = {
        ...registry.pin,
        packages: { ...registry.pin.packages, [PLATFORM_PACKAGE]: { resolved: registry.pin.packages[PLATFORM_PACKAGE]?.resolved as string, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` } },
      };
      registry.tamper(PLATFORM_PACKAGE, bytes);
      await expect(installClaudeEngine({ root, pin, platformPackage: PLATFORM_PACKAGE, signal: new AbortController().signal })).rejects.toThrow(/archive refused/);
      expect(claudeDirEntries()).toEqual([]);
      expect(existsSync(join(root, "outside"))).toBe(false);
    }
  });

  it("retries a 5xx and installs", async () => {
    registry.override(PLATFORM_PACKAGE, (res, hit) => {
      if (hit > 1) return false;
      res.writeHead(503).end();
      return true;
    });
    await expect(install()).resolves.toMatchObject({ downloaded: true });
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(2);
  });

  it("stops mid-download on its signal, leaving no partial directory", async () => {
    const controller = new AbortController();
    const reason = new Error("the person stopped the turn");
    registry.override(PLATFORM_PACKAGE, (res, _hit, body) => {
      res.writeHead(200, { "content-length": String(body.length) });
      res.write(body.subarray(0, 64));
      setTimeout(() => controller.abort(reason), 20);
      return true;
    });
    await expect(install(controller.signal)).rejects.toBe(reason);
    expect(claudeDirEntries()).toEqual([]);
  });

  it("names a platform package the pin does not carry", async () => {
    await expect(
      installClaudeEngine({ root, pin: registry.pin, platformPackage: `${CLAUDE_SDK}-plan9-x64`, signal: new AbortController().signal }),
    ).rejects.toThrow(`the runner's Claude engine pin names no ${CLAUDE_SDK}-plan9-x64`);
  });

  it("removes another version's home unused for 30 days and a dead install's partial directory, keeping a recent one", async () => {
    const claudeDir = join(root, "claude");
    const now = Date.now();
    const old = new Date(now - PRUNE_AFTER_MS - 60_000);
    const stale = engineHomeDir(root, "0.0.1");
    writeHome(stale, "0.0.1", PLATFORM_PACKAGE);
    writeFileSync(join(stale, LAST_USED_FILE), "");
    utimesSync(join(stale, LAST_USED_FILE), old, old);
    const unstamped = engineHomeDir(root, "0.0.2");
    writeHome(unstamped, "0.0.2", PLATFORM_PACKAGE);
    utimesSync(unstamped, old, old);
    const recent = engineHomeDir(root, "0.0.3");
    writeHome(recent, "0.0.3", PLATFORM_PACKAGE);
    writeFileSync(join(recent, LAST_USED_FILE), "");
    utimesSync(recent, old, old);
    const deadPartial = join(claudeDir, ".partial-dead");
    mkdirSync(deadPartial);
    const dayAgo = new Date(now - PARTIAL_STALE_MS - 60_000);
    utimesSync(deadPartial, dayAgo, dayAgo);
    const livePartial = join(claudeDir, ".partial-live");
    mkdirSync(livePartial);

    await installClaudeEngine({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, signal: new AbortController().signal, now: () => now });
    expect(claudeDirEntries()).toEqual([".partial-live", "0.0.3", VERSION]);
  });
});

describe("two installs into one root at once", () => {
  it("in one process, the second waits on the lock and finds the first's home", async () => {
    // The first install is held inside its lock (its partial directory
    // exists, its body is unfinished) until the second has polled the lock.
    let finish = (): void => {};
    registry.override(PLATFORM_PACKAGE, (res, _hit, body) => {
      res.writeHead(200, { "content-length": String(body.length) });
      res.write(body.subarray(0, 100));
      finish = () => res.end(body.subarray(100));
      return true;
    });
    const first = install();
    while (!existsSync(join(root, "claude")) || !readdirSync(join(root, "claude")).some((name) => name.startsWith(".partial-")) || registry.hits(PLATFORM_PACKAGE) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = install();
    await new Promise((resolve) => setTimeout(resolve, 100));
    finish();
    await expect(first).resolves.toMatchObject({ downloaded: true });
    await expect(second).resolves.toMatchObject({ downloaded: false });
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
  });

  it("an old home it cannot remove stays, and the install goes on", async () => {
    const now = Date.now();
    const old = new Date(now - PRUNE_AFTER_MS - 60_000);
    const stuck = engineHomeDir(root, "0.0.1");
    writeHome(stuck, "0.0.1", PLATFORM_PACKAGE);
    utimesSync(stuck, old, old);
    const locked = join(stuck, "node_modules");
    chmodSync(locked, 0o500);
    try {
      await expect(installClaudeEngine({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, signal: new AbortController().signal, now: () => now })).resolves.toMatchObject({
        downloaded: true,
      });
      expect(claudeDirEntries()).toEqual(["0.0.1", VERSION]);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

describe("an install whose lock is taken from under it", () => {
  it("says so and goes on; a second install takes the lock and renames first, and the first then serves that home", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The first request for the platform package is held; every later one is served.
      let finish = (): void => {};
      registry.override(PLATFORM_PACKAGE, (res, hit, body) => {
        if (hit > 1) return false;
        res.writeHead(200, { "content-length": String(body.length) });
        res.write(body.subarray(0, 100));
        finish = () => res.end(body.subarray(100));
        return true;
      });
      const first = installClaudeEngine({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, signal: new AbortController().signal, lockStaleMs: 2_000 });
      await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
      rmSync(join(root, "claude", ".install.lock"), { recursive: true });
      await until(() => warn.mock.calls.some(([line]) => String(line).startsWith("[claude] the engine install lock was compromised (continuing):")));

      await expect(installClaudeEngine({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, signal: new AbortController().signal })).resolves.toEqual({
        home: engineHomeDir(root, VERSION),
        downloaded: true,
      });
      finish();
      await expect(first).resolves.toEqual({ home: engineHomeDir(root, VERSION), downloaded: false });
      expect(warn.mock.calls.some(([line]) => String(line).startsWith("[claude] releasing the engine install lock failed (ignored):"))).toBe(true);
      expect(claudeDirEntries()).toEqual([VERSION]);
      expect(findClaudeEngine({ pin: registry.pin, root, resolveFromRunner: () => null }).kind).toBe("found");
    } finally {
      warn.mockRestore();
    }
  }, 30_000);
});

describe("an install that cannot finish", () => {
  // The first request for the platform package is held until `finish`.
  function holdFirst(): { finish: () => void } {
    const held = { finish: (): void => {} };
    registry.override(PLATFORM_PACKAGE, (res, hit, body) => {
      if (hit > 1) return false;
      res.writeHead(200, { "content-length": String(body.length) });
      res.write(body.subarray(0, 100));
      held.finish = () => res.end(body.subarray(100));
      return true;
    });
    return held;
  }

  it("fails with the reason when the lock cannot be taken at all", async () => {
    mkdirSync(join(root, "claude"), { recursive: true });
    chmodSync(join(root, "claude"), 0o500);
    try {
      await expect(install()).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      chmodSync(join(root, "claude"), 0o700);
    }
  });

  it("stops a turn waiting on another install's lock with the stop's reason", async () => {
    const held = holdFirst();
    const first = install();
    await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
    const waiting = new AbortController();
    const reason = new Error("the waiting turn was stopped");
    const second = install(waiting.signal);
    await new Promise((resolve) => setTimeout(resolve, 60));
    waiting.abort(reason);
    await expect(second).rejects.toBe(reason);
    held.finish();
    await expect(first).resolves.toMatchObject({ downloaded: true });
  });

  it("fails when the home cannot be renamed into place and no other install put one there", async () => {
    const held = holdFirst();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = install();
    await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
    chmodSync(join(root, "claude"), 0o500);
    try {
      held.finish();
      await expect(first).rejects.toMatchObject({ code: "EACCES" });
      expect(existsSync(engineHomeDir(root, VERSION))).toBe(false);
    } finally {
      chmodSync(join(root, "claude"), 0o700);
      warn.mockRestore();
    }
  });
});

describe("two processes installing into one root at once", () => {
  it("download once, and both load the engine", async () => {
    // A slow body keeps the first install inside its lock while the second arrives.
    registry.override(PLATFORM_PACKAGE, (res, _hit, body) => {
      res.writeHead(200, { "content-length": String(body.length) });
      res.write(body.subarray(0, 100));
      setTimeout(() => res.end(body.subarray(100)), 400);
      return true;
    });
    const run = (): Promise<{ stdout: string }> =>
      execFileAsync(process.execPath, ["--import", "tsx", CHILD, root, JSON.stringify(registry.pin), PLATFORM_PACKAGE], { timeout: 60_000 });
    const results = (await Promise.all([run(), run()])).map(({ stdout }) => JSON.parse(stdout.trim().split("\n").at(-1) as string) as { downloaded?: boolean; marker?: string; error?: string });
    expect(results.map((r) => r.error)).toEqual([undefined, undefined]);
    expect(results.map((r) => r.marker)).toEqual([FIXTURE_MARKER, FIXTURE_MARKER]);
    expect(results.map((r) => r.downloaded).sort()).toEqual([false, true]);
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
    expect(registry.hits(CLAUDE_SDK)).toBe(1);
  }, 90_000);
});

describe("installForTurn", () => {
  const options = (): Parameters<typeof installForTurn>[0] => ({ root, pin: registry.pin, platformPackage: PLATFORM_PACKAGE, sleep: noWait, lockPollMs: 20 });

  // Holds the platform package's body until released, so turns can join and leave mid-download.
  function holdBody(): { release: () => void } {
    let release = (): void => {};
    registry.override(PLATFORM_PACKAGE, (res, _hit, body) => {
      res.writeHead(200, { "content-length": String(body.length) });
      res.write(body.subarray(0, 100));
      release = () => res.end(body.subarray(100));
      return true;
    });
    return { release: () => release() };
  }

  it("shares one install among the turns waiting on it, giving each the progress", async () => {
    const held = holdBody();
    const seen: [number[], number[]] = [[], []];
    const first = installForTurn(options(), { signal: new AbortController().signal, onProgress: (f) => seen[0].push(f) });
    const second = installForTurn(options(), { signal: new AbortController().signal, onProgress: (f) => seen[1].push(f) });
    await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
    held.release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { home: engineHomeDir(root, VERSION), downloaded: true },
      { home: engineHomeDir(root, VERSION), downloaded: true },
    ]);
    expect(registry.hits(PLATFORM_PACKAGE)).toBe(1);
    expect(seen[0].at(-1)).toBe(1);
    expect(seen[1].at(-1)).toBe(1);
  });

  it("lets one turn leave with its stop while the install goes on for the other", async () => {
    const held = holdBody();
    const leaving = new AbortController();
    const reason = new Error("this turn was stopped");
    const left = installForTurn(options(), { signal: leaving.signal });
    const staying = installForTurn(options(), { signal: new AbortController().signal });
    await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
    leaving.abort(reason);
    await expect(left).rejects.toBe(reason);
    held.release();
    await expect(staying).resolves.toMatchObject({ downloaded: true });
  });

  it("stops the install when the last waiting turn stops, and a later turn starts a new one", async () => {
    holdBody();
    const only = new AbortController();
    const reason = new Error("stopped");
    const first = installForTurn(options(), { signal: only.signal });
    await until(() => registry.hits(PLATFORM_PACKAGE) === 1);
    only.abort(reason);
    await expect(first).rejects.toBe(reason);

    registry.override(PLATFORM_PACKAGE, () => false);
    await expect(installForTurn(options(), { signal: new AbortController().signal })).resolves.toMatchObject({ downloaded: true });
    expect(claudeDirEntries()).toEqual([VERSION]);
  });

  it("refuses a turn that is already stopped without starting anything", async () => {
    const reason = new Error("already stopped");
    expect(() => installForTurn(options(), { signal: AbortSignal.abort(reason) })).toThrow(reason);
    expect(registry.hits(CLAUDE_SDK)).toBe(0);
  });
});
