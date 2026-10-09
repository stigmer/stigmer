/**
 * The real agent setup across a save in My vault and the reads that follow
 * it, the path a composer takes when a conversation leaves My vault out:
 * the person types a key, it is saved in My vault, the composer ticks My
 * vault, and My vault's reload lands later. Pinned: a save in a
 * conversation that leaves My vault out does not resolve the agent ready
 * (a teammate who cannot tick is shown what is still owed); ticking My
 * vault right after the save resolves it ready over what the save wrote,
 * before the reload lands, and it stays ready once the reload lands; and
 * an agent judged before My vault's first read lands is judged again when
 * it does.
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
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";
import type { ConversationVaults } from "../../vault/conversationVaults";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const REF = { org: "acme", slug: "reviewer" };

const REVIEWER = create(AgentSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ACME_ID, slug: "reviewer", name: "Reviewer" }),
  spec: create(AgentSpecSchema, {
    env: { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  }),
});

function myVaultHolding(names: readonly string[]): Vault {
  return create(VaultSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "vlt_mine", org: ACME_ID, slug: "my-vault-x" }),
    spec: {
      owner: { case: "person", value: "ida_1" },
      secrets: Object.fromEntries(names.map((name) => [name, { value: "" }])),
    },
  });
}

/**
 * A server whose My vault reads answer one at a time, when the test lets
 * them: `answerRead(vault)` settles the oldest read still waiting. A save
 * writes `API_TOKEN` and answers the vault it wrote at once.
 */
function server() {
  const waiting: Array<(vault: Vault | null) => void> = [];
  let reads = 0;
  const stigmer = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, { getByReference: () => REVIEWER });
      service(VaultQueryController, {
        getMine: async () => {
          reads += 1;
          const vault = await new Promise<Vault | null>((resolve) => waiting.push(resolve));
          if (vault === null) throw new ConnectError("no My vault yet", Code.NotFound);
          return vault;
        },
      });
      service(VaultCommandController, { setSecrets: () => myVaultHolding(["API_TOKEN"]) });
    }),
  });
  return {
    stigmer,
    reads: () => reads,
    async answerRead(vault: Vault | null) {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => {
        waiting.shift()?.(vault);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
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

const LEFT_OUT: ConversationVaults = { includeMyVault: false, vaults: [] };
const INCLUDED: ConversationVaults = { includeMyVault: true, vaults: [] };

/** Mounts the real hook over a conversation that leaves My vault out, with My vault read empty. */
async function mountLeftOut() {
  const world = server();
  const hook = renderHook(({ choice }: { choice: ConversationVaults }) => useAgentSetup(ACME_ID, undefined, choice), {
    wrapper: wrapper(world.stigmer),
    initialProps: { choice: LEFT_OUT },
  });
  await world.answerRead(null);
  await act(async () => {
    await hook.result.current.resolveAgent(REF);
  });
  expect(hook.result.current.state.status).toBe("needsEnvVars");
  return { world, hook };
}

describe("useAgentSetup across a save in My vault", () => {
  it("keeps a conversation that leaves My vault out owing the key after the save", async () => {
    const { hook } = await mountLeftOut();

    let status = "";
    await act(async () => {
      status = (await hook.result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } })).status;
    });

    expect(status).toBe("needsEnvVars");
    expect(hook.result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [expect.objectContaining({ key: "API_TOKEN" })],
    });
  });

  it("resolves ready when My vault is ticked after the save, before and after My vault's reload lands", async () => {
    const { world, hook } = await mountLeftOut();
    const readsBefore = world.reads();

    await act(async () => {
      await hook.result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } });
    });
    // The save started My vault's reload; it has not landed.
    await waitFor(() => expect(world.reads()).toBe(readsBefore + 1));

    hook.rerender({ choice: INCLUDED });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } }));

    await world.answerRead(myVaultHolding(["API_TOKEN"]));
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } }));
  });

  it("judges an agent again when My vault's first read lands after it was judged", async () => {
    const world = server();
    const hook = renderHook(() => useAgentSetup(ACME_ID, undefined, INCLUDED), { wrapper: wrapper(world.stigmer) });

    // Judged before My vault's read lands: the key looks owed.
    await act(async () => {
      await hook.result.current.resolveAgent(REF);
    });
    expect(hook.result.current.state.status).toBe("needsEnvVars");

    await world.answerRead(myVaultHolding(["API_TOKEN"]));
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } }));
  });
});
