/**
 * What an agent's setup counts as already saved, and when it counts again.
 * Pinned: a plugin server's login key is saved when a vault the run reads
 * holds a login that serves the server under the run's rule (a pasted login
 * at an HTTP server's own URL), in My vault or in a listed vault alike, so the
 * composer never asks again for a key saved as a login; a login at another
 * address fills nothing. When the conversation's vault choice changes
 * after the agent resolved (My vault ticked or unticked, a vault listed),
 * the agent is resolved again over the new choice (and nothing is resolved
 * before an agent is picked). An answer for a choice the person has
 * already changed again never lands over the newer choice's.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";

import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";
import { MY_VAULT_ONLY, type ConversationVaults } from "../../vault/conversationVaults";

afterEach(cleanup);

const ORG = "org_acme";
const REF = { org: ORG, slug: "reviewer" };
/** A conversation that leaves My vault out and lists the team vault. */
const LISTED: ConversationVaults = { includeMyVault: false, vaults: [{ org: ORG, slug: "team" }] };
const ZENDESK_URL = "https://zendesk.example/mcp";

/** A plugin of one API-key server: its bearer header names the key a pasted login at its URL fills. */
const zendesk = create(PluginSchema, {
  metadata: { id: "plg_zendesk", org: ORG, slug: "zendesk", name: "zendesk" },
  status: {
    mcpServers: [
      {
        name: "zendesk",
        transport: { case: "http", value: { url: `${ZENDESK_URL}/`, headers: { Authorization: "Bearer ${ZENDESK_TOKEN}" } } },
        env: ["ZENDESK_TOKEN"],
      },
    ],
    env: { ZENDESK_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  },
});

/** A vault holding `secrets` by name and pasted logins at `addresses`. */
function vaultHolding(slug: string, secrets: readonly string[], addresses: readonly string[] = []): Vault {
  return create(VaultSchema, {
    metadata: { id: `vlt_${slug}`, org: ORG, slug, name: slug },
    spec: {
      owner: slug === "mine" ? { case: "person", value: "ida_1" } : { case: "org", value: ORG },
      secrets: Object.fromEntries(secrets.map((name) => [name, { value: "" }])),
      connections: Object.fromEntries(addresses.map((address) => [address, { token: "" }])),
    },
  });
}

interface World {
  readonly mine: Vault | null;
  readonly team: Vault;
  /** The keys the agent declares itself. */
  readonly declares: readonly string[];
  /** Whether the agent lists the Zendesk plugin. */
  readonly usesTool: boolean;
  /** When set, a read of the team vault answers only once this settles. */
  readonly teamRead?: Promise<void>;
}

/** How many times the agent was read: once per resolution. */
let agentReads = 0;

function client(world: World) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () => {
          agentReads += 1;
          return create(AgentSchema, {
            metadata: { id: "agt_1", org: ORG, slug: REF.slug, name: "Reviewer" },
            spec: {
              env: Object.fromEntries(world.declares.map((key) => [key, create(EnvVarDeclarationSchema, { isSecret: true })])),
              plugins: world.usesTool ? [{ org: ORG, slug: "zendesk" }] : [],
            },
          });
        },
      });
      service(PluginQueryController, { getByReference: () => zendesk });
      service(VaultQueryController, {
        getMine: () => {
          if (world.mine === null) throw new ConnectError("no My vault yet", Code.NotFound);
          return world.mine;
        },
        getByReference: async () => {
          await world.teamRead;
          return world.team;
        },
      });
      service(VaultCommandController, { setSecrets: () => world.mine ?? world.team });
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

/** Resolves once My vault's read has settled (the hook reads it as loaded). */
async function resolveSettled(result: { current: ReturnType<typeof useAgentSetup> }, status: string) {
  await waitFor(async () => {
    await act(async () => {
      await result.current.resolveAgent(REF);
    });
    expect(result.current.state.status).toBe(status);
  });
}

