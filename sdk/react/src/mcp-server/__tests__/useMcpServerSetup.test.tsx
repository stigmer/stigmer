/**
 * useMcpServerSetup walks each attached server from loading to ready: a
 * server whose credentials are missing waits in needsSetup until they are
 * submitted (saved into the person's credential serving the server, or kept
 * for this run only) or until the session's env pool covers them. A ready
 * server becomes a usage that attaches the whole server: no per-tool
 * selection rides on it, because the agent's own tool lists decide which
 * tools a session may call. Credentials are an in-memory world, so the save
 * is pinned as the one write it makes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import type { ResourceRef } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { ME, credentialWorld, routeCredentials, type CredentialWorld } from "../../credential/__tests__/credential-world";
import { useMcpServerSetup } from "../useMcpServerSetup";

let world: CredentialWorld = credentialWorld();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  world = credentialWorld();
});

const ORG = "acme";
const REF: ResourceRef = { org: ORG, slug: "zendesk", kind: ApiResourceKind.mcp_server };

/** A server that needs one secret and has discovered two tools. */
function serverNeedingToken() {
  const server = samples.mcpServer({ name: "Zendesk", org: ORG, slug: "zendesk" });
  server.spec = create(McpServerSpecSchema, {
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://zendesk.example/mcp" }),
    },
    env: { ZENDESK_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  });
  server.status = create(McpServerStatusSchema, {
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, { name: "get_ticket" }),
        create(DiscoveredToolSchema, { name: "delete_ticket", destructiveHint: true }),
      ],
    }),
  });
  return server;
}

function wrapper({ children }: { readonly children: ReactNode }) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router) => {
      router.service(McpServerQueryController, {
        getByReference: () => serverNeedingToken(),
      });
      routeCredentials(router, world);
    }),
  });
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

const WHOLE_SERVER_USAGE = {
  mcpServerRef: { org: ORG, slug: "zendesk", kind: ApiResourceKind.mcp_server },
};

async function addNeedingSetup(poolKeys?: Set<string>) {
  const hook = renderHook(
    ({ pool }: { pool?: Set<string> }) => useMcpServerSetup(ORG, pool),
    { wrapper, initialProps: { pool: poolKeys } },
  );
  await act(() => hook.result.current.addServer(REF));
  expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("needsSetup");
  return hook;
}

describe("useMcpServerSetup", () => {
  it("readies a server for this run only and attaches it whole", async () => {
    const { result } = await addNeedingSetup();

    await act(() =>
      result.current.submitEnvVars(
        REF,
        { ZENDESK_TOKEN: { value: "t", isSecret: true } },
        { saveForFuture: false },
      ),
    );

    expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
    expect(world.writes).toEqual([]);
    expect(result.current.pendingRuntimeEnv).toEqual({
      ZENDESK_TOKEN: { value: "t", isSecret: true },
    });
    expect(result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });

  it("readies a server after saving its credentials into a new credential of the person's serving it", async () => {
    const { result } = await addNeedingSetup();

    await act(() =>
      result.current.submitEnvVars(REF, { ZENDESK_TOKEN: { value: "t", isSecret: true } }),
    );

    expect(world.writes.map((w) => w.rpc)).toEqual(["create"]);
    const created = world.writes[0]!.credential;
    expect(created.metadata?.name).toBe("Zendesk");
    expect(created.spec?.owner).toEqual({ case: "person", value: ME });
    expect(Object.keys(created.spec?.fields ?? {})).toEqual(["ZENDESK_TOKEN"]);
    expect(created.spec?.serves.map((t) => t.target.case)).toEqual(["mcpServer"]);
    expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
    expect(result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });

  it("readies a waiting server once the session's env pool covers its credentials", async () => {
    const hook = await addNeedingSetup();

    hook.rerender({ pool: new Set(["ZENDESK_TOKEN"]) });

    await waitFor(() =>
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready"),
    );
    expect(hook.result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });
});
