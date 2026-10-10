/**
 * An agent whose plugin carries a server that signs in is not ready until a
 * login at the server's address is held where the run reads. Pinned:
 * resolving such an agent lands in `needsEnvVars` with the server under
 * `pendingSignIns` (keyed by its address) and no variable asked for its
 * login key; a server whose address has a login in My vault is not
 * pending; a plugin that cannot be read is the resolution's error;
 * `signInCompleted` for the last pending address reads My vault again and
 * lands in `ready`; the pool covering every variable does not skip a
 * pending sign-in.
 *
 * The plugin declares the login key (install writes it), and the agent may
 * declare it too. Pinned for both: a login at the address satisfies it and
 * the agent resolves `ready` in direct mode; without one the key is the
 * Sign in row and never a form field; a key of the agent's own beside it,
 * and one the plugin's server reads, are still asked for.
 *
 * A login in My vault counts only when the conversation includes My vault,
 * and a listed vault's login counts only at the server's own address.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";
import { MY_VAULT_ONLY, type ConversationVaults } from "../../vault/conversationVaults";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "reviewer" };

const addressOf = (slug: string) => `https://${slug}.example/mcp`;
const loginKeyOf = (slug: string) => `${slug.toUpperCase()}_ACCESS_TOKEN`;

interface World {
  /** The plugins the agent lists, by slug: `"missing"` makes the plugin's read fail. */
  readonly plugins: Record<string, "ok" | "missing">;
  /** The addresses My vault holds a login at; mutable so a sign-in can land. */
  readonly mine: string[];
  /** The shared vault a conversation may list; absent, reading it fails. */
  readonly listedVault?: Vault;
  /** A variable the plugin's server reads besides its login key. */
  readonly serverKey?: string;
}

function signInPlugin(slug: string, serverKey?: string) {
  const loginKey = loginKeyOf(slug);
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `plg_${slug}`, org: ORG, slug, name: slug }),
    status: {
      mcpServers: [
        {
          name: slug,
          transport: { case: "http", value: { url: addressOf(slug), headers: { Authorization: `Bearer \${${loginKey}}` } } },
          env: serverKey === undefined ? [loginKey] : [loginKey, serverKey],
          signIn: { oauthOnly: true },
        },
      ],
      env: { [loginKey]: create(EnvVarDeclarationSchema, { isSecret: true }) },
    },
  });
}

