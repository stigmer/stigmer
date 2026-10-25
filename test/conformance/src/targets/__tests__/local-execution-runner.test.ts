// Pins the local execution target's one door to its runner, restartRunner,
// and the runner's pid it names (the benchmark's sweep walks from it):
// it ends the runner by the signal asked (a crash or a drain), boots the
// replacement with the options the first had, on the SAME state directories
// the target owns, refuses before setup, and the target removes those
// directories at teardown. The build, the process spawns, the engine and the
// readiness gate are stubbed; nothing here starts a process.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnedRunner {
  readonly options: { readonly dirs?: { readonly homeDir: string; readonly workspaceDir: string }; readonly entryPath: string };
  readonly ended: string[];
}

const runners: SpawnedRunner[] = [];

vi.mock("@stigmer/test-support/ts-build", () => ({
  ensureLibraryServerEntry: async () => "/library-server.mjs",
}));

vi.mock("@stigmer/test-support/server-process", () => ({
  ephemeralSqliteStorage: async () => ({ serverEnv: {}, release: async () => {} }),
  spawnServer: async () => ({
    baseUrl: "http://127.0.0.1:1",
    artifactServeUrl: "http://127.0.0.1:2",
    artifactBaseDir: "/artifacts",
    logTail: () => "",
    stop: async () => {},
  }),
}));

vi.mock("../../harness/grpc-ready", () => ({ awaitGrpcReady: async () => {} }));

vi.mock("@stigmer/test-support/temporal", () => ({
  spawnTemporal: async () => ({ hostPort: "127.0.0.1:3", stop: async () => {} }),
}));

vi.mock("@stigmer/test-support/runner-build", () => ({ ensureRunnerBuilt: async () => "/runner/main.js" }));

vi.mock("@stigmer/test-support/runner-process", () => ({
  makeRunnerDirs: async () => {
    const root = mkdtempSync(join(tmpdir(), "local-execution-runner-test-"));
    return { homeDir: mkdtempSync(join(root, "home-")), workspaceDir: mkdtempSync(join(root, "workspace-")) };
  },
  spawnRunner: async (options: SpawnedRunner["options"]) => {
    const runner: SpawnedRunner = { options, ended: [] };
    runners.push(runner);
    return {
      pid: 4242 + runners.length,
      stop: async () => void runner.ended.push("stop"),
      kill: async (signal: string) => void runner.ended.push(signal),
    };
  },
}));

vi.mock("@stigmer/test-support/mock-llm", () => ({
  MockLlmProxy: class {
    async start(): Promise<void> {}
    url(): string {
      return "http://127.0.0.1:4";
    }
    async close(): Promise<void> {}
  },
}));

vi.mock("../../harness/mcp-server", () => ({
  McpToolFixture: class {
    async start(): Promise<void> {}
    async close(): Promise<void> {}
  },
}));

const { LocalExecutionTarget } = await import("../local-execution");

beforeEach(() => {
  runners.length = 0;
});

describe("the local execution target's restartRunner", () => {
  it("ends the runner by the signal asked and boots the replacement with the same options on the same directories", async () => {
    const target = new LocalExecutionTarget();
    await target.setup();
    await target.restartRunner({ signal: "SIGKILL" });
    await target.restartRunner({ signal: "SIGTERM" });

    expect(runners.map((r) => r.ended), "a crash, then a drain, and the last runner still running").toEqual([["SIGKILL"], ["SIGTERM"], []]);
    const [first, ...replacements] = runners;
    for (const replacement of replacements) {
      expect(replacement.options, "the replacement boots exactly as the first did").toEqual(first!.options);
    }
    expect(first!.options.dirs, "on directories the target owns").toBeDefined();
    await target.teardown();
  });

  it("calls onEnded after the ended runner exits and before the replacement boots", async () => {
    const target = new LocalExecutionTarget();
    await target.setup();
    const seen: string[] = [];
    await target.restartRunner({
      signal: "SIGTERM",
      onEnded: () => seen.push(`ended ${runners[0]!.ended.join()}; runners ${runners.length}`),
    });

    expect(seen).toEqual(["ended SIGTERM; runners 1"]);
    expect(runners).toHaveLength(2);
    await target.teardown();
  });

  it("removes the runner's directories at teardown, after the runner stops", async () => {
    const target = new LocalExecutionTarget();
    await target.setup();
    const dirs = runners[0]!.options.dirs!;
    expect(existsSync(dirs.homeDir) && existsSync(dirs.workspaceDir)).toBe(true);

    await target.teardown();

    expect(runners[0]!.ended).toEqual(["stop"]);
    expect(existsSync(dirs.homeDir), "the HOME is removed").toBe(false);
    expect(existsSync(dirs.workspaceDir), "the workspace root is removed").toBe(false);
  });

  it("refuses before setup", async () => {
    await expect(new LocalExecutionTarget().restartRunner({ signal: "SIGTERM" })).rejects.toThrow(/setup\(\) must be called before restartRunner/);
  });

  it("names the serving runner's pid, a replacement's after a restart, and refuses before setup", async () => {
    expect(() => new LocalExecutionTarget().runnerPid()).toThrow(/setup\(\) must be called before runnerPid/);
    const target = new LocalExecutionTarget();
    await target.setup();
    expect(target.runnerPid()).toBe(4243);
    await target.restartRunner({ signal: "SIGKILL" });
    expect(target.runnerPid()).toBe(4244);
    await target.teardown();
  });
});
