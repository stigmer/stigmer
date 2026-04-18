/**
 * Connect playback for "Connect your tools".
 *
 * 6-step sequence: MCP server detail → cursor clicks Connect →
 * credential form opens → credentials filled + submit →
 * tools discovered + policies classified → view policies tab.
 *
 * Each step carries the full McpServer fixture so the playback
 * component can swap the data fed to the real SDK McpServerDetailView.
 */

import { create } from "@bufbuild/protobuf";
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
import { samples } from "@stigmer/react/demo";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ScenarioStep } from "@scenar/react";

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "order-management-api";

function buildServerBase(): McpServer {
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

  return server;
}

function buildConnectedServer(): McpServer {
  const server = buildServerBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
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
      ],
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

export type ConnectStep =
  | { view: "no-tools"; server: McpServer }
  | { view: "click-connect"; server: McpServer }
  | { view: "credential-form"; server: McpServer }
  | { view: "credential-filled"; server: McpServer }
  | { view: "connected-tools"; server: McpServer }
  | { view: "connected-policies"; server: McpServer };

const baseServer = buildServerBase();
const connectedServer = buildConnectedServer();

export const connectSteps: ScenarioStep<ConnectStep>[] = [
  {
    delayMs: 0,
    data: { view: "no-tools", server: baseServer },
    caption: "MCP server added — no tools yet",
    narration:
      "You've added the MCP server, but Stigmer doesn't know what tools it offers yet.",
  },
  {
    delayMs: 2500,
    data: { view: "click-connect", server: baseServer },
    caption: 'Click "Connect"',
  },
  {
    delayMs: 2500,
    data: { view: "credential-form", server: baseServer },
    caption: "Enter your API key",
    narration:
      "Stigmer needs your API key to connect to the server.",
  },
  {
    delayMs: 3000,
    data: { view: "credential-filled", server: baseServer },
    caption: "Save and connect",
  },
  {
    delayMs: 3000,
    data: { view: "connected-tools", server: connectedServer },
    caption: "3 tools discovered, policies classified",
    narration:
      "Stigmer connected to the server, found three tools, and classified each one. Read operations pass through automatically. process_return requires approval.",
  },
  {
    delayMs: 3500,
    data: { view: "connected-policies", server: connectedServer },
    caption: "process_return requires approval",
    narration:
      "The Policies tab shows auto-classified rules. The agent will pause and ask a human before processing any refund.",
  },
];
