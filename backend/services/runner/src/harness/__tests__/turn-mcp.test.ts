/**
 * Pins the tool surface the runtime hands every harness
 * (`resolveMcpServersAndPolicies`, phases 4 to 4b), driven directly over a
 * mocked control plane:
 *  - each synthesized attachment the turn injects (channel messaging,
 *    conversation participation, memory capture) is recorded as a platform
 *    server, outside every tool list, and marks no tool destructive;
 *  - the agent's tool scope is resolved from its two lists, under its slug;
 *  - the built-in assistant (no agent) is unrestricted;
 *  - a turn's own lists (`mainToolScope`) are one more layer, over the
 *    agent's or over the assistant's nothing;
 *  - each plugin server is named `plugin_<plugin>_<server>` and filled only
 *    from its own values group, and one whose URL moved since its values
 *    were checked is skipped;
 *  - an engine that does not read its tools' marks (`readsToolMarks` false)
 *    gets each plugin server listed at turn start, and the default asks for
 *    the destructive tools and every tool of an unlisted server; one that
 *    reads them itself gets no listing and a default of the leases alone;
 *  - a server the lists exclude whole is not connected, while a server
 *    excluded tool by tool and the platform's own still are (#2106):
 *    `callableServers` is the one filter, applied before the tool listing
 *    (itself a connection) and so before either engine connects; a
 *    plugin-eval try's mocked server is never listed either;
 *  - a try's stand-ins (`startEvalMocks`) take their servers' places in the
 *    list and in the listing, a stand-in the lists exclude whole left out
 *    like any server, and a try whose endpoint starts no stand-in keeps its
 *    list as it was.
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

import {
  PluginEvalCaseContextSchema,
  PluginEvalMockServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/plugin_eval_case_pb";

import {
  callableServers,
  mainToolScope,
  resolveMcpServersAndPolicies,
  startEvalMocks,
  type ResolutionDeps,
  type TurnFrame,
} from "../turn-context.js";
import { caseArchiveOf } from "../../shared/plugin-eval/case-archive.js";
import { ToolScope } from "../../shared/tool-lists.js";
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

/** What the mocked endpoint serves: its stand-ins and their tools; `undefined` when it starts none. */
const endpoint = vi.hoisted(() => ({
  served: undefined as { servers: unknown[]; listed: { server: string; tools: string[] }[] } | undefined,
}));
vi.mock("../../shared/plugin-eval/mock-endpoint.js", () => ({
  startMockEndpoint: () =>
    Promise.resolve(
      endpoint.served === undefined
        ? undefined
        : { ...endpoint.served, bind: () => undefined, close: () => Promise.resolve() },
    ),
}));

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
    identifyRun: () => {},
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

