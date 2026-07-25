/**
 * Pure `renderStep` for the MCP server connect tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only
 * maps step data to views.
 *
 * Every beat renders the REAL `@stigmer/react` `McpServerDetailView`. The
 * resource it shows is injected through the view's `mcpServerState` prop as
 * one of two frozen snapshots (registered / connected), so the view issues
 * no `getByReference` and every beat — including the payoff — paints
 * correct data on its first frame, under scrubbing and video export alike
 * (scenar-cloud DD-006).
 *
 * Internal view state (credential form open, active tab, prefilled values)
 * is set through the view's `default*` initial-state props, applied by
 * remounting on `KEY` — the reset idiom this codebase standardizes on
 * (stigmer DD-014). The remount is visually free precisely because the
 * resource is a prop: nothing the remount re-fetches is on screen. Each
 * remount resets the frame's scroll, which the steps' `scroll_to`
 * interactions re-establish.
 *
 * The view sits inside an `inert` wrapper: the credential form autofocuses
 * its first input on mount, which would steal keyboard focus from the
 * player mid-playback (the same trap tour 4 hit with the wizard's name
 * field), and a depicted page should not be interactive during playback.
 */
import type { CSSProperties } from "react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { McpServerDetailView, type UseMcpServerReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import type { EnvVarInput } from "@stigmer/sdk";
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
import { AppShell } from "../_shared/AppShell";
import {
  DEMO_CONTENT_ZOOM,
  ORDER_MGMT_DISCOVERED_AT,
} from "../_shared/fixtures";
import {
  type McpServerConnectTourStep,
  DEMO_ORG,
  ORDER_MGMT_MCP,
} from "./steps";

// ---------------------------------------------------------------------------
// Frozen resource snapshots (one per phase)
// ---------------------------------------------------------------------------
// Built once at module load from the shared identity — the tour's timeline
// swaps between these two by reference, so a beat can never observe a
// half-updated resource. No clock, no randomness (DD-006).

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

const REGISTERED = frozenState(buildRegisteredServer());
const CONNECTED = frozenState(buildConnectedServer());

/** Pre-fill for the "filled" credential beat, via EnvVarForm's pool lookup. */
const CREDENTIAL_POOL: Record<string, EnvVarInput> = {
  [ORDER_MGMT_MCP.envKey]: {
    value: "st-acme-om-7f3k9q2w8r",
    isSecret: true,
    description: ORDER_MGMT_MCP.envDescription,
  },
};

function credentialPoolLookup(key: string): EnvVarInput | undefined {
  return CREDENTIAL_POOL[key];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Scrollable frame for the real detail view (skill-creation-tour's idiom). */
const DETAIL_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: 16,
  zoom: DEMO_CONTENT_ZOOM,
};

/**
 * Derive the view's props for a beat. `key` changes exactly when a
 * `default*` initial-state prop must re-apply — beats that only move the
 * cursor share a key, so the component stays mounted and scroll persists.
 */
function detailPropsFor(data: McpServerConnectTourStep): {
  key: string;
  state: UseMcpServerReturn;
  tab: "tools" | "policies";
  showCredentialForm: boolean;
  poolValues?: (key: string) => EnvVarInput | undefined;
} {
  if (data.view === "credentials") {
    return {
      key: `credentials-${data.form}`,
      state: REGISTERED,
      tab: "tools",
      showCredentialForm: true,
      poolValues: data.form === "filled" ? credentialPoolLookup : undefined,
    };
  }
  return {
    key: `${data.phase}-${data.tab}`,
    state: data.phase === "connected" ? CONNECTED : REGISTERED,
    tab: data.tab,
    showCredentialForm: false,
  };
}

export function renderStep(data: McpServerConnectTourStep): ReactNode {
  const { key, state, tab, showCredentialForm, poolValues } =
    detailPropsFor(data);

  return (
    // One page throughout — a stable contentKey keeps AppShell from
    // replaying its navigation transition on every beat.
    <AppShell activeNav="library" contentKey="mcp-detail">
      <div key={key} style={DETAIL_SCROLL} inert>
        <McpServerDetailView
          org={DEMO_ORG}
          slug={ORDER_MGMT_MCP.slug}
          activeOrg={DEMO_ORG}
          editable
          mcpServerState={state}
          defaultCapabilityTab={tab}
          defaultShowCredentialForm={showCredentialForm}
          credentialPoolValues={poolValues}
        />
      </div>
    </AppShell>
  );
}
