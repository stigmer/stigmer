/**
 * Pins the runtime's subagent phase (`turn-context.ts` `resolveSubagents`):
 * each saved agent the turn's agent lists, resolved as an agent of its own.
 *  - Its servers are the ones it writes itself, under its own home, then
 *    its plugins': none of the conversation's own plugins and none of the
 *    platform's servers (channel, conversation, memory), even on a turn
 *    that gets them; a server it shares with the conversation keeps its
 *    slug, so the engine connects it once; one it writes under a name the
 *    main agent's server already has refuses the turn.
 *  - Its skills are its own refs and its plugins' skills, mounted where the
 *    main agent's are; a skill the main agent also has is mounted once; a
 *    ref that fails costs the subagent that skill alone, warned; a scope
 *    that hides skills (its own deny, or the turn's) fetches none.
 *  - Its hooks are its plugins' that record hooks, then its own block; a
 *    plugin whose archive cannot be mounted settles the turn naming it.
 *  - Its values are `ExecutionValues.subagents` under its name; its model
 *    counts only on the engine it was chosen for; `bringsOwn` says what it
 *    brings beyond instructions, model and skills.
 *  - A harness without subagents, or a turn whose agent lists none,
 *    resolves nothing and reports nothing.
 *  - Beside the subagents, the skills each one mounted from its own refs,
 *    by id at their version hash, for the run's record of what it loaded;
 *    a skill that failed is not listed, nor a plugin's skill.
 *
 * The client is doubled with scripted skills and a plugin archive; `HOME`
 * is the hermetic environment's, so mounts land under a temp platform dir;
 * the model registry is answered by a stubbed fetch.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentMcpServerSchema, AgentSpecSchema, HookSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { GetArtifactResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { HttpMcpServerSchema, McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RecalledMemoriesSchema, RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { ResolvedBlueprint, SavedSubagent } from "../../shared/blueprint-resolver.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { CHANNEL_ID_LABEL, CONVERSATION_KEY_LABEL } from "../../shared/conversation-attachment.js";
import { _resetRegistryCache } from "../../shared/model-registry.js";
import { toolServerSegment } from "../../shared/plugin-servers.js";
import { DuplicateServerNameError, resolveTurnServers } from "../../shared/mcp-resolver.js";
import { resolveMcpTransportPosture } from "../../shared/mcp-transport-guard.js";
import { NO_RUN_VALUES, toolValuesKey, type RunValues } from "../../shared/run-values.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { mountSkills, resolveSubagents, type ResolutionDeps } from "../turn-context.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

const ARCHIVE = buildZip([
  { name: "hooks/hooks.json", content: '{"hooks":{}}' },
  { name: "skills/changelog/SKILL.md", content: "---\nname: changelog\n---\n# changelog" },
]);
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");

const group = create(HookGroupSchema, { event: "PreToolUse", matcher: "Bash", handlers: [create(HookHandlerSchema, { command: "check" })] });

function ref(slug: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { slug, org: "acme" });
}

function skill(slug: string): Skill {
  return create(SkillSchema, {
    metadata: { id: `skill-${slug}`, slug, org: "acme" },
    spec: { name: slug, description: `The ${slug} skill`, skillMd: `# ${slug}` },
    status: { versionHash: `hash-${slug}` },
  });
}

/** A plugin with one HTTP server, one skill and, unless told otherwise, hooks; its archive is the scripted one. */
function plugin(name: string, options: { hooks?: boolean; digest?: string } = {}): Plugin {
  return create(PluginSchema, {
    metadata: { id: `plg_${name}`, name, slug: name, org: "acme" },
    status: {
      digest: options.digest ?? DIGEST,
      artifactStorageKey: `plugins/${name}.zip`,
      mcpServers: [
        create(McpServerEntrySchema, {
          name: "api",
          env: ["TOKEN"],
          transport: { case: "http", value: create(HttpMcpServerSchema, { url: `https://${name}.example.com/mcp`, headers: { Authorization: "Bearer ${TOKEN}" } }) },
        }),
      ],
      skills: [{ name: "changelog", description: "Write a changelog", path: "skills/changelog" }],
      ...(options.hooks === false ? {} : { hooks: create(HookConfigSchema, { format: HookFormat.CLAUDE_CODE, groups: [group] }) }),
    },
  });
}

