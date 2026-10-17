/**
 * `shared/blueprint-resolver.ts`: `mergeSkillRefs`, the one merge of the
 * agent's and the session's skill refs the turn runtime resolves from
 * (`resolveBlueprint`) — union, deduplicated by slug, the session's ref
 * winning a collision (it may pin a different version); and
 * `resolveBlueprint`'s arms:
 *   - a turn that recorded an agent version runs that version's spec, read
 *     through getAgentVersion, even after the agent's head moved and with
 *     the session pointing elsewhere; a recorded version that no longer
 *     resolves fails the turn naming it and never falls back to the head;
 *   - a turn that recorded an agent without a version reads that agent as
 *     it is now, not the session's;
 *   - a turn whose stamp names no agent is the built-in assistant, even in
 *     a session that names and pins one (the stamp is the only route to
 *     the agent): no agent read, empty instructions, no subagents of its
 *     own, and the session's own plugins and refs as the whole tool set.
 *   - a run labelled as an AI judge's runs the built-in judge whatever its
 *     stamp: no agent read, the judge's instruction, and no plugin, skill
 *     ref or subagent, not even the session's own.
 *   - plugins: the agent's and the session's merged one per organization
 *     and slug, the session's reference winning; each read by reference,
 *     a failure failing the turn naming the plugin; each plugin's agents
 *     the turn's plugin subagents as `<plugin>:<agent>`, carrying the
 *     model their file names.
 *   - subagents: each saved agent the version lists, read by reference at
 *     the version its parent pinned; a plugin of a subagent's that the
 *     conversation already lists is the conversation's object, at its
 *     version; a plugin only subagents list is read once, the first
 *     subagent's reference winning; a subagent that cannot be read fails
 *     the turn naming it; a subagent or plugin reference with no slug is
 *     passed over unread.
 *   - excluded plugins: a plugin the run excludes is read but left out of
 *     the turn, by its resolved id, whether the agent, the session or a
 *     subagent lists it, a subagent's copy included whether the turn's
 *     merge already held it or the subagent's reference read it afresh;
 *     its agents are not the turn's; the plugins kept keep their order.
 *
 * `mergeSkillRefs` carried from `skill-writer.test.ts` in #1096, when the
 * native orchestrator's byte-twin of this function was deleted with its
 * module; until then the runtime's copy was tested only through the twin.
 */

import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { mergePluginRefs, mergeSkillRefs, pluginAgentName, pluginSubagents, resolveBlueprint } from "../blueprint-resolver.js";
import { JUDGE_INSTRUCTIONS } from "@stigmer/eval-runtime/judge";
import {
  BUILT_IN_JUDGE_DISALLOWED_TOOLS,
  GRADES_RUN_LABEL,
} from "../builtin-judge.js";

const HASH = "a".repeat(64);