describe("useAgentSetup counts a tool's login as its key", () => {
  it("counts a login My vault holds at the tool's URL, asking nothing", async () => {
    const world: World = {
      mine: vaultHolding("mine", [], [ZENDESK_URL]),
      team: vaultHolding("team", []),
      declares: ["ZENDESK_TOKEN"],
      usesTool: true,
    };
    const { result } = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(client(world)) });
    await resolveSettled(result, "ready");
    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("counts a login a listed vault holds at the tool's URL, and nothing at another address", async () => {
    const served = renderHook(() => useAgentSetup(ORG, undefined, LISTED), {
      wrapper: wrapper(client({ mine: null, team: vaultHolding("team", [], [ZENDESK_URL]), declares: ["ZENDESK_TOKEN"], usesTool: true })),
    });
    await act(async () => {
      await served.result.current.resolveAgent(REF);
    });
    expect(served.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });

    const elsewhere = renderHook(() => useAgentSetup(ORG, undefined, LISTED), {
      wrapper: wrapper(
        client({ mine: null, team: vaultHolding("team", [], ["https://zendesk.example/other"]), declares: ["ZENDESK_TOKEN"], usesTool: true }),
      ),
    });
    await act(async () => {
      await elsewhere.result.current.resolveAgent(REF);
    });
    expect(elsewhere.result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [expect.objectContaining({ key: "ZENDESK_TOKEN" })],
    });
  });
});

describe("useAgentSetup and a change of the conversation's vaults", () => {
  it("resolves nothing when the vaults change before an agent is picked", async () => {
    const world: World = { mine: null, team: vaultHolding("team", []), declares: ["API_TOKEN"], usesTool: false };
    const hook = renderHook(({ choice }: { choice: ConversationVaults }) => useAgentSetup(ORG, undefined, choice), {
      wrapper: wrapper(client(world)),
      initialProps: { choice: MY_VAULT_ONLY },
    });
    const readsBefore = agentReads;
    hook.rerender({ choice: LISTED });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(agentReads).toBe(readsBefore);
    expect(hook.result.current.state.status).toBe("idle");
  });

  it("resolves the agent again when the conversation's vault choice changes", async () => {
    const world: World = { mine: vaultHolding("mine", ["API_TOKEN"]), team: vaultHolding("team", []), declares: ["API_TOKEN"], usesTool: false };
    const hook = renderHook(({ choice }: { choice: ConversationVaults }) => useAgentSetup(ORG, undefined, choice), {
      wrapper: wrapper(client(world)),
      initialProps: { choice: MY_VAULT_ONLY },
    });
    await resolveSettled(hook.result, "ready");
    expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });

    // The conversation now leaves My vault out and lists a vault without the key.
    hook.rerender({ choice: LISTED });
    await waitFor(() =>
      expect(hook.result.current.state).toMatchObject({
        status: "needsEnvVars",
        missingVariables: [expect.objectContaining({ key: "API_TOKEN" })],
      }),
    );

    // My vault included again: its key counts again.
    hook.rerender({ choice: MY_VAULT_ONLY });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } }));
  });

  it("drops the answer for a vault pick changed again while it was read", async () => {
    let answerTeam = (): void => undefined;
    const teamRead = new Promise<void>((resolve) => {
      answerTeam = resolve;
    });
    const world: World = {
      mine: vaultHolding("mine", ["API_TOKEN"]),
      team: vaultHolding("team", []),
      declares: ["API_TOKEN"],
      usesTool: false,
      teamRead,
    };
    const hook = renderHook(({ choice }: { choice: ConversationVaults }) => useAgentSetup(ORG, undefined, choice), {
      wrapper: wrapper(client(world)),
      initialProps: { choice: MY_VAULT_ONLY },
    });
    await resolveSettled(hook.result, "ready");

    // The team vault is picked and its read hangs; the pick goes back to My vault alone, which resolves at once.
    const readsBefore = agentReads;
    hook.rerender({ choice: LISTED });
    await waitFor(() => expect(agentReads).toBe(readsBefore + 1));
    hook.rerender({ choice: MY_VAULT_ONLY });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } }));

    // The team vault's answer (the key missing there) arrives late and is dropped.
    await act(async () => {
      answerTeam();
      await teamRead;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });
});
