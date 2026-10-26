/**
 * Pins where a runner's Claude engine comes from (`engine-home.ts`).
 *
 * The order: the runner's own install wins over a home, so a developer's
 * tests never load a home a desktop app or `stigmer up` left on the machine;
 * a home is found under `STIGMER_ENGINES_DIR`, else `<home>/.stigmer/engines`.
 * The pin: an engine of another version is skipped and named, the runner's
 * own install included; a home without this machine's executable is skipped;
 * a runner without a pin loads its own install unchecked and names no home.
 * The platform package follows the SDK's own rule, musl first exactly when
 * the process report names no glibc. The `last-used` stamp is best effort:
 * a home the runner cannot write loads unstamped.
 */

import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeHome } from "../../../__test-utils__/claude-engine-fixture.js";
import {
  CLAUDE_SDK,
  ENGINES_DIR_ENV,
  LAST_USED_FILE,
  currentPlatform,
  engineExecutable,
  engineHomeDir,
  enginesRoot,
  findClaudeEngine,
  platformPackages,
  readEnginePin,
  resolveFromRunner,
  touchLastUsed,
  type ClaudeEnginePin,
  type PlatformFacts,
} from "../engine-home.js";

const VERSION = "9.9.9-test";
const MAC: PlatformFacts = { platform: "darwin", arch: "arm64", musl: false };
const MAC_PACKAGE = `${CLAUDE_SDK}-darwin-arm64`;

function pinFor(version: string): ClaudeEnginePin {
  return {
    version,
    packages: {
      [CLAUDE_SDK]: { resolved: "https://registry.test/sdk.tgz", integrity: "sha512-AAAA" },
      [MAC_PACKAGE]: { resolved: "https://registry.test/mac.tgz", integrity: "sha512-BBBB" },
    },
  };
}

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
  dirs = [];
  vi.restoreAllMocks();
});

function scratch(): string {
  // Resolution reports real paths (macOS's tmpdir is a link).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-engine-home-")));
  dirs.push(dir);
  return dir;
}

describe("enginesRoot", () => {
  it("is STIGMER_ENGINES_DIR when set, else <home>/.stigmer/engines", () => {
    expect(enginesRoot({ [ENGINES_DIR_ENV]: "/runner/engines" }, "/home/p")).toBe("/runner/engines");
    expect(enginesRoot({ [ENGINES_DIR_ENV]: "  " }, "/home/p")).toBe(join("/home/p", ".stigmer", "engines"));
    expect(enginesRoot({}, "/home/p")).toBe(join("/home/p", ".stigmer", "engines"));
  });

  it("reads the runner's home as its other ~/.stigmer paths do: HOME, then USERPROFILE", () => {
    vi.stubEnv("HOME", "/from/home");
    expect(enginesRoot({})).toBe(join("/from/home", ".stigmer", "engines"));
    vi.unstubAllEnvs();
  });

  it("names one version's home under claude/", () => {
    expect(engineHomeDir("/r", "0.3.310")).toBe(join("/r", "claude", "0.3.310"));
  });
});

describe("findClaudeEngine", () => {
  it("prefers the runner's own install over a home of the same version", () => {
    const root = scratch();
    writeHome(engineHomeDir(root, VERSION), VERSION, MAC_PACKAGE);
    const own = join(scratch(), "own");
    writeHome(own, VERSION, MAC_PACKAGE);
    const entry = join(own, "node_modules", ...CLAUDE_SDK.split("/"), "sdk.mjs");
    const found = findClaudeEngine({ pin: pinFor(VERSION), root, resolveFromRunner: () => entry, platform: MAC });
    expect(found).toEqual({ kind: "found", engine: { entry, version: VERSION, home: null }, skipped: [] });
  });

  it("finds the home under the root when the runner has no install of its own", () => {
    const root = scratch();
    const home = engineHomeDir(root, VERSION);
    writeHome(home, VERSION, MAC_PACKAGE);
    const found = findClaudeEngine({ pin: pinFor(VERSION), root, resolveFromRunner: () => null, platform: MAC });
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.engine.home).toBe(home);
    expect(found.engine.version).toBe(VERSION);
    expect(found.engine.entry).toBe(join(home, "node_modules", ...CLAUDE_SDK.split("/"), "sdk.mjs"));
  });

  it("skips the runner's own install at another version, naming it, and falls through to the home", () => {
    const root = scratch();
    writeHome(engineHomeDir(root, VERSION), VERSION, MAC_PACKAGE);
    const own = join(scratch(), "own");
    writeHome(own, "1.0.0", MAC_PACKAGE);
    const found = findClaudeEngine({
      pin: pinFor(VERSION),
      root,
      resolveFromRunner: () => join(own, "node_modules", ...CLAUDE_SDK.split("/"), "sdk.mjs"),
      platform: MAC,
    });
    expect(found.kind).toBe("found");
    expect(found.skipped).toEqual([`the runner's own install holds 1.0.0, not the pinned ${VERSION}`]);
  });

  it("skips a home whose SDK is another version, or that has no executable for this machine", () => {
    const root = scratch();
    const home = engineHomeDir(root, VERSION);
    writeHome(home, "1.0.0", MAC_PACKAGE);
    expect(findClaudeEngine({ pin: pinFor(VERSION), root, resolveFromRunner: () => null, platform: MAC })).toEqual({
      kind: "missing",
      skipped: [`${home}: it holds 1.0.0, not the pinned ${VERSION}`],
    });

    const linux: PlatformFacts = { platform: "linux", arch: "x64", musl: false };
    const other = scratch();
    writeHome(engineHomeDir(other, VERSION), VERSION, MAC_PACKAGE);
    expect(findClaudeEngine({ pin: pinFor(VERSION), root: other, resolveFromRunner: () => null, platform: linux }).skipped).toEqual([
      `${engineHomeDir(other, VERSION)}: no executable for linux-x64 in it`,
    ]);
  });

  it("skips a home directory with no SDK in it, and reports nothing when there is no home", () => {
    const root = scratch();
    const home = engineHomeDir(root, VERSION);
    writeHome(home, VERSION, MAC_PACKAGE);
    rmSync(join(home, "node_modules", ...CLAUDE_SDK.split("/")), { recursive: true });
    expect(findClaudeEngine({ pin: pinFor(VERSION), root, resolveFromRunner: () => null, platform: MAC }).skipped).toEqual([
      `${home}: no ${CLAUDE_SDK} in it`,
    ]);
    expect(findClaudeEngine({ pin: pinFor(VERSION), root: scratch(), resolveFromRunner: () => null, platform: MAC })).toEqual({ kind: "missing", skipped: [] });
  });

  it("without a pin, loads the runner's own install unchecked and looks for no home", () => {
    const root = scratch();
    writeHome(engineHomeDir(root, VERSION), VERSION, MAC_PACKAGE);
    expect(findClaudeEngine({ pin: null, root, resolveFromRunner: () => null, platform: MAC })).toEqual({ kind: "missing", skipped: [] });
    const own = join(scratch(), "own");
    writeHome(own, "4.5.6", MAC_PACKAGE);
    const entry = join(own, "node_modules", ...CLAUDE_SDK.split("/"), "sdk.mjs");
    expect(findClaudeEngine({ pin: null, root, resolveFromRunner: () => entry })).toMatchObject({ kind: "found", engine: { version: "4.5.6", home: null } });
  });

  it("names an unreadable SDK manifest as an unknown version", () => {
    const own = join(scratch(), "own");
    writeHome(own, VERSION, MAC_PACKAGE);
    const sdkDir = join(own, "node_modules", ...CLAUDE_SDK.split("/"));
    writeFileSync(join(sdkDir, "package.json"), "{ not json");
    expect(findClaudeEngine({ pin: pinFor(VERSION), root: scratch(), resolveFromRunner: () => join(sdkDir, "sdk.mjs") }).skipped).toEqual([
      `the runner's own install holds an unknown version, not the pinned ${VERSION}`,
    ]);
  });

  it("resolves the runner's own install from this checkout, where the SDK is a development dependency", () => {
    expect(resolveFromRunner()).toMatch(/claude-agent-sdk[\\/]sdk\.mjs$/);
  });
});