describe("resolveBlueprint", () => {
  it("runs the built-in judge for a judge-labelled run, with nothing of the session's or an agent's", async () => {
    const client = mockStigmerClient({
      getAgent: vi.fn().mockRejectedValue(new Error("no agent may be read")),
      getAgentVersion: vi.fn().mockRejectedValue(new Error("no agent may be read")),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_judge", org: "acme" },
      spec: {
        plugins: [{ org: "acme", slug: "github" }],
        skillRefs: [{ org: "acme", slug: "review" }],
      },
    });

    const blueprint = await resolveBlueprint(
      client,
      session,
      { agentId: "agt_1", agentVersionHash: HASH },
      { [GRADES_RUN_LABEL]: "run_judged" },
    );

    expect(blueprint.agent?.id).toBe("");
    expect(blueprint.agent?.spec.disallowedTools).toEqual([...BUILT_IN_JUDGE_DISALLOWED_TOOLS]);
    expect(blueprint.instructions).toBe(JUDGE_INSTRUCTIONS);
    expect(blueprint.pluginAgents).toEqual([]);
    expect(blueprint.subagents).toEqual([]);
    expect(blueprint.plugins).toEqual([]);
    expect(blueprint.mergedSkillRefs).toEqual([]);
    expect(client.getPluginByReference).not.toHaveBeenCalled();
    expect(client.getAgentByReference).not.toHaveBeenCalled();
  });

  it("runs the recorded version's spec after the head moved, never the head or the session's agent", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        create(AgentVersionEntrySchema, {
          versionHash: HASH,
          specSnapshot: {
            instructions: "You review pull requests, version one.",
            skillRefs: [{ org: "acme", slug: "review" }],
          },
        }),
      ),
      getAgent: vi.fn().mockRejectedValue(new Error("the head must not be read")),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_3", org: "acme" },
      spec: { agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "repointed" } },
      status: { agentId: "agt_repointed", agentVersionHash: "b".repeat(64) },
    });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.agent).toMatchObject({ id: "agt_1", versionHash: HASH });
    expect(blueprint.instructions).toBe("You review pull requests, version one.");
    expect(blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["review"]);
    expect(client.getAgentVersion).toHaveBeenCalledWith("agt_1", HASH);
    expect(client.getAgent).not.toHaveBeenCalled();
  });

  it("fails the turn naming a recorded version that no longer resolves, keeping its status code", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi
        .fn()
        .mockRejectedValue(new ConnectError("agent version not found", Code.NotFound)),
      getAgent: vi.fn().mockRejectedValue(new Error("the head must not be read")),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_4" }, spec: { agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "builder" } } });

    const failure = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {}).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain(`agent agt_1, version ${HASH}`);
    expect(client.getAgent).not.toHaveBeenCalled();
  });

  it("keeps a recorded-version failure that is not a status as its message, naming the version", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockRejectedValue(new Error("socket hang up")),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_6" }, spec: { agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "builder" } } });

    const failure = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {}).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toContain(`agent agt_1, version ${HASH}`);
    expect((failure as Error).message).toContain("socket hang up");
  });

  it("reads a recorded agent with no version as it is now, not the session's agent", async () => {
    const client = mockStigmerClient({
      getAgent: vi.fn().mockResolvedValue(
        create(AgentSchema, { metadata: { id: "agt_1" }, spec: { instructions: "Unversioned." } }),
      ),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_5" },
      spec: { agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "other" } },
      status: { agentId: "agt_other" },
    });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: "" }, {});

    expect(blueprint.agent).toMatchObject({ id: "agt_1", versionHash: "" });
    expect(blueprint.instructions).toBe("Unversioned.");
    expect(client.getAgent).toHaveBeenCalledWith("agt_1");
    expect(client.getAgent).toHaveBeenCalledTimes(1);
  });

  it("merges the stamped version's tools with the session's own", async () => {
    const client = mockStigmerClient({
      getPluginByReference: vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug)),
      getAgentVersion: vi.fn().mockResolvedValue(
        create(AgentVersionEntrySchema, {
          versionHash: HASH,
          specSnapshot: {
            instructions: "You build things.",
            plugins: [{ org: "acme", slug: "github" }],
            skillRefs: [{ org: "acme", slug: "release" }],
          },
        }),
      ),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_1", org: "acme" },
      spec: {
        agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "builder" },
        plugins: [{ org: "acme", slug: "notes" }],
      },
    });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.agent?.id).toBe("agt_1");
    expect(blueprint.instructions).toBe("You build things.");
    expect(blueprint.plugins.map((plugin) => plugin.metadata?.name)).toEqual(["github", "notes"]);
    expect(blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["release"]);
  });

  it.each([
    ["an empty stamp", { agentId: "", agentVersionHash: "" }],
    ["no stamp", undefined],
  ] as const)(
    "answers the built-in assistant for %s, even in a session that pins an agent: no agent read, the session's tools alone",
    async (_label, recorded) => {
      const client = mockStigmerClient({
        getAgent: vi.fn().mockRejectedValue(new Error("must not be reached")),
        getAgentVersion: vi.fn().mockRejectedValue(new Error("must not be reached")),
        getPluginByReference: vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug, ["drafter"])),
      });
      const session = create(SessionSchema, {
        metadata: { id: "ses_2", org: "acme" },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "builder" },
          plugins: [{ org: "acme", slug: "notes" }],
          skillRefs: [{ org: "acme", slug: "writing" }],
        },
        status: { agentId: "agt_pinned", agentVersionHash: HASH },
      });

      const blueprint = await resolveBlueprint(client, session, recorded, {});

      expect(blueprint.agent).toBeUndefined();
      expect(blueprint.instructions).toBe("");
      expect(blueprint.pluginAgents.map((agent) => agent.name), "the session's plugins' agents only").toEqual(["notes:drafter"]);
      expect(blueprint.subagents).toEqual([]);
      expect(client.getAgentByReference).not.toHaveBeenCalled();
      expect(blueprint.plugins.map((plugin) => plugin.metadata?.name)).toEqual(["notes"]);
      expect(blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["writing"]);
      expect(client.getAgent).not.toHaveBeenCalled();
      expect(client.getAgentVersion).not.toHaveBeenCalled();
    },
  );
});

