import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  GetOrgOAuthAppOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  McpServerSpecSchema,
  McpServerAuthSchema,
  HttpServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { OAuthAppSource } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { useMcpServerCredentials } from "../useMcpServerCredentials";

/**
 * Pins the client-side derivation of the org-override signal
 * (stigmer-cloud#401): `effectiveOAuthSource` / `isOrgOAuthApp` /
 * `canBringOwnApp` are resolved from the `getOrgOAuthApp` RPC keyed on
 * the hook's `org` parameter — NOT from `status.oauth_status` fields 3-4,
 * which no backend populates (the caller's active org is client-side
 * context the read RPCs never carry; see the OAuthStatus proto).
 */

afterEach(cleanup);

const ORG = "acme";

function buildServer(options: { withAuth: boolean; withAppRef: boolean }): McpServer {
  const server = samples.mcpServer({ name: "Vendor CRM", org: ORG, slug: "vendor-crm" });
  server.spec = create(McpServerSpecSchema, {
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://mcp.vendor.example.com" }),
    },
    ...(options.withAuth
      ? {
          auth: create(McpServerAuthSchema, {
            targetEnvVar: "VENDOR_ACCESS_TOKEN",
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
        }
      : {}),
  });
  return server;
}

/** Baseline handlers so personal-env and grant-status fetches stay healthy. */
function baselineHandlers() {
  return {
    mcpServer: {
      getOAuthGrantStatus: () =>
        create(GetOAuthGrantStatusOutputSchema, { connected: false }),
    },
    environment: {
      list: () => create(EnvironmentListSchema, { items: [] }),
    },
  };
}

function renderCredentials(
  server: McpServer | null,
  org: string | null,
  register: Parameters<typeof createRouterTransport>[0],
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useMcpServerCredentials(org, server), { wrapper });
}

describe("useMcpServerCredentials — org-override derivation", () => {
  it("reports ORG_OVERRIDE when the org has a BYOA override", async () => {
    const base = baselineHandlers();
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp: () =>
            create(GetOrgOAuthAppOutputSchema, {
              hasOverride: true,
              oauthAppId: "oauthapp_01acme",
              clientId: "acme-client-id",
            }),
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOrgOAuthApp).toBe(true);
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_ORG_OVERRIDE,
    );
    expect(result.current.canBringOwnApp).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports PLATFORM when no override exists for the org", async () => {
    const base = baselineHandlers();
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp: () =>
            create(GetOrgOAuthAppOutputSchema, { hasOverride: false }),
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOrgOAuthApp).toBe(false);
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
    );
    expect(result.current.canBringOwnApp).toBe(true);
  });

  it("degrades to no-override with BYOA hidden when the backend does not implement the RPC (OSS)", async () => {
    // getOrgOAuthApp deliberately NOT registered: the router transport
    // answers UNIMPLEMENTED — exactly what the OSS server returns for the
    // hosted-only org-override surface (stigmer/stigmer#558). No override
    // can exist on that edition, so PLATFORM with no error is the truthful
    // source — and canBringOwnApp stays false (the #558 capability gate:
    // offering BYOA where the submit could only fail is a dead end).
    const base = baselineHandlers();
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, base.mcpServer);
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOrgOAuthApp).toBe(false);
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
    );
    expect(result.current.canBringOwnApp).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports NONE without firing the RPC when the server has no oauth_app_ref", async () => {
    const base = baselineHandlers();
    const getOrgOAuthApp = vi.fn(() =>
      create(GetOrgOAuthAppOutputSchema, { hasOverride: true }),
    );
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: false }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp,
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_NONE,
    );
    expect(result.current.isOrgOAuthApp).toBe(false);
    expect(result.current.canBringOwnApp).toBe(false);
    expect(getOrgOAuthApp).not.toHaveBeenCalled();
  });

  it("stays UNSPECIFIED without firing the RPC on a manual server", async () => {
    const base = baselineHandlers();
    const getOrgOAuthApp = vi.fn(() =>
      create(GetOrgOAuthAppOutputSchema, { hasOverride: true }),
    );
    const { result } = renderCredentials(
      buildServer({ withAuth: false, withAppRef: false }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp,
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.authMode).toBe("manual");
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_UNSPECIFIED,
    );
    expect(getOrgOAuthApp).not.toHaveBeenCalled();
  });

  it("reports UNSPECIFIED and surfaces the error when the lookup genuinely fails", async () => {
    const base = baselineHandlers();
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp: () => {
            throw new ConnectError("store unavailable", Code.Internal);
          },
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Unknown is not PLATFORM: guessing would hide a real override.
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_UNSPECIFIED,
    );
    expect(result.current.isOrgOAuthApp).toBe(false);
    // An errored probe never confirmed the surface exists — BYOA hides.
    expect(result.current.canBringOwnApp).toBe(false);
  });

  it("reports UNSPECIFIED without firing the RPC when org is null", async () => {
    const base = baselineHandlers();
    const getOrgOAuthApp = vi.fn(() =>
      create(GetOrgOAuthAppOutputSchema, { hasOverride: true }),
    );
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      null,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp,
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.effectiveOAuthSource).toBe(
      OAuthAppSource.OAUTH_APP_SOURCE_UNSPECIFIED,
    );
    expect(getOrgOAuthApp).not.toHaveBeenCalled();
  });

  it("refetch() re-resolves the override (BYOA set/remove flows update live)", async () => {
    const base = baselineHandlers();
    let hasOverride = false;
    const { result } = renderCredentials(
      buildServer({ withAuth: true, withAppRef: true }),
      ORG,
      (router) => {
        router.service(McpServerQueryController, {
          ...base.mcpServer,
          getOrgOAuthApp: () =>
            create(GetOrgOAuthAppOutputSchema, { hasOverride }),
        });
        router.service(EnvironmentQueryController, base.environment);
      },
    );

    await waitFor(() =>
      expect(result.current.effectiveOAuthSource).toBe(
        OAuthAppSource.OAUTH_APP_SOURCE_PLATFORM,
      ),
    );

    hasOverride = true;
    result.current.refetch();

    await waitFor(() =>
      expect(result.current.effectiveOAuthSource).toBe(
        OAuthAppSource.OAUTH_APP_SOURCE_ORG_OVERRIDE,
      ),
    );
    expect(result.current.isOrgOAuthApp).toBe(true);
  });
});
