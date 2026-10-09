/**
 * Where an agent's declared keys come from: exactly the vaults the
 * conversation uses, the person's My vault when it includes it, then the
 * shared vaults it lists. Setup creates nothing per agent. Pinned: an agent
 * whose keys My vault already holds resolves `saved` without asking, and
 * saving typed values writes them to My vault through `setSecrets` naming
 * `mine`, with no other resource written, whatever the conversation uses,
 * and resolves `saved` only where the conversation reads My vault.
 * An agent of another organization resolves `direct`, asking nothing and
 * writing nothing. My vault's keys count only while the conversation
 * includes it; a listed vault's keys count; a vault the conversation does
 * not use counts for nothing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const REVIEWER = create(AgentSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ACME_ID, slug: "reviewer", name: "Reviewer" }),
  spec: create(AgentSpecSchema, {
    env: { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true, description: "API token" }) },
  }),
});

/** Every write the client received, by RPC name. */
type Writes = string[];

/** A client whose My vault holds `held` secret names, and a shared vault holding `teamHeld`. */
function client(writes: Writes, held: readonly string[], agent = REVIEWER, teamHeld: readonly string[] = []) {
  const myVault = create(VaultSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "vlt_1", org: ACME_ID, slug: "my-vault-x" }),
    spec: {
      owner: { case: "person", value: "ida_1" },
      secrets: Object.fromEntries(held.map((key) => [key, { value: "" }])),
    },
  });
  const team = create(VaultSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "vlt_2", org: ACME_ID, slug: "team" }),
    spec: {
      owner: { case: "org", value: ACME_ID },
      secrets: Object.fromEntries(teamHeld.map((key) => [key, { value: "" }])),
    },
  });
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, { getByReference: () => agent });
      service(VaultQueryController, {
        getMine: () => {
          if (held.length === 0) throw new ConnectError("no My vault yet", Code.NotFound);
          return myVault;
        },
        getByReference: () => team,
      });
      service(VaultCommandController, {
        setSecrets: (request) => {
          const target = request.vault?.vault;
          writes.push(`vault.setSecrets:${target?.case === "mine" ? "mine" : "id"}:${Object.keys(request.secrets).join(",")}`);
          // The vault as the write left it: what it held, and the names written.
          return create(VaultSchema, {
            metadata: myVault.metadata,
            spec: {
              owner: { case: "person", value: "ida_1" },
              secrets: Object.fromEntries(
                [...held, ...Object.keys(request.secrets)].map((key) => [key, { value: "" }]),
              ),
            },
          });
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

describe("useAgentSetup and the person's vaults", () => {
  it("resolves saved, asking nothing, when My vault holds every declared key", async () => {
    const writes: Writes = [];
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, ["API_TOKEN"])),
    });
    // Resolution reads My vault as loaded; retried until its read settles.
    await waitFor(async () => {
      await act(async () => {
        await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
      });
      expect(result.current.state.status).toBe("ready");
    });

    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "saved" });
    }
    expect(writes).toEqual([]);
  });

  it("saves typed values to My vault and resolves saved, writing nothing else", async () => {
    const writes: Writes = [];
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, [])),
    });

    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });
    expect(result.current.state.status).toBe("needsEnvVars");
    // My vault's read must have settled before a save.
    await waitFor(async () => {
      await act(async () => {
        await result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } });
      });
    });

    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "saved" });
    }
    expect(writes).toEqual(["vault.setSecrets:mine:API_TOKEN"]);
  });

  it("asks nothing of an agent of another organization, whose runs read none of the person's keys", async () => {
    const writes: Writes = [];
    const foreign = create(AgentSchema, {
      ...REVIEWER,
      metadata: create(ApiResourceMetadataSchema, {
        id: "agt_2",
        org: "org_01jgggggggggggggggggggggggg",
        slug: "reviewer",
        name: "Reviewer",
      }),
    });
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, [], foreign)),
    });

    await act(async () => {
      await result.current.resolveAgent({ org: "globex", slug: "reviewer" });
    });

    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "direct" });
    }
    expect(writes).toEqual([]);
  });

  it("asks for a key that only a shared vault the conversation does not use holds", async () => {
    const writes: Writes = [];
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, [], REVIEWER, ["API_TOKEN"])),
    });

    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });

    expect(result.current.state.status).toBe("needsEnvVars");
    expect(writes).toEqual([]);
  });

  it("counts My vault's keys only while the conversation includes My vault", async () => {
    const writes: Writes = [];
    const listed = [{ org: ACME_ID, slug: "team" }];
    const { result, rerender } = renderHook(
      ({ includeMyVault }: { includeMyVault: boolean }) =>
        useAgentSetup(ACME_ID, undefined, { includeMyVault, vaults: listed }),
      { wrapper: wrapper(client(writes, ["API_TOKEN"])), initialProps: { includeMyVault: true } },
    );
    // My vault holds the key: while it is included the agent is ready.
    await waitFor(async () => {
      await act(async () => {
        await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
      });
      expect(result.current.state.status).toBe("ready");
    });

    rerender({ includeMyVault: false });
    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });

    expect(result.current.state.status).toBe("needsEnvVars");
    if (result.current.state.status === "needsEnvVars") {
      expect(result.current.state.missingVariables.map((variable) => variable.key)).toEqual(["API_TOKEN"]);
    }
  });

  it("resolves saved when a vault the conversation lists holds the key", async () => {
    const writes: Writes = [];
    const { result } = renderHook(
      () => useAgentSetup(ACME_ID, undefined, { includeMyVault: false, vaults: [{ org: ACME_ID, slug: "team" }] }),
      { wrapper: wrapper(client(writes, [], REVIEWER, ["API_TOKEN"])) },
    );

    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });

    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "saved" });
    }
  });

  it("saves typed values in My vault when the conversation leaves My vault out, and still owes them there", async () => {
    const writes: Writes = [];
    const { result } = renderHook(
      () => useAgentSetup(ACME_ID, undefined, { includeMyVault: false, vaults: [{ org: ACME_ID, slug: "team" }] }),
      { wrapper: wrapper(client(writes, [])) },
    );

    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });
    expect(result.current.state.status).toBe("needsEnvVars");
    await waitFor(async () => {
      await act(async () => {
        await result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } });
      });
    });

    // The run reads only the team vault, which lacks the key: until the
    // conversation includes My vault, the key is still owed.
    expect(result.current.state.status).toBe("needsEnvVars");
    expect(writes).toEqual(["vault.setSecrets:mine:API_TOKEN"]);
  });
});