/** A plugin as the server answers it: named by its slug, carrying the given agents. */
function pluginNamed(slug: string, agents: string[] = [], org = "acme"): Plugin {
  return create(PluginSchema, {
    metadata: { id: `plg_${slug}`, name: slug, slug, org },
    status: { agents: agents.map((name) => ({ name, description: `${name} agent`, instructions: `You are ${name}.` })) },
  });
}

describe("resolveBlueprint: plugins", () => {
  const agentVersion = (plugins: { org: string; slug: string; version?: string }[]) =>
    create(AgentVersionEntrySchema, {
      versionHash: HASH,
      specSnapshot: { instructions: "x", plugins },
    });

  it("merges one per plugin, the session's reference winning, each read by its own reference", async () => {
    const getPluginByReference = vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        agentVersion([
          { org: "acme", slug: "linear", version: "agent-pin" },
          { org: "acme", slug: "github" },
        ]),
      ),
      getPluginByReference,
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_p", org: "acme" },
      spec: { plugins: [{ org: "acme", slug: "linear", version: "session-pin" }, { org: "acme", slug: "notes" }] },
    });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.plugins.map((plugin) => plugin.metadata?.name)).toEqual(["linear", "github", "notes"]);
    const asked = getPluginByReference.mock.calls.map(([ref]) => `${ref.slug}@${ref.version}`);
    expect(asked).toEqual(["linear@session-pin", "github@", "notes@"]);
  });

  it("names each plugin's agents <plugin>:<agent>, with the plugin's tool lists and the model its file names", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(agentVersion([{ org: "acme", slug: "review" }])),
      getPluginByReference: vi.fn(async () =>
        create(PluginSchema, {
          metadata: { id: "plg_review", name: "review", slug: "review", org: "acme" },
          status: {
            agents: [
              { name: "security", description: "Finds holes.", instructions: "Look.", tools: ["Read"], disallowedTools: ["Bash"], skills: ["owasp"], model: "claude-sonnet-4-5" },
              { name: "quick", description: "Quick looks.", instructions: "Glance." },
            ],
          },
        }),
      ),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_a", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.pluginAgents).toEqual([
      {
        name: "review:security",
        description: "Finds holes.",
        instructions: "Look.",
        tools: ["Read"],
        disallowedTools: ["Bash"],
        model: "claude-sonnet-4-5",
      },
      { name: "review:quick", description: "Quick looks.", instructions: "Glance.", tools: [], disallowedTools: [], model: "" },
    ]);
    expect(blueprint.subagents).toEqual([]);
  });

  it("fails the turn naming a plugin that cannot be read, keeping its status code", async () => {
    const client = mockStigmerClient({
      getPluginByReference: vi.fn().mockRejectedValue(new ConnectError("plugin not found", Code.NotFound)),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_f", org: "acme" }, spec: { plugins: [{ org: "acme", slug: "gone" }] } });

    const failure = await resolveBlueprint(client, session, undefined, {}).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain("the plugin 'gone'");
    expect((failure as ConnectError).rawMessage).toContain("plugin not found");
  });

  it("names the plugin when a read fails with no status", async () => {
    const client = mockStigmerClient({ getPluginByReference: vi.fn().mockRejectedValue(new Error("socket hang up")) });
    const session = create(SessionSchema, { metadata: { id: "ses_g", org: "acme" }, spec: { plugins: [{ org: "acme", slug: "flaky" }] } });

    const failure = await resolveBlueprint(client, session, undefined, {}).catch((e: unknown) => e);

    expect(failure).not.toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toContain("the plugin 'flaky'");
    expect((failure as Error).message).toContain("socket hang up");
  });

});

