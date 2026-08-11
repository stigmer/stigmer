import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  needsBackfill,
  backfillMcpServersIfNeeded,
  extractRuntimeEnvForServer,
} from "../connect-backfill.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

function makeServer(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    slug: "test-server",
    connectionType: "stdio",
    command: "npx",
    args: ["-y", "@mcp/test-server"],
    toolApprovals: [],
    pinnedToolApprovals: [],
    toolApprovalOverrides: [],
    discoveredCapabilitiesEmpty: false,
    ...overrides,
  };
}

function makeUsage(slug: string, org = "test-org") {
  return {
    mcpServerRef: { slug, org, kind: 0 },
    toolApprovalOverrides: [],
  } as any;
}

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getMcpServerByReference: vi.fn().mockResolvedValue({
      metadata: { id: "server-id-123" },
      spec: { env: {} },
    }),
    connectMcpServer: vi.fn().mockResolvedValue({
      status: {
        discoveredCapabilities: { tools: [{ name: "tool1" }], resourceTemplates: [] },
        toolApprovals: [{ toolName: "tool1", message: "Classified" }],
      },
    }),
    ...overrides,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// needsBackfill
// ─────────────────────────────────────────────────────────────────────────────

describe("needsBackfill", () => {
  it("returns true when discoveredCapabilitiesEmpty is true", () => {
    expect(needsBackfill(makeServer({ discoveredCapabilitiesEmpty: true }))).toBe(true);
  });

  it("returns false when discoveredCapabilitiesEmpty is false", () => {
    expect(needsBackfill(makeServer({ discoveredCapabilitiesEmpty: false }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractRuntimeEnvForServer
// ─────────────────────────────────────────────────────────────────────────────

describe("extractRuntimeEnvForServer", () => {
  it("returns undefined when server has no env declarations", () => {
    expect(extractRuntimeEnvForServer({ spec: {} }, { FOO: "bar" })).toBeUndefined();
    expect(extractRuntimeEnvForServer({}, { FOO: "bar" })).toBeUndefined();
  });

  it("returns undefined when env declarations are empty", () => {
    expect(extractRuntimeEnvForServer({ spec: { env: {} } }, { FOO: "bar" })).toBeUndefined();
  });

  it("returns only declared keys present in merged env with isSecret from declarations", () => {
    const server = {
      spec: {
        env: {
          API_KEY: { isSecret: true },
          DB_URL: { isSecret: false },
          UNUSED: { isSecret: false },
        },
      },
    };
    const mergedEnv = { API_KEY: "secret123", DB_URL: "postgres://localhost" };
    const result = extractRuntimeEnvForServer(server, mergedEnv);
    expect(result).toEqual({
      API_KEY: { value: "secret123", isSecret: true },
      DB_URL: { value: "postgres://localhost", isSecret: false },
    });
  });

  it("falls back to secretKeys when declaration has no isSecret", () => {
    const server = { spec: { env: { TOKEN: {}, OTHER: {} } } };
    const mergedEnv = { TOKEN: "abc", OTHER: "def" };
    const secretKeys = new Set(["TOKEN"]);
    const result = extractRuntimeEnvForServer(server, mergedEnv, secretKeys);
    expect(result).toEqual({
      TOKEN: { value: "abc", isSecret: true },
      OTHER: { value: "def", isSecret: false },
    });
  });

  it("returns undefined when no declared keys are in merged env", () => {
    const server = { spec: { env: { MISSING_KEY: {} } } };
    expect(extractRuntimeEnvForServer(server, { OTHER: "val" })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// backfillMcpServersIfNeeded
// ─────────────────────────────────────────────────────────────────────────────

describe("backfillMcpServersIfNeeded", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns original servers unchanged when none need backfill", async () => {
    const servers = [
      makeServer({ slug: "a", discoveredCapabilitiesEmpty: false }),
      makeServer({ slug: "b", discoveredCapabilitiesEmpty: false }),
    ];
    const client = makeMockClient();

    const result = await backfillMcpServersIfNeeded(
      client, servers, [], {}, "org", "stdio-allowed",
    );

    expect(result).toBe(servers);
    expect(client.getMcpServerByReference).not.toHaveBeenCalled();
    expect(client.connectMcpServer).not.toHaveBeenCalled();
  });

  it("returns the same array reference for early-return (no backfill needed)", async () => {
    const servers = [makeServer({ discoveredCapabilitiesEmpty: false })];
    const client = makeMockClient();

    const result = await backfillMcpServersIfNeeded(
      client, servers, [], {}, "org", "stdio-allowed",
    );

    expect(result).toBe(servers);
  });

  it("triggers connect RPC for servers with empty capabilities", async () => {
    const servers = [
      makeServer({ slug: "needs-backfill", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("needs-backfill")];
    const client = makeMockClient();

    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: [makeServer({ slug: "needs-backfill", discoveredCapabilitiesEmpty: false })],
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(client.getMcpServerByReference).toHaveBeenCalledOnce();
    expect(client.connectMcpServer).toHaveBeenCalledWith("server-id-123", "org", undefined);
    expect(result).not.toBe(servers);
    expect(result[0].discoveredCapabilitiesEmpty).toBe(false);
  });

  it("only backfills servers that need it, leaves others alone", async () => {
    const servers = [
      makeServer({ slug: "ok", discoveredCapabilitiesEmpty: false }),
      makeServer({ slug: "empty", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("ok"), makeUsage("empty")];
    const client = makeMockClient();

    const refreshedServers = [
      makeServer({ slug: "ok", discoveredCapabilitiesEmpty: false }),
      makeServer({ slug: "empty", discoveredCapabilitiesEmpty: false }),
    ];
    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: refreshedServers,
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(client.connectMcpServer).toHaveBeenCalledOnce();
    expect(result).toEqual(refreshedServers);
  });

  it("passes runtime env to connect RPC when server declares env vars", async () => {
    const servers = [
      makeServer({ slug: "with-env", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("with-env")];
    const mergedEnv = { API_KEY: "secret", OTHER: "ignored" };
    const client = makeMockClient({
      getMcpServerByReference: vi.fn().mockResolvedValue({
        metadata: { id: "env-server-id" },
        spec: { env: { API_KEY: { is_secret: true } } },
      }),
    });

    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: [makeServer({ slug: "with-env", discoveredCapabilitiesEmpty: false })],
    });

    await backfillMcpServersIfNeeded(
      client, servers, usages, mergedEnv, "org", "stdio-allowed",
    );

    expect(client.connectMcpServer).toHaveBeenCalledWith(
      "env-server-id", "org", { API_KEY: { value: "secret", isSecret: false } },
    );
  });

  it("preserves original servers when connect RPC fails", async () => {
    const servers = [
      makeServer({ slug: "failing", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("failing")];
    const client = makeMockClient({
      connectMcpServer: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(result).toBe(servers);
  });

  it("preserves original servers when connect RPC times out", async () => {
    const servers = [
      makeServer({ slug: "slow", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("slow")];
    const client = makeMockClient({
      connectMcpServer: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 120_000)),
      ),
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(result).toBe(servers);
  }, 70_000);

  it("invokes onHeartbeat callback at correct points", async () => {
    const servers = [
      makeServer({ slug: "hb-test", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("hb-test")];
    const client = makeMockClient();
    const onHeartbeat = vi.fn();

    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: [makeServer({ slug: "hb-test", discoveredCapabilitiesEmpty: false })],
    });

    await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed", onHeartbeat,
    );

    expect(onHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("skips servers that have no matching usage ref", async () => {
    const servers = [
      makeServer({ slug: "orphan", discoveredCapabilitiesEmpty: true }),
    ];
    const client = makeMockClient();

    const result = await backfillMcpServersIfNeeded(
      client, servers, [], {}, "org", "stdio-allowed",
    );

    expect(client.getMcpServerByReference).not.toHaveBeenCalled();
    expect(result).toBe(servers);
  });

  it("skips servers where getMcpServerByReference returns no id", async () => {
    const servers = [
      makeServer({ slug: "no-id", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("no-id")];
    const client = makeMockClient({
      getMcpServerByReference: vi.fn().mockResolvedValue({
        metadata: {},
        spec: {},
      }),
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(client.connectMcpServer).not.toHaveBeenCalled();
    expect(result).toBe(servers);
  });

  it("re-resolves after partial success (one fails, one succeeds)", async () => {
    const servers = [
      makeServer({ slug: "fail-me", discoveredCapabilitiesEmpty: true }),
      makeServer({ slug: "succeed", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("fail-me"), makeUsage("succeed")];

    let callCount = 0;
    const client = makeMockClient({
      getMcpServerByReference: vi.fn().mockImplementation((ref: any) => ({
        metadata: { id: `id-${ref.slug}` },
        spec: { env: {} },
      })),
      connectMcpServer: vi.fn().mockImplementation((serverId: string) => {
        callCount++;
        if (serverId === "id-fail-me") {
          return Promise.reject(new Error("Unreachable"));
        }
        return Promise.resolve({
          status: {
            discoveredCapabilities: { tools: [], resourceTemplates: [] },
            toolApprovals: [],
          },
        });
      }),
    });

    const refreshed = [
      makeServer({ slug: "fail-me", discoveredCapabilitiesEmpty: true }),
      makeServer({ slug: "succeed", discoveredCapabilitiesEmpty: false }),
    ];
    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: refreshed,
    });

    const result = await backfillMcpServersIfNeeded(
      client, servers, usages, {}, "org", "stdio-allowed",
    );

    expect(callCount).toBe(2);
    expect(result).toEqual(refreshed);
  });
});
