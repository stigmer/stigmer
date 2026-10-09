import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { GetOAuthGrantStatusOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
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
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { useMcpServerCredentials } from "../useMcpServerCredentials";

/**
 * Pins which saved values count, by the run's rule: an HTTP tool's key is
 * filled by a login at its URL, and a pasted key is saved there; a local
 * program has no address, so its key is filled only by a secret of its
 * name, a typed token is saved as that secret, and a login saved anywhere
 * counts for nothing. An OAuth tool whose token was pasted at its own URL
 * is connected after a reload, though the grant reports no sign-in (a run
 * uses that login); it offers no disconnect, which only a sign-in has.
 */

afterEach(cleanup);

const ORG = "acme";

function buildServer(options: { withAuth: boolean }): McpServer {
  const server = samples.mcpServer({ name: "Vendor CRM", org: ORG, slug: "vendor-crm" });
  server.spec = create(McpServerSpecSchema, {
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://mcp.vendor.example.com" }),
    },
    ...(options.withAuth
      ? {
          auth: create(McpServerAuthSchema, { targetEnvVar: "VENDOR_ACCESS_TOKEN" }),
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

describe("useMcpServerCredentials — a local program's key", () => {
  const ELSEWHERE = "https://auth.vendor.example.com";

  /** A local program that takes its key as an environment variable: it has no address and no sign-in. */
  function localProgram(): McpServer {
    const server = samples.mcpServer({ id: "mcp_local", name: "Vendor CLI", org: ORG, slug: "vendor-cli" });
    server.spec = create(McpServerSpecSchema, {
      serverType: { case: "stdio", value: { command: "vendor-mcp" } },
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

  it("saves a typed token as a secret by its name, never as a login", async () => {
    const writes: string[] = [];
    const mine = create(VaultSchema, { metadata: { id: "vlt_mine", org: ORG }, spec: { owner: { case: "person", value: "ida_ana" } } });
    const { result } = render(mine, writes);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.authMode).toBe("manual");
    expect(result.current.missingVariables.map((v) => v.key)).toEqual(["VENDOR_TOKEN"]);

    await act(async () => {
      await result.current.saveCredentials({ VENDOR_TOKEN: { value: "tok", isSecret: true } });
    });
    expect(writes).toEqual(["setSecrets:VENDOR_TOKEN"]);
  });

  it("does not count a login saved anywhere as the key: a run never fills a local program from one", async () => {
    const mine = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: {
        owner: { case: "person", value: "ida_ana" },
        connections: { [ELSEWHERE]: { source: VaultConnectionSource.sign_in, signIn: { loginApp: "" } } },
      },
    });
    const { result } = render(mine);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.missingVariables.map((v) => v.key)).toEqual(["VENDOR_TOKEN"]);
    expect(result.current.isReady).toBe(false);
  });

  it("counts a secret by the key's name", async () => {
    const bySecret = create(VaultSchema, {
      metadata: { id: "vlt_mine", org: ORG },
      spec: { owner: { case: "person", value: "ida_ana" }, secrets: { VENDOR_TOKEN: { value: "" } } },
    });
    const { result } = render(bySecret);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.missingVariables).toEqual([]);
    expect(result.current.isReady).toBe(true);
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
    return renderCredentials(buildServer({ withAuth: true }), ORG, (router) => {
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
