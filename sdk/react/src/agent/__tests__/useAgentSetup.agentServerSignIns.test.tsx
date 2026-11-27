/**
 * An agent's own MCP server signs in as a plugin's does. Pinned: an agent
 * whose save recorded that its server's address asked for a sign-in
 * (`status.serverSignIns`) resolves to `needsEnvVars` with that server
 * under `pendingSignIns` (its home the agent, its row named as the agent
 * names the server) and no variable asked for its login key; a login at
 * the address in My vault makes the agent `ready`; an answer recorded at
 * another address, or none, leaves the server with no sign-in to offer.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";
import { MY_VAULT_ONLY } from "../../vault/conversationVaults";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "helper" };
const TOOLS = "https://tools.acme.test/mcp";

interface World {
  /** The address the save's answer was recorded at; undefined for no answer. */
  readonly answeredAt: string | undefined;
  /** The addresses My vault holds a login at. */
  readonly mine: string[];
}

function client(world: World) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ORG, slug: REF.slug, name: "Helper" }),
            spec: create(AgentSpecSchema, { mcpServers: [{ name: "app-tools", url: TOOLS, headers: {} }] }),
            status: {
              serverSignIns:
                world.answeredAt === undefined
                  ? []
                  : [create(AgentServerSignInSchema, { name: "app-tools", url: world.answeredAt, signIn: { oauthOnly: true } })],
            },
          }),
      });
      service(VaultQueryController, {
        getMine: () => {
          if (world.mine.length === 0) throw new ConnectError("no My vault yet", Code.NotFound);
          return create(VaultSchema, {
            metadata: { org: ORG, slug: "mine" },
            spec: {
              owner: { case: "person", value: "ida_1" },
              connections: Object.fromEntries(
                world.mine.map((address) => [address, { source: VaultConnectionSource.sign_in, signIn: { loginApp: "" } }]),
              ),
            },
          });
        },
      });
    }),
  });
}

async function resolved(world: World) {
  const stigmer = client(world);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
  const rendered = renderHook(() => ({ setup: useAgentSetup(ORG, undefined, MY_VAULT_ONLY), mine: useMyVault(ORG) }), { wrapper });
  await waitFor(() => expect(rendered.result.current.mine.isLoading).toBe(false));
  await act(async () => {
    await rendered.result.current.setup.resolveAgent(REF);
  });
  return rendered.result.current.setup.state;
}

describe("useAgentSetup and an agent's own server that signs in", () => {
  it("holds the agent until the server is signed in, offering it under the agent's home, never as a variable", async () => {
    const state = await resolved({ answeredAt: TOOLS, mine: [] });
    if (state.status !== "needsEnvVars") throw new Error(`expected needsEnvVars, got ${state.status}`);
    expect(state.pendingSignIns.map((signIn) => [signIn.home.kind, signIn.name, signIn.address])).toEqual([["agent", "app-tools", TOOLS]]);
    expect(state.missingVariables).toEqual([]);
  });

  it("is ready once My vault holds a login at the server's address", async () => {
    const state = await resolved({ answeredAt: TOOLS, mine: [TOOLS] });
    expect(state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it.each([
    ["an answer recorded at another address", "https://old.acme.test/mcp"],
    ["no answer", undefined],
  ])("offers no sign-in for %s", async (_label, answeredAt) => {
    const state = await resolved({ answeredAt, mine: [] });
    expect(state.status).toBe("ready");
  });
});
