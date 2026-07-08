import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { MIN_NODE_MAJOR, MIN_NODE_MINOR_ON_MAJOR, resolveNode } from "./node.js";
import { acquireRunner, resolveRunner } from "./runner.js";
import { resolveServerBinary } from "./server.js";
import { which } from "./which.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Snapshot and restore the env vars these resolvers read, so tests don't leak.
const TOUCHED = ["PATH", "STIGMER_SERVER_BIN", "STIGMER_RUNNER_DIR", "STIGMER_NODE_BIN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("which", () => {
  it("resolves an executable on PATH and returns null for an unknown name", () => {
    const dir = tempDir("stigmer-which-");
    const exe = join(dir, "myexec");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    process.env.PATH = dir;

    expect(which("myexec")).toBe(exe);
    expect(which("definitely-not-a-real-binary-xyz")).toBeNull();
  });

  it("checks an absolute path directly", () => {
    const dir = tempDir("stigmer-which-");
    const exe = join(dir, "tool");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    expect(which(exe)).toBe(exe);
    expect(which(join(dir, "missing"))).toBeNull();
  });
});

describe("resolveNode", () => {
  it("defaults to the current Node runtime", () => {
    delete process.env.STIGMER_NODE_BIN;
    expect(resolveNode()).toBe(process.execPath);
  });

  it("honors a valid override", () => {
    process.env.STIGMER_NODE_BIN = process.execPath; // a real Node >= 22.13
    expect(resolveNode()).toBe(process.execPath);
  });

  it("rejects an override that is not a working Node", () => {
    process.env.STIGMER_NODE_BIN = "/nonexistent/node";
    expect(() => resolveNode()).toThrow(CliExitError);
  });

  it("requires Node >= 22.13 (the node:sqlite floor)", () => {
    expect(MIN_NODE_MAJOR).toBe(22);
    expect(MIN_NODE_MINOR_ON_MAJOR).toBe(13);
  });
});

describe("resolveServerBinary", () => {
  it("honors the STIGMER_SERVER_BIN override", () => {
    const dir = tempDir("stigmer-server-");
    const bin = join(dir, "stigmer-server");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.STIGMER_SERVER_BIN = bin;
    expect(resolveServerBinary()).toBe(bin);
  });
});

describe("resolveRunner", () => {
  const fakeNode = (): string => "/usr/bin/node";

  it("resolves a built runner from STIGMER_RUNNER_DIR", () => {
    const dir = tempDir("stigmer-runner-");
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.js"), "//");
    process.env.STIGMER_RUNNER_DIR = dir;

    const resolution = resolveRunner(fakeNode);
    expect(resolution).toEqual({ nodeBin: "/usr/bin/node", entryPath: join(dir, "dist", "main.js"), appDir: dir });
  });

  it("errors with build guidance when dist/main.js is missing", () => {
    const dir = tempDir("stigmer-runner-");
    writeFileSync(join(dir, "package.json"), "{}");
    process.env.STIGMER_RUNNER_DIR = dir;
    expect(() => resolveRunner(fakeNode)).toThrow(/not built/);
  });

  it("rejects an override that is not a runner package", () => {
    const dir = tempDir("stigmer-runner-");
    process.env.STIGMER_RUNNER_DIR = join(dir, "no-package-here"); // no package.json
    expect(() => resolveRunner(fakeNode)).toThrow(/not a runner package/);
  });
});

describe("acquireRunner", () => {
  const fakeNode = (): string => "/usr/bin/node";

  it("installs the slim package and resolves its main.js entry", () => {
    const home = tempDir("stigmer-home-");
    const installed: Array<{ dir: string; spec: string }> = [];
    const install = (dir: string, spec: string): void => {
      installed.push({ dir, spec });
      // Simulate the npm install laying down the slim package.
      const pkgDir = join(dir, "node_modules", "@stigmer", "runner-slim");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "main.js"), "// slim bundle");
    };

    const resolution = acquireRunner({ home, version: "0.5.0", node: fakeNode, install });

    const expectedEntry = join(home, ".stigmer", "runtimes", "0.5.0", "node_modules", "@stigmer", "runner-slim", "main.js");
    expect(resolution.nodeBin).toBe("/usr/bin/node");
    expect(resolution.entryPath).toBe(expectedEntry);
    expect(resolution.appDir).toBe(join(home, ".stigmer", "runtimes", "0.5.0", "node_modules", "@stigmer", "runner-slim"));
    expect(installed).toEqual([{ dir: join(home, ".stigmer", "runtimes", "0.5.0"), spec: "@stigmer/runner-slim@0.5.0" }]);
  });

  it("reuses a prior install without reinstalling", () => {
    const home = tempDir("stigmer-home-");
    const pkgDir = join(home, ".stigmer", "runtimes", "0.5.0", "node_modules", "@stigmer", "runner-slim");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "main.js"), "// slim bundle");

    const install = vi.fn();
    const resolution = acquireRunner({ home, version: "0.5.0", node: fakeNode, install });

    expect(resolution.entryPath).toBe(join(pkgDir, "main.js"));
    expect(install).not.toHaveBeenCalled();
  });

  it("refuses to acquire for a non-release (dev) build", () => {
    const home = tempDir("stigmer-home-");
    expect(() => acquireRunner({ home, version: "0.0.0-dev", node: fakeNode, install: vi.fn() })).toThrow(
      /non-release build/,
    );
  });
});
