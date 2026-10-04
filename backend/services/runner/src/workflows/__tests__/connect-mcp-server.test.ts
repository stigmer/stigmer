/**
 * Pins the MCP connect workflows: they run discovery and nothing else, pass
 * the input through to it (the EC token included, oss#535), and emit the
 * wire shape the server reads — snake_case keys plus the camelCase
 * `destructiveHint` on each tool, true only for an explicit MCP annotation.
 * No approval decision rides the result. The activity is mocked: discovery's
 * own behaviour is pinned in `activities/__tests__/discover-mcp-server.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectMcpServerWorkflowInput } from "../types.js";
import type { DiscoverMcpServerInput, DiscoverMcpServerOutput } from "../../activities/discover-mcp-server.js";

const mockDiscoverActivity = vi.fn<(input: DiscoverMcpServerInput) => Promise<DiscoverMcpServerOutput>>();
const proxiedActivityNames: string[][] = [];

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: vi.fn(() => {
    const proxy = new Proxy(
      { DiscoverMcpServerCapabilities: mockDiscoverActivity },
      {
        get(target, prop: string) {
          proxiedActivityNames.push([prop]);
          return (target as Record<string, unknown>)[prop];
        },
      },
    );
    return proxy;
  }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeDiscoveryResult(overrides: Partial<DiscoverMcpServerOutput> = {}): DiscoverMcpServerOutput {
  return { tools: [], resourceTemplates: [], ...overrides };
}

describe("ConnectMcpServerWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxiedActivityNames.length = 0;
  });

  describe("discovery is the whole flow", () => {
    it("calls discovery once and returns its tools and resource templates", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "search", description: "Search code", inputSchema: { type: "object" }, destructiveHint: false },
            { name: "delete_repo", description: "Delete a repo", inputSchema: { type: "object" }, destructiveHint: true },
          ],
          resourceTemplates: [
            { uriTemplate: "repo://{owner}/{repo}", name: "repo", description: "A repository", mimeType: "application/json" },
          ],
        }),
      );
      const input: ConnectMcpServerWorkflowInput = {
        mcp_server_id: "mcp-123",
        execution_context_id: "ctx-abc",
        invoker_identity_account_id: "user-1",
      };

      const result = await connectMcpServer(input);

      expect(mockDiscoverActivity).toHaveBeenCalledOnce();
      expect(mockDiscoverActivity).toHaveBeenCalledWith({
        mcpServerId: "mcp-123",
        executionContextId: "ctx-abc",
        executionContextToken: null,
        invokerIdentityAccountId: "user-1",
      });
      // Only discovery is ever reached for: no judging activity exists.
      expect(new Set(proxiedActivityNames.flat())).toEqual(new Set(["DiscoverMcpServerCapabilities"]));
      expect(result).toEqual({
        tools: [
          { name: "search", description: "Search code", input_schema: { type: "object" }, destructiveHint: false },
          { name: "delete_repo", description: "Delete a repo", input_schema: { type: "object" }, destructiveHint: true },
        ],
        resource_templates: [
          { uri_template: "repo://{owner}/{repo}", name: "repo", description: "A repository", mime_type: "application/json" },
        ],
      });
    });

    it("maps optional input fields to null when absent", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(makeDiscoveryResult());

      await connectMcpServer({ mcp_server_id: "mcp-min" });

      expect(mockDiscoverActivity).toHaveBeenCalledWith({
        mcpServerId: "mcp-min",
        executionContextId: null,
        executionContextToken: null,
        invokerIdentityAccountId: null,
      });
    });

    it("forwards the payload-carried EC token to discovery (oss#535)", async () => {
      // The OSS handler mints an execution-scoped token into the workflow
      // input; discovery presents it on the EC read to receive decrypted
      // credentials from the redact-by-default OSS server.
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(makeDiscoveryResult());

      await connectMcpServer({
        mcp_server_id: "mcp-tok",
        execution_context_id: "ctx-tok",
        execution_context_token: "scoped-ec-token",
      });

      expect(mockDiscoverActivity).toHaveBeenCalledWith({
        mcpServerId: "mcp-tok",
        executionContextId: "ctx-tok",
        executionContextToken: "scoped-ec-token",
        invokerIdentityAccountId: null,
      });
    });

    it("propagates a discovery failure", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockRejectedValue(new Error("MCP server 'broken' did not respond within 270s"));

      await expect(connectMcpServer({ mcp_server_id: "mcp-broken" })).rejects.toThrow("did not respond within 270s");
    });
  });

  describe("wire format", () => {
    it("emits snake_case keys, the camelCase destructiveHint, and no approval list", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "query", description: "Run query", inputSchema: { type: "object" }, destructiveHint: true }],
          resourceTemplates: [
            { uriTemplate: "db://{table}", name: "table", description: "DB table", mimeType: "application/json" },
          ],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-wire" });

      expect(Object.keys(result).sort()).toEqual(["resource_templates", "tools"]);
      expect(Object.keys(result.tools[0]).sort()).toEqual(["description", "destructiveHint", "input_schema", "name"]);
      expect(result.tools[0].destructiveHint).toBe(true);
      expect(Object.keys(result.resource_templates[0]).sort()).toEqual([
        "description",
        "mime_type",
        "name",
        "uri_template",
      ]);
    });

    it("maps a null or absent inputSchema to null", async () => {
      const { connectMcpServer } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [
            { name: "t1", description: "d1", inputSchema: null, destructiveHint: false },
            { name: "t2", description: "d2", inputSchema: undefined, destructiveHint: false },
          ],
        }),
      );

      const result = await connectMcpServer({ mcp_server_id: "mcp-null" });

      expect(result.tools[0].input_schema).toBeNull();
      expect(result.tools[1].input_schema).toBeNull();
    });
  });

  describe("discoverMcpServerLegacy", () => {
    it("returns the same discovery result as the connect workflow", async () => {
      const { connectMcpServer, discoverMcpServerLegacy } = await import("../connect-mcp-server.js");
      mockDiscoverActivity.mockResolvedValue(
        makeDiscoveryResult({
          tools: [{ name: "search", description: "Search", inputSchema: { type: "object" }, destructiveHint: false }],
          resourceTemplates: [
            { uriTemplate: "r://{id}", name: "resource", description: "A resource", mimeType: "text/plain" },
          ],
        }),
      );
      const input = { mcp_server_id: "mcp-legacy", execution_context_id: "ctx-1" };

      expect(await discoverMcpServerLegacy(input)).toEqual(await connectMcpServer(input));
    });
  });
});