describe("resolveBlueprint: subagents", () => {
  const PIN = "c".repeat(64);
  const OTHER_PIN = "d".repeat(64);

  /** The parent's version: its plugins and the subagents it pinned at save. */
  const parentVersion = (
    plugins: { org: string; slug: string; version?: string }[],
    subagents: { org: string; slug: string; version: string }[],
  ) =>
    create(AgentVersionEntrySchema, {
      versionHash: HASH,
      specSnapshot: {
        instructions: "You open pull requests.",
        plugins,
        subagents: subagents.map((ref) => ({ kind: ApiResourceKind.agent, ...ref })),
      },
    });

  /** A saved agent as the reference read answers it. */
  const savedAgent = (slug: string, plugins: { org?: string; slug: string; version?: string }[] = [], org = "acme") =>
    create(AgentSchema, {
      metadata: { id: `agt_${slug}`, name: slug, slug, org },
      spec: { description: `${slug} agent`, instructions: `You are ${slug}.`, plugins },
    });

  it("reads each subagent by reference at the version its parent pinned, in the parent's order", async () => {
    const getAgentByReference = vi.fn(async (ref: ApiResourceReference) => savedAgent(ref.slug));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        parentVersion([], [
          { org: "acme", slug: "release-notes", version: PIN },
          { org: "acme", slug: "triage", version: OTHER_PIN },
        ]),
      ),
      getAgentByReference,
    });
    const session = create(SessionSchema, { metadata: { id: "ses_sub", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(getAgentByReference.mock.calls.map(([ref]) => `${ref.org}/${ref.slug}@${ref.version}`)).toEqual([
      `acme/release-notes@${PIN}`,
      `acme/triage@${OTHER_PIN}`,
    ]);
    expect(blueprint.subagents.map((s) => ({ name: s.name, agentId: s.agentId, versionHash: s.versionHash }))).toEqual([
      { name: "release-notes", agentId: "agt_release-notes", versionHash: PIN },
      { name: "triage", agentId: "agt_triage", versionHash: OTHER_PIN },
    ]);
    expect(blueprint.subagents[0]?.spec.instructions).toBe("You are release-notes.");
    expect(blueprint.pluginAgents, "a subagent is no plugin agent").toEqual([]);
  });

  it("hands a subagent the conversation's own plugin object when it lists the same plugin, at the conversation's version", async () => {
    const getPluginByReference = vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        parentVersion([{ org: "acme", slug: "github", version: "parent-pin" }], [{ org: "acme", slug: "release-notes", version: PIN }]),
      ),
      getAgentByReference: vi.fn(async (ref: ApiResourceReference) => savedAgent(ref.slug, [{ slug: "github", version: "own-pin" }])),
      getPluginByReference,
    });
    const session = create(SessionSchema, { metadata: { id: "ses_shared", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.subagents[0]?.plugins[0], "the very object the conversation runs").toBe(blueprint.plugins[0]);
    expect(getPluginByReference.mock.calls.map(([ref]) => `${ref.slug}@${ref.version}`), "read once, at the conversation's pin").toEqual([
      "github@parent-pin",
    ]);
  });

  it("reads a plugin only subagents list once, the first subagent's reference winning, under the subagent's organization", async () => {
    const getPluginByReference = vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug, [], ref.org));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        parentVersion([], [
          { org: "acme", slug: "release-notes", version: PIN },
          { org: "acme", slug: "triage", version: OTHER_PIN },
        ]),
      ),
      getAgentByReference: vi.fn(async (ref: ApiResourceReference) =>
        savedAgent(ref.slug, [{ slug: "changelog", version: ref.slug === "release-notes" ? "first-pin" : "second-pin" }]),
      ),
      getPluginByReference,
    });
    const session = create(SessionSchema, { metadata: { id: "ses_once", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(getPluginByReference.mock.calls.map(([ref]) => `${ref.org}/${ref.slug}@${ref.version}`)).toEqual(["acme/changelog@first-pin"]);
    expect(blueprint.subagents[1]?.plugins[0]).toBe(blueprint.subagents[0]?.plugins[0]);
    expect(blueprint.plugins, "a subagent's plugin is not the conversation's").toEqual([]);
    expect(blueprint.pluginAgents, "nor are its plugin's agents offered to the main agent").toEqual([]);
  });

  it("passes over a subagent reference, and a subagent's plugin reference, that names no slug", async () => {
    const getAgentByReference = vi.fn(async (ref: ApiResourceReference) => savedAgent(ref.slug, [{ slug: "" }, { slug: "changelog" }]));
    const getPluginByReference = vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug, [], ref.org));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(
        parentVersion([], [
          { org: "acme", slug: "", version: PIN },
          { org: "acme", slug: "release-notes", version: PIN },
        ]),
      ),
      getAgentByReference,
      getPluginByReference,
    });
    const session = create(SessionSchema, { metadata: { id: "ses_blank", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(getAgentByReference.mock.calls.map(([ref]) => ref.slug), "a reference with no slug is never read").toEqual(["release-notes"]);
    expect(blueprint.subagents.map((s) => s.name)).toEqual(["release-notes"]);
    expect(getPluginByReference.mock.calls.map(([ref]) => ref.slug)).toEqual(["changelog"]);
    expect(blueprint.subagents[0]?.plugins.map((p) => p.metadata?.slug)).toEqual(["changelog"]);
  });

  it("fails the turn naming a subagent that cannot be read, keeping its status code", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(parentVersion([], [{ org: "acme", slug: "release-notes", version: PIN }])),
      getAgentByReference: vi.fn().mockRejectedValue(new ConnectError("agent not found", Code.NotFound)),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_gone", org: "acme" }, spec: {} });

    const failure = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {}).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain("the subagent 'release-notes'");
    expect((failure as ConnectError).rawMessage).toContain("agent not found");
  });

  it("names the subagent when its read fails with no status", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(parentVersion([], [{ org: "acme", slug: "release-notes", version: PIN }])),
      getAgentByReference: vi.fn().mockRejectedValue(new Error("socket hang up")),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_flaky", org: "acme" }, spec: {} });

    const failure = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {}).catch((e: unknown) => e);

    expect(failure).not.toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toContain("the subagent 'release-notes'");
    expect((failure as Error).message).toContain("socket hang up");
  });
});

