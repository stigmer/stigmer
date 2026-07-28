/**
 * Agent detail tour — a single establishing beat of the real `AgentDetailView`
 * on the console's agent page. It sits directly under the YAML listing on
 * `docs/concepts/agents.mdx` ("Here's how this Agent looks in the Stigmer web
 * console"), so the fixture below mirrors that listing field for field.
 *
 * Ported from the `agent-detail` docs inline demo. `index.tsx` renders this
 * step; `.scenar/providers.tsx` supplies the agent fixture the real view
 * fetches.
 */
import { create } from "@bufbuild/protobuf";
import {
  AgentSpecSchema,
  McpServerUsageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The single surface this tour shows (one branch in `renderStep`). */
export type AgentDetailTourStep = { view: "agent-detail" };

/** Slug the fixture agent is published under (the real view fetches it). */
export const DEMO_SLUG = "support-agent";

// ---------------------------------------------------------------------------
// Agent fixture (the real AgentDetailView renders this)
// ---------------------------------------------------------------------------

/**
 * The demo agent returned by the mocked `AgentQueryController.getByReference`
 * (see `.scenar/providers.tsx`). Every rendered field — description,
 * instructions, both skill refs, the MCP server usage with its three tools,
 * the two env declarations, and the public visibility — matches the YAML
 * listing the embed sits under on `docs/concepts/agents.mdx`, so the reader
 * sees exactly the definition they just read.
 *
 * Note this is deliberately NOT `create-agent-tour`'s `buildDemoAgent()`:
 * that tour's story creates a one-skill agent, while this page's listing
 * declares two. The same slug carrying two spec variants is recorded on the
 * depicted-identity debt entry (scenar-cloud project notes).
 */
export function buildDemoAgent() {
  const agent = samples.agent({
    name: DEMO_SLUG,
    org: DEMO_ORG,
    description: "Handles customer support requests.",
    instructions: [
      "You are a customer support agent for Acme Corp.",
      "",
      "Use the company knowledge base to answer product questions.",
      "When customers ask about orders, look up the order details",
      "using the available tools before responding.",
      "",
      "For returns and refunds, always ask for human approval",
      "before processing.",
    ].join("\n"),
  });

  agent.metadata!.visibility = ApiResourceVisibility.visibility_public;

  agent.spec = create(AgentSpecSchema, {
    description: agent.spec!.description,
    instructions: agent.spec!.instructions,
    mcpServerUsages: [
      create(McpServerUsageSchema, {
        mcpServerRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.mcp_server,
          slug: "order-management-api",
        }),
        enabledTools: ["get_order", "list_orders", "process_return"],
        toolApprovalOverrides: [],
      }),
    ],
    skillRefs: [
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "company-knowledge-base",
      }),
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "return-policy",
      }),
    ],
    env: {
      ORDER_API_URL: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "Base URL of the order management API",
      }),
      ORDER_API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "API key for the order management service",
      }),
    },
  });

  return agent;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const agentDetailTourSteps: ScenarioStep<AgentDetailTourStep>[] = [
  {
    // Floor for muted playback; narration extends the beat when it runs
    // longer. Step 0 is interaction-free by rule, so this beat holds a
    // steady establishing frame of the whole page.
    delayMs: 6000,
    data: { view: "agent-detail" },
    // The steady frame doubles as the still on docs/concepts/agents (its
    // <Still id="agent-detail-tour/agent-detail">). That reference is why
    // this tour must stay in the repo even with no <ScenarEmbed> left —
    // verify-scenar-tours invariant 8 holds the two sides together.
    shot: "agent-detail",
    narration:
      "The console shows the whole definition in one place — the instructions, " +
      "both Skills, the MCP server with its enabled tools, and the environment " +
      "variables it needs at runtime.",
  },
];
