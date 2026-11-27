/**
 * What an app user's setup counts and offers (a person signed in to a host's
 * product through a token the host's backend mints: `whoAmI` answers their
 * account with `provisioning_mode: app_user`). Their own turn reads only the
 * logins in their My vault, each for the tool at its address, never a key
 * by name from it; the keys by name come from the vaults the integrator
 * chose, which this client cannot read. Pinned: a login at a server's
 * address in My vault satisfies its sign-in, and an owed one is still
 * offered into My vault (where the run reads it); a secret in My vault
 * counts for nothing, so an agent whose key only My vault holds resolves
 * `direct`, never `saved`; a key nothing visible holds is never offered for
 * saving (no form: the server's refusal names who provides it), neither
 * beside an owed sign-in nor alone; a person with the same vault is still
 * asked and counted as before; and while `whoAmI` is unanswered the
 * resolution stays `resolving`, so no form is offered and then withdrawn.
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
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "reviewer" };
const LINEAR = "https://linear.example/mcp";

interface World {
  /** Who `whoAmI` answers; a promise holds the answer back. */
  readonly account: IdentityAccount | Promise<IdentityAccount>;
  /** The secret names My vault holds. */
  readonly secrets: readonly string[];
  /** The addresses My vault holds a login at. */
  readonly logins: readonly string[];
  /** Whether the agent lists a plugin whose server signs in at LINEAR, reading SERVER_KEY besides its login. */
  readonly signsIn?: boolean;
}

function accountOf(mode: IdentityAccountProvisioningMode): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "ida_1", org: ORG }),
    spec: { provisioningMode: mode },
  });
}

const APP_USER = accountOf(IdentityAccountProvisioningMode.app_user);
const PERSON = accountOf(IdentityAccountProvisioningMode.direct);

function linearPlugin() {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "plg_linear", org: ORG, slug: "linear", name: "linear" }),
    status: {
      mcpServers: [
        {
          name: "linear",
          transport: { case: "http", value: { url: LINEAR, headers: { Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}" } } },
          env: ["LINEAR_ACCESS_TOKEN", "SERVER_KEY"],
          signIn: { oauthOnly: true },
        },
      ],
      env: {
        LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }),
        SERVER_KEY: create(EnvVarDeclarationSchema, { isSecret: true }),
      },
    },
  });
}

function client(world: World) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(IdentityAccountQueryController, { whoAmI: () => world.account });
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ORG, slug: REF.slug, name: "Reviewer" }),
            spec: create(AgentSpecSchema, {
              env: { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
              plugins: world.signsIn === true ? [{ org: ORG, slug: "linear" }] : [],
            }),
          }),
      });
      service(PluginQueryController, { getByReference: () => linearPlugin() });
      service(VaultQueryController, {
        getMine: () => {
          if (world.secrets.length === 0 && world.logins.length === 0) {
            throw new ConnectError("no My vault yet", Code.NotFound);
          }
          return create(VaultSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "vlt_1", org: ORG, slug: "mine" }),
            spec: {
              owner: { case: "person", value: "ida_1" },
              secrets: Object.fromEntries(world.secrets.map((key) => [key, { value: "" }])),
              connections: Object.fromEntries(
                world.logins.map((address) => [address, { source: VaultConnectionSource.sign_in, signIn: { loginApp: "" } }]),
              ),
            },
          });
        },
        getByReference: () => {
          throw new ConnectError("no such vault", Code.NotFound);
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
async function renderSettled(world: World) {
  const rendered = renderHook(() => ({ setup: useAgentSetup(ORG), mine: useMyVault(ORG) }), {
    wrapper: wrapper(client(world)),
  });
  await waitFor(() => expect(rendered.result.current.mine.isLoading).toBe(false));
  return rendered;
}

describe("useAgentSetup for an app user", () => {
  it("counts no secret of My vault: a key only My vault holds resolves direct, never saved; a person's resolves saved", async () => {
    for (const [account, mode] of [
      [APP_USER, "direct"],
      [PERSON, "saved"],
    ] as const) {
      const { result, unmount } = await renderSettled({ account, secrets: ["API_TOKEN"], logins: [] });
      await act(async () => {
        await result.current.setup.resolveAgent(REF);
      });
      expect(result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode } });
      unmount();
    }
  });

  it("never offers a key by name for saving: an app user resolves direct where a person is asked", async () => {
    const appUser = await renderSettled({ account: APP_USER, secrets: [], logins: [] });
    await act(async () => {
      await appUser.result.current.setup.resolveAgent(REF);
    });
    expect(appUser.result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
    appUser.unmount();

    const person = await renderSettled({ account: PERSON, secrets: [], logins: [] });
    await act(async () => {
      await person.result.current.setup.resolveAgent(REF);
    });
    expect(person.result.current.setup.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [expect.objectContaining({ key: "API_TOKEN" })],
    });
  });

  it("counts a login in My vault at the server's address, and offers an owed sign-in into My vault with no key beside it", async () => {
    const signedIn = await renderSettled({ account: APP_USER, secrets: [], logins: [LINEAR], signsIn: true });
    await act(async () => {
      await signedIn.result.current.setup.resolveAgent(REF);
    });
    expect(signedIn.result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
    signedIn.unmount();

    const owed = await renderSettled({ account: APP_USER, secrets: ["SERVER_KEY"], logins: [], signsIn: true });
    await act(async () => {
      await owed.result.current.setup.resolveAgent(REF);
    });
    const state = owed.result.current.setup.state;
    if (state.status !== "needsEnvVars") throw new Error(`expected needsEnvVars, got ${state.status}`);
    expect(state.pendingSignIns.map((signIn) => signIn.address)).toEqual([LINEAR]);
    expect(state.signInVaults).toEqual({ kind: "my-vault" });
    expect(state.missingVariables).toEqual([]);
  });

  it("stays resolving while whoAmI is unanswered, so no form is offered and then withdrawn", async () => {
    let answer: (account: IdentityAccount) => void = () => {};
    const account = new Promise<IdentityAccount>((resolve) => {
      answer = resolve;
    });
    const { result } = await renderSettled({ account, secrets: [], logins: [] });
    let resolving: Promise<unknown> = Promise.resolve();
    act(() => {
      resolving = result.current.setup.resolveAgent(REF);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.setup.state.status).toBe("resolving");
    await act(async () => {
      answer(APP_USER);
      await resolving;
    });
    expect(result.current.setup.state).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });
});