describe("resolveBlueprint: excluded plugins", () => {
  const PIN = "c".repeat(64);

  /** The agent's version: its plugins and the subagents it pinned. */
  const agentVersion = (plugins: { org: string; slug: string }[], subagents: string[] = []) =>
    create(AgentVersionEntrySchema, {
      versionHash: HASH,
      specSnapshot: {
        instructions: "x",
        plugins,
        subagents: subagents.map((slug) => ({ kind: ApiResourceKind.agent, org: "acme", slug, version: PIN })),
      },
    });

  /** A client whose agent lists `plugins` and `subagents`, each subagent listing `subagentPlugins`. */
  function clientFor(plugins: { org: string; slug: string }[], subagents: string[] = [], subagentPlugins: { slug: string }[] = []) {
    const getPluginByReference = vi.fn(async (ref: ApiResourceReference) => pluginNamed(ref.slug, [`${ref.slug}-helper`]));
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(agentVersion(plugins, subagents)),
      getAgentByReference: vi.fn(async (ref: ApiResourceReference) =>
        create(AgentSchema, { metadata: { id: `agt_${ref.slug}`, slug: ref.slug, org: "acme" }, spec: { plugins: subagentPlugins } }),
      ),
      getPluginByReference,
    });
    return { client, getPluginByReference };
  }

  const STAMP = { agentId: "agt_1", agentVersionHash: HASH };

  it("leaves out an excluded plugin the agent or the session lists, still reading it, keeping the others in order", async () => {
    const { client, getPluginByReference } = clientFor([
      { org: "acme", slug: "linear" },
      { org: "acme", slug: "github" },
    ]);
    const session = create(SessionSchema, { metadata: { id: "ses_x", org: "acme" }, spec: { plugins: [{ org: "acme", slug: "notes" }] } });

    const withoutLinear = await resolveBlueprint(client, session, STAMP, {}, ["plg_linear"]);
    expect(withoutLinear.plugins.map((p) => p.metadata?.slug)).toEqual(["github", "notes"]);
    expect(withoutLinear.pluginAgents.map((a) => a.name)).toEqual(["github:github-helper", "notes:notes-helper"]);
    expect(getPluginByReference.mock.calls.map(([ref]) => ref.slug), "an excluded plugin is still read").toContain("linear");

    const withoutNotes = await resolveBlueprint(client, session, STAMP, {}, ["plg_notes"]);
    expect(withoutNotes.plugins.map((p) => p.metadata?.slug)).toEqual(["linear", "github"]);
  });

  it("leaves an excluded plugin out of a subagent that shares the turn's copy, and out of one that reads its own", async () => {
    const shared = clientFor([{ org: "acme", slug: "linear" }], ["triage"], [{ slug: "linear" }]);
    const session = create(SessionSchema, { metadata: { id: "ses_s", org: "acme" }, spec: {} });
    const sharedBlueprint = await resolveBlueprint(shared.client, session, STAMP, {}, ["plg_linear"]);
    expect(sharedBlueprint.plugins).toEqual([]);
    expect(sharedBlueprint.subagents[0]?.plugins).toEqual([]);

    const own = clientFor([], ["triage"], [{ slug: "linear" }, { slug: "changelog" }]);
    const ownBlueprint = await resolveBlueprint(own.client, session, STAMP, {}, ["plg_linear"]);
    expect(own.getPluginByReference.mock.calls.map(([ref]) => ref.slug), "the subagent's own reference is read").toEqual([
      "linear",
      "changelog",
    ]);
    expect(ownBlueprint.subagents[0]?.plugins.map((p) => p.metadata?.slug)).toEqual(["changelog"]);
  });

  it("runs every plugin when the run excludes none, or only plugins the turn does not list", async () => {
    const { client } = clientFor([{ org: "acme", slug: "linear" }], ["triage"], [{ slug: "changelog" }]);
    const session = create(SessionSchema, { metadata: { id: "ses_n", org: "acme" }, spec: {} });
    for (const excluded of [[], ["plg_other"]]) {
      const blueprint = await resolveBlueprint(client, session, STAMP, {}, excluded);
      expect(blueprint.plugins.map((p) => p.metadata?.slug), excluded.join()).toEqual(["linear"]);
      expect(blueprint.subagents[0]?.plugins.map((p) => p.metadata?.slug), excluded.join()).toEqual(["changelog"]);
    }
  });
});

