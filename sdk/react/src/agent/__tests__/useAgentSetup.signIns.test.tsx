/**
 * An agent whose MCP server authenticates by OAuth is not ready until the
 * organization holds a grant for it. Pinned: resolving such an agent lands
 * in `needsEnvVars` with the server under `pendingSignIns` and no variable
 * asked for the token (the composed agent never declares it); a server with
 * a connected grant is not pending; a grant read that fails leaves the
 * server pending (fail-closed, the composer's own MCP rule); a server that
 * cannot be read is the resolution's error; `signInCompleted` for the last
 * pending server resolves the agent again and lands in `ready`; the pool
 * covering every variable does not skip a pending sign-in.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentInstanceListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema, McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { GetOAuthGrantStatusOutputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { HttpServerConfigSchema, McpServerAuthSchema, McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "reviewer" };

interface World {
  /** Per server slug: whether the organization holds a connected grant. `"unreadable"` makes the grant read fail; `"missing"` makes the server read fail. */
  readonly grants: Record<string, boolean | "unreadable" | "missing">;
}

function oauthServer(slug: string) {
  const variable = `${slug.toUpperCase()}_ACCESS_TOKEN`;
  return create(McpServerSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `mcp_${slug}`, org: ORG, slug, name: slug }),
    spec: create(McpServerSpecSchema, {
      serverType: { case: "http", value: create(HttpServerConfigSchema, { url: `https://${slug}.example/mcp` }) },
      auth: create(McpServerAuthSchema, { targetEnvVar: variable, oauthOnly: true }),
      env: { [variable]: create(EnvVarDeclarationSchema, { isSecret: true }) },
    }),
  });
}

function client(world: World, agentEnv: Record<string, { isSecret: boolean }> = {}) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ORG, slug: REF.slug, name: "Reviewer" }),
            spec: create(AgentSpecSchema, {
              env: Object.fromEntries(Object.entries(agentEnv).map(([k, v]) => [k, create(EnvVarDeclarationSchema, v)])),
              mcpServerUsages: Object.keys(world.grants).map((slug) =>
                create(McpServerUsageSchema, { mcpServerRef: create(ApiResourceReferenceSchema, { org: ORG, slug }) }),
              ),
            }),
          }),
      });
      service(McpServerQueryController, {
        getByReference: (ref) => {
          if (world.grants[ref.slug] === "missing") throw new ConnectError(`no server '${ref.slug}'`, Code.NotFound);
          return oauthServer(ref.slug);
        },
        getOAuthGrantStatus: (input) => {
          const slug = input.resourceId.replace(/^mcp_/, "");
          const grant = world.grants[slug];
          if (grant === "unreadable") throw new ConnectError("grant store away", Code.Unavailable);
          return create(GetOAuthGrantStatusOutputSchema, {
            connected: grant === true,
            connectionHealth: grant === true ? OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY : OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
          });
        },
      });
      service(AgentInstanceQueryController, { list: () => create(AgentInstanceListSchema, { items: [] }) });
      service(EnvironmentQueryController, { list: () => create(EnvironmentListSchema, { items: [] }) });
    }),
  });
}

function wrapper(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useAgentSetup and the agent's OAuth servers", () => {
  it("holds the agent until its servers without a grant are signed in, and never asks for the token as a variable", async () => {
    const world: { grants: Record<string, boolean | "unreadable" | "missing"> } = { grants: { linear: false, notion: true } };
    const { result } = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(client(world)) });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.resolveAgent(REF);
    });
    expect(outcome).toMatchObject({ status: "needsEnvVars", missingVariables: [] });
    expect(result.current.state.status).toBe("needsEnvVars");
    if (result.current.state.status !== "needsEnvVars") return;
    expect(result.current.state.pendingSignIns.map((s) => s.id)).toEqual(["mcp_linear"]);
    expect(result.current.state.pendingSignIns[0]?.health).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);

    // The sign-in lands; the world now holds the grant; the agent resolves again and is ready.
    world.grants.linear = true;
    await act(async () => {
      await result.current.signInCompleted("mcp_linear");
    });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("fails closed on a grant it cannot read, and fails the resolution on a server it cannot read", async () => {
    const { result } = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(client({ grants: { linear: "unreadable" } })) });
    await act(async () => {
      await result.current.resolveAgent(REF);
    });
    expect(result.current.state).toMatchObject({ status: "needsEnvVars", pendingSignIns: [expect.objectContaining({ id: "mcp_linear" })] });

    const broken = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(client({ grants: { ghost: "missing" } })) });
    await act(async () => {
      await expect(broken.result.current.resolveAgent(REF)).rejects.toThrow(/no server 'ghost'/);
    });
    expect(broken.result.current.state.error?.message).toMatch(/no server 'ghost'/);
  });

  it("keeps a pending sign-in even when the pool covers every variable, and refuses submitEnvVars meanwhile", async () => {
    const pool = new Set(["API_TOKEN"]);
    const { result } = renderHook(() => useAgentSetup(ORG, pool), {
      wrapper: wrapper(client({ grants: { linear: false } }, { API_TOKEN: { isSecret: true } })),
    });
    await act(async () => {
      await result.current.resolveAgent(REF);
    });
    expect(result.current.state).toMatchObject({ status: "needsEnvVars", missingVariables: [], pendingSignIns: [expect.objectContaining({ id: "mcp_linear" })] });
    await expect(result.current.submitEnvVars({})).rejects.toThrow(/every pending sign-in/);
  });
});