/** A saved subagent as the blueprint carries it. */
function saved(name: string, spec: MessageInitShape<typeof AgentSpecSchema> = {}, plugins: Plugin[] = []): SavedSubagent {
  return {
    name,
    agentId: `agt_${name}`,
    versionHash: "c".repeat(64),
    spec: create(AgentSpecSchema, { description: `${name} agent`, instructions: `You are ${name}.`, ...spec }),
    plugins,
  };
}

/** A client that answers the scripted skills and the plugin archive; every skill fetch is counted. */
function client(available: readonly string[] = []) {
  const fetches: string[] = [];
  const c = mockStigmerClient({
    getSkillByReference: vi.fn(async (r: ApiResourceReference) => {
      fetches.push(r.slug);
      if (!available.includes(r.slug)) throw new Error(`skill ${r.slug} not found`);
      return skill(r.slug);
    }),
    getPluginArtifactDownloadUrl: vi.fn(async () => {
      throw new ConnectError("no lane", Code.Unimplemented);
    }),
    getPluginArtifact: vi.fn(async () => create(GetArtifactResponseSchema, { artifact: ARCHIVE })),
  });
  return { client: c, fetches };
}

function depsWith(c: ResolutionDeps["client"]): { deps: ResolutionDeps; labels: string[] } {
  const labels: string[] = [];
  const status = create(RunStatusSchema, {});
  const rows = create(TurnRowsSchema);
  return {
    labels,
    deps: {
      input: { executionId: "aex-subagents", threadId: "", turnSeq: 0 },
      client: c,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir, mcpBridgeEndpoint: "https://mcp.example.com" }),
      status,
      rows,
      transcript: new TranscriptBuilder("aex-subagents", rows, status),
      artifactStorage: undefined,
      timing: new TimingRecorder(),
      signal: new AbortController().signal,
      heartbeat: () => {},
      enterPhase: () => {},
      reportProgress: async (label) => {
        labels.push(label);
      },
      identifyRun: () => {},
      recordReconciled: async () => {},
    },
  };
}

let n = 0;
let sessionId: string;
let primaryDir: string;

beforeAll(() => {
  mkdirSync(env.workspaceRootDir, { recursive: true });
});

