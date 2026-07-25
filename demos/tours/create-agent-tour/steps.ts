/**
 * Create Agent overview tour — a multi-surface walkthrough: describe an agent
 * to the Agent Creator, see the bundled definition, inspect it in the real
 * `AgentDetailView`, then reference it in code and run it.
 *
 * Ported from the docs inline demo to a hosted Scenar tour. `index.tsx` renders
 * these steps; `.scenar/providers.tsx` supplies the agent fixture the real
 * components fetch.
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
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG, snapshot } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type CreateAgentTourStep =
  | { view: "agent-creator-typing" }
  | { view: "agent-created"; execution: AgentExecution }
  | { view: "agent-config" }
  | { view: "code-simplified" }
  | { view: "terminal-result" };

/** Slug the fixture agent is published under (the real view fetches it). */
export const DEMO_SLUG = "support-agent";

// ---------------------------------------------------------------------------
// Conversation fixture (the "agent created" step)
// ---------------------------------------------------------------------------

const userMessage = samples.humanMessage(
  "I want to create a customer support agent. It should use the return-policy " +
    "skill and the order-management-api MCP server.",
);

const aiMessage = samples.aiMessage(
  "Done! I've created **support-agent** with:\n\n" +
    "- **Instructions** — Acme Corp support role, direct tone, approval rules\n" +
    "- **Skill** — `return-policy` for domain knowledge\n" +
    "- **MCP Server** — `order-management-api` with `get_order`, `list_orders`, `process_return`\n\n" +
    "The Agent definition is ready as an artifact. Review it and apply to save.",
);

const agentArtifact = samples.artifact("support-agent", ExecutionArtifactKind.FILE);

export const agentCreatedExecution = snapshot(
  [userMessage, aiMessage],
  ExecutionPhase.EXECUTION_COMPLETED,
  [agentArtifact],
);

// ---------------------------------------------------------------------------
// Agent fixture (the real AgentDetailView renders this)
// ---------------------------------------------------------------------------

/**
 * The demo agent returned by the mocked `AgentQueryController.getByReference`
 * (see `.scenar/providers.tsx`). Its spec bundles a skill, an MCP server with
 * enabled tools, and two env var declarations — the configuration
 * `AgentDetailView` shows "all in one place."
 */
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
    env: {
      ORDER_API_URL: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "Base URL of the order management API",
      }),
      ORDER_API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "API key for authenticating with the order management service",
      }),
    },
  });

  return agent;
}

// ---------------------------------------------------------------------------
// Code + terminal fixtures
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
// Timeline
// ---------------------------------------------------------------------------

export const createAgentTourSteps: ScenarioStep<CreateAgentTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "agent-creator-typing" },
    narration:
      "Tell the Agent Creator what your agent does and which Skills and tools it needs.",
  },
  {
    delayMs: 3000,
    data: { view: "agent-created", execution: agentCreatedExecution },
    narration:
      "The creator bundles everything — instructions, Skills, and MCP servers — into one Agent definition.",
  },
  {
    delayMs: 3500,
    data: { view: "agent-config" },
    narration:
      "Instructions define the role. Skills provide knowledge. Tools give it hands. All bundled under one name.",
  },
  {
    delayMs: 3500,
    data: { view: "code-simplified" },
    narration:
      "No more listing every Skill and MCP server. Get the agent by name. That's it.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-result" },
    narration:
      "The behavior is identical. But your code is simpler, and the Agent owns its configuration.",
  },
];
