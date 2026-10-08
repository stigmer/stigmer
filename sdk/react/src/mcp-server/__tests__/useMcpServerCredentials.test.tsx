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
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { act } from "@testing-library/react";
import { Code as VaultCode, ConnectError as VaultConnectError } from "@connectrpc/connect";
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
 * Pins the client-side derivation of the org-override signal:
 * `effectiveOAuthSource` / `isOrgOAuthApp` /
 * `canBringOwnApp` are resolved from the `getOrgOAuthApp` RPC keyed on
 * the hook's `org` parameter — NOT from `status.oauth_status` fields 3-4,
 * which no backend populates (the caller's active org is client-side
 * context the read RPCs never carry; see the OAuthStatus proto).
 *
 * Also pins which saved values count, by the run's rule: an HTTP tool's key
 * is filled by a login at its URL, and a pasted key is saved there; a local
 * program's key only by a secret of its name or a sign-in it made, so a
 * typed token is saved as that secret and a pasted login at its discovery
 * URL counts for nothing. An OAuth tool whose token was pasted at its own
 * URL is connected after a reload, though the grant reports no grant (a
 * run uses that login, and the server refuses a sign-in over it); it offers
 * no disconnect, which only a sign-in has.
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

/** Baseline handlers so My vault and grant-status fetches stay healthy. */
function baselineHandlers() {
  return {
    mcpServer: {
      getOAuthGrantStatus: () =>
        create(GetOAuthGrantStatusOutputSchema, { connected: false }),
    },
    myVault: {
      getMine: () => {
        throw new VaultConnectError("no My vault yet", VaultCode.NotFound);
      },
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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
        router.service(VaultQueryController, base.myVault);
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

describe("useMcpServerCredentials — an API-key tool's login slot", () => {
  /** A tool whose bearer header names its key: the slot a pasted token fills. */
  function apiKeyTool(): McpServer {
    const server = samples.mcpServer({ name: "Zendesk", org: ORG, slug: "zendesk" });
    server.spec = create(McpServerSpecSchema, {
      serverType: {
        case: "http",
        value: create(HttpServerConfigSchema, {
          url: "https://mcp.zendesk.example.com/mcp/",
          headers: { Authorization: "Bearer ${ZENDESK_API_KEY}" },
        }),
      },
      env: { ZENDESK_API_KEY: { isSecret: true }, ZENDESK_SUBDOMAIN: { isSecret: true } },
    });
    return server;
  }

  it("counts a login saved at the tool's address as its key, and saves a pasted key as that login", async () => {
    const base = baselineHandlers();
    const writes: string[] = [];
    const mine = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: {
        owner: { case: "person", value: "ida_ana" },
        connections: { "https://mcp.zendesk.example.com/mcp": { token: "" } },
      },
    });
    const { result } = renderCredentials(apiKeyTool(), ORG, (router) => {
      router.service(McpServerQueryController, { ...base.mcpServer });
      router.service(VaultQueryController, { getMine: () => mine });
      router.service(VaultCommandController, {
        setConnection: (req) => {
          writes.push(`setConnection:${req.address}=${req.token}`);
          return mine;
        },
        setSecrets: (req) => {
          writes.push(`setSecrets:${Object.keys(req.secrets).join(",")}`);
          return mine;
        },
      });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.missingVariables.map((v) => v.key)).toEqual(["ZENDESK_SUBDOMAIN"]);

    await act(async () => {
      await result.current.saveCredentials({
        ZENDESK_API_KEY: { value: "zd-key", isSecret: true },
        ZENDESK_SUBDOMAIN: { value: "acme", isSecret: true },
      });
    });
    expect(writes).toEqual([
      "setConnection:https://mcp.zendesk.example.com/mcp=zd-key",
      "setSecrets:ZENDESK_SUBDOMAIN",
    ]);
  });
});

describe("useMcpServerCredentials — a local program's login key", () => {
  const DISCOVERY = "https://auth.vendor.example.com";

  /** A local program whose key a sign-in or a typed token fills; its address is only a discovery URL. */
  function localProgram(): McpServer {
    const server = samples.mcpServer({ id: "mcp_local", name: "Vendor CLI", org: ORG, slug: "vendor-cli" });
    server.spec = create(McpServerSpecSchema, {
      serverType: { case: "stdio", value: { command: "vendor-mcp" } },
      auth: create(McpServerAuthSchema, { targetEnvVar: "VENDOR_TOKEN", discoveryUrl: `${DISCOVERY}/` }),
      env: { VENDOR_TOKEN: { isSecret: true } },
    });
    return server;
  }

  function render(mine: Vault, writes: string[] = []) {
    const base = baselineHandlers();
    return renderCredentials(localProgram(), ORG, (router) => {
      router.service(McpServerQueryController, { ...base.mcpServer });
      router.service(VaultQueryController, { getMine: () => mine });
      router.service(VaultCommandController, {
        setConnection: (req) => {
          writes.push(`setConnection:${req.address}`);
          return mine;
        },
        setSecrets: (req) => {
          writes.push(`setSecrets:${Object.keys(req.secrets).join(",")}`);
          return mine;
        },
      });
    });
  }

  it("saves a typed token as a secret by its name, never as a login at the discovery URL", async () => {
    const writes: string[] = [];
    const mine = create(VaultSchema, { metadata: { id: "vlt_mine", org: ORG }, spec: { owner: { case: "person", value: "ida_ana" } } });
    const { result } = render(mine, writes);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setManualOverride(true));
    expect(result.current.missingVariables.map((v) => v.key)).toEqual(["VENDOR_TOKEN"]);

    await act(async () => {
      await result.current.saveCredentials({ VENDOR_TOKEN: { value: "tok", isSecret: true } });
    });
    expect(writes).toEqual(["setSecrets:VENDOR_TOKEN"]);
  });

  it("does not count a pasted login at the discovery URL as the key: a run never fills a local program from one", async () => {
    const mine = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: { owner: { case: "person", value: "ida_ana" }, connections: { [DISCOVERY]: { token: "" } } },
    });
    const { result } = render(mine);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setManualOverride(true));
    expect(result.current.missingVariables.map((v) => v.key)).toEqual(["VENDOR_TOKEN"]);
    expect(result.current.isReady).toBe(false);
  });

  it("counts a sign-in this local program made, and a secret by the key's name", async () => {
    const signedIn = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: {
        owner: { case: "person", value: "ida_ana" },
        connections: { [DISCOVERY]: { source: VaultConnectionSource.sign_in, signIn: { mcpServerId: "mcp_local", localProgram: true } } },
      },
    });
    const first = render(signedIn);
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    act(() => first.result.current.setManualOverride(true));
    expect(first.result.current.missingVariables).toEqual([]);

    const bySecret = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: { owner: { case: "person", value: "ida_ana" }, secrets: { VENDOR_TOKEN: { value: "" } } },
    });
    const second = render(bySecret);
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    act(() => second.result.current.setManualOverride(true));
    expect(second.result.current.missingVariables).toEqual([]);
    expect(second.result.current.isReady).toBe(true);
  });
});

describe("useMcpServerCredentials — an OAuth tool's token pasted by hand", () => {
  /** My vault holding a pasted login at `address`. */
  function mineWithLogin(address: string): Vault {
    return create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: {
        owner: { case: "person", value: "ida_ana" },
        connections: { [address]: { source: VaultConnectionSource.pasted } },
      },
    });
  }

  function render(mine: Vault) {
    const base = baselineHandlers();
    return renderCredentials(buildServer({ withAuth: true, withAppRef: false }), ORG, (router) => {
      router.service(McpServerQueryController, { ...base.mcpServer });
      router.service(VaultQueryController, { getMine: () => mine });
    });
  }

  it("is connected and ready after a reload when My vault holds the token at the tool's own URL", async () => {
    const { result } = render(mineWithLogin("https://mcp.vendor.example.com"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.manualOverride).toBe(false);
    expect(result.current.isOAuthConnected).toBe(true);
    expect(result.current.isReady).toBe(true);
    expect(result.current.canDisconnect).toBe(false);
  });

  it("is not connected when the pasted token sits at another address", async () => {
    const { result } = render(mineWithLogin("https://mcp.vendor.example.com/other"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOAuthConnected).toBe(false);
    expect(result.current.isReady).toBe(false);
  });
});
