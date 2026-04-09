"use client";

import { useCallback, useMemo, useState } from "react";
import { StigmerProvider, McpServerDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
  samples,
} from "@stigmer/react/demo";
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
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { DEMO_CONTENT_ZOOM, DEMO_DETAIL_CLASSES } from "../../shared/tokens";

const DEMO_ORG = "acme";

function buildDemoMcpServer() {
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
  });

  server.metadata!.visibility = ApiResourceVisibility.visibility_private;

  server.status = create(McpServerStatusSchema, {
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "process_return",
        message:
          "Process return for order '{{args.order_id}}' — refund ${{args.refund_amount}} to {{args.refund_method}}",
      }),
    ],
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, {
          name: "get_order",
          description:
            "Retrieve details of a specific order by ID, including status, items, tracking, and delivery estimate.",
        }),
        create(DiscoveredToolSchema, {
          name: "list_orders",
          description:
            "List recent orders for a customer, filtered by status or date range.",
        }),
        create(DiscoveredToolSchema, {
          name: "process_return",
          description:
            "Initiate a return and refund for an order. Requires order ID, reason, and refund amount.",
        }),
      ],
    }),
  });

  return server;
}

const emptyEnvList = () => create(EnvironmentListSchema, {});

export function McpServerDetail() {
  const client = useMemo(() => {
    const server = buildDemoMcpServer();
    const scenario = buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
    );
    return createDemoClient(scenario);
  }, []);

  const [, setVisibility] = useState(ApiResourceVisibility.visibility_private);
  const handleVisibilityChange = useCallback(
    (v: ApiResourceVisibility) => setVisibility(v),
    [],
  );

  return (
    <StigmerProvider client={client}>
      <div className={DEMO_DETAIL_CLASSES}>
        <div className="p-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
          <McpServerDetailView
            org={DEMO_ORG}
            slug="order-management-api"
            onVisibilityChange={handleVisibilityChange}
          />
        </div>
      </div>
    </StigmerProvider>
  );
}
