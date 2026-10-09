/**
 * Which logins satisfy an agent's OAuth server: whatever a run of it would
 * use, read from the same vaults the run reads (My vault when the
 * conversation includes it, then the vaults it lists). The grant read
 * reports only a sign-in made for that server and kept in My vault, so the
 * composer must count the rest itself, or it refuses an agent the server
 * would run. Pinned: a token pasted at the HTTP tool's own URL in My vault
 * satisfies the server though the grant reports no grant; a sign-in made
 * for the server and kept in a vault the conversation lists satisfies it
 * too; a grant whose token expired keeps it pending whatever else holds a
 * login; a conversation that leaves My vault out counts neither its login
 * nor its grant; an agent of another organization never reads My vault.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { GetOAuthGrantStatusOutputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";
import { MY_VAULT_ONLY, type ConversationVaults } from "../../vault/conversationVaults";

afterEach(cleanup);

const ORG = "org_acme";
const REF = { org: ORG, slug: "reviewer" };
const LINEAR_URL = "https://linear.example/mcp";

const linear = create(McpServerSchema, {
  metadata: { id: "mcp_linear", org: ORG, slug: "linear", name: "Linear" },
  spec: {
    serverType: { case: "http", value: { url: LINEAR_URL } },
    auth: { targetEnvVar: "LINEAR_ACCESS_TOKEN" },
    env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  },
});

/** A vault holding one login at Linear's URL: pasted, or a sign-in made by `signedInBy`. */
function vaultWithLogin(slug: string, signedInBy?: string): Vault {
  return create(VaultSchema, {
    metadata: { id: `vlt_${slug}`, org: ORG, slug, name: slug },
    spec: {
      owner: slug === "mine" ? { case: "person", value: "ida_1" } : { case: "org", value: ORG },
      connections: {
        [LINEAR_URL]:
          signedInBy === undefined
            ? { source: VaultConnectionSource.pasted }
            : { source: VaultConnectionSource.sign_in, signIn: { mcpServerId: signedInBy } },
      },
    },
  });
}

interface World {
  /** My vault, or `null` when the person has none yet. */
  readonly mine: Vault | null;
  /** The shared vault the conversation lists, when it lists one. */
  readonly shared?: Vault;
  /** Whether the conversation includes My vault. */
  readonly includeMyVault?: boolean;
  /** The organization the agent belongs to. */
  readonly agentOrg?: string;
  /** What the grant read reports for Linear. */
  readonly health?: OAuthConnectionHealth;
}

function client(world: World) {
  const agentOrg = world.agentOrg ?? ORG;
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: { id: "agt_1", org: agentOrg, slug: REF.slug, name: "Reviewer" },
            spec: {
              env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
              mcpServerUsages: [create(McpServerUsageSchema, { mcpServerRef: { org: ORG, slug: "linear" } })],
            },
          }),
      });
      service(McpServerQueryController, {
        getByReference: () => linear,
        // The grant reports only a sign-in made for Linear in My vault.
        getOAuthGrantStatus: () => {
          const health = world.health ?? OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT;
          return create(GetOAuthGrantStatusOutputSchema, {
            connected: health !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
            connectionHealth: health,
          });
        },
      });
      service(VaultQueryController, {
        getMine: () => {
          if (world.mine === null) throw new ConnectError("no My vault yet", Code.NotFound);
          return world.mine;
        },
        getByReference: () => {
          if (world.shared === undefined) throw new ConnectError("no such vault", Code.NotFound);
          return world.shared;
        },
      });
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

/** Resolves the agent once My vault's read has settled, so the resolution sees what My vault holds. */
async function resolveSettled(world: World) {
  const choice: ConversationVaults = {
    includeMyVault: world.includeMyVault ?? MY_VAULT_ONLY.includeMyVault,
    vaults: world.shared === undefined ? [] : [{ org: ORG, slug: "team" }],
  };
  const { result } = renderHook(() => ({ setup: useAgentSetup(ORG, undefined, choice), mine: useMyVault(ORG) }), {
    wrapper: wrapper(client(world)),
  });
  await waitFor(() => expect(result.current.mine.isLoading).toBe(false));
  expect(result.current.mine.vault?.metadata?.id).toBe(world.mine?.metadata?.id);
  await act(async () => {
    await result.current.setup.resolveAgent(REF);
  });
  return result.current.setup.state;
}

describe("useAgentSetup counts the logins a run reads", () => {
  it("counts a token pasted at the tool's URL in My vault, though the grant reports no grant", async () => {
    const state = await resolveSettled({ mine: vaultWithLogin("mine") });
    expect(state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("counts a sign-in made for the server and kept in a vault the conversation lists", async () => {
    const state = await resolveSettled({ mine: null, shared: vaultWithLogin("team", "mcp_linear") });
    expect(state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("keeps the server pending while the grant's token is expired, whatever else holds a login", async () => {
    const state = await resolveSettled({
      mine: vaultWithLogin("mine"),
      health: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
    });
    expect(state).toMatchObject({
      status: "needsEnvVars",
      pendingSignIns: [
        expect.objectContaining({ id: "mcp_linear", health: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED }),
      ],
    });
  });

  it("counts neither My vault's login nor its grant when the conversation leaves My vault out", async () => {
    const state = await resolveSettled({
      mine: vaultWithLogin("mine", "mcp_linear"),
      health: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
      includeMyVault: false,
    });
    expect(state).toMatchObject({ status: "needsEnvVars", pendingSignIns: [expect.objectContaining({ id: "mcp_linear" })] });
  });

  it("counts no login of My vault for an agent of another organization", async () => {
    const state = await resolveSettled({
      mine: vaultWithLogin("mine"),
      health: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
      agentOrg: "org_globex",
    });
    expect(state).toMatchObject({ status: "needsEnvVars", pendingSignIns: [expect.objectContaining({ id: "mcp_linear" })] });
  });
});