describe("mergePluginRefs", () => {
  it("keys a reference by organization and slug, an empty organization being the session's", () => {
    const merged = mergePluginRefs(
      [makeRef("linear", ""), makeRef("linear", "other-org")],
      [makeRef("linear", "acme")],
      "acme",
    );
    expect(merged.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(["acme/linear", "other-org/linear"]);
  });

  it("skips a reference with no slug", () => {
    expect(mergePluginRefs([makeRef("")], [], "acme")).toEqual([]);
  });

  it("keys a reference that holds an id by its id, so one plugin named twice is one entry", () => {
    const merged = mergePluginRefs(
      [makeRef("linear", "acme", "plg_1")],
      [makeRef("linear", "acme", "plg_1"), makeRef("linear-two", "acme", "plg_2")],
      "acme",
    );
    expect(merged.map((ref) => ref.id)).toEqual(["plg_1", "plg_2"]);
  });

  it("leaves out a plugin that was deleted (an id the server named with no slug), with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(mergePluginRefs([makeRef("", "acme", "plg_gone")], [], "acme")).toEqual([]);
      expect(warn.mock.calls[0]?.[0]).toContain("acme/plg_gone");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("pluginSubagents", () => {
  it("names a plugin's agent as Claude Code does", () => {
    expect(pluginAgentName("review", "security")).toBe("review:security");
    expect(pluginSubagents(pluginNamed("review", ["a", "b"])).map((agent) => agent.name)).toEqual(["review:a", "review:b"]);
  });
});

function makeRef(slug: string, org = "test-org", id = ""): ApiResourceReference {
  return { slug, org, id, $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference" } as ApiResourceReference;
}

describe("mergeSkillRefs", () => {
  it("returns empty for no refs", () => {
    expect(mergeSkillRefs([], [])).toEqual([]);
  });

  it("returns the agent's refs when the session names none", () => {
    const result = mergeSkillRefs([makeRef("skill-a"), makeRef("skill-b")], []);
    expect(result.map((r) => r.slug)).toEqual(["skill-a", "skill-b"]);
  });

  it("deduplicates by slug with the session's ref winning", () => {
    const result = mergeSkillRefs([makeRef("skill-a", "org1")], [makeRef("skill-a", "org2")]);
    expect(result).toHaveLength(1);
    expect(result[0].org).toBe("org2");
  });

  it("unions distinct skills from both sources", () => {
    expect(mergeSkillRefs([makeRef("skill-a")], [makeRef("skill-b")])).toHaveLength(2);
  });

  it("ignores a ref with no slug (nothing to key it by)", () => {
    expect(mergeSkillRefs([makeRef("")], [])).toEqual([]);
  });
});
