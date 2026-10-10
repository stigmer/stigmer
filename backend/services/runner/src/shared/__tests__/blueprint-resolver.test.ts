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
 *     the agent): no agent read, empty instructions, no sub-agents of its
 *     own, and the session's own plugins and refs as the whole tool set.
 *   - a run labelled as an AI judge's runs the built-in judge whatever its
 *     stamp: no agent read, the judge's instruction, and no plugin, skill
 *     ref or sub-agent, not even the session's own.
 *   - plugins: the agent's and the session's merged one per organization
 *     and slug, the session's reference winning; each read by reference,
 *     a failure failing the turn naming the plugin; each plugin's agents
 *     joining the sub-agents as `<plugin>:<agent>` after the agent's own.
 *
 * `mergeSkillRefs` carried from `skill-writer.test.ts` in #1096, when the
 * native orchestrator's byte-twin of this function was deleted with its
 * module; until then the runtime's copy was tested only through the twin.
 */

import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { mergePluginRefs, mergeSkillRefs, pluginAgentName, pluginSubAgents, resolveBlueprint } from "../blueprint-resolver.js";
import {
  BUILT_IN_JUDGE_DISALLOWED_TOOLS,
  BUILT_IN_JUDGE_INSTRUCTIONS,
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
    expect(blueprint.instructions).toBe(BUILT_IN_JUDGE_INSTRUCTIONS);
    expect(blueprint.subAgents).toEqual([]);
    expect(blueprint.plugins).toEqual([]);
    expect(blueprint.mergedSkillRefs).toEqual([]);
    expect(client.getPluginByReference).not.toHaveBeenCalled();
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
      expect(blueprint.subAgents.map((subAgent) => subAgent.name), "the session's plugins' agents only").toEqual(["notes:drafter"]);
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
      specSnapshot: { instructions: "x", plugins, subAgents: [{ name: "reviewer", instructions: "Review." }] },
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

  it("names each plugin's agents <plugin>:<agent>, after the agent's own sub-agents, with the plugin's tool lists", async () => {
    const client = mockStigmerClient({
      getAgentVersion: vi.fn().mockResolvedValue(agentVersion([{ org: "acme", slug: "review" }])),
      getPluginByReference: vi.fn(async () =>
        create(PluginSchema, {
          metadata: { id: "plg_review", name: "review", slug: "review", org: "acme" },
          status: {
            agents: [{ name: "security", description: "Finds holes.", instructions: "Look.", tools: ["Read"], disallowedTools: ["Bash"], skills: ["owasp"] }],
          },
        }),
      ),
    });
    const session = create(SessionSchema, { metadata: { id: "ses_a", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.subAgents.map((subAgent) => subAgent.name)).toEqual(["reviewer", "review:security"]);
    const security = blueprint.subAgents[1];
    expect(security?.description).toBe("Finds holes.");
    expect(security?.instructions).toBe("Look.");
    expect(security?.tools).toEqual(["Read"]);
    expect(security?.disallowedTools).toEqual(["Bash"]);
    expect(security?.skillRefs, "a plugin agent's skills are the plugin's, mounted by the skills phase").toEqual([]);
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

  it("keeps the agent spec's own sub-agent list when the plugins add none", async () => {
    const version = agentVersion([]);
    const client = mockStigmerClient({ getAgentVersion: vi.fn().mockResolvedValue(version) });
    const session = create(SessionSchema, { metadata: { id: "ses_s", org: "acme" }, spec: {} });

    const blueprint = await resolveBlueprint(client, session, { agentId: "agt_1", agentVersionHash: HASH }, {});

    expect(blueprint.subAgents).toBe(blueprint.agent?.spec.subAgents);
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
});

describe("pluginSubAgents", () => {
  it("names a plugin's agent as Claude Code does", () => {
    expect(pluginAgentName("review", "security")).toBe("review:security");
    expect(pluginSubAgents(pluginNamed("review", ["a", "b"])).map((subAgent) => subAgent.name)).toEqual(["review:a", "review:b"]);
  });
});

function makeRef(slug: string, org = "test-org"): ApiResourceReference {
  return { slug, org, $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference" } as ApiResourceReference;
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
