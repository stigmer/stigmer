/**
 * Agent creation tour for "Add your Agent".
 *
 * 12-step playback: sidebar → Library → Agents list →
 * Add Agent → Session Composer → conversation with
 * Agent Creator → artifact preview → apply → back to Library
 * with the new agent.
 */

import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type AgentCreationStep =
  | { view: "library-click" }
  | { view: "agents-list" }
  | { view: "create-agent-click" }
  | { view: "composer-ready" }
  | { view: "conversation"; execution: AgentExecution }
  | { view: "artifact-click"; execution: AgentExecution }
  | { view: "artifact-preview"; execution: AgentExecution }
  | { view: "apply-agent"; execution: AgentExecution }
  | { view: "library-complete" };

// ---------------------------------------------------------------------------
// Conversation messages
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "I want to create a customer support agent. It should use the return-policy " +
    "skill and the order-management-api MCP server.",
);

const ai1 = samples.aiMessage(
  "I'll create a support agent with those resources. A few questions:\n\n" +
    "1. **Role** — what should the agent introduce itself as?\n" +
    "2. **Behavior rules** — any actions that need human approval?\n" +
    "3. **Tone** — formal, casual, or direct?",
);

const user2 = samples.humanMessage(
  "It's a customer support agent for Acme Corp. Direct and concise tone. " +
    "Returns and refunds always need human approval before processing. " +
    "It should look up order details using the tools before answering " +
    "order questions.",
);

const ai2 = samples.aiMessage(
  "Done! I've created **support-agent** with:\n\n" +
    "- **Instructions** — Acme Corp support role, direct tone, approval rules\n" +
    "- **Skill** — `return-policy` for domain knowledge\n" +
    "- **MCP Server** — `order-management-api` with `get_order`, `list_orders`, `process_return`\n\n" +
    "The Agent definition is ready as an artifact. Review it and apply to save.",
);

// ---------------------------------------------------------------------------
// Artifact content — Agent YAML
// ---------------------------------------------------------------------------

export const AGENT_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: support-agent
  org: acme
spec:
  description: >-
    Handles customer support requests — answers questions
    using company knowledge, looks up orders, and processes
    returns with human approval.
  instructions: |
    You are a customer support agent for Acme Corp.

    Use the company knowledge base to answer product questions.
    When customers ask about orders, look up the order details
    using the available tools before responding.

    For returns and refunds, always ask for human approval
    before processing. Never process a refund without approval.

    Be direct and concise.
  skill_refs:
    - kind: skill
      slug: return-policy
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: order-management-api
      enabled_tools:
        - get_order
        - list_orders
        - process_return`;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const AGENT_ARTIFACT: ExecutionArtifact = (() => {
  const a = samples.artifact(
    "support-agent",
    ExecutionArtifactKind.FILE,
  );
  return a;
})();

const finalExecution = snapshot(
  [user1, ai1, user2, ai2],
  ExecutionPhase.EXECUTION_COMPLETED,
  [AGENT_ARTIFACT],
);

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const agentCreationTourSteps: ScenarioStep<AgentCreationStep>[] = [
  {
    delayMs: 0,
    data: { view: "library-click" },
    caption: "Navigate to Library",
  },
  {
    delayMs: 1500,
    data: { view: "agents-list" },
    caption: "View your Agents",
    narration: "An Agent is a reusable definition of what your AI assistant knows and can do.",
  },
  {
    delayMs: 2000,
    data: { view: "create-agent-click" },
    caption: 'Click "Add Agent"',
  },
  {
    delayMs: 1500,
    data: { view: "composer-ready" },
    caption: "Agent Creator opens",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
    caption: "Describe your agent",
    narration: "You tell the creator what the agent should do, and which Skills and tools it needs.",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
    caption: "Agent asks for details",
  },
  {
    delayMs: 2500,
    data: { view: "conversation", execution: snapshot([user1, ai1, user2]) },
    caption: "Provide role and rules",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: finalExecution },
    caption: "Agent definition created",
    narration: "The definition brings everything together — your Skill for domain knowledge, your MCP server for tools, and the behavior rules you set.",
  },
  {
    delayMs: 2000,
    data: { view: "artifact-click", execution: finalExecution },
    caption: "Click to preview",
  },
  {
    delayMs: 1500,
    data: { view: "artifact-preview", execution: finalExecution },
    caption: "Review the definition",
  },
  {
    delayMs: 3000,
    data: { view: "apply-agent", execution: finalExecution },
    caption: "Apply to save",
  },
  {
    delayMs: 2000,
    data: { view: "library-complete" },
    caption: "Agent added to Library",
    narration: "Your agent is ready. Any application can call it through the Stigmer API.",
  },
];
