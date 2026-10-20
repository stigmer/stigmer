/**
 * The agent host's codec (`agent-host/codec.ts`): what crosses the pipe and
 * what is rebuilt on the far side.
 *
 * Pinned here, each a fact an adapter or the runtime relies on:
 *
 *  - a `TurnInput` survives the trip as JSON: protobuf messages, Maps and
 *    Sets intact, and the aliases the runtime builds rebuilt (`session` IS
 *    `blueprint.session`, the spec IS `blueprint.sessionSpec`, the leased
 *    servers ARE one Set), the turn's plugins, its plugin subagents and
 *    saved subagents, each plugin's hook values, each subagent's own values,
 *    the servers whose tools could not be listed and the turn start's
 *    listing included;
 *  - each saved subagent's context crosses whole: its tool scope rebuilt
 *    with the same answers, its hook sources with a verify that calls back;
 *  - the behaviour members are the host's stand-ins: the memory selection
 *    and a plugin's verify call back, never run locally; the artifact store
 *    crosses as its presence alone and refuses every use on the host;
 *  - the turn's files cross whole: this message's, the conversation's, an
 *    eval case's references and the message's vision facts;
 *  - a eval-run try's recorded conversation crosses whole, and a turn
 *    without one crosses none;
 *  - the adapter-owned projection replaces the adapter's rows IN PLACE
 *    (the builder holds the arrays), and touches no status field and no
 *    runtime row;
 *  - every status field is the runtime's, and crosses back only when it
 *    changed;
 *  - the CAS snapshot's bytes cross exactly, `null` (an added path) included.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { describe, expect, it } from "vitest";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ChannelTemplateSchema, MessagingChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_io_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { TurnSubagent } from "../../harness/types.js";
import type { PluginSubagent } from "../../shared/blueprint-resolver.js";
import { savedSubagentScope } from "../../shared/subagents.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { toolValuesKey } from "../../shared/run-values.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { hookServerNamesOf } from "../../shared/hooks/tool-view.js";
import {
  ADAPTER_OWNED_ROW_FIELDS,
  RUNTIME_OWNED_STATUS_FIELDS,
  RuntimeFieldTracker,
  applyAdapterProjection,
  applyRuntimeFields,
  decodeCasSnapshot,
  decodeRunEvents,
  decodeTurnInput,
  encodeAdapterProjection,
  encodeCasSnapshot,
  encodeRunEvents,
  encodeTurnInput,
  type HostTurnServices,
} from "../codec.js";
import { AgentMessageSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, MessageType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

function noServices(calls: string[] = []): HostTurnServices {
  return {
    selectRecalledMemories: async () => {
      calls.push("recall");
      return { facts: ["remembered"] };
    },
    verifyPlugin: async (slug) => {
      calls.push(`verify ${slug}`);
    },
    readRunEvents: async () => {
      calls.push("events");
      return decodeRunEvents(encodeRunEvents([RUN_EVENT]));
    },
  };
}

/** One event of the turn's run, as the log holds it. */
const RUN_EVENT = create(SessionEventSchema, {
  runId: "run_1",
  event: { case: "stigmerPermissionAsked", value: { id: "run_1.c1.ask", toolUseId: "run_1.c1", policySource: "hook", contentDigest: "args:abc" } },
});

/** The wire is JSON: encode, stringify, parse, decode, as the pipe does. */
function crossed(input: ReturnType<typeof turnInputFixture>, services = noServices()) {
  return decodeTurnInput(JSON.parse(JSON.stringify(encodeTurnInput(input))), services);
}


/** A conversation's File as the mount placed it. */
const NOTES = {
  fileId: "file_1",
  mountPath: "notes.txt",
  filename: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 4,
  relativePath: ".stigmer/uploads/notes.txt",
};

