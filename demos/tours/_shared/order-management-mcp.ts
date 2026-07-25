/**
 * The Order Management API — the one MCP server the Getting Started tours
 * tell a story about, in every state the docs depict. Tour 4
 * (`mcp-server-creation-tour`) creates it, tour 5 (`mcp-server-connect-tour`)
 * connects it, and the `connect-tools-tour` overview shows the payoff — up
 * to three embeds on the same docs page, so every field and every built
 * state lives here once and the embeds cannot drift apart.
 *
 * The public surface is deliberately the two settled `UseMcpServerReturn`
 * states rather than the builders: a tour injects a state through the
 * view's `mcpServerState` prop (no `getByReference` fires, every beat
 * paints correct data on its first frame — scenar-cloud DD-006), and a
 * surface that can't be re-built can't be half-built into a drifted
 * variant.
 *
 * Narrate-safe by construction: `steps.ts` files import the identity
 * constants from here, and `scenar narrate` loads `steps.ts` in plain Node
 * (tsx). Everything this module touches is in that loader's safe tier —
 * protos, `@stigmer/react/test` samples, and a type-only `@stigmer/react`
 * import. Keep it that way: no component imports, no CSS, no live clock
 * (`verify-scenar-tours` enforces the last one).
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { UseMcpServerReturn } from "@stigmer/react";
import { samples, sampleDate } from "@stigmer/react/test";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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
import { DEMO_ORG } from "./fixtures";

/** The server's identity, referenced by narration, YAML beats, and chrome. */
export const ORDER_MGMT_MCP = {
  name: "Order Management API",
  slug: "order-management-api",
  description: "REST API for order lookup, inventory, and return processing.",
  url: "https://api.acme.com/mcp",
  /** The env var the Authorization header resolves from at runtime. */
  envKey: "API_TOKEN",
  envDescription: "Bearer token for the Order Management API",
} as const;

/**
 * When the server's tools were discovered: the tour world's anchor instant
 * (`SAMPLE_INSTANT`, the demo day at 11:00 UTC), derived rather than
 * authored. `McpServerDetailView` formats this as a calendar date in the
 * reader's local time, and the anchor is the one instant guaranteed to
 * render the same date across the supported reader offset window — an
 * independent literal here once read "Jul 19" in Honolulu (see the anchor's
 * docs in `sdk/react/src/test/samples.ts`). Not exported: the module's
 * public surface is the settled states, not their ingredients.
 */
const ORDER_MGMT_DISCOVERED_AT = sampleDate();

/** The server exactly as tour 4 created it: HTTP + one secret env var. */
function buildRegisteredServer(): McpServer {
  const server = samples.mcpServer({
    name: ORDER_MGMT_MCP.name,
    slug: ORDER_MGMT_MCP.slug,
    org: DEMO_ORG,
  });
  server.spec = create(McpServerSpecSchema, {
    description: ORDER_MGMT_MCP.description,
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: ORDER_MGMT_MCP.url }),
    },
    env: {
      [ORDER_MGMT_MCP.envKey]: {
        isSecret: true,
        description: ORDER_MGMT_MCP.envDescription,
      },
    },
  });
  return server;
}

/** The same server after Connect: 3 discovered tools, 1 classified policy. */
function buildConnectedServer(): McpServer {
  const server = buildRegisteredServer();
  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      lastDiscoveredAt: timestampFromDate(ORDER_MGMT_DISCOVERED_AT),
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

/** Wraps a snapshot in the settled hoisted-state shape the view consumes. */
function frozenState(server: McpServer): UseMcpServerReturn {
  return {
    mcpServer: server,
    isLoading: false,
    isRefetching: false,
    error: null,
    // Nothing ever actually connects in a playback, so there is nothing to
    // refresh — but the contract still wants a callable.
    refetch: () => {},
  };
}

/**
 * The two depicted states, built once at module load. A tour's timeline
 * swaps between these by reference, so a beat can never observe a
 * half-updated resource. No clock, no randomness (DD-006).
 */
export const ORDER_MGMT_REGISTERED: UseMcpServerReturn =
  frozenState(buildRegisteredServer());
export const ORDER_MGMT_CONNECTED: UseMcpServerReturn =
  frozenState(buildConnectedServer());
