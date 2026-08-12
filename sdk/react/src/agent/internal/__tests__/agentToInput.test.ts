import { describe, it, expect } from "vitest";
import { create, equals, isFieldSet, toJson } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { buildAgentProto } from "@stigmer/sdk";
import { agentToInput } from "../agentToInput";

/**
 * Regression guard for stigmer/stigmer#319 — the console agent editor
 * silently deleting an unmapped spec field on save.
 *
 * `agentToInput()` reconstructs a full `AgentInput` from a fetched Agent
 * so inline edits can re-submit the whole spec (the backend does full
 * spec replacement). Any spec field the converter does not map is
 * therefore *cleared* by the next console edit. Two tests enforce the
 * converter's "must be kept exhaustive" contract:
 *
 * 1. The round-trip test proves no field of the fixture below survives
 *    conversion distorted or dropped.
 * 2. The tripwire test proves the fixture itself covers every
 *    `AgentSpec` field, via schema reflection. When a new proto field
 *    lands, the tripwire fails until the fixture sets it — and the
 *    round-trip then fails until `agentToInput()` maps it.
 *
 * Nested messages are covered by population, not reflection: every
 * sub-field of the fixture (ref `version` pins, approval overrides,
 * sub-agent grants, env metadata) must carry a non-default value so the
 * round-trip comparison can catch its loss.
 */
function fullyPopulatedAgent(): Agent {
  return create(AgentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: {
      id: "agt_test",
      name: "Clinic Assistant",
      slug: "clinic-assistant",
      org: "acme",
      labels: { team: "care-ops" },
    },
    spec: {
      description: "Front-desk assistant for the clinic pilot.",
      iconUrl: "https://example.com/clinic.svg",
      instructions: "You are a careful clinic assistant. Verify identity first.",
      mcpServerUsages: [
        {
          mcpServerRef: {
            org: "acme",
            slug: "github",
            kind: ApiResourceKind.mcp_server,
          },
          enabledTools: ["create_issue", "search_issues"],
          toolApprovalOverrides: [
            {
              toolName: "create_issue",
              requiresApproval: true,
              message: "Create issue {{args.title}}?",
            },
          ],
        },
      ],
      skillRefs: [
        {
          org: "acme",
          slug: "triage-guide",
          kind: ApiResourceKind.skill,
          // The version pin (tag or hash) must survive conversion — a
          // dropped pin silently resets the skill to "latest".
          version: "stable",
        },
      ],
      subAgents: [
        {
          name: "researcher",
          description: "Looks up prior cases",
          instructions: "Research thoroughly before answering anything.",
          mcpAccess: [{ mcpServer: "github", enabledTools: ["search_issues"] }],
          skillRefs: [
            {
              org: "acme",
              slug: "research-methods",
              kind: ApiResourceKind.skill,
              version: "v1.2",
            },
          ],
          modelOverride: "claude-sonnet",
        },
      ],
      env: {
        CLINIC_API_KEY: {
          isSecret: true,
          description: "Clinic API credential",
        },
        REGION: { optional: true },
      },
    },
  });
}

describe("agentToInput", () => {
  it("round-trips a fully-populated spec through AgentInput without loss", () => {
    const agent = fullyPopulatedAgent();

    const rebuilt = buildAgentProto(agentToInput(agent));

    // toJson gives a readable structural diff on failure; the protobuf
    // equals() assertion below is the authoritative semantic check.
    expect(toJson(AgentSpecSchema, rebuilt.spec!)).toEqual(
      toJson(AgentSpecSchema, agent.spec!),
    );
    expect(equals(AgentSpecSchema, rebuilt.spec!, agent.spec!)).toBe(true);
  });

  it("round-trips the input-owned metadata fields", () => {
    const agent = fullyPopulatedAgent();

    const rebuilt = buildAgentProto(agentToInput(agent));

    // Only the fields AgentInput owns: id is server-assigned, and
    // visibility is deliberately unmapped (the backend preserves it on
    // omit — see preserveImmutableFields in the update pipeline).
    expect(rebuilt.metadata?.name).toBe(agent.metadata?.name);
    expect(rebuilt.metadata?.org).toBe(agent.metadata?.org);
    expect(rebuilt.metadata?.slug).toBe(agent.metadata?.slug);
    expect(rebuilt.metadata?.labels).toEqual(agent.metadata?.labels);
  });

  it("populates every AgentSpec field in the fixture (new-field tripwire)", () => {
    const spec = fullyPopulatedAgent().spec!;

    const unsetFields = AgentSpecSchema.fields
      .filter((field) => !isFieldSet(spec, field))
      .map((field) => field.name);

    expect(
      unsetFields,
      `AgentSpec gained field(s) [${unsetFields.join(", ")}] that the ` +
        "fixture does not populate. Set them in fullyPopulatedAgent() AND " +
        "map them in agentToInput() — an unmapped spec field is cleared " +
        "by every console inline edit (stigmer/stigmer#319).",
    ).toEqual([]);
  });
});
