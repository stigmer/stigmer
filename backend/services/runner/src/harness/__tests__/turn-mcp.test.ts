/**
 * Pins the tool surface the runtime hands every harness
 * (`resolveMcpServersAndPolicies`, phases 4 to 4b), driven directly over a
 * mocked control plane:
 *  - each synthesized attachment the turn injects (channel messaging,
 *    conversation participation, memory capture) is recorded as a platform
 *    server, outside every tool list, and marks no tool destructive;
 *  - the agent's tool scope is resolved from its two lists, under its slug;
 *  - the built-in assistant (no agent) is unrestricted;
 *  - each plugin server is named `plugin_<plugin>_<server>` and filled only
 *    from its own values group, and one whose URL moved since its values
 *    were checked is skipped;
 *  - an engine that does not read its tools' marks (`readsToolMarks` false)
 *    gets each plugin server listed at turn start, and the default asks for
 *    the destructive tools and every tool of an unlisted server; one that
 *    reads them itself gets no listing and a default of the leases alone.
 * The fetch-and-provision phases around it are pinned end to end by the
 * hermetic goldens.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema, RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HttpMcpServerSchema, McpServerEntrySchema, PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";

import { resolveMcpServersAndPolicies, type ResolutionDeps } from "../turn-context.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { CHANNEL_ATTACHMENT_SLUG } from "../../shared/channel-attachment.js";
import { CHANNEL_ID_LABEL, CONVERSATION_ATTACHMENT_SLUG } from "../../shared/conversation-attachment.js";
import { MEMORY_ATTACHMENT_SLUG } from "../../shared/memory-attachment.js";
import type { ResolvedBlueprint, RunAgent } from "../../shared/blueprint-resolver.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { NO_RUN_VALUES, toolValuesKey, type RunValues, type ToolValueGroup } from "../../shared/run-values.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";

const listTurnTools = vi.hoisted(() =>
  vi.fn<(servers: readonly ResolvedMcpServer[]) => Promise<McpToolListing>>(),
);
vi.mock("../../shared/mcp-tool-listing.js", () => ({ listTurnTools }));

const EXECUTION_ID = "aex_mcp_1";

function deps(options: { readonly channels: boolean }): ResolutionDeps {
  const status = create(RunStatusSchema, {});
  return {
    input: { executionId: EXECUTION_ID, threadId: "", turnSeq: 0 },
    client: mockStigmerClient({
      listMessagingChannels: vi
        .fn()
        .mockResolvedValue(options.channels ? [{ channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel] : []),
    }),
    config: testConfig({ mcpBridgeEndpoint: "https://mcp.example.com" }),
    status,
    transcript: new TranscriptBuilder(EXECUTION_ID, status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => undefined,
    enterPhase: () => undefined,
    reportProgress: async () => undefined,
  };
}

/** A plugin carrying one HTTP server that reads TOKEN into its Authorization header. */
function httpPlugin(id: string, name: string, server: string, url: string): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id, name, slug: name, org: "org" }),
    status: create(PluginStatusSchema, {
      mcpServers: [
        create(McpServerEntrySchema, {
          name: server,
          env: ["TOKEN"],
          transport: { case: "http", value: create(HttpMcpServerSchema, { url, headers: { Authorization: "Bearer ${TOKEN}" } }) },
        }),
      ],
    }),
  });
}

function args(options: {
  readonly agentLists?: { tools: string[]; disallowedTools: string[] };
  readonly attachments: boolean;
  readonly plugins?: Plugin[];
  readonly values?: RunValues;
  readonly readsToolMarks?: boolean;
}) {
  const session = create(SessionSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: "ses_1",
      org: "org",
      labels: options.attachments ? { [CHANNEL_ID_LABEL]: "agch_1" } : {},
    }),
    spec: create(SessionSpecSchema, {}),
  });
  const agent: RunAgent | undefined = options.agentLists
    ? { id: "agt_1", versionHash: "", spec: create(AgentSpecSchema, options.agentLists) }
    : undefined;
  const blueprint: ResolvedBlueprint = {
    agent,
    session,
    sessionSpec: session.spec!,
    instructions: "",
    subAgents: [],
    plugins: options.plugins ?? [],
    mergedSkillRefs: [],
    cloudRepos: [],
  };
  const execution = create(RunSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: EXECUTION_ID }),
    spec: create(RunSpecSchema, {
      target: { case: "sessionId", value: "ses_1" },
    }),
    status: create(RunStatusSchema, {
      recalledMemories: options.attachments ? create(RecalledMemoriesSchema, { enabled: true }) : undefined,
    }),
  });
  return {
    execution,
    session,
    sessionId: "ses_1",
    blueprint,
    values: options.values ?? NO_RUN_VALUES,
    readsToolMarks: options.readsToolMarks ?? true,
  };
}

