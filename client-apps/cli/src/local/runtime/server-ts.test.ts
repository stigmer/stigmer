// Pins the cutover switch (D4 #24): STIGMER_SERVER_BIN selects the Go
// rollback binary before anything else; otherwise the TS server resolves
// exactly like the runner (explicit dir → repo tree → acquired slim package).

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireServer, ensureServer, resolveServerTs } from "./server-ts.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const fakeNode = (): string => "/usr/bin/node";

// Snapshot and restore the env vars the switch reads, so tests don't leak.
const TOUCHED = [
  "STIGMER_SERVER_BIN",
  "STIGMER_SERVER_DIR",
  "STIGMER_NODE_BIN",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function builtServerDir(): string {
  const dir = tempDir("stigmer-server-ts-");
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "main.js"), "//");
  return dir;
}

describe("ensureServer (the switch)", () => {
  it("selects the Go binary when STIGMER_SERVER_BIN is set — the rollback lever", () => {
    const dir = tempDir("stigmer-go-");
    const bin = join(dir, "stigmer-server");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.STIGMER_SERVER_BIN = bin;

    expect(ensureServer({ node: fakeNode })).toEqual({ kind: "binary", bin });
  });

  it("prefers the binary override even when a TS server dir is also set", () => {
    const dir = tempDir("stigmer-go-");
    const bin = join(dir, "stigmer-server");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.STIGMER_SERVER_BIN = bin;
    process.env.STIGMER_SERVER_DIR = builtServerDir();

    expect(ensureServer({ node: fakeNode }).kind).toBe("binary");
  });

  it("rejects a binary override that does not exist, with rollback guidance", () => {
    process.env.STIGMER_SERVER_BIN = "/nonexistent/stigmer-server";
    expect(() => ensureServer({ node: fakeNode })).toThrow(
      /STIGMER_SERVER_BIN does not exist/,
    );
  });

  it("resolves the TS server when no override is set", () => {
    const dir = builtServerDir();
    process.env.STIGMER_SERVER_DIR = dir;

    expect(ensureServer({ node: fakeNode })).toEqual({
      kind: "node",
      nodeBin: "/usr/bin/node",
      entryPath: join(dir, "dist", "main.js"),
      appDir: dir,
    });
  });
});

describe("resolveServerTs", () => {
  it("resolves a built server from STIGMER_SERVER_DIR", () => {
    const dir = builtServerDir();
    process.env.STIGMER_SERVER_DIR = dir;

    expect(resolveServerTs(fakeNode)).toEqual({
      kind: "node",
      nodeBin: "/usr/bin/node",
      entryPath: join(dir, "dist", "main.js"),
      appDir: dir,
    });
  });

  it("errors with build guidance (and the rollback hint) when dist/main.js is missing", () => {
    const dir = tempDir("stigmer-server-ts-");
    writeFileSync(join(dir, "package.json"), "{}");
    process.env.STIGMER_SERVER_DIR = dir;

    expect(() => resolveServerTs(fakeNode)).toThrow(/not built/);
    // Remediation rides in hints, not the message: the build command and the
    // Go rollback lever must both be offered.
    const hints = captureHints(() => resolveServerTs(fakeNode));
    expect(hints.join("\n")).toMatch(/make build-server-ts/);
    expect(hints.join("\n")).toMatch(/STIGMER_SERVER_BIN/);
  });

  it("rejects an override that is not a server package", () => {
    const dir = tempDir("stigmer-server-ts-");
    process.env.STIGMER_SERVER_DIR = join(dir, "no-package-here"); // no package.json
    expect(() => resolveServerTs(fakeNode)).toThrow(/not a server package/);
  });
});

describe("acquireServer", () => {
  it("installs the slim package and resolves its main.js entry", () => {
    const home = tempDir("stigmer-home-");
    const installed: Array<{ dir: string; spec: string }> = [];
    const install = (dir: string, spec: string): void => {
      installed.push({ dir, spec });
      // Simulate the npm install laying down the slim package.
      const pkgDir = join(dir, "node_modules", "@stigmer", "server-slim");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "main.js"), "// slim bundle");
    };

    const launch = acquireServer({
      home,
      version: "0.5.0",
      node: fakeNode,
      install,
    });

    const installDir = join(home, ".stigmer", "runtimes", "0.5.0");
    expect(launch).toEqual({
      kind: "node",
      nodeBin: "/usr/bin/node",
      entryPath: join(
        installDir,
        "node_modules",
        "@stigmer",
        "server-slim",
        "main.js",
      ),
      appDir: join(installDir, "node_modules", "@stigmer", "server-slim"),
    });
    expect(installed).toEqual([
      { dir: installDir, spec: "@stigmer/server-slim@0.5.0" },
    ]);
  });

  it("reuses a prior install without reinstalling", () => {
    const home = tempDir("stigmer-home-");
    const pkgDir = join(
      home,
      ".stigmer",
      "runtimes",
      "0.5.0",
      "node_modules",
      "@stigmer",
      "server-slim",
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "main.js"), "// slim bundle");

    const install = vi.fn();
    const launch = acquireServer({
      home,
      version: "0.5.0",
      node: fakeNode,
      install,
    });

    expect(launch.kind).toBe("node");
    expect(install).not.toHaveBeenCalled();
  });

  // The runner and the server share one per-version install root; acquiring
  // the server after the runner must ADD to it, never clobber the root
  // manifest the runner's install already wrote.
  it("shares the runtimes install root with the runner without clobbering it", () => {
    const home = tempDir("stigmer-home-");
    const installDir = join(home, ".stigmer", "runtimes", "0.5.0");
    mkdirSync(installDir, { recursive: true });
    writeFileSync(
      join(installDir, "package.json"),
      '{"name":"stigmer-runtime","marker":"pre-existing"}\n',
    );

    const install = (dir: string): void => {
      const pkgDir = join(dir, "node_modules", "@stigmer", "server-slim");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "main.js"), "// slim bundle");
    };
    acquireServer({ home, version: "0.5.0", node: fakeNode, install });

    expect(readFileSync(join(installDir, "package.json"), "utf8")).toContain(
      "pre-existing",
    );
  });

  // The hunted npm failure shape: the install runs but the platform-native
  // package was skipped (unsupported OS/arch), so the entry never appears.
  it("errors actionably when the install produces no entry", () => {
    const home = tempDir("stigmer-home-");
    const install = vi.fn(); // runs, lays down nothing
    const attempt = (): unknown => acquireServer({ home, version: "0.5.0", node: fakeNode, install });
    expect(attempt).toThrow(/install did not produce/);
    expect(install).toHaveBeenCalledOnce();
    const hints = captureHints(attempt).join("\n");
    expect(hints).toMatch(/platform-native/);
    expect(hints).toMatch(/Remove .* and retry/);
  });

  it("refuses to acquire for a non-release (dev) build, naming both fallbacks", () => {
    const home = tempDir("stigmer-home-");
    const attempt = (): unknown =>
      acquireServer({
        home,
        version: "0.0.0-dev",
        node: fakeNode,
        install: vi.fn(),
      });
    expect(attempt).toThrow(/non-release build/);
    // Both escape hatches ride in the hints: the TS dir and the Go rollback.
    const hints = captureHints(attempt);
    expect(hints.join("\n")).toMatch(/STIGMER_SERVER_DIR/);
    expect(hints.join("\n")).toMatch(/STIGMER_SERVER_BIN/);
  });
});

function captureHints(attempt: () => unknown): readonly string[] {
  try {
    attempt();
  } catch (err) {
    return (err as { hints?: readonly string[] }).hints ?? [];
  }
  throw new Error("expected the attempt to throw");
}
