import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  GetOrgOAuthAppOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import {
  McpServerSpecSchema,
  McpServerAuthSchema,
  HttpServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  OAuthStatusSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { McpServerConnectDialog } from "../McpServerConnectDialog";
import { McpServerDetailView } from "../McpServerDetailView";
import { McpServerConfigPanel } from "../McpServerConfigPanel";
import type { UseMcpServerReturn } from "../useMcpServer";

/**
 * Pins the oauth_only + vendor-approval-blocked combination across the three
 * connect surfaces (stigmer/stigmer#412). Before the shared notice, this
 * state was a silent dead end in the connect dialog (disabled button, no
 * reason, no way forward) and two surfaces recommended manual token entry on
 * servers whose endpoint rejects static tokens.
 */

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

const ORG = "acme";
const SLUG = "vendor-crm";
const DOCS_URL = "https://vendor.example.com/oauth-docs";

/**
 * An oauth_only vendor-OAuth server whose platform OAuth app is blocked.
 * `withAppRef` controls the BYOA arm: with a ref and no org override,
 * `canBringOwnApp` is true. The org-override state itself comes from the
 * `getOrgOAuthApp` transport handler (client-side derivation,
 * stigmer-cloud#401) — status.oauth_status carries only the
 * vendor-approval fields, matching what backends actually populate.
 */
function buildBlockedOAuthOnlyServer(options: {
  status: VendorApprovalStatus;
  withAppRef: boolean;
}): McpServer {
  const server = samples.mcpServer({ name: "Vendor CRM", org: ORG, slug: SLUG });
  server.spec = create(McpServerSpecSchema, {
    description: "CRM tools over the vendor's hosted MCP endpoint.",
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://mcp.vendor.example.com" }),
    },
    auth: create(McpServerAuthSchema, {
      targetEnvVar: "VENDOR_ACCESS_TOKEN",
      oauthOnly: true,
      ...(options.withAppRef
        ? {
            oauthAppRef: {
              org: "stigmer",
              kind: ApiResourceKind.oauth_app,
              slug: "vendor-oauth",
            },
          }
        : {}),
    }),
  });
  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    oauthStatus: create(OAuthStatusSchema, {
      vendorApprovalStatus: options.status,
      vendorApprovalDocsUrl: DOCS_URL,
    }),
  });
  return server;
}

function noGrant() {
  return create(GetOAuthGrantStatusOutputSchema, { connected: false });
}

// BYOA affordances render only where the org-override surface exists —
// canBringOwnApp is gated on a getOrgOAuthApp capability probe
// (stigmer/stigmer#558), so the BYOA arms of these tests must register the
// RPC to simulate the hosted edition. The OSS arm (probe UNIMPLEMENTED →
// affordances hidden) is pinned in byoaEditionDegradation.test.tsx.
function noOverride() {
  return create(GetOrgOAuthAppOutputSchema, { hasOverride: false });
}

function renderWithTransport(
  ui: ReactNode,
  register: Parameters<typeof createRouterTransport>[0] = () => {},
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  return render(
    <StigmerContext.Provider value={client}>{ui}</StigmerContext.Provider>,
  );
}

// ---------------------------------------------------------------------------
// Surface 1: McpServerConnectDialog — the surface that was a silent dead end
// ---------------------------------------------------------------------------

describe("McpServerConnectDialog — oauth_only + vendor-blocked", () => {
  function renderDialog(server: McpServer, onOpenDetails?: () => void) {
    return renderWithTransport(
      <McpServerConnectDialog
        org={ORG}
        slug={SLUG}
        open
        onClose={() => {}}
        onOpenDetails={onOpenDetails}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: () => server,
          getOAuthGrantStatus: noGrant,
          getOrgOAuthApp: noOverride,
        });
      },
    );
  }

  it("explains the blocked state instead of showing only a disabled button", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.PENDING,
        withAppRef: true,
      }),
    );

    const signIn = await screen.findByRole("button", {
      name: "Sign in with OAuth",
    });
    expect((signIn as HTMLButtonElement).disabled).toBe(true);
    // The reason is always visible — this was the oss#412 dead end.
    expect(screen.getByText(/is awaiting vendor approval/)).toBeTruthy();
  });

  it("never offers manual entry on an oauth_only server", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.PENDING,
        withAppRef: true,
      }),
    );

    await screen.findByRole("button", { name: "Sign in with OAuth" });
    // OAuthRequiredNotice legitimately says tokens are *rejected*; what must
    // never appear is a recommendation to enter one.
    expect(screen.queryByText(/enter (a|your) token manually/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enter token manually" }),
    ).toBeNull();
  });

  it("routes the BYOA escape hatch to onOpenDetails", async () => {
    const onOpenDetails = vi.fn();
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.PENDING,
        withAppRef: true,
      }),
      onOpenDetails,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use your own OAuth app" }),
    );
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  it("is honest about rejection and falls back to the docs link without BYOA", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.REJECTED,
        withAppRef: false,
      }),
    );

    expect(
      await screen.findByText(/was not approved by the vendor/),
    ).toBeTruthy();
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    const docs = screen.getByRole("link", {
      name: /Learn how to bring your own token/,
    });
    expect(docs.getAttribute("href")).toBe(DOCS_URL);
  });

  it("enables sign-in with the org's own app when a BYOA override is active", async () => {
    // The platform app is still vendor-blocked, but the org brought its
    // own approved app — the block describes an app sign-in won't use
    // (stigmer-cloud#401). Before the client-side derivation this state
    // was a dead end: disabled button AND no way forward.
    renderWithTransport(
      <McpServerConnectDialog
        org={ORG}
        slug={SLUG}
        open
        onClose={() => {}}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: () =>
            buildBlockedOAuthOnlyServer({
              status: VendorApprovalStatus.PENDING,
              withAppRef: true,
            }),
          getOAuthGrantStatus: noGrant,
          getOrgOAuthApp: () =>
            create(GetOrgOAuthAppOutputSchema, {
              hasOverride: true,
              oauthAppId: "oauthapp_01acme",
              clientId: "acme-client-id",
            }),
        });
      },
    );

    const signIn = await screen.findByRole("button", {
      name: "Sign in with your app",
    });
    expect((signIn as HTMLButtonElement).disabled).toBe(false);
    // The blocked notice describes the platform app — suppressed while
    // the org's own app is the effective one.
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Use your own OAuth app" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Surface 2: McpServerDetailView — the banner that recommended a dead path
// ---------------------------------------------------------------------------