function vaultWith(addresses: readonly string[], owner: "person" | "org"): Vault {
  return create(VaultSchema, {
    metadata: { org: ORG, slug: owner === "person" ? "mine" : "team" },
    spec: {
      owner: owner === "person" ? { case: "person", value: "ida_1" } : { case: "org", value: ORG },
      connections: Object.fromEntries(addresses.map((address) => [address, { source: VaultConnectionSource.sign_in, signIn: { loginApp: "" } }])),
    },
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
              plugins: Object.keys(world.plugins).map((slug) => ({ org: ORG, slug })),
            }),
          }),
      });
      service(PluginQueryController, {
        getByReference: (ref) => {
          if (world.plugins[ref.slug] === "missing") throw new ConnectError(`no plugin '${ref.slug}'`, Code.NotFound);
          return signInPlugin(ref.slug, world.serverKey);
        },
      });
      service(VaultQueryController, {
        getMine: () => {
          if (world.mine.length === 0) throw new ConnectError("no My vault yet", Code.NotFound);
          return vaultWith(world.mine, "person");
        },
        getByReference: () => {
          if (!world.listedVault) throw new ConnectError("no such vault", Code.NotFound);
          return world.listedVault;
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

/** The setup hook beside a My vault reader, settled once My vault's first read lands, as a composer mounts them. */
async function renderSettled(
  world: World,
  agentEnv: Record<string, { isSecret: boolean }> = {},
  options: { readonly pool?: Set<string>; readonly choice?: ConversationVaults } = {},
) {
  const rendered = renderHook(
    () => ({ setup: useAgentSetup(ORG, options.pool, options.choice ?? MY_VAULT_ONLY), mine: useMyVault(ORG) }),
    { wrapper: wrapper(client(world, agentEnv)) },
  );
  await waitFor(() => expect(rendered.result.current.mine.isLoading).toBe(false));
  return rendered;
}

describe("useAgentSetup and the servers of the agent's plugins that sign in", () => {
  it("holds the agent until its servers without a login are signed in, and never asks for the login key as a variable", async () => {
    const world: World = { plugins: { linear: "ok", notion: "ok" }, mine: [addressOf("notion")] };
    const { result } = await renderSettled(world);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.setup.resolveAgent(REF);
    });
    const state = result.current.setup.state;
    expect(outcome).toMatchObject({ status: "needsEnvVars", missingVariables: [] });
    if (state.status !== "needsEnvVars") throw new Error(`expected needsEnvVars, got ${state.status}`);
    expect(state.pendingSignIns.map((s) => s.address)).toEqual([addressOf("linear")]);
    expect(state.pendingSignIns[0]).toMatchObject({ plugin: { org: ORG, slug: "linear" }, name: "linear" });

    // The sign-in lands in My vault through the row's own hook; the agent is resolved again over a fresh read.
    world.mine.push(addressOf("linear"));
    await act(async () => {
      await result.current.setup.signInCompleted(addressOf("linear"));
    });
    await waitFor(() => expect(result.current.setup.state.status).toBe("ready"));
    expect(result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("fails the resolution on a plugin it cannot read", async () => {
    const { result } = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(client({ plugins: { ghost: "missing" }, mine: [] })) });
    await act(async () => {
      await expect(result.current.resolveAgent(REF)).rejects.toThrow(/no plugin 'ghost'/);
    });
    expect(result.current.state.error?.message).toMatch(/no plugin 'ghost'/);
  });

  it("treats a login at the address as satisfying the declaration of the login key", async () => {
    const { result } = await renderSettled({ plugins: { linear: "ok" }, mine: [addressOf("linear")] }, { LINEAR_ACCESS_TOKEN: { isSecret: true } });
    await act(async () => {
      await result.current.setup.resolveAgent(REF);
    });
    expect(result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("still asks for the agent's own keys and the keys a plugin server reads beside a satisfied login key", async () => {
    const { result } = await renderSettled(
      { plugins: { linear: "ok" }, mine: [addressOf("linear")], serverKey: "LINEAR_WORKSPACE" },
      { API_TOKEN: { isSecret: true } },
    );
    await act(async () => {
      await result.current.setup.resolveAgent(REF);
    });
    const state = result.current.setup.state;
    if (state.status !== "needsEnvVars") throw new Error(`expected needsEnvVars, got ${state.status}`);
    expect(state.pendingSignIns).toEqual([]);
    expect(state.missingVariables.map((v) => v.key).sort()).toEqual(["API_TOKEN", "LINEAR_WORKSPACE"]);
  });

  it("keeps a pending sign-in even when the pool covers every variable, and refuses submitEnvVars meanwhile", async () => {
    const pool = new Set(["API_TOKEN"]);
    const { result } = renderHook(() => useAgentSetup(ORG, pool), {
      wrapper: wrapper(client({ plugins: { linear: "ok" }, mine: [] }, { API_TOKEN: { isSecret: true } })),
    });
    await act(async () => {
      await result.current.resolveAgent(REF);
    });
    expect(result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [],
      pendingSignIns: [expect.objectContaining({ address: addressOf("linear") })],
    });
    await expect(result.current.submitEnvVars({})).rejects.toThrow(/every pending sign-in/);
  });

  it("gives a login in My vault no credit when the conversation leaves My vault out", async () => {
    const LISTED = { includeMyVault: false, vaults: [{ org: ORG, slug: "team" }] };
    const { result } = renderHook(() => useAgentSetup(ORG, undefined, LISTED), {
      wrapper: wrapper(client({ plugins: { linear: "ok" }, mine: [addressOf("linear")], listedVault: vaultWith([], "org") })),
    });
    await act(async () => {
      await result.current.resolveAgent(REF);
    });
    expect(result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [],
      pendingSignIns: [expect.objectContaining({ address: addressOf("linear") })],
    });
  });

  it("counts a listed vault's login at the server's address, and none elsewhere", async () => {
    const LISTED = { includeMyVault: false, vaults: [{ org: ORG, slug: "team" }] };

    const foreign = renderHook(() => useAgentSetup(ORG, undefined, LISTED), {
      wrapper: wrapper(client({ plugins: { linear: "ok" }, mine: [], listedVault: vaultWith(["https://other.example/mcp"], "org") })),
    });
    await act(async () => {
      await foreign.result.current.resolveAgent(REF);
    });
    expect(foreign.result.current.state).toMatchObject({
      status: "needsEnvVars",
      pendingSignIns: [expect.objectContaining({ address: addressOf("linear") })],
    });

    const own = renderHook(() => useAgentSetup(ORG, undefined, LISTED), {
      wrapper: wrapper(client({ plugins: { linear: "ok" }, mine: [], listedVault: vaultWith([addressOf("linear")], "org") })),
    });
    await act(async () => {
      await own.result.current.resolveAgent(REF);
    });
    expect(own.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });
});