describe("the turn input across the pipe", () => {
  it("keeps every protobuf message, Map and Set, and rebuilds the runtime's aliases", () => {
    const leased = new Set(["github"]);
    const listing: McpToolListing = {
      listed: [{ server: "plugin_linear_api", tools: ["search", "delete_issue"] }],
      destructive: [{ server: "plugin_linear_api", tool: "delete_issue" }],
      unlisted: ["plugin_jira_api"],
    };
    const input = turnInputFixture({
      approvalDecisions: new Map([["call-1", ApprovalAction.APPROVE], ["call-2", ApprovalAction.REJECT]]),
      approvalDenyMessages: new Map([["call-2", "use make clean instead"]]),
      approvalAsks: new Map([["run_1.call-2", { policySource: "hook", policyHook: "safety", contentDigest: "args:abc" }]]),
      values: {
        agent: { API_TOKEN: "value" },
        tools: new Map([[toolValuesKey("plugin", "plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }]]),
        plugins: new Map([["plg_safety", { HOOK_TOKEN: "hook" }]]),
        subagents: new Map([["release-notes", { NOTES_TOKEN: "notes" }]]),
        repositories: [{ name: "app", url: "https://github.com/acme/app.git", token: "ghp_runner_only" }],
      },
      appliedToolCallIds: new Set(["call-2"]),
      mcp: {
        servers: [],
        channelMessaging: [],
        leases: { global: false, categories: new Set(["write"]), servers: leased, hooks: new Set(["hook-key"]) },
        mcpDefault: { destructive: new Set(["github/delete_repo"]), unlisted: new Set(["plugin_jira_api"]), leasedServers: leased },
        listing,
        platformServerSlugs: new Set(["memory"]),
        toolScope: ToolScope.of("The agent", { tools: ["Read", "Agent(explore)"], disallowedTools: ["mcp__github__delete_repo"] }),
      },
      skills: { root: [{ name: "s", description: "d", path: "/p" }], bySubAgent: new Map([["kit:helper", [{ name: "h", description: "d", path: "/h" }]]]) },
    });
    input.session.status = create(SessionStatusSchema, { harnessStateId: "state-1" });

    const decoded = crossed(input);

    expect(toBinary(RunStatusSchema, decoded.execution.status ?? create(RunStatusSchema))).toEqual(
      toBinary(RunStatusSchema, input.execution.status ?? create(RunStatusSchema)),
    );
    expect(decoded.session.status!.harnessStateId).toBe("state-1");
    expect(decoded.blueprint.session, "session IS blueprint.session").toBe(decoded.session);
    expect(decoded.blueprint.sessionSpec, "the spec IS blueprint.sessionSpec").toBe(decoded.session.spec);
    expect(decoded.mcp.mcpDefault.leasedServers, "one Set of leased servers").toBe(decoded.mcp.leases.servers);
    expect([...decoded.approvalDecisions]).toEqual([["call-1", ApprovalAction.APPROVE], ["call-2", ApprovalAction.REJECT]]);
    expect([...decoded.approvalDenyMessages], "a deny's reason crosses to the host's engine").toEqual([["call-2", "use make clean instead"]]);
    expect([...decoded.approvalAsks], "what each call was asked under crosses with it").toEqual([
      ["run_1.call-2", { policySource: "hook", policyHook: "safety", contentDigest: "args:abc" }],
    ]);
    expect(decoded.continuation, "a first invocation carries no continuation").toBeUndefined();
    expect(decoded.values.agent).toEqual({ API_TOKEN: "value" });
    expect([...decoded.values.tools]).toEqual([
      [toolValuesKey("plugin", "plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }],
    ]);
    expect([...decoded.values.plugins]).toEqual([["plg_safety", { HOOK_TOKEN: "hook" }]]);
    expect([...decoded.values.subagents]).toEqual([["release-notes", { NOTES_TOKEN: "notes" }]]);
    expect([...decoded.mcp.mcpDefault.unlisted]).toEqual(["plugin_jira_api"]);
    expect(decoded.mcp.listing).toEqual(listing);
    // A repository's token is the runner's alone: it never crosses the pipe.
    expect(decoded.values.repositories).toEqual([]);
    expect(JSON.stringify(encodeTurnInput(input))).not.toContain("ghp_runner_only");
    expect([...decoded.appliedToolCallIds]).toEqual(["call-2"]);
    expect([...decoded.mcp.leases.categories]).toEqual(["write"]);
    expect([...decoded.mcp.mcpDefault.destructive]).toEqual(["github/delete_repo"]);
    expect([...decoded.skills.bySubAgent.keys()]).toEqual(["kit:helper"]);
  });

  it("carries a continuation, with its digest or without one", () => {
    expect(crossed(turnInputFixture({ continuation: { digest: "Assistant: built it" } })).continuation).toEqual({ digest: "Assistant: built it" });
    expect(crossed(turnInputFixture({ continuation: {} })).continuation).toEqual({});
  });

  it("carries each server's home, and rebuilds the platform's set from the homes rather than carrying it", () => {
    const servers: ResolvedMcpServer[] = [
      { slug: "zendesk", connectionType: "http", url: "https://acme-co.zendesk.com/mcp", home: { kind: "agent", agentId: "agt_helper", subagent: null, server: "zendesk" } },
      { slug: "plugin_linear_api", connectionType: "http", url: "https://mcp.linear.app/mcp", home: { kind: "plugin", pluginId: "plg_linear", plugin: "linear", server: "api" } },
      { slug: "stigmer-memory", connectionType: "http", url: "https://bridge.example/mcp", home: { kind: "platform" } },
    ];
    const base = turnInputFixture();
    const input = turnInputFixture({
      mcp: { ...base.mcp, servers, platformServerSlugs: new Set(["stigmer-memory"]) },
      hooks: { sources: [], serverNames: hookServerNamesOf(servers) },
    });
    const wire = encodeTurnInput(input);
    expect(JSON.stringify(wire.mcp)).not.toContain("platformServerSlugs");
    const decoded = crossed(input);
    expect(decoded.mcp.servers.map((server) => server.home)).toEqual(servers.map((server) => server.home));
    expect([...decoded.mcp.platformServerSlugs]).toEqual(["stigmer-memory"]);
    expect([...decoded.hooks.serverNames]).toEqual([
      ["zendesk", { name: "zendesk", source: "agent" }],
      ["plugin_linear_api", { name: "plugin:linear:api", source: "plugin" }],
    ]);
  });

  it("carries no listing for an engine that reads its tools' marks itself", () => {
    expect(crossed(turnInputFixture()).mcp.listing).toBeUndefined();
  });

  it("carries every list the runtime resolved: plugins, skill references, channels and their templates, plugin subagents and saved subagents, the conversation's Files", () => {
    const input = turnInputFixture({
      files: { message: [], conversation: [NOTES], references: [], visionImages: [], visionNotViewable: [] },
    });
    const mcp = {
      ...input.mcp,
      channelMessaging: [
        { channel: create(MessagingChannelSchema, { channel: "chn_1" }), templates: [create(ChannelTemplateSchema, { name: "welcome" })] },
      ],
    };
    const pluginAgent: PluginSubagent = {
      name: "kit:helper",
      description: "Helps.",
      instructions: "Help.",
      tools: ["Read"],
      disallowedTools: ["Bash"],
      model: "claude-sonnet-4-5",
    };
    const blueprint = {
      ...input.blueprint,
      pluginAgents: [pluginAgent],
      subagents: [
        {
          name: "release-notes",
          agentId: "agt_release-notes",
          versionHash: "c".repeat(64),
          spec: create(AgentSpecSchema, { instructions: "You write release notes.", plugins: [{ slug: "kit" }] }),
          plugins: [create(PluginSchema, { metadata: { id: "plg_kit", name: "kit" } })],
        },
      ],
      plugins: [
        create(PluginSchema, {
          metadata: { id: "plg_kit", name: "kit" },
          status: { digest: "d".repeat(64), mcpServers: [{ name: "api", env: ["TOKEN"], transport: { case: "http", value: { url: "https://kit.example/mcp" } } }] },
        }),
      ],
      mergedSkillRefs: [create(ApiResourceReferenceSchema, { slug: "review" })],
    };

    const decoded = crossed({ ...input, mcp, blueprint });

    expect(decoded.blueprint.pluginAgents).toEqual([pluginAgent]);
    expect(decoded.blueprint.subagents.map((s) => [s.name, s.agentId, s.versionHash, s.spec.instructions, s.spec.plugins.map((r) => r.slug), s.plugins.map((p) => p.metadata?.id)])).toEqual([
      ["release-notes", "agt_release-notes", "c".repeat(64), "You write release notes.", ["kit"], ["plg_kit"]],
    ]);
    expect(decoded.blueprint.plugins.map((p) => [p.metadata?.id, p.status?.digest, p.status?.mcpServers.map((e) => [e.name, e.env, e.transport.case])])).toEqual([
      ["plg_kit", "d".repeat(64), [["api", ["TOKEN"], "http"]]],
    ]);
    expect(decoded.blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["review"]);
    expect(decoded.mcp.channelMessaging.map((c) => [c.channel.channel, c.templates.map((t) => t.name)])).toEqual([["chn_1", ["welcome"]]]);
    expect(decoded.files.conversation).toEqual([NOTES]);
  });

  it("rebuilds the tool scope with the same answers", () => {
    const scope = ToolScope.of("The agent", { tools: ["Read", "Agent(explore)", "mcp__github"], disallowedTools: ["mcp__github__delete_repo"] })
      .narrow("helper", { tools: ["Read"], disallowedTools: [] });
    const input = turnInputFixture();
    const decoded = crossed({ ...input, mcp: { ...input.mcp, toolScope: scope } });

    const rebuilt = decoded.mcp.toolScope;
    expect(rebuilt.describe()).toBe(scope.describe());
    expect(rebuilt.allowsSubAgentType("explore")).toBe(scope.allowsSubAgentType("explore"));
    expect(rebuilt.allowsSubAgentType("other")).toBe(scope.allowsSubAgentType("other"));
    expect(rebuilt.allowsMcpTool("github", "delete_repo")).toBe(false);
    expect(rebuilt.allowsClaudeTool("Read")).toBe(true);
    expect(rebuilt.owner).toBe("helper");
  });

  it("carries each saved subagent's context whole: its scope rebuilt, its hooks' verify calling back", async () => {
    const calls: string[] = [];
    const toolScope = savedSubagentScope("release-notes", create(AgentSpecSchema, { tools: ["Read", "mcp__plugin_changelog_api"] }), undefined);
    const subagent: TurnSubagent = {
      name: "release-notes",
      description: "Writes release notes",
      instructions: "You write release notes.",
      model: "claude-sonnet-4-5",
      toolScope,
      servers: [{ slug: "plugin_changelog_api", connectionType: "http", url: "https://changelog.example/mcp", home: { kind: "plugin", pluginId: "plg_changelog", plugin: "changelog", server: "api" } }],
      skills: [{ name: "changelog:changelog", description: "Write a changelog", path: "/c" }],
      hooks: [
        { plugin: { id: "plg_guard", slug: "guard", name: "Guard", root: "/g", data: "/gd", verify: async () => void calls.push("local verify") }, format: "claude-code", groups: [] },
        { plugin: null, format: "cursor", groups: [] },
      ],
      values: { NOTES_TOKEN: "notes" },
      bringsOwn: { plugins: true, hooks: true, lists: true, mcpServers: false },
    };
    const decoded = crossed(turnInputFixture({ subagents: [subagent] }), noServices(calls));

    const [back] = decoded.subagents;
    expect(back).toMatchObject({
      name: "release-notes",
      description: "Writes release notes",
      instructions: "You write release notes.",
      model: "claude-sonnet-4-5",
      servers: subagent.servers,
      skills: subagent.skills,
      values: { NOTES_TOKEN: "notes" },
      bringsOwn: { plugins: true, hooks: true, lists: true, mcpServers: false },
    });
    expect(back!.toolScope.describe()).toBe(toolScope.describe());
    expect(back!.toolScope.allowsClaudeTool("Agent")).toBe(false);
    expect(back!.toolScope.allowsMcpTool("plugin_changelog_api", "write")).toBe(true);
    expect(back!.toolScope.allowsClaudeTool("Bash")).toBe(false);
    expect(back!.hooks.map((h) => [h.plugin?.slug ?? null, h.format])).toEqual([["guard", "claude-code"], [null, "cursor"]]);
    await back!.hooks[0]!.plugin!.verify();
    expect(calls, "the host's verify calls back, never the runner's closure").toEqual(["verify guard"]);
  });

  it("calls back to the runner for the memory selection, a plugin's verify and the run's events, and serves no artifact store", async () => {
    const calls: string[] = [];
    const runnerStorage: ArtifactStorage = {
      upload: async (key) => {
        calls.push(`local upload ${key}`);
        return key;
      },
      download: async () => Buffer.alloc(0),
      exists: async () => false,
    };
    const input = turnInputFixture({
      hooks: { sources: [{ plugin: { id: "plg_lint", slug: "lint", name: "Lint", root: "/r", data: "/d", verify: async () => void calls.push("local verify") }, format: "claude-code", groups: [] }], serverNames: new Map() },
      artifactStorage: runnerStorage,
    });
    const decoded = crossed(input, noServices(calls));

    expect(await decoded.standing.selectRecalledMemories()).toEqual({ facts: ["remembered"] });
    expect(decoded.artifactStorage, "present, as the runner's is").toBeDefined();
    await expect(decoded.artifactStorage!.upload("artifacts/x/a.txt", Buffer.from("a"))).rejects.toThrow(/the runner's/);
    await expect(decoded.artifactStorage!.download("artifacts/x/a.txt")).rejects.toThrow(/the runner's/);
    expect(decoded.hooks.sources[0]!.plugin!.id, "the id a plugin's hook values are grouped by").toBe("plg_lint");
    await decoded.hooks.sources[0]!.plugin!.verify();
    const events = await decoded.readRunEvents();
    expect(events.map((event) => toBinary(SessionEventSchema, event)), "each event crosses whole").toEqual([toBinary(SessionEventSchema, RUN_EVENT)]);
    expect(calls).toEqual(["recall", "verify lint", "events"]);
  });

  it("carries the turn's appended system prompt and a turn layer that hides skills", () => {
    const input = turnInputFixture();
    const scope = ToolScope.of("The agent", { tools: [], disallowedTools: [] }).narrow("The turn", {
      tools: ["Read"],
      disallowedTools: ["Skill"],
    });
    const decoded = crossed({ ...input, appendSystemPrompt: "Answer in one line.", mcp: { ...input.mcp, toolScope: scope } });

    expect(decoded.appendSystemPrompt).toBe("Answer in one line.");
    expect(decoded.mcp.toolScope.hidesSkills).toBe(true);
  });

  it("carries a eval-run try's recorded conversation, and none for a turn without one", () => {
    const history = [
      { role: "user" as const, blocks: [{ type: "text" as const, text: "Draft a note." }] },
      { role: "assistant" as const, blocks: [{ type: "tool_use" as const, id: "t1", name: "Read", input: { file_path: "a" } }] },
      { role: "user" as const, blocks: [{ type: "tool_result" as const, toolUseId: "t1", content: "A", isError: false }] },
    ];
    expect(crossed({ ...turnInputFixture(), resumedHistory: history }).resumedHistory).toEqual(history);
    expect(crossed(turnInputFixture()).resumedHistory).toBeUndefined();
  });

  it("carries no artifact store when the runtime resolved none", () => {
    expect(crossed(turnInputFixture()).artifactStorage).toBeUndefined();
  });

  it("carries the turn's files whole, each image's bytes once", () => {
    const image = { filename: "a.png", mimeType: "image/png" as const, base64: "iVBORw0KGgo=", byteSize: 8 };
    const photo = { ...NOTES, fileId: "file_2", mountPath: "a.png", filename: "a.png", mimeType: "image/png", relativePath: ".stigmer/uploads/a.png", kind: "image" as const };
    const files = {
      message: [photo],
      conversation: [NOTES],
      references: [{ filename: "case.json", relativePath: ".stigmer/inputs/fixtures/case.json", sizeBytes: 2 }],
      visionImages: [image],
      visionNotViewable: [{ path: ".stigmer/uploads/big.png", reason: "too_large" as const }],
    };

    const wire = JSON.stringify(encodeTurnInput(turnInputFixture({ files })));
    expect(wire.split(image.base64).length - 1, "the image's bytes appear once on the wire").toBe(1);
    expect(decodeTurnInput(JSON.parse(wire), noServices()).files).toEqual(files);
  });
});

describe("the turn's fields, split by owner", () => {
  it("gives the runtime every status field", () => {
    const all = RunStatusSchema.fields.map((f) => f.localName);
    expect([...RUNTIME_OWNED_STATUS_FIELDS].sort()).toEqual([...all].sort());
  });

  it("names the rows the adapter owns; the turn's other rows are the runtime's and never cross", () => {
    const rows = TurnRowsSchema.fields.map((f) => f.localName);
    expect([...ADAPTER_OWNED_ROW_FIELDS].every((name) => rows.includes(name))).toBe(true);
    expect(rows.filter((name) => !(ADAPTER_OWNED_ROW_FIELDS as readonly string[]).includes(name)).sort()).toEqual(["fileReviewEventStream", "recalledMemoriesReport"]);
  });

  it("replaces the adapter's rows in place and leaves the status and the runtime's rows alone", () => {
    const target = {
      status: create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, error: "runtime's" }),
      rows: create(TurnRowsSchema, {
        todos: { stale: { content: "old" } },
        recalledMemoriesReport: { selectionActive: true },
        fileReviewEventStream: { runId: "runtime's ledger" },
      }),
    };
    const messages = target.rows.messages;
    const host = {
      status: create(RunStatusSchema, { phase: RunPhase.RUN_FAILED, error: "host's" }),
      rows: create(TurnRowsSchema, {
        messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "from the host" })],
        todos: { fresh: { content: "new" } },
        structuredOutput: { answer: 42 },
        recalledMemoriesReport: { selectionActive: false },
      }),
    };

    applyAdapterProjection(target, encodeAdapterProjection(host));

    expect(target.rows.messages, "the same array, which the runtime's builder holds").toBe(messages);
    expect(target.rows.messages.map((m) => m.content)).toEqual(["from the host"]);
    expect(Object.keys(target.rows.todos)).toEqual(["fresh"]);
    expect(target.rows.structuredOutput).toEqual({ answer: 42 });
    expect(target.rows.recalledMemoriesReport?.selectionActive, "a runtime row the host sent is ignored").toBe(true);
    expect(target.rows.fileReviewEventStream?.runId).toBe("runtime's ledger");
    expect(target.status.phase, "a status field the host holds never crosses").toBe(RunPhase.RUN_IN_PROGRESS);
    expect(target.status.error).toBe("runtime's");
  });

  it("sends back only the status fields that changed", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" });
    const tracker = new RuntimeFieldTracker(status);
    const host = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" });

    expect(tracker.changes(status).fields, "nothing changed yet").toEqual([]);
    status.startedAt = "t1";
    const changes = tracker.changes(status);
    expect(changes.fields).toEqual(["startedAt"]);
    applyRuntimeFields(host, changes);
    expect(host.startedAt).toBe("t1");
    expect(tracker.changes(status).fields, "and a field crosses once per change").toEqual([]);
  });
});

describe("the CAS snapshot across the pipe", () => {
  it("keeps every byte and every added path", () => {
    const snapshot = { before: new Map<string, Uint8Array | null>([["a.txt", new Uint8Array([0, 255, 10])], ["new.txt", null]]), blockedSecretPaths: new Set([".env"]) };
    const decoded = decodeCasSnapshot(JSON.parse(JSON.stringify(encodeCasSnapshot(snapshot))));

    expect([...decoded.before.keys()]).toEqual(["a.txt", "new.txt"]);
    expect([...decoded.before.get("a.txt")!]).toEqual([0, 255, 10]);
    expect(decoded.before.get("new.txt")).toBeNull();
    expect([...decoded.blockedSecretPaths]).toEqual([".env"]);
  });
});