describe("resolveMcpServersAndPolicies — platform servers and the agent's scope", () => {
  it("records every injected attachment as a platform server that marks nothing destructive", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: true }), args({ attachments: true }));

    expect([...mcp.platformServerSlugs].sort()).toEqual(
      [CHANNEL_ATTACHMENT_SLUG, CONVERSATION_ATTACHMENT_SLUG, MEMORY_ATTACHMENT_SLUG].sort(),
    );
    expect(mcp.servers.map((s) => s.slug).sort()).toEqual([...mcp.platformServerSlugs].sort());
    expect(mcp.mcpDefault.destructive.size).toBe(0);
  });

  it("injects no attachment, and records no platform server, when the turn calls for none", async () => {
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), args({ attachments: false }));
    expect(mcp.platformServerSlugs.size).toBe(0);
    expect(mcp.servers).toEqual([]);
  });

  it("resolves the agent's two lists into its scope, under its slug", async () => {
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, agentLists: { tools: ["Read"], disallowedTools: ["Bash"] } }),
    );
    expect(mcp.toolScope.restricted).toBe(true);
    expect(mcp.toolScope.allowsClaudeTool("Read")).toBe(true);
    expect(mcp.toolScope.allowsClaudeTool("Write")).toBe(false);
    expect(mcp.toolScope.owner).toBe("The agent");
  });

  it("leaves the built-in assistant unrestricted", async () => {
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), args({ attachments: false }));
    expect(mcp.toolScope.restricted).toBe(false);
  });
});

describe("resolveMcpServersAndPolicies — the plugins' servers", () => {
  const linear = httpPlugin("plg_linear", "linear", "api", "https://linear.example/mcp");
  const github = httpPlugin("plg_github", "github", "api", "https://github.example/mcp");
  const groups = new Map<string, ToolValueGroup>([
    [toolValuesKey("plg_linear", "api"), { url: "https://linear.example/mcp", values: { TOKEN: "linear-token" } }],
    [toolValuesKey("plg_github", "api"), { url: "https://github.example/mcp", values: { TOKEN: "github-token" } }],
  ]);
  const values: RunValues = { ...NO_RUN_VALUES, tools: groups };

  beforeEach(() => {
    listTurnTools.mockReset();
  });

  it("names each server plugin_<plugin>_<server> and fills it from its own group only", async () => {
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, plugins: [linear, github], values }),
    );
    expect(mcp.servers.map((server) => [server.slug, server.headers?.Authorization])).toEqual([
      ["plugin_linear_api", "Bearer linear-token"],
      ["plugin_github_api", "Bearer github-token"],
    ]);
    expect(mcp.servers.map((server) => server.pluginOrigin)).toEqual([
      { pluginId: "plg_linear", plugin: "linear", server: "api" },
      { pluginId: "plg_github", plugin: "github", server: "api" },
    ]);
    expect(mcp.platformServerSlugs.size).toBe(0);
  });

  it("skips a server whose URL is not the one its values were checked against", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const moved = httpPlugin("plg_github", "github", "api", "https://moved.example/mcp");
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, plugins: [linear, moved], values }),
    );
    expect(mcp.servers.map((server) => server.slug)).toEqual(["plugin_linear_api"]);
    expect(warn.mock.calls.some(([line]) => String(line).includes("'plugin_github_api'"))).toBe(true);
    warn.mockRestore();
  });

  it("lists the plugin servers for an engine that does not read its tools' marks, and asks per the listing", async () => {
    const listing: McpToolListing = {
      listed: [{ server: "plugin_linear_api", tools: ["search", "delete_issue"] }],
      destructive: [{ server: "plugin_linear_api", tool: "delete_issue" }],
      unlisted: ["plugin_github_api"],
    };
    listTurnTools.mockResolvedValue(listing);
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, plugins: [linear, github], values, readsToolMarks: false }),
    );
    expect(listTurnTools).toHaveBeenCalledTimes(1);
    expect(listTurnTools.mock.calls[0][0].map((server) => server.slug)).toEqual(["plugin_linear_api", "plugin_github_api"]);
    expect(mcp.listing).toBe(listing);
    expect([...mcp.mcpDefault.destructive]).toEqual(["plugin_linear_api/delete_issue"]);
    expect([...mcp.mcpDefault.unlisted]).toEqual(["plugin_github_api"]);
  });

  it("lists nothing for an engine that reads its tools' marks itself: the default is the leases alone", async () => {
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, plugins: [linear], values, readsToolMarks: true }),
    );
    expect(listTurnTools).not.toHaveBeenCalled();
    expect(mcp.listing).toBeUndefined();
    expect(mcp.mcpDefault.destructive.size).toBe(0);
    expect(mcp.mcpDefault.unlisted.size).toBe(0);
    expect(mcp.mcpDefault.leasedServers).toBe(mcp.leases.servers);
  });

  it("lists nothing when the turn has no plugin server", async () => {
    const mcp = await resolveMcpServersAndPolicies(
      deps({ channels: false }),
      args({ attachments: false, readsToolMarks: false }),
    );
    expect(listTurnTools).not.toHaveBeenCalled();
    expect(mcp.listing).toBeUndefined();
  });
});
