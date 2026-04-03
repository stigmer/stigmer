/**
 * Discover capabilities playback for "Connect your tools".
 *
 * 7-step sequence: MCP server from the top → scroll down to show
 * Capabilities → cursor clicks Discover → credential form opens →
 * credentials filled + Save → tools discovered.
 *
 * Each step carries the full McpServer fixture so the playback
 * component can swap the data fed to the real SDK McpServerDetailView.
 */

import { create } from "@bufbuild/protobuf";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
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
    envSpec: create(EnvironmentSpecSchema, {
      data: {
        API_KEY: create(EnvironmentValueSchema, {
          isSecret: true,
          description:
            "API key for order management authentication.",
        }),
      },
    }),
  });

  return server;
}

function buildServerWithTools(): McpServer {
  const server = buildServerBase();

  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      discoveredBy: DiscoverySource.api,
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
  });

  return server;
}

export type DiscoverStep =
  | { view: "no-tools"; server: McpServer }
  | { view: "scroll-to-capabilities"; server: McpServer }
  | { view: "click-discover"; server: McpServer }
  | { view: "credential-form"; server: McpServer }
  | { view: "credential-filled"; server: McpServer }
  | { view: "tools-discovered"; server: McpServer };

const noToolsServer = buildServerBase();
const withToolsServer = buildServerWithTools();

export const discoverSteps: ScenarioStep<DiscoverStep>[] = [
  {
    delayMs: 0,
    data: { view: "no-tools", server: noToolsServer },
    caption: "MCP server added — no tools yet",
  },
  {
    delayMs: 2500,
    data: { view: "scroll-to-capabilities", server: noToolsServer },
    caption: "Scroll to Capabilities",
  },
  {
    delayMs: 2000,
    data: { view: "click-discover", server: noToolsServer },
    caption: 'Click "Discover"',
  },
  {
    delayMs: 2500,
    data: { view: "credential-form", server: noToolsServer },
    caption: "Enter your API key",
  },
  {
    delayMs: 3000,
    data: { view: "credential-filled", server: noToolsServer },
    caption: "Save and discover",
  },
  {
    delayMs: 3000,
    data: { view: "tools-discovered", server: withToolsServer },
    caption: "3 tools discovered",
  },
];
