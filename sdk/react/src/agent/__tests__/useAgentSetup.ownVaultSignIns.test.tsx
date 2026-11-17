/**
 * Which logins satisfy a plugin server that signs in: whatever a run of
 * the agent would use, read from the same vaults the run reads (My vault
 * when the conversation includes it, then the vaults it lists). Pinned: a
 * token pasted at the server's own URL in My vault satisfies it; a sign-in
 * at the server's address kept in a vault the conversation lists satisfies
 * it too; a conversation that leaves My vault out counts none of its
 * logins; an agent of another organization never reads My vault.
 *
 * And where an owed sign-in can be saved (`signInVaults`), on the state and
 * the result alike: My vault for a run that may read it, whether or not the
 * conversation includes it now (signing in includes it), with no
 * permission asked; for a run that never reads My vault, the listed vaults
 * the person may edit, or, when they may edit none, the listed vaults by
 * name, or none when nothing is listed. A My vault the conversation lists
 * by reference is no vault such a run reads (the server skips it): its
 * logins count for nothing and it is never offered. A permission check
 * that fails is the resolution's error, never "ask someone else".
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema, type Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { CheckAuthorizationResultSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";

import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";
import { MY_VAULT_ONLY, type ConversationVaults } from "../../vault/conversationVaults";
import type { AgentSetupResult, AgentSetupState } from "../agentSetupReducer";

afterEach(cleanup);

const ORG = "org_acme";
const REF = { org: ORG, slug: "reviewer" };
const LINEAR_URL = "https://linear.example/mcp";

const linear = create(PluginSchema, {
  metadata: { id: "plg_linear", org: ORG, slug: "linear", name: "linear" },
  status: {
    mcpServers: [
      {
        name: "linear",
        transport: { case: "http", value: { url: LINEAR_URL, headers: { Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}" } } },
        env: ["LINEAR_ACCESS_TOKEN"],
        signIn: {},
      },
    ],
    env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  },
});

/** A vault holding one login at Linear's URL: pasted, or a sign-in made through `signedInBy` (a login app, "" for the address's own login server). */
function vaultWithLogin(slug: string, signedInBy?: string): Vault {
  return create(VaultSchema, {
    metadata: { id: `vlt_${slug}`, org: ORG, slug, name: slug },
    spec: {
      owner: slug === "mine" ? { case: "person", value: "ida_1" } : { case: "org", value: ORG },
      connections: {
        [LINEAR_URL]:
          signedInBy === undefined
            ? { source: VaultConnectionSource.pasted }
            : { source: VaultConnectionSource.sign_in, signIn: { loginApp: signedInBy } },
      },
    },
  });
}