describe("readEnginePin", () => {
  it("is null when the runner carries none, and reads one it does", () => {
    const dir = scratch();
    expect(readEnginePin(join(dir, "claude-engine.json"))).toBeNull();
    writeFileSync(join(dir, "claude-engine.json"), JSON.stringify(pinFor(VERSION)));
    expect(readEnginePin(join(dir, "claude-engine.json"))).toEqual(pinFor(VERSION));
  });

  it("throws, naming the file, on a pin that is not one or pins no SDK", () => {
    const dir = scratch();
    const file = join(dir, "claude-engine.json");
    for (const broken of [{}, { version: "", packages: {} }, { version: "1", packages: { x: { resolved: 1 } } }, null]) {
      writeFileSync(file, JSON.stringify(broken));
      expect(() => readEnginePin(file)).toThrow(`${file} is not a Claude engine pin`);
    }
    writeFileSync(file, JSON.stringify({ version: "1", packages: { [MAC_PACKAGE]: { resolved: "u", integrity: "i" } } }));
    expect(() => readEnginePin(file)).toThrow(`${file} pins no ${CLAUDE_SDK}`);
  });

  it("is absent beside this source module, which no build writes a pin next to", () => {
    expect(readEnginePin()).toBeNull();
  });
});

describe("platformPackages", () => {
  it("follows the SDK's order: on Linux the libc's own first and the other second", () => {
    expect(platformPackages({ platform: "linux", arch: "x64", musl: false })).toEqual([`${CLAUDE_SDK}-linux-x64`, `${CLAUDE_SDK}-linux-x64-musl`]);
    expect(platformPackages({ platform: "linux", arch: "arm64", musl: true })).toEqual([`${CLAUDE_SDK}-linux-arm64-musl`, `${CLAUDE_SDK}-linux-arm64`]);
    expect(platformPackages({ platform: "win32", arch: "x64", musl: false })).toEqual([`${CLAUDE_SDK}-win32-x64`]);
    expect(engineExecutable("win32")).toBe("claude.exe");
    expect(engineExecutable("darwin")).toBe("claude");
  });

  it("calls a Linux musl exactly when the process report names no glibc runtime", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const report = vi.spyOn(process.report, "getReport");
    report.mockReturnValue({ header: {} } as ReturnType<typeof process.report.getReport>);
    expect(currentPlatform().musl).toBe(true);
    report.mockReturnValue({ header: { glibcVersionRuntime: "2.36" } } as unknown as ReturnType<typeof process.report.getReport>);
    expect(currentPlatform().musl).toBe(false);
    platform.mockReturnValue("darwin");
    expect(currentPlatform().musl).toBe(false);
  });
});

describe("touchLastUsed", () => {
  it("stamps a writable home, and leaves an unwritable one unstamped without failing", () => {
    const home = scratch();
    const at = new Date("2026-01-02T03:04:05Z");
    expect(touchLastUsed(home, at)).toBe(true);
    expect(statSync(join(home, LAST_USED_FILE)).mtimeMs).toBe(at.getTime());

    const readOnly = scratch();
    chmodSync(readOnly, 0o500);
    expect(touchLastUsed(readOnly)).toBe(false);
    expect(existsSync(join(readOnly, LAST_USED_FILE))).toBe(false);
  });
});