describe("McpServerDetailView — oauth_only + vendor-blocked", () => {
  function loadedState(server: McpServer): UseMcpServerReturn {
    return {
      mcpServer: server,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    };
  }

  it("offers BYOA without recommending manual entry, and keeps the tour's CTA marker", async () => {
    renderWithTransport(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(
          buildBlockedOAuthOnlyServer({
            status: VendorApprovalStatus.PENDING,
            withAppRef: true,
          }),
        )}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
          getOrgOAuthApp: noOverride,
        });
      },
    );

    expect(
      await screen.findByText(
        "The platform's OAuth app is awaiting vendor approval. You can use your own OAuth app.",
      ),
    ).toBeTruthy();
    // OAuthRequiredNotice legitimately says tokens are *rejected*; what must
    // never appear is a recommendation to enter one.
    expect(screen.queryByText(/enter (a|your) token manually/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enter token manually" }),
    ).toBeNull();

    const cta = screen.getByRole("button", { name: "Use your own OAuth app" });
    // The byoa-setup docs tour targets this marker; it must survive the
    // extraction into the shared notice.
    expect(cta.getAttribute("data-cursor-target")).toBe("byoa-cta-button");
  });

  it("enables 'Sign in with your app' when the org's BYOA override is active", async () => {
    // The vendor block gates the PLATFORM app; with the org's own app
    // effective, sign-in must be enabled and the BYOA CTA retired
    // (stigmer-cloud#401 — the signal these gates key on never fired).
    renderWithTransport(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(
          buildBlockedOAuthOnlyServer({
            status: VendorApprovalStatus.PENDING,
            withAppRef: true,
          }),
        )}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
          getOrgOAuthApp: () =>
            create(GetOrgOAuthAppOutputSchema, {
              hasOverride: true,
              oauthAppId: "oauthapp_01acme",
              clientId: "acme-client-id",
            }),
        });
      },
    );

    const signIn = await screen.findByRole("button", {
      name: "Sign in with your app",
    });
    expect((signIn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Using your OAuth app")).toBeTruthy();
    // The blocked banner and BYOA offer describe the platform app —
    // both retire while the override is active.
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Use your own OAuth app" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Surface 3: McpServerConfigPanel — the session-setup inline sign-in
// ---------------------------------------------------------------------------

describe("McpServerConfigPanel — oauth_only + vendor-blocked", () => {
  function renderPanel(
    oauthSignInOverrides: Record<string, unknown> = {},
    panelOverrides: Record<string, unknown> = {},
  ) {
    const server = buildBlockedOAuthOnlyServer({
      status: VendorApprovalStatus.PENDING,
      withAppRef: true,
    });
    return renderWithTransport(
      <McpServerConfigPanel
        mcpServer={server}
        oauthSignIn={{
          onSignIn: () => {},
          phase: "idle",
          isConnected: false,
          error: null,
          onClearError: () => {},
          isVendorApprovalPending: true,
          isVendorApprovalBlocked: true,
          vendorApprovalDocsUrl: DOCS_URL,
          ...oauthSignInOverrides,
        }}
        discoveredTools={[]}
        toolApprovals={[]}
        enabledTools={[]}
        onEnabledToolsChange={() => {}}
        onBack={() => {}}
        error={null}
        {...panelOverrides}
      />,
    );
  }

  it("never claims manual entry when the affordance is not wired (oauth_only)", () => {
    renderPanel();
    expect(screen.getByText(/is awaiting vendor approval/)).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
  });

  it("explicit manualEntrySupported=false wins even if a switch handler leaks through", () => {
    renderPanel(
      { manualEntrySupported: false },
      { onSwitchToManual: () => {} },
    );
    expect(screen.getByText(/is awaiting vendor approval/)).toBeTruthy();
    expect(
      screen.getByText(/OAuth sign-in is temporarily unavailable for this server/),
    ).toBeTruthy();
    expect(
      screen.queryByText(/You can use your own OAuth app or enter a token manually/),
    ).toBeNull();
  });

  it("mentions manual entry when the panel actually offers it (legacy fallback)", () => {
    renderPanel({}, { onSwitchToManual: () => {} });
    expect(
      screen.getByText(/You can still connect by entering your own token manually/),
    ).toBeTruthy();
  });
});
