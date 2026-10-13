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
 *  - the behaviour members are the host's stand-ins: the memory selection,
 *    the artifact upload and a plugin's verify call back, never run locally;
 *  - a vision image crosses once even when an attachment and the vision
 *    list share it;
 *  - a plugin-eval try's recorded conversation crosses whole, and a turn
 *    without one crosses none;
 *  - the adapter-owned projection replaces the runtime's fields IN PLACE
 *    (the builder holds the arrays), and touches no runtime-owned field;
 *  - the runtime-owned fields cross back only when they changed, and never
 *    the adapter's;
 *  - the CAS snapshot's bytes cross exactly, `null` (an added path) included.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import { describe, expect, it } from "vitest";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ChannelTemplateSchema, MessagingChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApprovalAction, MessageType, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { TurnSubagent } from "../../harness/types.js";
import type { PluginSubagent } from "../../shared/blueprint-resolver.js";
import { savedSubagentScope } from "../../shared/subagents.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { toolValuesKey } from "../../shared/run-values.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import {
  ADAPTER_OWNED_STATUS_FIELDS,
  RUNTIME_OWNED_STATUS_FIELDS,
  RuntimeFieldTracker,
  applyAdapterProjection,
  applyRuntimeFields,
  decodeCasSnapshot,
  decodeTurnInput,
  encodeAdapterProjection,
  encodeCasSnapshot,
  encodeTurnInput,
  type HostTurnServices,
} from "../codec.js";

function noServices(calls: string[] = []): HostTurnServices {
  const storage: ArtifactStorage = {
    upload: async (key) => {
      calls.push(`upload ${key}`);
      return key;
    },
    download: async () => Buffer.alloc(0),
    exists: async () => false,
  };
  return {
    selectRecalledMemories: async () => {
      calls.push("recall");
      return { facts: ["remembered"] };
    },
    artifactStorage: storage,
    verifyPlugin: async (slug) => {
      calls.push(`verify ${slug}`);
    },
  };
}

