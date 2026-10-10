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
 *  - a server the lists exclude whole is not connected, while a server
 *    excluded tool by tool and the platform's own still are (#2106):
 *    `callableServers` is the one filter, applied before the discovery
 *    backfill (itself a connection) and so before either engine connects;
 *    a plugin-eval try's mocked server never reaches the backfill either;
 *  - a try's stand-ins (`startEvalMocks`) take their servers' places in the
 *    list, a stand-in the lists exclude whole left out like any server, and
 *    a try whose endpoint starts no stand-in keeps its list as it was.
 * The fetch-and-provision phases around it are pinned end to end by the
 * hermetic goldens.
 */

import { describe, expect, it, vi } from "vitest";

/** What the mocked resolver answers, and what reached the backfill, per test. */
const resolution = vi.hoisted(() => ({
  resolved: [] as unknown[],
  backfilled: [] as string[][],
}));
vi.mock("../../shared/mcp-resolver.js", async (original) => ({
  ...(await original<typeof import("../../shared/mcp-resolver.js")>()),
  resolveMcpServers: () => Promise.resolve({ resolvedServers: [...resolution.resolved] }),
}));
/** The stand-ins the mocked endpoint serves; `undefined` when it starts none. */
const endpoint = vi.hoisted(() => ({ servers: undefined as unknown[] | undefined }));
vi.mock("../../shared/plugin-eval/mock-endpoint.js", () => ({
  startMockEndpoint: () =>
    Promise.resolve(
      endpoint.servers === undefined
        ? undefined
        : { servers: endpoint.servers, bind: () => undefined, close: () => Promise.resolve() },
    ),
}));
vi.mock("../../shared/connect-backfill.js", async (original) => ({
  ...(await original<typeof import("../../shared/connect-backfill.js")>()),
  backfillMcpServersIfNeeded: (_client: unknown, servers: { slug: string }[]) => {
    resolution.backfilled.push(servers.map((server) => server.slug));
    return Promise.resolve(servers);
  },
}));
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema, RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import {
  PluginEvalCaseContextSchema,
  PluginEvalMockServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/plugin_eval_case_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import {
  callableServers,
  mainToolScope,
  resolveMcpServersAndPolicies,
  startEvalMocks,
  type ResolutionDeps,
  type TurnFrame,
} from "../turn-context.js";
import { caseArchiveOf } from "../../shared/plugin-eval/case-archive.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { CHANNEL_ATTACHMENT_SLUG } from "../../shared/channel-attachment.js";
import { CHANNEL_ID_LABEL, CONVERSATION_ATTACHMENT_SLUG } from "../../shared/conversation-attachment.js";
import { MEMORY_ATTACHMENT_SLUG } from "../../shared/memory-attachment.js";
import type { ResolvedBlueprint, RunAgent } from "../../shared/blueprint-resolver.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { NO_RUN_VALUES } from "../../shared/run-values.js";

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

function args(options: { readonly agentLists?: { tools: string[]; disallowedTools: string[] }; readonly attachments: boolean }) {
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
    mergedMcpServerUsages: [],
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
  return { execution, session, sessionId: "ses_1", blueprint, values: NO_RUN_VALUES };
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

describe("callableServers — a server no tool of which can be called is never connected (#2106)", () => {
  const server = (slug: string): ResolvedMcpServer => ({
    slug,
    connectionType: "http",
    url: `https://${slug}.example.com/mcp`,
    discoveredCapabilitiesEmpty: false,
    destructiveTools: [],
    discoveredToolNames: null,
    serverId: `mcp_${slug}`,
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

  it("filters before the discovery backfill, and leaves a plugin-eval try's mocked server to its stand-in", async () => {
    resolution.resolved = [server("tracker"), server("orders"), server("wiki")];
    resolution.backfilled = [];
    try {
      const turn = args({ attachments: false, agentLists: { tools: [], disallowedTools: ["mcp__wiki"] } });
      turn.execution.spec!.pluginEvalCase = create(PluginEvalCaseContextSchema, {
        mocks: [create(PluginEvalMockServerSchema, { server: "tracker", segment: "tracker" })],
      });
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), turn);
      expect(resolution.backfilled).toEqual([["orders"]]);
      expect(mcp.servers.map((s) => s.slug)).toEqual(["orders"]);
    } finally {
      resolution.resolved = [];
    }
  });
});

describe("startEvalMocks — a plugin-eval try's stand-ins take their servers' places", () => {
  const server = (slug: string, url = `https://${slug}.example.com/mcp`): ResolvedMcpServer => ({
    slug,
    connectionType: "http",
    url,
    discoveredCapabilitiesEmpty: false,
    destructiveTools: [],
    discoveredToolNames: null,
    serverId: `mcp_${slug}`,
    pluginOrigin: null,
  });
  const frame = (): TurnFrame => ({
    primaryDir: undefined,
    releaseWorkspaceLock: undefined,
    writeback: null,
    evalMocks: undefined,
    evalReadFiles: undefined,
  });

  /** The turn's resolved list (`tracker`, `wiki`; `orders` denied whole), then the try's stand-ins for `tracker` and `orders`. */
  async function standIns(served: unknown[] | undefined) {
    resolution.resolved = [server("tracker"), server("wiki")];
    endpoint.servers = served;
    try {
      const turn = args({ attachments: false, agentLists: { tools: [], disallowedTools: ["mcp__orders"] } });
      const mcp = await resolveMcpServersAndPolicies(deps({ channels: false }), turn);
      const spec = create(RunSpecSchema, {
        pluginEvalCase: create(PluginEvalCaseContextSchema, {
          mocks: ["tracker", "orders"].map((segment) => create(PluginEvalMockServerSchema, { server: segment, segment })),
        }),
      });
      const into = frame();
      const out = await startEvalMocks(deps({ channels: false }), { spec, archive: caseArchiveOf([]), mcp, frame: into });
      return { mcp, out, into };
    } finally {
      resolution.resolved = [];
      endpoint.servers = undefined;
    }
  }

  it("replaces the plugin's server of each stand-in's name, and leaves out a stand-in the lists exclude whole", async () => {
    const { out, into } = await standIns([server("tracker", "http://127.0.0.1:4000/tracker"), server("orders", "http://127.0.0.1:4000/orders")]);
    expect(out.servers.map((s) => [s.slug, s.url])).toEqual([
      ["wiki", "https://wiki.example.com/mcp"],
      ["tracker", "http://127.0.0.1:4000/tracker"],
    ]);
    expect(into.evalMocks, "the turn's finally closes it").toBeDefined();
  });

  it("keeps the list as it was when the endpoint starts no stand-in", async () => {
    const { mcp, out, into } = await standIns(undefined);
    expect(out).toBe(mcp);
    expect(into.evalMocks).toBeUndefined();
  });
});
