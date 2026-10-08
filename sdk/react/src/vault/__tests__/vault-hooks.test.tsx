/**
 * The vault data and write hooks, pinned against an in-process server:
 * - useVault reads one vault by reference, and a null reference reads nothing;
 * - useVaultEntries names a vault by id on every write (secrets by name with
 *   or without a description, logins by address), refuses to write without
 *   an organization and a vault, and keeps the last failure as `error`;
 * - useCreateVault creates an empty shared vault with only the fields given;
 * - useUpdateVault sends the vault's own fields, the caller's changes over
 *   the loaded ones, and never its entries;
 * - useMyVault's removals name My vault by `mine`, and a failed write is kept;
 * - useSessionEnvPool counts one-time values beside saved names;
 * - diffEnv treats a plain declaration with a value as satisfied.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { diffEnv } from "../diffEnv";
import { useCreateVault } from "../useCreateVault";
import { useMyVault } from "../useMyVault";
import { useSessionEnvPool } from "../useSessionEnvPool";
import { useUpdateVault } from "../useUpdateVault";
import { useVault } from "../useVault";
import { useVaultEntries } from "../useVaultEntries";

afterEach(cleanup);

const ORG = "org_acme";

const SHARED = create(VaultSchema, {
  metadata: { id: "vlt_team", org: ORG, slug: "support-tools", name: "Support tools" },
  spec: { owner: { case: "org", value: ORG }, description: "team keys", externalId: "cust-1" },
});

const MINE = create(VaultSchema, {
  metadata: { id: "vlt_mine", org: ORG, slug: "my-vault-x", name: "My vault" },
  spec: { owner: { case: "person", value: "ida_ana" } },
});

function providers(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

/** A client whose server records every write as `method:target:detail`, or refuses every write. */
function clientWith(writes: string[], refuse = false) {
  const fail = () => {
    throw new ConnectError("not allowed", Code.PermissionDenied);
  };
  const target = (req: { vault?: { vault: { case?: string; value?: unknown } } }) =>
    `${req.vault?.vault.case}=${String(req.vault?.vault.value)}`;
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultQueryController, {
        getByReference: (req) => {
          writes.push(`getByReference:${req.org}/${req.slug}`);
          return SHARED;
        },
        getMine: () => MINE,
      });
      service(VaultCommandController, {
        create: (req) => {
          if (refuse) fail();
          writes.push(`create:${req.metadata?.name}:${req.spec?.description ?? ""}:${req.spec?.externalId ?? ""}`);
          return SHARED;
        },
        update: (req) => {
          if (refuse) fail();
          writes.push(
            `update:${req.metadata?.id}:${req.metadata?.name}:${req.spec?.description}:${req.spec?.externalId}:${Object.keys(req.spec?.secrets ?? {}).length}`,
          );
          return SHARED;
        },
        setSecrets: (req) => {
          if (refuse) fail();
          writes.push(
            `setSecrets:${target(req)}:${Object.entries(req.secrets)
              .map(([k, v]) => `${k}=${v.value}/${v.description}`)
              .join(",")}`,
          );
          return SHARED;
        },
        removeSecrets: (req) => {
          if (refuse) fail();
          writes.push(`removeSecrets:${target(req)}:${req.names.join(",")}`);
          return SHARED;
        },
        setConnection: (req) => {
          if (refuse) fail();
          writes.push(`setConnection:${target(req)}:${req.address}:${req.description}`);
          return SHARED;
        },
        removeConnections: (req) => {
          if (refuse) fail();
          writes.push(`removeConnections:${target(req)}:${req.addresses.join(",")}`);
          return SHARED;
        },
      });
    }),
  });
}

describe("useVault", () => {
  it("reads a vault by reference, and nothing for a null reference", async () => {
    const writes: string[] = [];
    const wrapper = providers(clientWith(writes));
    const { result } = renderHook(() => useVault({ org: ORG, slug: "support-tools" }), { wrapper });
    await waitFor(() => expect(result.current.vault).not.toBeNull());
    expect(result.current.vault?.metadata?.name).toBe("Support tools");
    expect(writes).toEqual([`getByReference:${ORG}/support-tools`]);

    const none = renderHook(() => useVault(null), { wrapper });
    expect(none.result.current.vault).toBeNull();
    expect(writes).toHaveLength(1);
  });
});

