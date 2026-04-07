/**
 * Create Agent overview tour — multi-surface preview showing:
 * create agent via conversation → bundled configuration →
 * simplified code → same result.
 *
 * Placed at the top of the "Create your Agent" page inside
 * "What you'll build."
 */

import { create } from "@bufbuild/protobuf";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentSpecSchema,
  McpServerUsageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  EnvironmentSpecSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { TerminalLine } from "../../views/TerminalView";
import { snapshot } from "../../engine/shared";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type CreateAgentTourStep =
  | { view: "agent-creator-typing" }
  | { view: "agent-created"; execution: AgentExecution }
  | { view: "agent-config" }
  | { view: "code-simplified" }
  | { view: "terminal-result" };

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "support-agent";

// ---------------------------------------------------------------------------
// Conversation data (condensed from agent-creation-tour)
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "I want to create a customer support agent. It should use the return-policy " +
    "skill and the order-management-api MCP server.",
);

const ai1 = samples.aiMessage(
  "Done! I've created **support-agent** with:\n\n" +
    "- **Instructions** — Acme Corp support role, direct tone, approval rules\n" +
    "- **Skill** — `return-policy` for domain knowledge\n" +
    "- **MCP Server** — `order-management-api` with `get_order`, `list_orders`, `process_return`\n\n" +
    "The Agent definition is ready as an artifact. Review it and apply to save.",
);

const AGENT_ARTIFACT = (() => {
  const a = samples.artifact("support-agent", ExecutionArtifactKind.FILE);
  return a;
})();

export const agentCreatedExecution = snapshot(
  [user1, ai1],
  ExecutionPhase.EXECUTION_COMPLETED,
  [AGENT_ARTIFACT],
);

// ---------------------------------------------------------------------------
// Agent fixture data (for real AgentDetailView)
// ---------------------------------------------------------------------------

export function buildDemoAgent() {
  const agent = samples.agent({
    name: "support-agent",
    org: DEMO_ORG,
    description:
      "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
    instructions: [
      "You are a customer support agent for Acme Corp.",
      "",
      "Use the company knowledge base to answer product questions.",
      "When customers ask about orders, look up the order details",
      "using the available tools before responding.",
      "",
      "For returns and refunds, always ask for human approval",
      "before processing. Never process a refund without approval.",
      "",
      "Be direct and concise.",
    ].join("\n"),
  });

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
        slug: "return-policy",
      }),
    ],
    envSpec: create(EnvironmentSpecSchema, {
      data: {
        ORDER_API_URL: create(EnvironmentValueSchema, {
          isSecret: false,
          description: "Base URL of the order management API",
        }),
        ORDER_API_KEY: create(EnvironmentValueSchema, {
          isSecret: true,
          description: "API key for authenticating with the order management service",
        }),
      },
    }),
  });

  return agent;
}

// ---------------------------------------------------------------------------
// Code snippet
// ---------------------------------------------------------------------------

export const SIMPLIFIED_CODE = [
  "// ask-agent.ts — Reference by name",
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const agent = await stigmer.agent.getByReference({",
  '  org: "my-org",',
  '  slug: "support-agent",',
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  "  agentInstanceId: agent.status!.defaultInstanceId,",
  "});",
];

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

export const RESULT_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "Order #ORD-4821 has been shipped." },
  { type: "blank", text: "" },
  { type: "output", text: "- Item: Wireless Headphones (1x $79.99)" },
  { type: "output", text: "- Tracking: 1Z999AA10123456784" },
  { type: "output", text: "- Estimated delivery: April 5, 2026" },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const createAgentTourSteps: ScenarioStep<CreateAgentTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "agent-creator-typing" },
    caption: "Describe your agent to the Agent Creator",
    narration:
      "Tell the Agent Creator what your agent does and which Skills and tools it needs.",
  },
  {
    delayMs: 3000,
    data: { view: "agent-created", execution: agentCreatedExecution },
    caption: "Agent definition generated",
    narration:
      "The creator bundles everything — instructions, Skills, and MCP servers — into one Agent definition.",
  },
  {
    delayMs: 3500,
    data: { view: "agent-config" },
    caption: "Everything in one place",
    narration:
      "Instructions define the role. Skills provide knowledge. Tools give it hands. All bundled under one name.",
  },
  {
    delayMs: 3500,
    data: { view: "code-simplified" },
    caption: "One lookup replaces a shopping list",
    narration:
      "No more listing every Skill and MCP server. Get the agent by name. That's it.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-result" },
    caption: "Same result — cleaner code",
    narration:
      "The behavior is identical. But your code is simpler, and the Agent owns its configuration.",
  },
];
