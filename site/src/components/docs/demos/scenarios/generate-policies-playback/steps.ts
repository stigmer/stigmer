/**
 * Generate approval policies playback for "Connect your tools".
 *
 * 3-step sequence: tools discovered (no policies) → highlight
 * generate button → policies applied.
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
  DiscoverySource,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import {
  EnvironmentSpecSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { samples } from "@stigmer/react/demo";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ScenarioStep } from "../../engine/ScenarioPlayer";

export const DEMO_ORG = "acme";
export const DEMO_SLUG = "order-management-api";

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

function buildServerWithTools(): McpServer {
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
    envSpec: create(EnvironmentSpecSchema, {
      data: {
        API_KEY: create(EnvironmentValueSchema, {
          isSecret: true,
          description: "API key for order management authentication.",
        }),
      },
    }),
  });

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      discoveredBy: DiscoverySource.api,
      tools: buildDiscoveredTools(),
    }),
  });

  return server;
}

function buildServerWithPolicies(): McpServer {
  const server = buildServerWithTools();

  server.spec!.defaultToolApprovals = [
    create(ToolApprovalPolicySchema, {
      toolName: "process_return",
      message:
        "Process return for order '{{args.order_id}}' — refund ${{args.refund_amount}} to {{args.refund_method}}",
    }),
  ];

  return server;
}

export type GeneratePoliciesStep =
  | { view: "no-policies"; server: McpServer }
  | { view: "click-generate"; server: McpServer }
  | { view: "policies-applied"; server: McpServer };

const toolsOnlyServer = buildServerWithTools();
const withPoliciesServer = buildServerWithPolicies();

export const generatePoliciesSteps: ScenarioStep<GeneratePoliciesStep>[] = [
  {
    delayMs: 0,
    data: { view: "no-policies", server: toolsOnlyServer },
    caption: "Tools discovered — no policies yet",
  },
  {
    delayMs: 3000,
    data: { view: "click-generate", server: toolsOnlyServer },
    caption: '"Generate Policies"',
  },
  {
    delayMs: 3000,
    data: { view: "policies-applied", server: withPoliciesServer },
    caption: "process_return requires approval",
  },
];
