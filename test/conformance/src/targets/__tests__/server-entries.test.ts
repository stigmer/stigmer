// Pins which server entry each local target spawns, for its primary and its
// siblings: the library entry (any number of organizations) for the targets
// whose suites create an organization per tenancy, the shipped entry (the
// open-source edition, one organization) for local-single-org, which also
// refuses to provision the extra organizations another suite would ask for.
// The build, the process spawns, the engine and the readiness gate are
// stubbed; nothing here starts a server.
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawned: string[][] = [];

vi.mock("@stigmer/test-support/ts-build", () => ({
  ensureLibraryServerEntry: async () => "/library-server.mjs",
  ensureTsServerEntry: async () => "/dist/main.js",
}));

vi.mock("@stigmer/test-support/server-process", () => ({
  ephemeralSqliteStorage: async () => ({
    serverEnv: {},
    release: async () => {},
  }),
  spawnServer: async (_node: string, options: { args: string[] }) => {
    spawned.push(options.args);
    return {
      baseUrl: "http://127.0.0.1:1",
      artifactServeUrl: "http://127.0.0.1:2",
      artifactBaseDir: "/artifacts",
      logTail: () => "",
      stop: async () => {},
    };
  },
}));

vi.mock("../../harness/grpc-ready", () => ({
  awaitGrpcReady: async () => {},
}));

vi.mock("@stigmer/test-support/temporal", () => ({
  spawnTemporal: async () => ({ hostPort: "127.0.0.1:3", stop: async () => {} }),
}));

vi.mock("@stigmer/test-support/runner-build", () => ({
  ensureRunnerBuilt: async () => "/runner/main.js",
}));

vi.mock("@stigmer/test-support/runner-process", () => ({
  spawnRunner: async () => ({ stop: async () => {} }),
}));

vi.mock("@stigmer/test-support/mock-llm", () => ({
  MockLlmProxy: class {
    async start(): Promise<void> {}
    url(): string {
      return "http://127.0.0.1:4";
    }
    async stop(): Promise<void> {}
  },
}));

vi.mock("../../harness/mcp-server", () => ({
  McpToolFixture: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  },
}));

const { LocalTarget } = await import("../local");
const { LocalExecutionTarget } = await import("../local-execution");
const { LocalSingleOrgTarget } = await import("../local-single-org");
const { createTarget } = await import("../index");

const SIBLING = { env: {}, readinessBearer: "" };

beforeEach(() => {
  spawned.length = 0;
});

describe("the server entry each local target spawns", () => {
  it("local spawns the library entry, for its primary and its siblings", async () => {
    const target = new LocalTarget();
    await target.setup();
    await target.spawnSibling(SIBLING);
    expect(spawned).toEqual([["/library-server.mjs"], ["/library-server.mjs"]]);
  });

  it("local-execution spawns the library entry, for its primary and its siblings", async () => {
    const target = new LocalExecutionTarget();
    await target.setup();
    await target.spawnSibling(SIBLING);
    expect(spawned).toEqual([["/library-server.mjs"], ["/library-server.mjs"]]);
  });

  it("local-single-org spawns the shipped entry, and differs from local only in singleOrganization", async () => {
    const target = new LocalSingleOrgTarget();
    await target.setup();
    expect(spawned).toEqual([["/dist/main.js"]]);
    expect(target.name).toBe("local-single-org");
    expect(target.capabilities).toEqual({
      ...new LocalTarget().capabilities,
      singleOrganization: true,
    });
  });

  it("CONFORMANCE_TARGET=local-single-org selects it", () => {
    vi.stubEnv("CONFORMANCE_TARGET", "local-single-org");
    try {
      expect(createTarget()).toBeInstanceOf(LocalSingleOrgTarget);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("local-single-org provisions no extra organization", async () => {
    const target = new LocalSingleOrgTarget();
    await expect(target.provisionTenancy()).rejects.toThrow(
      /holds one organization and provisions no other/,
    );
    await expect(target.provisionPrivilegedScope()).rejects.toThrow(
      /holds one organization and provisions no other/,
    );
  });
});
