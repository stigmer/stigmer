// Pins the local execution target's door to its server, restartServer: on
// storage two servers may share (Postgres) the replacement boots, passes the
// readiness gate and joins the front before `duringOverlap` runs, and only
// then is the outgoing server taken off the front and shut down; on SQLite
// the outgoing server leaves first and `duringOverlap` is never called. Every
// server serves the same state directory and environment, a replacement that
// fails its readiness gate is stopped, and the target removes the directory
// at teardown. The build, the process spawns, the front, the engine and the
// readiness gate are stubbed; nothing here starts a process.
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProvisionedStorage } from "@stigmer/test-support/server-process";

interface SpawnedServer {
  readonly port: number;
  readonly options: { readonly stateDir?: string; readonly env?: Record<string, string> };
}

const servers: SpawnedServer[] = [];
// What happened, in order: spawns, front changes, shutdowns, the overlap.
const events: string[] = [];
let readinessFails = false;

vi.mock("@stigmer/test-support/ts-build", () => ({
  ensureLibraryServerEntry: async () => "/library-server.mjs",
}));

vi.mock("@stigmer/test-support/server-process", () => ({
  ephemeralSqliteStorage: async () => ({ serverEnv: {}, release: async () => {} }),
  spawnServer: async (_node: string, options: SpawnedServer["options"]) => {
    const port = 100 + servers.length;
    servers.push({ port, options });
    events.push(`spawn ${port}`);
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      port,
      artifactServeUrl: "http://127.0.0.1:2",
      artifactBaseDir: "/artifacts",
      logTail: () => "",
      stop: async () => void events.push(`stop ${port}`),
      shutdown: async () => void events.push(`shutdown ${port}`),
    };
  },
}));

vi.mock("@stigmer/test-support/tcp-front", () => ({
  startTcpFront: async () => ({
    port: 5,
    baseUrl: "http://127.0.0.1:5",
    add: (port: number) => void events.push(`front + ${port}`),
    remove: (port: number) => void events.push(`front - ${port}`),
    backends: () => [],
    close: async () => void events.push("front closed"),
  }),
}));

vi.mock("../../harness/grpc-ready", () => ({
  awaitGrpcReady: async (_clients: unknown, logTail: () => string) => {
    if (readinessFails && servers.length > 1) throw new Error(`never ready (${logTail() || "no log"})`);
  },
}));

vi.mock("@stigmer/test-support/temporal", () => ({
  spawnTemporal: async () => ({ hostPort: "127.0.0.1:3", stop: async () => {} }),
}));

vi.mock("@stigmer/test-support/runner-build", () => ({ ensureRunnerBuilt: async () => "/runner/main.js" }));

vi.mock("@stigmer/test-support/runner-process", () => ({
  makeRunnerDirs: async () => ({ homeDir: "/runner-home-none", workspaceDir: "/runner-workspace-none" }),
  spawnRunner: async (options: { backendEndpoint: string }) => {
    events.push(`runner dials ${options.backendEndpoint}`);
    return { stop: async () => {}, kill: async () => {} };
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

/** The execution target on a storage shape of the test's choosing. */
function targetOn(sharedByTwoServers: boolean) {
  return new (class extends LocalExecutionTarget {
    protected override async provisionStorage(): Promise<ProvisionedStorage> {
      return { serverEnv: { DATABASE_URL: "postgres://db" }, release: async () => {}, sharedByTwoServers };
    }
  })();
}

beforeEach(() => {
  servers.length = 0;
  events.length = 0;
  readinessFails = false;
});

describe("the local execution target's restartServer", () => {
  it("boots the replacement beside the outgoing server where two can share the store, then shuts the outgoing one down", async () => {
    const target = targetOn(true);
    await target.setup();
    expect(events, "the runner and every client dial the front").toContain("runner dials http://127.0.0.1:5");
    expect(target.httpBaseUrl()).toBe("http://127.0.0.1:5");
    events.length = 0;

    const restart = await target.restartServer({
      duringOverlap: async (incoming) => {
        expect(incoming.sessionQuery).toBeDefined();
        events.push("overlap");
      },
    });

    expect(restart).toEqual({ overlapped: true });
    expect(events).toEqual(["spawn 101", "front + 101", "overlap", "front - 100", "shutdown 100"]);
    expect(servers[1]!.options, "the replacement serves the same state and environment").toEqual(servers[0]!.options);
    await target.teardown();
  });

  it("shuts the outgoing server down even when the overlap fails", async () => {
    const target = targetOn(true);
    await target.setup();
    events.length = 0;
    await expect(
      target.restartServer({
        duringOverlap: async () => {
          throw new Error("the arm failed");
        },
      }),
    ).rejects.toThrow("the arm failed");
    expect(events.slice(-2)).toEqual(["front - 100", "shutdown 100"]);
    await target.teardown();
  });

  it("on SQLite stops the outgoing server first and starts the replacement on the same file, with no overlap", async () => {
    const target = targetOn(false);
    await target.setup();
    events.length = 0;
    let overlapCalled = false;

    const restart = await target.restartServer({ duringOverlap: async () => void (overlapCalled = true) });

    expect(restart).toEqual({ overlapped: false });
    expect(overlapCalled).toBe(false);
    expect(events).toEqual(["front - 100", "shutdown 100", "spawn 101", "front + 101"]);
    expect(servers[1]!.options.stateDir).toBe(servers[0]!.options.stateDir);
    await target.teardown();
  });

  it("stops a replacement that fails its readiness gate, and keeps it off the front", async () => {
    const target = targetOn(true);
    await target.setup();
    events.length = 0;
    readinessFails = true;
    await expect(target.restartServer()).rejects.toThrow("never ready");
    expect(events).toEqual(["spawn 101", "stop 101"]);
    await target.teardown();
  });

  it("removes the state directory and closes the front at teardown", async () => {
    const target = targetOn(true);
    await target.setup();
    const stateDir = servers[0]!.options.stateDir!;
    expect(existsSync(stateDir)).toBe(true);
    await target.teardown();
    expect(existsSync(stateDir)).toBe(false);
    expect(events).toContain("front closed");
  });

  it("refuses before setup", async () => {
    await expect(new LocalExecutionTarget().restartServer()).rejects.toThrow(/setup\(\) must be called before restartServer/);
  });
});
