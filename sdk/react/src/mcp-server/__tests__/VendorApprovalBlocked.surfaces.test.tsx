import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { GetOAuthGrantStatusOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
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
 * An oauth_only server whose login app (the organization's app for its
 * address) is blocked by its vendor, as status.oauth_status reports it.
 */
function buildBlockedOAuthOnlyServer(options: { status: VendorApprovalStatus }): McpServer {
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
  function renderDialog(server: McpServer) {
    return renderWithTransport(
      <McpServerConnectDialog
        org={ORG}
        slug={SLUG}
        open
        onClose={() => {}}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: () => server,
          getOAuthGrantStatus: noGrant,
        });
      },
    );
  }

  it("explains the blocked state instead of showing only a disabled button", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.PENDING,
      }),
    );

    const signIn = await screen.findByRole("button", {
      name: "Sign in",
    });
    expect((signIn as HTMLButtonElement).disabled).toBe(true);
    // The reason is always visible — this was the oss#412 dead end.
    expect(screen.getByText(/is awaiting vendor approval/)).toBeTruthy();
  });

  it("never offers manual entry on an oauth_only server", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.PENDING,
      }),
    );

    await screen.findByRole("button", { name: "Sign in" });
    // OAuthRequiredNotice legitimately says tokens are *rejected*; what must
    // never appear is a recommendation to enter one.
    expect(screen.queryByText(/enter (a|your) token manually/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enter token manually" }),
    ).toBeNull();
  });

  it("is honest about rejection and offers the docs link", async () => {
    renderDialog(
      buildBlockedOAuthOnlyServer({
        status: VendorApprovalStatus.REJECTED,
      }),
    );

    expect(
      await screen.findByText(/was not approved by the vendor/),
    ).toBeTruthy();
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    const docs = screen.getByRole("link", {
      name: /Learn how to connect without it/,
    });
    expect(docs.getAttribute("href")).toBe(DOCS_URL);
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

  it("explains the block and what an admin can do, without recommending manual entry", async () => {
    renderWithTransport(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(
          buildBlockedOAuthOnlyServer({ status: VendorApprovalStatus.PENDING }),
        )}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
        });
      },
    );

    expect(
      await screen.findByText(
        "The login app for this server is awaiting vendor approval. Sign-in is unavailable until it is approved, or an admin adds another login app for this server's address.",
      ),
    ).toBeTruthy();
    // OAuthRequiredNotice legitimately says tokens are *rejected*; what must
    // never appear is a recommendation to enter one.
    expect(screen.queryByText(/enter (a|your) token manually/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enter token manually" }),
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
      screen.getByText(/an admin adds another login app for this server's address/),
    ).toBeTruthy();
    expect(screen.queryByText(/entering your own token manually/)).toBeNull();
  });

  it("mentions manual entry when the panel actually offers it (legacy fallback)", () => {
    renderPanel({}, { onSwitchToManual: () => {} });
    expect(
      screen.getByText(/You can still connect by entering your own token manually/),
    ).toBeTruthy();
  });
});