/** A shared vault holding no login. */
function emptyVault(slug: string): Vault {
  return create(VaultSchema, {
    metadata: { id: `vlt_${slug}`, org: ORG, slug, name: slug === "team" ? "Team logins" : slug },
    spec: { owner: { case: "org", value: ORG }, connections: {} },
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
  /** The answer to "may I edit this vault?": yes, no, or a failed check. */
  readonly canEdit?: boolean | "fails";
}

/** Each permission the hook asked, as `kind/id:relation`. */
const asked: string[] = [];
afterEach(() => {
  asked.length = 0;
});

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
              plugins: [{ org: ORG, slug: "linear" }],
            },
          }),
      });
      service(PluginQueryController, {
        getByReference: () => linear,
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
      service(GrantQueryController, {
        checkMyPermission: (input) => {
          asked.push(`${input.resource?.kind}/${input.resource?.id}:${input.relation}`);
          if (world.canEdit === "fails") throw new ConnectError("the permission service is unavailable", Code.Unavailable);
          return create(CheckAuthorizationResultSchema, { isAuthorized: world.canEdit ?? false });
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
  return (await resolveWith(world)).state;
}

/** {@link resolveSettled}, answering the state, what `resolveAgent` returned, and what it threw. */
async function resolveWith(
  world: World,
): Promise<{ state: AgentSetupState; outcome: AgentSetupResult | undefined; thrown: unknown }> {
  const choice: ConversationVaults = {
    includeMyVault: world.includeMyVault ?? MY_VAULT_ONLY.includeMyVault,
    vaults: world.shared === undefined ? [] : [{ org: ORG, slug: "team" }],
  };
  const { result } = renderHook(() => ({ setup: useAgentSetup(ORG, undefined, choice), mine: useMyVault(ORG) }), {
    wrapper: wrapper(client(world)),
  });
  await waitFor(() => expect(result.current.mine.isLoading).toBe(false));
  expect(result.current.mine.vault?.metadata?.id).toBe(world.mine?.metadata?.id);
  let outcome: AgentSetupResult | undefined;
  let thrown: unknown;
  await act(async () => {
    try {
      outcome = await result.current.setup.resolveAgent(REF);
    } catch (err) {
      thrown = err;
    }
  });
  return { state: result.current.setup.state, outcome, thrown };
}

describe("useAgentSetup counts the logins a run reads", () => {
  it("counts a token pasted at the server's URL in My vault", async () => {
    const state = await resolveSettled({ mine: vaultWithLogin("mine") });
    expect(state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("counts a sign-in made for the server and kept in a vault the conversation lists", async () => {
    const state = await resolveSettled({ mine: null, shared: vaultWithLogin("team", "") });
    expect(state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("counts no login of My vault when the conversation leaves My vault out", async () => {
    const state = await resolveSettled({
      mine: vaultWithLogin("mine", ""),
      includeMyVault: false,
    });
    expect(state).toMatchObject({ status: "needsEnvVars", pendingSignIns: [expect.objectContaining({ address: LINEAR_URL })] });
  });

  it("counts no login of My vault for an agent of another organization", async () => {
    const state = await resolveSettled({
      mine: vaultWithLogin("mine"),
      agentOrg: "org_globex",
    });
    expect(state).toMatchObject({ status: "needsEnvVars", pendingSignIns: [expect.objectContaining({ address: LINEAR_URL })] });
  });
});

describe("useAgentSetup says where a run's owed sign-ins can be saved", () => {
  it("saves them in My vault for a run that may read it, asking no vault's permission", async () => {
    const { state, outcome } = await resolveWith({ mine: null });
    expect(state).toMatchObject({ status: "needsEnvVars", signInVaults: { kind: "my-vault" } });
    expect(outcome).toMatchObject({ status: "needsEnvVars", signInVaults: { kind: "my-vault" } });
    expect(asked).toEqual([]);
  });

  it("keeps My vault for a run of the person's organization whose conversation leaves it out", async () => {
    const { state } = await resolveWith({ mine: null, shared: emptyVault("team"), includeMyVault: false, canEdit: true });
    expect(state).toMatchObject({ status: "needsEnvVars", signInVaults: { kind: "my-vault" } });
    expect(asked).toEqual([]);
  });

  it("offers a listed vault the person may edit to a run of another organization's agent", async () => {
    const { state, outcome } = await resolveWith({
      mine: vaultWithLogin("mine"),
      shared: emptyVault("team"),
      agentOrg: "org_globex",
      canEdit: true,
    });
    const signInVaults = { kind: "shared", vaults: [{ org: ORG, id: "vlt_team", name: "Team logins" }] };
    expect(state).toMatchObject({ status: "needsEnvVars", signInVaults });
    expect(outcome).toMatchObject({ status: "needsEnvVars", signInVaults });
    expect(asked).toEqual(["vault/vlt_team:can_edit"]);
  });

  it("names the listed vaults when the person may edit none of them", async () => {
    const { state } = await resolveWith({
      mine: vaultWithLogin("mine"),
      shared: emptyVault("team"),
      agentOrg: "org_globex",
      canEdit: false,
    });
    expect(state).toMatchObject({
      status: "needsEnvVars",
      signInVaults: { kind: "nowhere", listed: [{ org: ORG, id: "vlt_team", name: "Team logins" }] },
    });
  });

  it("names no vault when the conversation lists none", async () => {
    const { state } = await resolveWith({ mine: vaultWithLogin("mine"), agentOrg: "org_globex" });
    expect(state).toMatchObject({ status: "needsEnvVars", signInVaults: { kind: "nowhere", listed: [] } });
    expect(asked).toEqual([]);
  });

  it("neither counts nor offers a My vault the conversation lists, for a run that never reads My vault", async () => {
    const { state } = await resolveWith({
      mine: null,
      shared: vaultWithLogin("mine"),
      agentOrg: "org_globex",
      canEdit: true,
    });
    expect(state).toMatchObject({
      status: "needsEnvVars",
      pendingSignIns: [expect.objectContaining({ address: LINEAR_URL })],
      signInVaults: { kind: "nowhere", listed: [] },
    });
    expect(asked).toEqual([]);
  });

  it("makes a permission check that fails the resolution's error", async () => {
    const { state, outcome, thrown } = await resolveWith({
      mine: null,
      shared: emptyVault("team"),
      agentOrg: "org_globex",
      canEdit: "fails",
    });
    expect(outcome).toBeUndefined();
    expect(String(thrown)).toMatch(/permission service is unavailable/);
    expect(state.status).toBe("resolving");
    expect(state.error?.message).toMatch(/permission service is unavailable/);
  });
});