describe("useVaultEntries", () => {
  it("names the vault by id on every write", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() => useVaultEntries(ORG, "vlt_team"), {
      wrapper: providers(clientWith(writes)),
    });
    await act(async () => {
      await result.current.setSecrets({ A: "1", B: { value: "2", description: "bee" }, C: { value: "3" } });
      await result.current.removeSecrets(["A"]);
      await result.current.setConnection("github.com", "ghp", "work");
      await result.current.setConnection("https://mcp.example.com/mcp", "tok");
      await result.current.removeConnections(["github.com"]);
    });
    expect(writes).toEqual([
      "setSecrets:id=vlt_team:A=1/,B=2/bee,C=3/",
      "removeSecrets:id=vlt_team:A",
      "setConnection:id=vlt_team:github.com:work",
      "setConnection:id=vlt_team:https://mcp.example.com/mcp:",
      "removeConnections:id=vlt_team:github.com",
    ]);
    expect(result.current.isMutating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refuses to write without an organization and a vault", async () => {
    const { result } = renderHook(() => useVaultEntries(null, null), { wrapper: providers(clientWith([])) });
    await expect(result.current.removeSecrets(["A"])).rejects.toThrow(/org and vaultId are required/);
  });

  it("keeps a refused write as its error", async () => {
    const { result } = renderHook(() => useVaultEntries(ORG, "vlt_team"), {
      wrapper: providers(clientWith([], true)),
    });
    await act(async () => {
      await expect(result.current.setSecrets({ A: "1" })).rejects.toThrow(/not allowed/);
    });
    expect(result.current.error?.message).toMatch(/not allowed/);
  });
});

describe("useCreateVault", () => {
  it("creates a shared vault with only the fields given", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() => useCreateVault(), { wrapper: providers(clientWith(writes)) });
    await act(async () => {
      await result.current.create({ org: ORG, name: "Support tools", description: "team", externalId: "cust-1" });
      await result.current.create({ org: ORG, name: "Plain" });
    });
    expect(writes).toEqual(["create:Support tools:team:cust-1", "create:Plain::"]);
    expect(result.current.isCreating).toBe(false);
  });

  it("keeps a refused create as its error until cleared", async () => {
    const { result } = renderHook(() => useCreateVault(), { wrapper: providers(clientWith([], true)) });
    await act(async () => {
      await expect(result.current.create({ org: ORG, name: "x" })).rejects.toThrow(/not allowed/);
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useUpdateVault", () => {
  it("sends the vault's own fields, the caller's changes over the loaded ones, and no entries", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() => useUpdateVault(), { wrapper: providers(clientWith(writes)) });
    await act(async () => {
      await result.current.update({ vault: SHARED, name: "Renamed" });
      await result.current.update({ vault: SHARED, description: "new", externalId: "cust-2" });
      await result.current.update({ vault: create(VaultSchema, {}) });
    });
    expect(writes).toEqual([
      "update:vlt_team:Renamed:team keys:cust-1:0",
      "update:vlt_team:Support tools:new:cust-2:0",
      "update:::::0",
    ]);
  });

  it("keeps a refused update as its error until cleared", async () => {
    const { result } = renderHook(() => useUpdateVault(), { wrapper: providers(clientWith([], true)) });
    await act(async () => {
      await expect(result.current.update({ vault: SHARED })).rejects.toThrow(/not allowed/);
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useMyVault removals", () => {
  it("names My vault by `mine` on removals, and keeps a refused write", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() => useMyVault(ORG), { wrapper: providers(clientWith(writes)) });
    await waitFor(() => expect(result.current.vault).not.toBeNull());
    await act(async () => {
      await result.current.removeSecrets(["A"]);
      await result.current.removeConnections(["github.com"]);
    });
    expect(writes).toEqual(["removeSecrets:mine=true:A", "removeConnections:mine=true:github.com"]);

    const refused = renderHook(() => useMyVault(ORG), { wrapper: providers(clientWith([], true)) });
    await waitFor(() => expect(refused.result.current.vault).not.toBeNull());
    await act(async () => {
      await expect(refused.result.current.removeSecrets(["A"])).rejects.toThrow(/not allowed/);
    });
    expect(refused.result.current.error?.message ?? "").toMatch(/not allowed/);
  });
});

describe("useSessionEnvPool", () => {
  it("counts one-time values beside the names saved in My vault", () => {
    const { result } = renderHook(() =>
      useSessionEnvPool({
        savedKeys: new Set(["SAVED"]),
        agentOneTimeValues: { AGENT_ONE: { value: "a", isSecret: true } },
        mcpOneTimeValues: { MCP_ONE: { value: "m", isSecret: false } },
      }),
    );
    expect([...result.current.availableKeys].sort()).toEqual(["AGENT_ONE", "MCP_ONE", "SAVED"]);
    expect(result.current.getAvailableValue("MCP_ONE")).toEqual({ value: "m", isSecret: false });
    expect(result.current.getAvailableValue("SAVED")).toBeUndefined();
  });
});

describe("diffEnv", () => {
  it("treats a plain declaration with its own value as satisfied, and asks for a secret", () => {
    const missing = diffEnv(
      {
        WORKSPACE: { isSecret: false, value: "acme" },
        API_KEY: { isSecret: true },
      },
      new Set(),
    );
    expect(missing.map((v) => v.key)).toEqual(["API_KEY"]);
  });
});

