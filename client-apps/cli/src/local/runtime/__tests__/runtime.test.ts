import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { SERVER_NODE_FLOOR, SERVER_NODE_RANGE, resolveNode, resolveServerNode, serverRunsOn } from "../node.js";
import { acquireRunner, resolveRunner } from "../runner.js";
import { which } from "../which.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Snapshot and restore the env vars these resolvers read, so tests don't leak.
const TOUCHED = ["PATH", "STIGMER_RUNNER_DIR", "STIGMER_NODE_BIN"] as const;
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

// A fake "node" whose --version and capability-probe behavior the test
// controls, making these tests deterministic regardless of which Node runs
// the suite itself. The fake INSPECTS the probe script it receives ("fts5"
// in the source distinguishes the server's FTS5 probe from the runner's
// module-presence probe), so a mutation that wires resolveServerNode to the
// weaker probe — or neuters the FTS5 probe's failure exit — fails here.
function fakeNodeBinary(opts: { version: string; hasSqlite: boolean; hasFts5?: boolean }): string {
  const bin = join(tempDir("stigmer-node-"), "node");
  const fts5Exit = (opts.hasFts5 ?? opts.hasSqlite) ? 0 : 1;
  writeFileSync(
    bin,
    `#!/bin/sh\n` +
      `if [ "$1" = "--version" ]; then echo "${opts.version}"; exit 0; fi\n` +
      `case "$2" in *fts5*) exit ${fts5Exit};; esac\n` +
      `exit ${opts.hasSqlite ? 0 : 1}\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe("resolveNode", () => {
  it("resolves the current runtime iff it provides node:sqlite", () => {
    // The contract, not an environment assumption: on a supported Node the
    // own-runtime path resolves; on an unsupported one (e.g. 23.0-23.3, the
    // gap the old version-table gate let through) it must throw the
    // capability error rather than hand the runner a Node it will crash on.
    delete process.env.STIGMER_NODE_BIN;
    if (process.getBuiltinModule?.("node:sqlite") !== undefined) {
      expect(resolveNode()).toBe(process.execPath);
    } else {
      expect(() => resolveNode()).toThrow(/node:sqlite/);
    }
  });

  it("honors an override that passes the capability probe", () => {
    const bin = fakeNodeBinary({ version: "v22.13.0", hasSqlite: true });
    process.env.STIGMER_NODE_BIN = bin;
    expect(resolveNode()).toBe(bin);
  });

  it("rejects an override that is not a working Node", () => {
    process.env.STIGMER_NODE_BIN = "/nonexistent/node";
    expect(() => resolveNode()).toThrow(CliExitError);
  });

  it("rejects a Node without node:sqlite, naming the version and capability", () => {
    // The shape of a real 23.0-23.3 binary: healthy --version, no node:sqlite.
    process.env.STIGMER_NODE_BIN = fakeNodeBinary({ version: "v23.1.0", hasSqlite: false });

    expect(() => resolveNode()).toThrow(/node:sqlite/);
    expect(() => resolveNode()).toThrow(/v23\.1\.0/);
  });
});

describe("resolveServerNode", () => {
  it("honors an override in the server's range that passes the FTS5 capability probe", () => {
    const bin = fakeNodeBinary({ version: "v22.19.0", hasSqlite: true });
    process.env.STIGMER_NODE_BIN = bin;
    expect(resolveServerNode()).toBe(bin);

    const later = fakeNodeBinary({ version: "v24.1.0", hasSqlite: true });
    process.env.STIGMER_NODE_BIN = later;
    expect(resolveServerNode()).toBe(later);
  });

  it("rejects an override that is not a working Node, naming the range it should be", () => {
    process.env.STIGMER_NODE_BIN = "/nonexistent/node";
    let hints: readonly string[] = [];
    try {
      resolveServerNode();
    } catch (err) {
      expect(err).toBeInstanceOf(CliExitError);
      expect((err as Error).message).toBe("could not run /nonexistent/node to verify the stigmer server's Node requirements");
      hints = (err as CliExitError).hints ?? [];
    }
    expect(hints).toEqual([`Ensure /nonexistent/node is a working ${SERVER_NODE_FLOOR} runtime.`]);
  });

  it.each(["v22.13.0", "v22.18.0", "v23.4.0", "v23.11.1", "v20.19.0"])(
    "rejects %s with FTS5, naming the version to install",
    (version) => {
      // Node 22.13-22.18 pass the FTS5 probe, so a capability gate alone let
      // them through to a server that declares 22.19 (its network client,
      // undici, needs it); the version check is what refuses them.
      process.env.STIGMER_NODE_BIN = fakeNodeBinary({ version, hasSqlite: true });
      expect(() => resolveServerNode()).toThrow(
        `(${version}) cannot run the stigmer server: it needs Node.js 22 (22.19 or newer) or Node.js 24 or newer`,
      );
    },
  );

  it("rejects a Node in range whose sqlite lacks FTS5, naming the capability", () => {
    // node:sqlite present (the module probe would pass), FTS5 absent (the
    // fts5 probe fails), on a version the range accepts — pinning that the
    // server resolution dispatches the STRONGER probe after the version check.
    process.env.STIGMER_NODE_BIN = fakeNodeBinary({ version: "v24.1.0", hasSqlite: true, hasFts5: false });

    expect(() => resolveServerNode()).toThrow(/FTS5/);
    expect(() => resolveServerNode()).toThrow(/v24\.1\.0/);
  });

  it("states the server's own range, and the CLI's engines is that range", () => {
    // The CLI's copy of the server's floor drifted once (it said 22.13 while
    // the server declared 22.19); these three cannot disagree again.
    const manifest = (path: string): { engines?: { node?: string } } =>
      JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { engines?: { node?: string } };
    expect(SERVER_NODE_RANGE).toBe(">=22.19.0 <23 || >=24");
    expect(manifest("../../../../../../backend/services/stigmer-server/package.json").engines?.node).toBe(SERVER_NODE_RANGE);
    expect(manifest("../../../../package.json").engines?.node).toBe(SERVER_NODE_RANGE);
    expect(SERVER_NODE_FLOOR).toBe("Node.js 22 (22.19 or newer) or Node.js 24 or newer");
  });

  it("reads versions the way the range does", () => {
    for (const ok of ["v22.19.0", "22.22.1", "v24.0.0", "v26.3.1"]) expect(serverRunsOn(ok), ok).toBe(true);
    for (const no of ["v22.18.9", "v23.8.0", "v21.9.0", "unknown"]) expect(serverRunsOn(no), no).toBe(false);
  });

  it("the runner resolution still accepts the 23.4 shape (module present, FTS5 absent)", () => {
    // The two probes deliberately differ: the runner needs only node:sqlite.
    const bin = fakeNodeBinary({ version: "v23.4.0", hasSqlite: true, hasFts5: false });
    process.env.STIGMER_NODE_BIN = bin;
    expect(resolveNode()).toBe(bin);
  });

  it("runs the real FTS5 probe against the current runtime", () => {
    // The one place the REAL probe script executes end-to-end (the fake-node
    // tests above only exercise the dispatch and error copy). Conditional on
    // the runtime's own capability — the resolveNode own-runtime pattern —
    // so a no-FTS5 Node (e.g. 23.4) asserts the throw instead of the pass.
    delete process.env.STIGMER_NODE_BIN;
    if (!serverRunsOn(process.version)) {
      expect(() => resolveServerNode()).toThrow(/cannot run the stigmer server/);
    } else if (currentRuntimeHasFts5()) {
      expect(resolveServerNode()).toBe(process.execPath);
    } else {
      expect(() => resolveServerNode()).toThrow(/FTS5/);
    }
  });

  function currentRuntimeHasFts5(): boolean {
    const sqlite = process.getBuiltinModule?.("node:sqlite");
    if (sqlite === undefined) return false;
    try {
      new sqlite.DatabaseSync(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(x)");
      return true;
    } catch {
      return false;
    }
  }
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
    // Remediation rides in hints, not the message, and names a command that works.
    let hints: readonly string[] = [];
    try {
      resolveRunner(fakeNode);
    } catch (err) {
      if (err instanceof CliExitError) hints = err.hints ?? [];
    }
    expect(hints.join("\n")).toMatch(/make build-runner/);
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

  // Presence beats acquirability (the server acquirer's rule; the all-in-one
  // image bakes a dev-stamped runtime npm never published).
  it("uses an already-installed runtime even for a non-release (dev) build", () => {
    const home = tempDir("stigmer-home-");
    const pkgDir = join(home, ".stigmer", "runtimes", "0.0.0-dev.abc123", "node_modules", "@stigmer", "runner-slim");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "main.js"), "// slim bundle");

    const install = vi.fn();
    const resolution = acquireRunner({ home, version: "0.0.0-dev.abc123", node: fakeNode, install });

    expect(resolution.entryPath).toBe(join(pkgDir, "main.js"));
    expect(install).not.toHaveBeenCalled();
  });
});