/** Each plugin's `api` server's values, checked against the URL it declares. */
function valuesFor(...plugins: [id: string, url: string][]): RunValues {
  return {
    ...NO_RUN_VALUES,
    tools: new Map(plugins.map(([id, url]) => [toolValuesKey(id, "api"), { url, values: { TOKEN: "t" } }])),
  };
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
    pluginAgents: [],
    subagents: [],
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

  it("layers the turn's own lists over the agent's, and over the assistant's nothing", () => {
    const agent = { id: "agt", versionHash: "v", spec: create(AgentSpecSchema, { tools: ["Read", "Grep"], disallowedTools: [] }) } as RunAgent;
    const turn = create(RunSpecSchema, { tools: ["Read"], disallowedTools: ["Skill"] });
    const withAgent = mainToolScope({ agent } as ResolvedBlueprint, turn);
    expect(withAgent.depth).toBe(2);
    expect(withAgent.allowsClaudeTool("Read")).toBe(true);
    expect(withAgent.allowsClaudeTool("Grep"), "the turn narrows the agent's").toBe(false);
    expect(withAgent.hidesSkills).toBe(true);
    expect(withAgent.owner).toBe("The turn");
    const assistant = mainToolScope({ agent: undefined } as ResolvedBlueprint, turn);
    expect(assistant.depth).toBe(1);
    expect(assistant.allowsClaudeTool("Bash")).toBe(false);
    expect(mainToolScope({ agent: undefined } as ResolvedBlueprint, undefined).restricted).toBe(false);
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

describe("callableServers — a server no tool of which can be called is never connected (#2106)", () => {
  const server = (slug: string): ResolvedMcpServer => ({
    slug,
    connectionType: "http",
    url: `https://${slug}.example.com/mcp`,
    pluginOrigin: null,
  });
  const servers = [server("tracker"), server("orders"), server("wiki"), server(MEMORY_ATTACHMENT_SLUG)];
  const slugs = (scope: ToolScope): string[] => callableServers(servers, scope, new Set([MEMORY_ATTACHMENT_SLUG])).map((s) => s.slug);

  it("leaves out a server the lists deny whole, keeping one denied tool by tool", () => {
    const scope = ToolScope.of("The agent", { tools: [], disallowedTools: ["mcp__tracker", "mcp__orders__refund"] });
    expect(slugs(scope)).toEqual(["orders", "wiki", MEMORY_ATTACHMENT_SLUG]);
  });

  it("leaves out every server an allow-list names nothing of, and keeps the platform's own", () => {
    expect(slugs(ToolScope.of("The agent", { tools: ["Read"], disallowedTools: [] }))).toEqual([MEMORY_ATTACHMENT_SLUG]);
    expect(slugs(ToolScope.of("The agent", { tools: ["Read", "mcp__wiki__search"], disallowedTools: [] }))).toEqual(["wiki", MEMORY_ATTACHMENT_SLUG]);
  });

  it("connects every server for an unrestricted turn", () => {
    expect(slugs(ToolScope.unrestricted())).toEqual(["tracker", "orders", "wiki", MEMORY_ATTACHMENT_SLUG]);
  });

  it("filters before the tool listing, and leaves a plugin-eval try's mocked server to its stand-in", async () => {
    listTurnTools.mockReset();
    listTurnTools.mockResolvedValue({ listed: [], destructive: [], unlisted: [] });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const turn = args({
      attachments: false,
      agentLists: { tools: [], disallowedTools: ["mcp__plugin_github_api"] },
      plugins: [
        httpPlugin("plg_linear", "linear", "api", "https://linear.example/mcp"),
        httpPlugin("plg_github", "github", "api", "https://github.example/mcp"),
        httpPlugin("plg_wiki", "wiki", "api", "https://wiki.example/mcp"),
      ],
      values: valuesFor(
        ["plg_linear", "https://linear.example/mcp"],
        ["plg_github", "https://github.example/mcp"],
        ["plg_wiki", "https://wiki.example/mcp"],
      ),
      readsToolMarks: false,
    });
    turn.execution.spec!.pluginEvalCase = create(PluginEvalCaseContextSchema, {
      mocks: [create(PluginEvalMockServerSchema, { server: "api", segment: "plugin_linear_api" })],
    });
    const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), turn);
    expect(listTurnTools.mock.calls.map(([listed]) => listed.map((s) => s.slug))).toEqual([["plugin_wiki_api"]]);
    expect(mcp.servers.map((s) => s.slug)).toEqual(["plugin_wiki_api"]);
  });
});

describe("startEvalMocks — a plugin-eval try's stand-ins take their servers' places", () => {
  const standIn = (slug: string): ResolvedMcpServer => ({
    slug,
    connectionType: "http",
    url: `http://127.0.0.1:4000/mcp/${slug}`,
    pluginOrigin: { pluginId: "plg_linear", plugin: "linear", server: slug.replace(/^plugin_linear_/, "") },
  });
  const frame = (): TurnFrame => ({
    primaryDir: undefined,
    releaseWorkspaceLock: undefined,
    writeback: null,
    evalMocks: undefined,
    evalReadFiles: undefined,
  });

  /**
   * The turn's resolved list (`plugin_linear_api` and `plugin_wiki_api`;
   * `plugin_linear_orders` denied whole), then the try's stand-ins for
   * `plugin_linear_api` and `plugin_linear_orders`.
   */
  async function standIns(served: typeof endpoint.served, readsToolMarks: boolean) {
    listTurnTools.mockReset();
    listTurnTools.mockResolvedValue({
      listed: [
        { server: "plugin_linear_api", tools: ["search"] },
        { server: "plugin_wiki_api", tools: ["read_page"] },
      ],
      destructive: [
        { server: "plugin_linear_api", tool: "delete_issue" },
        { server: "plugin_wiki_api", tool: "delete_page" },
      ],
      unlisted: ["plugin_linear_api", "plugin_ghost_api"],
    });
    endpoint.served = served;
    try {
      const turn = args({
        attachments: false,
        agentLists: { tools: [], disallowedTools: ["mcp__plugin_linear_orders"] },
        plugins: [
          httpPlugin("plg_linear", "linear", "api", "https://linear.example/mcp"),
          httpPlugin("plg_wiki", "wiki", "api", "https://wiki.example/mcp"),
        ],
        values: valuesFor(["plg_linear", "https://linear.example/mcp"], ["plg_wiki", "https://wiki.example/mcp"]),
        readsToolMarks,
      });
      const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), turn);
      const spec = create(RunSpecSchema, {
        pluginEvalCase: create(PluginEvalCaseContextSchema, {
          mocks: ["api", "orders"].map((server) =>
            create(PluginEvalMockServerSchema, { server, segment: `plugin_linear_${server}` }),
          ),
        }),
      });
      const into = frame();
      const out = await startEvalMocks(deps({ channels: false }), { spec, archive: caseArchiveOf([]), mcp, frame: into });
      return { mcp, out, into };
    } finally {
      endpoint.served = undefined;
    }
  }

  const served = {
    servers: [standIn("plugin_linear_api"), standIn("plugin_linear_orders")],
    listed: [
      { server: "plugin_linear_api", tools: ["create_issue"] },
      { server: "plugin_linear_orders", tools: ["refund"] },
    ],
  };

  it("replaces the plugin's server of each stand-in's name, and leaves out a stand-in the lists exclude whole", async () => {
    const { out, into } = await standIns(served, true);
    expect(out.servers.map((s) => [s.slug, s.url])).toEqual([
      ["plugin_wiki_api", "https://wiki.example/mcp"],
      ["plugin_linear_api", "http://127.0.0.1:4000/mcp/plugin_linear_api"],
    ]);
    expect(out.listing, "an engine that reads its tools' marks gets no listing").toBeUndefined();
    expect(into.evalMocks, "the turn's finally closes it").toBeDefined();
  });

  it("lists each stand-in's mocked tools in place of its server's marks, for an engine that does not read its tools' marks", async () => {
    const { out } = await standIns(served, false);
    expect(out.listing).toEqual({
      listed: [
        { server: "plugin_wiki_api", tools: ["read_page"] },
        { server: "plugin_linear_api", tools: ["create_issue"] },
      ],
      destructive: [{ server: "plugin_wiki_api", tool: "delete_page" }],
      unlisted: ["plugin_ghost_api"],
    });
  });

  it("keeps the list as it was when the endpoint starts no stand-in", async () => {
    const { mcp, out, into } = await standIns(undefined, false);
    expect(out).toBe(mcp);
    expect(into.evalMocks).toBeUndefined();
  });
});