/** The wire is JSON: encode, stringify, parse, decode, as the pipe does. */
function crossed(input: ReturnType<typeof turnInputFixture>, services = noServices()) {
  return decodeTurnInput(JSON.parse(JSON.stringify(encodeTurnInput(input))), services);
}

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
      values: {
        agent: { API_TOKEN: "value" },
        tools: new Map([[toolValuesKey("plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }]]),
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
    expect(decoded.values.agent).toEqual({ API_TOKEN: "value" });
    expect([...decoded.values.tools]).toEqual([
      [toolValuesKey("plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }],
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

  it("carries no listing for an engine that reads its tools' marks itself", () => {
    expect(crossed(turnInputFixture()).mcp.listing).toBeUndefined();
  });

  it("carries every list the runtime resolved: plugins, skill references, channels and their templates, plugin subagents and saved subagents, plain attachments", () => {
    const input = turnInputFixture({
      attachments: { results: [{ filename: "notes.txt", relativePath: ".stigmer/inputs/notes.txt", sizeBytes: 4 }], visionImages: [], visionNotViewable: [] },
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
    expect(decoded.attachments.results).toEqual([{ filename: "notes.txt", relativePath: ".stigmer/inputs/notes.txt", sizeBytes: 4 }]);
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
      servers: [{ slug: "plugin_changelog_api", connectionType: "http", url: "https://changelog.example/mcp", pluginOrigin: { pluginId: "plg_changelog", plugin: "changelog", server: "api" } }],
      skills: [{ name: "changelog:changelog", description: "Write a changelog", path: "/c" }],
      hooks: [
        { plugin: { id: "plg_guard", slug: "guard", name: "Guard", root: "/g", data: "/gd", verify: async () => void calls.push("local verify") }, format: "claude-code", groups: [] },
        { plugin: null, format: "cursor", groups: [] },
      ],
      values: { NOTES_TOKEN: "notes" },
      bringsOwn: { plugins: true, hooks: true, lists: true },
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
      bringsOwn: { plugins: true, hooks: true, lists: true },
    });
    expect(back!.toolScope.describe()).toBe(toolScope.describe());
    expect(back!.toolScope.allowsClaudeTool("Agent")).toBe(false);
    expect(back!.toolScope.allowsMcpTool("plugin_changelog_api", "write")).toBe(true);
    expect(back!.toolScope.allowsClaudeTool("Bash")).toBe(false);
    expect(back!.hooks.map((h) => [h.plugin?.slug ?? null, h.format])).toEqual([["guard", "claude-code"], [null, "cursor"]]);
    await back!.hooks[0]!.plugin!.verify();
    expect(calls, "the host's verify calls back, never the runner's closure").toEqual(["verify guard"]);
  });

  it("calls back to the runner for the memory selection, the upload and a plugin's verify", async () => {
    const calls: string[] = [];
    const input = turnInputFixture({
      hooks: { sources: [{ plugin: { id: "plg_lint", slug: "lint", name: "Lint", root: "/r", data: "/d", verify: async () => void calls.push("local verify") }, format: "claude-code", groups: [] }], pluginServers: new Map() },
      artifactStorage: noServices().artifactStorage,
    });
    const decoded = crossed(input, noServices(calls));

    expect(await decoded.standing.selectRecalledMemories()).toEqual({ facts: ["remembered"] });
    await decoded.artifactStorage!.upload("artifacts/x/a.txt", Buffer.from("a"));
    expect(decoded.hooks.sources[0]!.plugin!.id, "the id a plugin's hook values are grouped by").toBe("plg_lint");
    await decoded.hooks.sources[0]!.plugin!.verify();
    expect(calls).toEqual(["recall", "upload artifacts/x/a.txt", "verify lint"]);
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

  it("carries a plugin-eval try's recorded conversation, and none for a turn without one", () => {
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

  it("sends a vision image once when an attachment and the vision list share it", () => {
    const image = { filename: "a.png", mimeType: "image/png" as const, base64: "iVBORw0KGgo=", byteSize: 8 };
    const input = turnInputFixture({
      attachments: { results: [{ filename: "a.png", relativePath: ".stigmer/inputs/a.png", sizeBytes: 8, vision: image }], visionImages: [image], visionNotViewable: [] },
    });

    const wire = JSON.stringify(encodeTurnInput(input));
    expect(wire.split(image.base64).length - 1, "the image's bytes appear once on the wire").toBe(1);
    const decoded = decodeTurnInput(JSON.parse(wire), noServices());
    expect(decoded.attachments.results[0]!.vision, "and the attachment points at the same image again").toBe(decoded.attachments.visionImages[0]);
  });
});

describe("the status, split by owner", () => {
  it("owns every field exactly once", () => {
    const all = RunStatusSchema.fields.map((f) => f.localName);
    expect([...ADAPTER_OWNED_STATUS_FIELDS, ...RUNTIME_OWNED_STATUS_FIELDS].sort()).toEqual([...all].sort());
  });

  it("replaces the adapter's fields in place and leaves the runtime's alone", () => {
    const target = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, error: "runtime's", todos: { stale: { content: "old" } } });
    const messages = target.messages;
    const host = create(RunStatusSchema, {
      phase: RunPhase.RUN_FAILED,
      error: "host's",
      messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "from the host" })],
      todos: { fresh: { content: "new" } },
      structuredOutput: { answer: 42 },
    });

    applyAdapterProjection(target, encodeAdapterProjection(host));

    expect(target.messages, "the same array, which the runtime's builder holds").toBe(messages);
    expect(target.messages.map((m) => m.content)).toEqual(["from the host"]);
    expect(Object.keys(target.todos)).toEqual(["fresh"]);
    expect(target.structuredOutput).toEqual({ answer: 42 });
    expect(target.phase, "a runtime field the host sent is ignored").toBe(RunPhase.RUN_IN_PROGRESS);
    expect(target.error).toBe("runtime's");
  });

  it("sends back only the runtime fields that changed, and never an adapter field", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" });
    const tracker = new RuntimeFieldTracker(status);
    const host = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" });

    expect(tracker.changes(status).fields, "nothing changed yet").toEqual([]);
    status.startedAt = "t1";
    status.messages.push(create(AgentMessageSchema, { content: "the runtime's terminal row" }));
    const changes = tracker.changes(status);
    expect(changes.fields).toEqual(["startedAt"]);
    applyRuntimeFields(host, changes);
    expect(host.startedAt).toBe("t1");
    expect(host.messages, "an adapter field never crosses back").toEqual([]);
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
