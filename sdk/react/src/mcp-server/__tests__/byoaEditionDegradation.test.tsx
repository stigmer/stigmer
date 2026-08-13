import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
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
  OAuthAppSource,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { McpServerDetailView } from "../McpServerDetailView";
import { McpServerConnectDialog } from "../McpServerConnectDialog";
import { useOrgOAuthApp } from "../useOrgOAuthApp";
import type { UseMcpServerReturn } from "../useMcpServer";

/**
 * Pins the edition degradation of the BYOA (org-OAuth-app override) surface
 * (stigmer/stigmer#558, DD-019).
 *
 * The org-override RPCs (getOrgOAuthApp / setOrgOAuthApp / deleteOrgOAuthApp)
 * are hosted-only by design: OSS has a flat OAuthApp store with no override
 * binding, so the OSS server answers UNIMPLEMENTED for the whole surface.
 * The SDK probes the capability through `getOrgOAuthApp` and must hide every
 * BYOA affordance when the probe answers UNIMPLEMENTED — offering "Use your
 * own OAuth app" on OSS is a dead end whose submit can only fail.
 *
 * `createRouterTransport` answers UNIMPLEMENTED for unregistered methods,
 * which makes an OSS-like backend the default here; registering
 * `getOrgOAuthApp` simulates the hosted edition.
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
const SERVER_ID = "mcps_01byoa";
const DOCS_URL = "https://vendor.example.com/oauth-docs";

/** A vendor-OAuth server; `approval` drives the blocked/plain CTA arms. */
function buildVendorOAuthServer(options: {
  approval: VendorApprovalStatus;
}): McpServer {
  const server = samples.mcpServer({ name: "Vendor CRM", org: ORG, slug: SLUG });
  server.metadata!.id = SERVER_ID;
  server.spec = create(McpServerSpecSchema, {
    description: "CRM tools over the vendor's hosted MCP endpoint.",
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://mcp.vendor.example.com" }),
    },
    auth: create(McpServerAuthSchema, {
      targetEnvVar: "VENDOR_ACCESS_TOKEN",
      oauthAppRef: {
        org: "stigmer",
        kind: ApiResourceKind.oauth_app,
        slug: "vendor-oauth",
      },
    }),
  });
  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    oauthStatus: create(OAuthStatusSchema, {
      vendorApprovalStatus: options.approval,
      vendorApprovalDocsUrl: DOCS_URL,
      effectiveOauthSource: OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
    }),
  });
  return server;
}

function noGrant() {
  return create(GetOAuthGrantStatusOutputSchema, { connected: false });
}

/** Hosted-edition read: the org has no override yet. */
function noOverride() {
  return create(GetOrgOAuthAppOutputSchema, { hasOverride: false });
}

function makeClient(register: Parameters<typeof createRouterTransport>[0]) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
}

function renderWithTransport(
  ui: ReactNode,
  register: Parameters<typeof createRouterTransport>[0] = () => {},
) {
  return render(
    <StigmerContext.Provider value={makeClient(register)}>
      {ui}
    </StigmerContext.Provider>,
  );
}

// ---------------------------------------------------------------------------
// Hook: useOrgOAuthApp capability probe
// ---------------------------------------------------------------------------

