/**
 * MCP server creation tour for "Connect your tools".
 *
 * 12-step playback: sidebar → Library → MCP Servers list →
 * Add MCP Server → Session Composer → conversation with
 * MCP Server Creator → artifact preview → apply → back to Library
 * with the new server.
 */

import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../../fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type McpCreationStep =
  | { view: "library-click" }
  | { view: "mcp-servers-list" }
  | { view: "create-mcp-server-click" }
  | { view: "composer-ready" }
  | { view: "conversation"; execution: AgentExecution }
  | { view: "artifact-click"; execution: AgentExecution }
  | { view: "artifact-preview"; execution: AgentExecution }
  | { view: "apply-mcp-server"; execution: AgentExecution }
  | { view: "library-complete" };

// ---------------------------------------------------------------------------
// Conversation messages
// ---------------------------------------------------------------------------

const user1 = samples.humanMessage(
  "I want to connect our order management API. It's an HTTP MCP server at https://orders.internal.acme.com/mcp",
);

const ai1 = samples.aiMessage(
  "I'll set up an HTTP MCP server for your order management API. A couple of quick questions:\n\n" +
    "1. **Authentication** — does the endpoint require an API key or auth header?\n" +
    "2. **Description** — a short summary of what this server provides (for your team's reference)?",
);

const user2 = samples.humanMessage(
  "It needs an API_KEY header for authentication. " +
    "Description: REST API for the Acme Corp order management system — " +
    "order lookup, inventory checks, and return processing.",
);

const ai2 = samples.aiMessage(
  "Done! I've created the **order-management-api** MCP server:\n\n" +
    "- **Type**: HTTP\n" +
    "- **URL**: `https://orders.internal.acme.com/mcp`\n" +
    "- **Auth**: `API_KEY` header (secret, configured via environment)\n" +
    "- **Description**: REST API for order lookup, inventory, and return processing\n\n" +
    "The configuration is ready as an artifact. Review it and apply to save.",
);

// ---------------------------------------------------------------------------
// Artifact content — MCP server YAML config
// ---------------------------------------------------------------------------

export const MCP_SERVER_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: order-management-api
  org: acme
spec:
  description: >-
    REST API for the Acme Corp order management system.
    Order lookup, inventory checks, and return processing.
  http:
    url: https://orders.internal.acme.com/mcp
  env:
    API_KEY:
      description: API key for order management authentication
      is_secret: true`;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const MCP_ARTIFACT: ExecutionArtifact = (() => {
  const a = samples.artifact(
    "order-management-api",
    ExecutionArtifactKind.FILE,
  );
  return a;
})();

const finalExecution = snapshot(
  [user1, ai1, user2, ai2],
  ExecutionPhase.EXECUTION_COMPLETED,
  [MCP_ARTIFACT],
);

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const mcpCreationTourSteps: ScenarioStep<McpCreationStep>[] = [
  {
    delayMs: 0,
    data: { view: "library-click" },
    caption: "Navigate to Library",
  },
  {
    delayMs: 1500,
    data: { view: "mcp-servers-list" },
    caption: "View your MCP Servers",
    narration: "MCP servers connect your agent to external systems — APIs, databases, and services your team already uses.",
  },
  {
    delayMs: 2000,
    data: { view: "create-mcp-server-click" },
    caption: 'Click "Add MCP Server"',
  },
  {
    delayMs: 1500,
    data: { view: "composer-ready" },
    caption: "MCP Server Creator opens",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1]) },
    caption: "Describe your server",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: snapshot([user1, ai1]) },
    caption: "Agent asks for details",
    narration: "The creator needs authentication details to connect securely, and a description so your team knows what this server does.",
  },
  {
    delayMs: 2500,
    data: { view: "conversation", execution: snapshot([user1, ai1, user2]) },
    caption: "Provide auth and description",
  },
  {
    delayMs: 2000,
    data: { view: "conversation", execution: finalExecution },
    caption: "Server configuration created",
    narration: "The MCP server is configured. Stigmer handles the connection and routes tool calls through it at runtime.",
  },
  {
    delayMs: 2000,
    data: { view: "artifact-click", execution: finalExecution },
    caption: "Click to preview",
  },
  {
    delayMs: 1500,
    data: { view: "artifact-preview", execution: finalExecution },
    caption: "Review the configuration",
  },
  {
    delayMs: 3000,
    data: { view: "apply-mcp-server", execution: finalExecution },
    caption: "Apply to save",
  },
  {
    delayMs: 2000,
    data: { view: "library-complete" },
    caption: "Server added to Library",
    narration: "Your MCP server is in the Library. Agents can use its tools to look up orders, check inventory, and process returns.",
  },
];
