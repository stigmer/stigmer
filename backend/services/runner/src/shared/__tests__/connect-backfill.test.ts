/**
 * Pins the turn-start connect backfill: which servers need discovery (never
 * discovered), that a connect failure keeps the turn going on the servers it
 * had, that one success re-resolves every server, and that a connect names
 * its run and carries no values. The discovery itself is the connect
 * workflow's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  needsBackfill,
  backfillMcpServersIfNeeded,
} from "../connect-backfill.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

/** The run's values per tool, and the platform values; the backfill hands both to re-resolution untouched. */
const TOOLS = new Map([["server-id-123", { url: "", values: { API_KEY: "secret" } }]]);
const RUN_ID = "run_1";

/** The runner endpoints resolution fills STIGMER_SERVER_ADDRESS from. */
const PLATFORM_ENDPOINTS = testConfig();

function makeServer(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    slug: "test-server",
    connectionType: "stdio",
    command: "npx",
    args: ["-y", "@mcp/test-server"],
    destructiveTools: [],
    discoveredToolNames: [],
    serverId: "",
    pluginOrigin: null,
    discoveredCapabilitiesEmpty: false,
    ...overrides,
  };
}

function makeUsage(slug: string, org = "test-org") {
  return {
    mcpServerRef: { slug, org, kind: 0 },
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
      client, servers, [], TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(result).toBe(servers);
    expect(client.getMcpServerByReference).not.toHaveBeenCalled();
    expect(client.connectMcpServer).not.toHaveBeenCalled();
  });

  it("returns the same array reference for early-return (no backfill needed)", async () => {
    const servers = [makeServer({ discoveredCapabilitiesEmpty: false })];
    const client = makeMockClient();

    const result = await backfillMcpServersIfNeeded(
      client, servers, [], TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(client.getMcpServerByReference).toHaveBeenCalledOnce();
    expect(client.connectMcpServer).toHaveBeenCalledWith("server-id-123", "org", RUN_ID);
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(client.connectMcpServer).toHaveBeenCalledOnce();
    expect(result).toEqual(refreshedServers);
  });

  it("names its run and sends no values, though the server declares keys the run holds", async () => {
    const servers = [
      makeServer({ slug: "with-env", discoveredCapabilitiesEmpty: true }),
    ];
    const usages = [makeUsage("with-env")];
    const client = makeMockClient({
      getMcpServerByReference: vi.fn().mockResolvedValue({
        metadata: { id: "server-id-123" },
        spec: { env: { API_KEY: { isSecret: true } } },
      }),
    });
    const resolve = vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: [makeServer({ slug: "with-env", discoveredCapabilitiesEmpty: false })],
    });
    const platformValues = { STIGMER_SESSION_ID: "ses_1" };

    await backfillMcpServersIfNeeded(
      client, servers, usages, TOOLS, platformValues, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(client.connectMcpServer).toHaveBeenCalledWith("server-id-123", "org", RUN_ID);
    expect(JSON.stringify(client.connectMcpServer.mock.calls)).not.toContain("secret");
    // Re-resolution reads the same per-tool values the turn fetched.
    expect(resolve).toHaveBeenCalledWith(client, usages, TOOLS, platformValues, "stdio-allowed", PLATFORM_ENDPOINTS);
  });

  it("names no run for a server the run's fetch gave no values: it needs none", async () => {
    const servers = [makeServer({ slug: "keyless", discoveredCapabilitiesEmpty: true })];
    const usages = [makeUsage("keyless")];
    const client = makeMockClient({
      getMcpServerByReference: vi.fn().mockResolvedValue({ metadata: { id: "server-keyless" } }),
    });
    vi.spyOn(await import("../mcp-resolver.js"), "resolveMcpServers").mockResolvedValue({
      resolvedServers: [makeServer({ slug: "keyless", discoveredCapabilitiesEmpty: false })],
    });

    await backfillMcpServersIfNeeded(
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(TOOLS.has("server-keyless")).toBe(false);
    expect(client.connectMcpServer).toHaveBeenCalledWith("server-keyless", "org", undefined);
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS, onHeartbeat,
    );

    expect(onHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("skips servers that have no matching usage ref", async () => {
    const servers = [
      makeServer({ slug: "orphan", discoveredCapabilitiesEmpty: true }),
    ];
    const client = makeMockClient();

    const result = await backfillMcpServersIfNeeded(
      client, servers, [], TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
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
      client, servers, usages, TOOLS, {}, "org", RUN_ID, "stdio-allowed", PLATFORM_ENDPOINTS,
    );

    expect(callCount).toBe(2);
    expect(result).toEqual(refreshed);
  });
});
