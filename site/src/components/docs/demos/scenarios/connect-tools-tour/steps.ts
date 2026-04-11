/**
 * Connect Tools overview tour — multi-surface preview showing:
 * connect (tools + policies) → code change → real data →
 * approval flow.
 *
 * Placed at the top of the "Connect your tools" page inside
 * "What you'll build."
 */

import { create } from "@bufbuild/protobuf";
import {
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import {
  EnvVarDeclarationSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { TerminalLine } from "../../views/TerminalView";
import { snapshot } from "../../engine/shared";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type ConnectToolsTourStep =
  | { view: "connected"; server: McpServer }
  | { view: "code-mcp-refs" }
  | { view: "terminal-order" }
  | { view: "approval-card"; execution: AgentExecution }
  | { view: "approved"; execution: AgentExecution };

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "order-management-api";

// ---------------------------------------------------------------------------
// McpServer fixture data (tools + policies for real McpServerDetailView)
// ---------------------------------------------------------------------------

function buildDiscoveredTools() {
  return [
    create(DiscoveredToolSchema, {
      name: "get_order",
      description:
        "Retrieve details of a specific order by ID, including status, items, and tracking.",
    }),
    create(DiscoveredToolSchema, {
      name: "list_orders",
      description:
        "List recent orders for a customer, filtered by status or date range.",
    }),
    create(DiscoveredToolSchema, {
      name: "process_return",
      description:
        "Initiate a return and refund for an order. Requires order ID, reason, and amount.",
    }),
  ];
}

function buildConnectedServer(): McpServer {
  const server = samples.mcpServer({
    name: "order-management-api",
    org: DEMO_ORG,
    description:
      "REST API for the Acme Corp order management system. Provides tools to query orders, check inventory, and process returns.",
  });

  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://orders.internal.acme.com/mcp",
      }),
    },
    env: {
      API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "API key for order management authentication.",
      }),
    },
  });

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: buildDiscoveredTools(),
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "process_return",
        message:
          "Process return for order '{{args.order_id}}' — refund ${{args.refund_amount}} to {{args.refund_method}}",
      }),
    ],
  });

  return server;
}

export const connectedServer = buildConnectedServer();

// ---------------------------------------------------------------------------
// Code snippet
// ---------------------------------------------------------------------------

export const MCP_REFS_CODE = [
  "// ask-agent.ts — Add tools alongside the Skill",
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  '  skillRefs: [{ org: "my-org", slug: "return-policy" }],',
  '  mcpServerRefs: [{ org: "my-org", slug: "order-management-api" }],',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What\'s the status of order #ORD-4821?",',
  "});",
];

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

export const ORDER_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "Order #ORD-4821 has been shipped." },
  { type: "blank", text: "" },
  { type: "output", text: "- Item: Wireless Headphones (1x $79.99)" },
  { type: "output", text: "- Tracking: 1Z999AA10123456784" },
  { type: "output", text: "- Estimated delivery: April 5, 2026" },
];

// ---------------------------------------------------------------------------
// Approval flow data
// ---------------------------------------------------------------------------

const approvalUser = samples.humanMessage(
  "Process a return for order #ORD-4821 — the headphones are defective.",
);

const pendingToolCall = create(ToolCallSchema, {
  id: "tc-process-return-1",
  name: "process_return",
  status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
  startedAt: new Date().toISOString(),
});

const pendingApproval = create(PendingApprovalSchema, {
  toolCallId: "tc-process-return-1",
  toolName: "process_return",
  message: "Process return for order 'ORD-4821'",
  argsPreview: JSON.stringify(
    {
      order_id: "ORD-4821",
      reason: "defective",
      refund_amount: 79.99,
      refund_method: "original_payment",
    },
    null,
    2,
  ),
  requestedAt: new Date().toISOString(),
  mcpServerSlug: "order-management-api",
});

export function buildWaitingExecution(): AgentExecution {
  const exec = snapshot(
    [approvalUser, samples.aiMessage("", [pendingToolCall])],
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  );
  exec.status!.pendingApprovals = [pendingApproval];
  return exec;
}

const completedToolCall = samples.toolCall(
  "process_return",
  JSON.stringify(
    {
      return_id: "RET-1092",
      status: "approved",
      refund_amount: 79.99,
      refund_method: "original_payment",
      estimated_refund_date: "2026-04-07",
    },
    null,
    2,
  ),
);

const aiSummary = samples.aiMessage(
  "The return has been processed. Here's a summary:\n\n" +
    "- **Return ID**: RET-1092\n" +
    "- **Refund**: $79.99 to original payment method\n" +
    "- **Estimated refund date**: April 7, 2026",
);

export const approvedExecution = snapshot(
  [approvalUser, samples.aiMessage("", [completedToolCall]), aiSummary],
  ExecutionPhase.EXECUTION_COMPLETED,
);

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const connectToolsTourSteps: ScenarioStep<ConnectToolsTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "connected", server: connectedServer },
    caption: "Connect — tools discovered, policies classified",
    narration:
      "One click connects to the MCP server, discovers three tools, and classifies each one. Read operations pass through. The process return tool requires human approval.",
  },
  {
    delayMs: 3500,
    data: { view: "code-mcp-refs" },
    caption: "One line connects the tools to your code",
    narration:
      "Add MCP server refs to your session. The agent now has access to real data.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-order" },
    caption: "Agent looks up a real order",
    narration:
      "Ask about an order and the agent calls get_order — real data, not a guess.",
  },
  {
    delayMs: 3500,
    data: { view: "approval-card", execution: buildWaitingExecution() },
    caption: "Sensitive action — agent pauses for approval",
    narration:
      "Ask to process a return and the agent stops. It shows exactly what it wants to do and waits for a human.",
  },
  {
    delayMs: 3500,
    data: { view: "approved", execution: approvedExecution },
    caption: "Approved — return processed",
    narration:
      "Once approved, the agent completes the action and confirms the result.",
  },
];
