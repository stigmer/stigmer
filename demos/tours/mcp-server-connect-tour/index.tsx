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
import { McpServerDetailView, type UseMcpServerReturn } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import type { EnvVarInput } from "@stigmer/sdk";
import { AppShell } from "../_shared/AppShell";
import { DEMO_ORG } from "../_shared/fixtures";
import {
  ORDER_MGMT_MCP,
  ORDER_MGMT_REGISTERED as REGISTERED,
  ORDER_MGMT_CONNECTED as CONNECTED,
} from "../_shared/order-management-mcp";
import type { McpServerConnectTourStep } from "./steps";

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

/**
 * Scrollable library-detail frame at the zone's real geometry
 * (`mx-auto max-w-4xl px-6 py-8`). One scale factor per frame — no zoom.
 */
const DETAIL_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "32px 24px",
};
const DETAIL_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: "56rem",
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
    // The console beat lives in a browser window whose address bar names the
    // depicted route. One page throughout — a stable contentKey keeps
    // AppShell from replaying its navigation transition on every beat.
    <BrowserView
      url={`app.stigmer.ai/library/mcp-servers/${ORDER_MGMT_MCP.slug}`}
      contentKey="mcp-detail"
    >
      <AppShell activeNav="library" contentKey="mcp-detail">
        <div key={key} style={DETAIL_SCROLL} inert>
          <div style={DETAIL_CONTENT}>
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
        </div>
      </AppShell>
    </BrowserView>
  );
}
