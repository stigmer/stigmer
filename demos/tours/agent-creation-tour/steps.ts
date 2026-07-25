/**
 * Agent creation tour — the web-app walkthrough for "Create your Agent":
 * navigate Library → Agents, open the Agent Creator, converse until the
 * Agent definition artifact appears, preview it, apply, and land back in
 * the Library with the new agent.
 *
 * Ported from the docs inline demo to a hosted Scenar tour. `index.tsx`
 * renders these steps; `.scenar/providers.tsx` supplies the artifact YAML
 * the real `ArtifactPreviewContent` fetches. The cursor is driven by each
 * step's declarative `interactions` (the packed embed wires it — there is
 * no per-view hook), replacing the inline demo's `cursorTargetFor`.
 */
import { ExecutionArtifactKind, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG, snapshot } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type AgentCreationTourStep =
  | { view: "library-click" }
  | { view: "agents-list" }
  | { view: "create-agent-click" }
  | { view: "composer-ready" }
  | { view: "conversation"; execution: AgentExecution }
  | { view: "artifact-click"; execution: AgentExecution }
  | { view: "artifact-preview"; execution: AgentExecution }
  | { view: "apply-agent"; execution: AgentExecution }
  | { view: "library-complete" };

/** The Agent Creator pre-selected in the composer when it opens. */
export const AGENT_CREATOR_REF: ResourceRef = {
  org: DEMO_ORG,
  slug: "agent-creator",
};

// ---------------------------------------------------------------------------
// Conversation fixture
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
// Artifact content — the Agent YAML shown in the preview
// ---------------------------------------------------------------------------

/** Served by the mocked `getArtifactContent` (see `.scenar/providers.tsx`). */
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
// Execution + library fixtures
// ---------------------------------------------------------------------------

/*
 * The artifact name needs a `.yaml` extension: `ArtifactPreviewContent` only
 * treats an artifact as previewable text when its extension is a known text
 * type, and only a fetched-and-parsed YAML body surfaces the "Apply to org"
 * CTA (which step 10's cursor points at).
 */
const agentArtifact = samples.artifact("support-agent.yaml", ExecutionArtifactKind.FILE);
agentArtifact.sizeBytes = BigInt(new TextEncoder().encode(AGENT_YAML).length);

const finalExecution = snapshot(
  [user1, ai1, user2, ai2],
  ExecutionPhase.EXECUTION_COMPLETED,
  [agentArtifact],
);

/** The Agents library before the tour: just the built-in assistant. */
export const EXISTING_AGENTS = [
  samples.searchResult({
    id: "agt-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.agent,
    name: "assistant",
    slug: "assistant",
    description: "General-purpose AI assistant.",
  }),
];

/** The Agents library after applying: the new support agent joins. */
export const ALL_AGENTS = [
  ...EXISTING_AGENTS,
  samples.searchResult({
    id: "agt-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.agent,
    name: "Support Agent",
    slug: "support-agent",
    description:
      "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
  }),
];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Cursor choreography: each pointing step sets its cursor mid-step and clears
 * it before the step ends, so every step is self-contained — no step depends
 * on a previous step's cursor state (the pattern the ported Path-B tours use).
 */
export const agentCreationTourSteps: ScenarioStep<AgentCreationTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "library-click" },
    // No cursor here: the embed arms step-0 interactions at mount (under the
    // poster), so they fire before Play — a @scenar/react quirk every ported
    // tour works around by keeping its first step cursor-less. The pulsing
    // Library nav row carries this beat instead.
  },
  {
    delayMs: 1500,
    data: { view: "agents-list" },
    narration:
      "An Agent is a reusable definition of what your AI assistant knows and can do.",
  },
  {
    delayMs: 2000,
    data: { view: "create-agent-click" },
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "create-agent" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 1500,
    data: { view: "composer-ready" },
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
    narration:
      "You tell the creator what the agent should do, and which Skills and tools it needs.",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
  },
  {
    delayMs: 2500,
    data: { view: "conversation", execution: snapshot([user1, ai1, user2]) },
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: finalExecution },
    narration:
      "The definition brings everything together — your Skill for domain knowledge, your MCP server for tools, and the behavior rules you set.",
  },
  {
    delayMs: 2000,
    data: { view: "artifact-click", execution: finalExecution },
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "artifact-widget" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 1500,
    data: { view: "artifact-preview", execution: finalExecution },
  },
  {
    delayMs: 3000,
    data: { view: "apply-agent", execution: finalExecution },
    interactions: [
      // The real ArtifactPreviewContent emits this target on its Apply CTA.
      { atPercent: 0.35, type: "set_cursor", target: "apply-resource-button" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 2000,
    data: { view: "library-complete" },
    narration:
      "Your agent is ready. Any application can call it through the Stigmer API.",
  },
];
