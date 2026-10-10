/**
 * The agent host's codec (`agent-host/codec.ts`): what crosses the pipe and
 * what is rebuilt on the far side.
 *
 * Pinned here, each a fact an adapter or the runtime relies on:
 *
 *  - a `TurnInput` survives the trip as JSON: protobuf messages, Maps and
 *    Sets intact, and the aliases the runtime builds rebuilt (`session` IS
 *    `blueprint.session`, the spec IS `blueprint.sessionSpec`, the agent's
 *    sub-agents ARE `blueprint.subAgents`, the leased servers ARE one Set),
 *    the turn's plugins, each plugin's hook values, the servers whose tools
 *    could not be listed and the turn start's listing included;
 *  - the behaviour members are the host's stand-ins: the memory selection,
 *    the artifact upload and a plugin's verify call back, never run locally;
 *  - a vision image crosses once even when an attachment and the vision
 *    list share it;
 *  - the adapter-owned projection replaces the runtime's fields IN PLACE
 *    (the builder holds the arrays), and touches no runtime-owned field;
 *  - the runtime-owned fields cross back only when they changed, and never
 *    the adapter's;
 *  - the CAS snapshot's bytes cross exactly, `null` (an added path) included.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ChannelTemplateSchema, MessagingChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApprovalAction, MessageType, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
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
      approvalDecisions: new Map([["call-1", ApprovalAction.APPROVE]]),
      values: {
        agent: { API_TOKEN: "value" },
        tools: new Map([[toolValuesKey("plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }]]),
        plugins: new Map([["plg_safety", { HOOK_TOKEN: "hook" }]]),
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
      skills: { root: [{ name: "s", description: "d", path: "/p" }], bySubAgent: new Map([["helper", [{ name: "h", description: "d", path: "/h" }]]]) },
    });
    input.blueprint.agent!.spec.subAgents.push(create(SubAgentSchema, { name: "helper" }));
    input.blueprint.subAgents = input.blueprint.agent!.spec.subAgents;
    input.session.spec!.harnessStateId = "state-1";

    const decoded = crossed(input);

    expect(toBinary(RunStatusSchema, decoded.execution.status ?? create(RunStatusSchema))).toEqual(
      toBinary(RunStatusSchema, input.execution.status ?? create(RunStatusSchema)),
    );
    expect(decoded.session.spec!.harnessStateId).toBe("state-1");
    expect(decoded.blueprint.session, "session IS blueprint.session").toBe(decoded.session);
    expect(decoded.blueprint.sessionSpec, "the spec IS blueprint.sessionSpec").toBe(decoded.session.spec);
    expect(decoded.blueprint.subAgents, "the sub-agents ARE the agent spec's list").toBe(decoded.blueprint.agent!.spec.subAgents);
    expect(decoded.blueprint.subAgents.map((s) => s.name)).toEqual(["helper"]);
    expect(decoded.mcp.mcpDefault.leasedServers, "one Set of leased servers").toBe(decoded.mcp.leases.servers);
    expect([...decoded.approvalDecisions]).toEqual([["call-1", ApprovalAction.APPROVE]]);
    expect(decoded.values.agent).toEqual({ API_TOKEN: "value" });
    expect([...decoded.values.tools]).toEqual([
      [toolValuesKey("plg_linear", "api"), { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } }],
    ]);
    expect([...decoded.values.plugins]).toEqual([["plg_safety", { HOOK_TOKEN: "hook" }]]);
    expect([...decoded.mcp.mcpDefault.unlisted]).toEqual(["plugin_jira_api"]);
    expect(decoded.mcp.listing).toEqual(listing);
    // A repository's token is the runner's alone: it never crosses the pipe.
    expect(decoded.values.repositories).toEqual([]);
    expect(JSON.stringify(encodeTurnInput(input))).not.toContain("ghp_runner_only");
    expect([...decoded.appliedToolCallIds]).toEqual(["call-2"]);
    expect([...decoded.mcp.leases.categories]).toEqual(["write"]);
    expect([...decoded.mcp.mcpDefault.destructive]).toEqual(["github/delete_repo"]);
    expect([...decoded.skills.bySubAgent.keys()]).toEqual(["helper"]);
  });

  it("carries no listing for an engine that reads its tools' marks itself", () => {
    expect(crossed(turnInputFixture()).mcp.listing).toBeUndefined();
  });

  it("keeps a sub-agent list that is not the agent spec's (the built-in judge's) as its own", () => {
    const input = turnInputFixture();
    input.blueprint.agent!.spec.subAgents.push(create(SubAgentSchema, { name: "on-the-spec" }));
    const decoded = crossed({ ...input, blueprint: { ...input.blueprint, subAgents: [] } });

    expect(decoded.blueprint.subAgents).toEqual([]);
    expect(decoded.blueprint.agent!.spec.subAgents.map((s) => s.name)).toEqual(["on-the-spec"]);
  });

  it("carries every list the runtime resolved: plugins, skill references, channels and their templates, sub-agents of their own, plain attachments", () => {
    const input = turnInputFixture({
      attachments: { results: [{ filename: "notes.txt", relativePath: ".stigmer/inputs/notes.txt", sizeBytes: 4 }], visionImages: [], visionNotViewable: [] },
    });
    const mcp = {
      ...input.mcp,
      channelMessaging: [
        { channel: create(MessagingChannelSchema, { channel: "chn_1" }), templates: [create(ChannelTemplateSchema, { name: "welcome" })] },
      ],
    };
    const blueprint = {
      ...input.blueprint,
      subAgents: [create(SubAgentSchema, { name: "own" })],
      plugins: [
        create(PluginSchema, {
          metadata: { id: "plg_kit", name: "kit" },
          status: { digest: "d".repeat(64), mcpServers: [{ name: "api", env: ["TOKEN"], transport: { case: "http", value: { url: "https://kit.example/mcp" } } }] },
        }),
      ],
      mergedSkillRefs: [create(ApiResourceReferenceSchema, { slug: "review" })],
    };

    const decoded = crossed({ ...input, mcp, blueprint });

    expect(decoded.blueprint.subAgents.map((s) => s.name)).toEqual(["own"]);
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
