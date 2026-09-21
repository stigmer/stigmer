/**
 * `shared/blueprint-resolver.ts`: `mergeSkillRefs`, the one merge of the
 * agent's and the session's skill refs the turn runtime resolves from
 * (`resolveBlueprint`) — union, deduplicated by slug, the session's ref
 * winning a collision (it may pin a different version); and
 * `resolveBlueprint`'s two arms: the agent chain walked when the session
 * names an instance, and the built-in assistant when it does not — no
 * instance or agent read, empty instructions, no sub-agents, and the
 * session's own usages and refs as the whole tool set.
 *
 * `mergeSkillRefs` carried from `skill-writer.test.ts` in #1096, when the
 * native orchestrator's byte-twin of this function was deleted with its
 * module; until then the runtime's copy was tested only through the twin.
 */

import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { mergeSkillRefs, resolveBlueprint } from "../blueprint-resolver.js";

describe("resolveBlueprint", () => {
  it("walks session -> instance -> agent and merges with the session's tools", async () => {
    const client = mockStigmerClient({
      getAgentInstance: vi.fn().mockResolvedValue(
        create(AgentInstanceSchema, { metadata: { id: "agi_1" }, spec: { agentId: "agt_1" } }),
      ),
      getAgent: vi.fn().mockResolvedValue(
        create(AgentSchema, {
          metadata: { id: "agt_1", name: "builder" },
          spec: {
            instructions: "You build things.",
            mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "github" } }],
            skillRefs: [{ org: "acme", slug: "release" }],
          },
        }),
      ),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_1", org: "acme" },
      spec: {
        agentInstanceId: "agi_1",
        mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "notes" } }],
      },
    });

    const blueprint = await resolveBlueprint(client, session);

    expect(blueprint.agent?.metadata?.id).toBe("agt_1");
    expect(blueprint.instructions).toBe("You build things.");
    expect(blueprint.mergedMcpServerUsages.map((u) => u.mcpServerRef?.slug).sort()).toEqual(["github", "notes"]);
    expect(blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["release"]);
    expect(client.getAgentInstance).toHaveBeenCalledWith("agi_1");
    expect(client.getAgent).toHaveBeenCalledWith("agt_1");
  });

  it("answers the built-in assistant for a session with no instance: no agent read, the session's tools alone", async () => {
    const client = mockStigmerClient({
      getAgentInstance: vi.fn().mockRejectedValue(new Error("must not be reached")),
      getAgent: vi.fn().mockRejectedValue(new Error("must not be reached")),
    });
    const session = create(SessionSchema, {
      metadata: { id: "ses_2", org: "acme" },
      spec: {
        agentInstanceId: "",
        mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "notes" } }],
        skillRefs: [{ org: "acme", slug: "writing" }],
      },
    });

    const blueprint = await resolveBlueprint(client, session);

    expect(blueprint.agent).toBeUndefined();
    expect(blueprint.instructions).toBe("");
    expect(blueprint.subAgents).toEqual([]);
    expect(blueprint.mergedMcpServerUsages.map((u) => u.mcpServerRef?.slug)).toEqual(["notes"]);
    expect(blueprint.mergedSkillRefs.map((r) => r.slug)).toEqual(["writing"]);
    expect(client.getAgentInstance).not.toHaveBeenCalled();
    expect(client.getAgent).not.toHaveBeenCalled();
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