describe("useOrgOAuthApp — edition capability probe", () => {
  function renderProbe(register: Parameters<typeof createRouterTransport>[0]) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={makeClient(register)}>
        {children}
      </StigmerContext.Provider>
    );
    return renderHook(() => useOrgOAuthApp(SERVER_ID, ORG), { wrapper });
  }

  it("reports isSupported=true once the hosted backend answers", async () => {
    const { result } = renderProbe((router) => {
      router.service(McpServerQueryController, { getOrgOAuthApp: noOverride });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSupported).toBe(true);
    expect(result.current.hasOverride).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("treats UNIMPLEMENTED as capability-absent, not as an error", async () => {
    // No getOrgOAuthApp registration — the router answers UNIMPLEMENTED,
    // exactly what the OSS server does for the whole org-override surface.
    const { result } = renderProbe((router) => {
      router.service(McpServerQueryController, { getOAuthGrantStatus: noGrant });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSupported).toBe(false);
    expect(result.current.hasOverride).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps genuine failures as errors and does not claim support", async () => {
    const { result } = renderProbe((router) => {
      router.service(McpServerQueryController, {
        getOrgOAuthApp: () => {
          throw new ConnectError("boom", Code.Internal);
        },
      });
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isSupported).toBe(false);
  });

  it("stays idle (unsupported, no fetch) without a resource or org", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={makeClient(() => {})}>
        {children}
      </StigmerContext.Provider>
    );
    const { result } = renderHook(() => useOrgOAuthApp(null, null), { wrapper });
    expect(result.current.isSupported).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Surface: McpServerDetailView
// ---------------------------------------------------------------------------

describe("McpServerDetailView — BYOA affordances follow the capability probe", () => {
  function loadedState(server: McpServer): UseMcpServerReturn {
    return {
      mcpServer: server,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    };
  }

  function renderDetail(
    server: McpServer,
    register: Parameters<typeof createRouterTransport>[0],
  ) {
    return renderWithTransport(
      <McpServerDetailView org={ORG} slug={SLUG} mcpServerState={loadedState(server)} />,
      register,
    );
  }

  it("offers the BYOA link when the hosted backend supports the surface", async () => {
    renderDetail(
      buildVendorOAuthServer({ approval: VendorApprovalStatus.APPROVED }),
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
          getOrgOAuthApp: noOverride,
        });
      },
    );

    expect(
      await screen.findByRole("button", { name: "Use your own OAuth app" }),
    ).toBeTruthy();
  });

  it("hides the BYOA link on an OSS backend (getOrgOAuthApp UNIMPLEMENTED)", async () => {
    renderDetail(
      buildVendorOAuthServer({ approval: VendorApprovalStatus.APPROVED }),
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
        });
      },
    );

    // Wait for the connect bar to settle (the manual-entry action proves
    // the secondary-action row rendered) before asserting absence.
    await screen.findByRole("button", { name: "Enter token manually" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Use your own OAuth app" }),
      ).toBeNull(),
    );
  });

  it("degrades the vendor-blocked notice copy on OSS instead of offering a dead CTA", async () => {
    renderDetail(
      buildVendorOAuthServer({ approval: VendorApprovalStatus.PENDING }),
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: noGrant,
        });
      },
    );

    expect(
      await screen.findByText(
        "The platform's OAuth app is awaiting vendor approval. You can still connect by entering your own token manually.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use your own OAuth app" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Surface: McpServerConnectDialog
// ---------------------------------------------------------------------------

describe("McpServerConnectDialog — BYOA escape hatch follows the capability probe", () => {
  function renderDialog(register: Parameters<typeof createRouterTransport>[0]) {
    return renderWithTransport(
      <McpServerConnectDialog
        org={ORG}
        slug={SLUG}
        open
        onClose={() => {}}
        onOpenDetails={() => {}}
      />,
      register,
    );
  }

  it("keeps the BYOA button on a hosted backend", async () => {
    renderDialog((router) => {
      router.service(McpServerQueryController, {
        getByReference: () =>
          buildVendorOAuthServer({ approval: VendorApprovalStatus.PENDING }),
        getOAuthGrantStatus: noGrant,
        getOrgOAuthApp: noOverride,
      });
    });

    expect(
      await screen.findByRole("button", { name: "Use your own OAuth app" }),
    ).toBeTruthy();
  });

  it("hides the BYOA button on an OSS backend and keeps honest copy", async () => {
    renderDialog((router) => {
      router.service(McpServerQueryController, {
        getByReference: () =>
          buildVendorOAuthServer({ approval: VendorApprovalStatus.PENDING }),
        getOAuthGrantStatus: noGrant,
      });
    });

    expect(
      await screen.findByText(/is awaiting vendor approval/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Use your own OAuth app" }),
      ).toBeNull(),
    );
  });
});