beforeEach(() => {
  sessionId = `ses-subagents-${++n}`;
  primaryDir = join(env.workspaceRootDir, sessionId);
  mkdirSync(primaryDir, { recursive: true });
  _resetRegistryCache();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(
      JSON.stringify({
        models: [
          { id: "claude-sonnet-4-5", provider: "anthropic", harness: "native" },
          { id: "composer-2", provider: "cursor", harness: "cursor" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

afterEach(() => {
  _resetRegistryCache();
  vi.restoreAllMocks();
});

/**
 * Run the phase over a blueprint whose conversation lists `conversationPlugins`
 * and whose agent lists `subagents`, on a turn that would get every platform
 * server (a channel conversation with recalled memories).
 */
async function run(
  subagents: SavedSubagent[],
  options: {
    readonly c?: ResolutionDeps["client"];
    readonly conversationPlugins?: Plugin[];
    readonly values?: RunValues;
    readonly runSpec?: { tools?: string[]; disallowedTools?: string[] };
    readonly capabilities?: { harness: Harness.NATIVE | Harness.CURSOR; subAgents: boolean };
    /** Servers the main agent writes itself. */
    readonly mainAgentServers?: { name: string; url: string }[];
  } = {},
) {
  const base = turnInputFixture({ sessionId }).blueprint;
  const blueprint: ResolvedBlueprint = {
    ...base,
    session: { ...base.session, metadata: { ...base.session.metadata!, labels: { [CHANNEL_ID_LABEL]: "chn_1", [CONVERSATION_KEY_LABEL]: "919000000001" } } },
    plugins: options.conversationPlugins ?? [],
    subagents,
  };
  const execution = create(RunSchema, {
    metadata: { id: "aex-subagents" },
    spec: create(RunSpecSchema, { target: { case: "sessionId", value: sessionId }, ...options.runSpec }),
    status: create(RunStatusSchema, { recalledMemories: create(RecalledMemoriesSchema, { enabled: true }) }),
  });
  const { deps, labels } = depsWith(options.c ?? client().client);
  const result = await resolveSubagents(deps, {
    execution,
    session: blueprint.session,
    sessionId,
    blueprint,
    values: options.values ?? NO_RUN_VALUES,
    primaryDir,
    capabilities: options.capabilities ?? { harness: Harness.NATIVE, subAgents: true },
    // The main agent's servers, as the MCP phase resolves them from the conversation's plugins.
    mainServers: resolveTurnServers({
      agent:
        options.mainAgentServers === undefined
          ? undefined
          : {
              agentId: "agt_main",
              subagent: null,
              servers: options.mainAgentServers.map((server) => create(AgentMcpServerSchema, server)),
            },
      plugins: blueprint.plugins,
      tools: (options.values ?? NO_RUN_VALUES).tools,
      platformValues: {},
      transportPosture: resolveMcpTransportPosture(deps.config.mode),
      platformEndpoints: deps.config,
    }).resolvedServers,
  });
  return { result, labels };
}

/** The resolved subagents of a ready result. */
function ready(result: Awaited<ReturnType<typeof run>>["result"]) {
  if (result.kind !== "ready") throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.subagents;
}

describe("resolveSubagents: what a subagent runs with", () => {
  it("resolves nothing, and reports nothing, for a turn whose agent lists no subagent", async () => {
    const { result, labels } = await run([]);
    expect(result).toEqual({ kind: "ready", subagents: [], loadedSkills: [] });
    expect(labels).toEqual([]);
  });

  it("resolves nothing for a harness without subagents", async () => {
    const { client: c, fetches } = client(["alpha"]);
    const { result, labels } = await run([saved("release-notes", { skillRefs: [ref("alpha")] })], {
      c,
      capabilities: { harness: Harness.NATIVE, subAgents: false },
    });
    expect(result).toEqual({ kind: "ready", subagents: [], loadedSkills: [] });
    expect(labels).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("gives a subagent its own plugins' servers, never the conversation's plugins' nor the platform's", async () => {
    const own = plugin("changelog", { hooks: false });
    const values: RunValues = {
      ...NO_RUN_VALUES,
      tools: new Map([[toolValuesKey("plugin", "plg_changelog", "api"), { url: "https://changelog.example.com/mcp", values: { TOKEN: "t-changelog" } }]]),
    };
    const { result, labels } = await run([saved("release-notes", { plugins: [ref("changelog")] }, [own])], {
      conversationPlugins: [plugin("github", { hooks: false })],
      values,
    });
    const [subagent] = ready(result);
    expect(subagent!.servers.map((s) => s.slug)).toEqual([toolServerSegment("changelog", "api")]);
    expect(subagent!.servers[0]!.home).toEqual({ kind: "plugin", pluginId: "plg_changelog", plugin: "changelog", server: "api" });
    expect(labels).toEqual(["Resolving subagents"]);
  });

  it("names a server it shares with the conversation by the same slug, so the engine connects it once", async () => {
    const shared = plugin("github", { hooks: false });
    const values: RunValues = {
      ...NO_RUN_VALUES,
      tools: new Map([[toolValuesKey("plugin", "plg_github", "api"), { url: "https://github.example.com/mcp", values: { TOKEN: "t-github" } }]]),
    };
    const { result } = await run([saved("release-notes", { plugins: [ref("github")] }, [shared])], { conversationPlugins: [shared], values });
    expect(ready(result)[0]!.servers.map((s) => s.slug)).toEqual([toolServerSegment("github", "api")]);
  });

  it("refuses the turn when a subagent's server would take a main server's name from another plugin", async () => {
    const theirs = plugin("github", { hooks: false });
    const other = create(PluginSchema, { ...theirs, metadata: { ...theirs.metadata!, id: "plg_github_other_org", org: "parent" } });
    const group = { url: "https://github.example.com/mcp", values: { TOKEN: "t" } };
    const values: RunValues = {
      ...NO_RUN_VALUES,
      tools: new Map([
        [toolValuesKey("plugin", "plg_github", "api"), group],
        [toolValuesKey("plugin", "plg_github_other_org", "api"), group],
      ]),
    };
    await expect(
      run([saved("release-notes", { plugins: [ref("github")] }, [other])], { conversationPlugins: [theirs], values }),
    ).rejects.toThrow(DuplicateServerNameError);
  });

  it("resolves the servers it writes itself under its own home, and says it brings them", async () => {
    const values: RunValues = {
      ...NO_RUN_VALUES,
      tools: new Map([[toolValuesKey("agent", "agt_triage", "crm"), { url: "https://crm.example.com/mcp", values: {} }]]),
    };
    const { result } = await run(
      [saved("triage", { mcpServers: [{ name: "crm", url: "https://crm.example.com/mcp" }] })],
      { values },
    );
    const [triage] = ready(result);
    expect(triage!.servers.map((server) => [server.slug, server.home])).toEqual([
      ["crm", { kind: "agent", agentId: "agt_triage", subagent: "triage", server: "crm" }],
    ]);
    expect(triage!.bringsOwn.mcpServers).toBe(true);
  });

  it("refuses the turn when a subagent writes a server under a name the main agent's server has", async () => {
    await expect(
      run([saved("triage", { mcpServers: [{ name: "crm", url: "https://other.example.com/mcp" }] })], {
        mainAgentServers: [{ name: "crm", url: "https://crm.example.com/mcp" }],
      }),
    ).rejects.toThrow(
      new DuplicateServerNameError("crm", "the agent's own server 'crm'", "subagent 'triage''s own server 'crm'"),
    );
  });

  it("refuses the turn when two subagents' servers would take one name from different plugins", async () => {
    const first = plugin("github", { hooks: false });
    const second = create(PluginSchema, { ...first, metadata: { ...first.metadata!, id: "plg_github_other_org", org: "parent" } });
    const group = { url: "https://github.example.com/mcp", values: { TOKEN: "t" } };
    const values: RunValues = {
      ...NO_RUN_VALUES,
      tools: new Map([
        [toolValuesKey("plugin", "plg_github", "api"), group],
        [toolValuesKey("plugin", "plg_github_other_org", "api"), group],
      ]),
    };
    await expect(
      run(
        [saved("release-notes", { plugins: [ref("github")] }, [first]), saved("triager", { plugins: [ref("github")] }, [second])],
        { values },
      ),
    ).rejects.toThrow(DuplicateServerNameError);
  });

  it("mounts its own skills and its plugins' skills where the main agent's are", async () => {
    const { client: c } = client(["alpha"]);
    const { result } = await run([saved("release-notes", { skillRefs: [ref("alpha")], plugins: [ref("changelog")] }, [plugin("changelog", { hooks: false })])], { c });
    const [subagent] = ready(result);
    expect(subagent!.skills.map((s) => s.name)).toEqual(["alpha", "changelog:changelog"]);
    expect(subagent!.skills[0]!.path).toBe(".stigmer/skills/alpha/SKILL.md");
    expect(subagent!.skills[1]!.path).toContain(DIGEST);
    const loaded = result.kind === "ready" ? result.loadedSkills : [];
    expect(loaded.map((r) => [r.org, r.id, r.version]), "its own skill by id at its version; its plugin's is named by the digest").toEqual([
      ["acme", "skill-alpha", "hash-alpha"],
    ]);
  });

  it("mounts a skill the main agent also has once: the second resolution hits the hash-keyed marker", async () => {
    const { client: c, fetches } = client(["shared"]);
    const { deps } = depsWith(c);
    const writes = vi.spyOn(await import("../../shared/skill-mount.js"), "writeSkillMount");
    const { skills: root } = await mountSkills(deps, {
      blueprint: turnInputFixture({ sessionId, blueprint: { mergedSkillRefs: [ref("shared")] } }).blueprint,
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    const { result } = await run([saved("release-notes", { skillRefs: [ref("shared")] })], { c });
    expect(root.root.map((s) => s.name)).toEqual(["shared"]);
    expect(ready(result)[0]!.skills.map((s) => s.name)).toEqual(["shared"]);
    expect(fetches, "the control plane is asked once per owner").toEqual(["shared", "shared"]);
    expect(writes, "the mount is written once").toHaveBeenCalledTimes(1);
  });

  it("costs a subagent a skill that fails to resolve, warned and never thrown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client: c } = client(["beta"]);
    const { result } = await run([saved("release-notes", { skillRefs: [ref("missing"), ref("beta")] })], { c });
    expect(ready(result)[0]!.skills.map((s) => s.name)).toEqual(["beta"]);
    expect(result.kind === "ready" ? result.loadedSkills.map((r) => r.id) : [], "a skill that did not mount is not listed").toEqual(["skill-beta"]);
  });

  it.each<[string, { disallowedTools?: string[] }, { disallowedTools?: string[] }]>([
    ["its own lists deny Skill", { disallowedTools: ["Skill"] }, {}],
    ["the turn's lists deny Skill", {}, { disallowedTools: ["Skill"] }],
  ])("fetches and mounts no skill when %s", async (_label, spec, runSpec) => {
    const { client: c, fetches } = client(["alpha"]);
    const { result } = await run(
      [saved("release-notes", { ...spec, skillRefs: [ref("alpha")], plugins: [ref("changelog")] }, [plugin("changelog", { hooks: false })])],
      { c, runSpec },
    );
    expect(ready(result)[0]!.skills).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("carries its plugins' hooks, then its own block, each as written", async () => {
    const inline = create(HookSourceSchema, { source: { case: "inline", value: create(HookConfigSchema, { format: HookFormat.CURSOR, groups: [group] }) } });
    const { result } = await run([
      saved("release-notes", { hooks: [inline], plugins: [ref("guard"), ref("quiet")] }, [plugin("guard"), plugin("quiet", { hooks: false })]),
    ]);
    const hooks = ready(result)[0]!.hooks;
    expect(hooks.map((h) => h.plugin?.slug ?? "own")).toEqual(["guard", "own"]);
    expect(hooks.map((h) => h.format)).toEqual(["claude-code", "cursor"]);
    expect(hooks[0]!.plugin?.root).toContain(DIGEST);
  });

  it("settles the turn naming a subagent's plugin whose hooks cannot be prepared", async () => {
    const { result } = await run([saved("release-notes", { plugins: [ref("forged")] }, [plugin("forged", { digest: "0".repeat(64) })])]);
    expect(result.kind).toBe("settled");
    if (result.kind !== "settled") return;
    expect(result.settlement).toMatchObject({ kind: "hooks-refused" });
    expect((result.settlement as { message: string }).message).toContain("The hooks of plugin 'forged' could not be prepared");
  });

  it("hands each subagent its own values by its name, and says what it brings of its own", async () => {
    const values: RunValues = { ...NO_RUN_VALUES, agent: { AGENT_KEY: "a" }, subagents: new Map([["release-notes", { NOTES_KEY: "n" }]]) };
    const { result } = await run(
      [
        saved("release-notes", { tools: ["Read"], plugins: [ref("quiet")] }, [plugin("quiet", { hooks: false })]),
        saved("triage", {
          hooks: [create(HookSourceSchema, { source: { case: "inline", value: create(HookConfigSchema, { groups: [group] }) } })],
        }),
        saved("plain"),
      ],
      { values },
    );
    const [notes, triage, plain] = ready(result);
    expect(notes!.values).toEqual({ NOTES_KEY: "n" });
    expect(triage!.values, "never the agent's").toEqual({});
    expect(notes!.bringsOwn).toEqual({ plugins: true, hooks: false, lists: true, mcpServers: false });
    expect(triage!.bringsOwn).toEqual({ plugins: false, hooks: true, lists: false, mcpServers: false });
    expect(plain!.bringsOwn).toEqual({ plugins: false, hooks: false, lists: false, mcpServers: false });
    expect(plain!).toMatchObject({ name: "plain", description: "plain agent", instructions: "You are plain." });
  });

  it("runs its own model only when chosen for this engine and listed by it", async () => {
    const { result } = await run([
      saved("native-pick", { harness: Harness.NATIVE, runConfig: { modelName: "claude-sonnet-4-5" } }),
      saved("unset-pick", { runConfig: { modelName: "claude-sonnet-4-5" } }),
      saved("cursor-pick", { harness: Harness.CURSOR, runConfig: { modelName: "composer-2" } }),
      saved("unlisted", { harness: Harness.NATIVE, runConfig: { modelName: "gpt-9" } }),
    ]);
    expect(ready(result).map((s) => [s.name, s.model])).toEqual([
      ["native-pick", "claude-sonnet-4-5"],
      ["unset-pick", "claude-sonnet-4-5"],
      ["cursor-pick", undefined],
      ["unlisted", undefined],
    ]);
  });

  it("scopes a subagent by its own lists and the turn's, with Agent denied, never the parent agent's", async () => {
    const { result } = await run([saved("release-notes", { tools: ["Read", "Bash"] })], { runSpec: { disallowedTools: ["Bash"] } });
    const scope = ready(result)[0]!.toolScope;
    expect(scope.allowsClaudeTool("Read")).toBe(true);
    expect(scope.allowsClaudeTool("Bash")).toBe(false);
    expect(scope.allowsClaudeTool("Agent")).toBe(false);
  });
});
