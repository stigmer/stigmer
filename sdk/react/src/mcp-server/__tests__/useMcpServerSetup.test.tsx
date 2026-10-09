/**
 * useMcpServerSetup walks each attached server from loading to ready: a
 * server whose credentials are missing waits in needsSetup until they are
 * saved in My vault, or until the pool (the platform's own keys) or My
 * vault, when included, covers them. A save My vault refuses resolves
 * false and leaves the server waiting with the reason. A ready server becomes a usage that
 * attaches the whole server: no per-tool selection rides on it, because
 * the agent's own tool lists decide which tools a session may call. A token
 * for the server's login variable (here an `Authorization: Bearer ${VAR}`
 * header) is saved as a login at the server's address, not as a secret by
 * name, and a login already saved at that address counts as the variable.
 * reset forgets every server. The hook reads exactly the vaults the
 * conversation uses: My vault's secrets, logins and sign-in grant count
 * only while it is included, a listed vault's secrets and logins count, a
 * listed vault's sign-in counts only for the server that started it, and a
 * typed value is saved in My vault whatever the conversation uses. When the
 * conversation's vault choice changes, every server already added is
 * evaluated again over it (one mid-submit is left to land). An answer for a
 * choice changed again while it was read never lands, and the newer
 * choice's still settles the server. A server that cannot be read holds its
 * error. My vault is stubbed so these tests pin the hook's transitions, not
 * the vault hook's RPCs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import type { ResourceRef } from "@stigmer/sdk";
import { MY_VAULT_ONLY, type ConversationVaults } from "../../vault/conversationVaults";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  McpServerSpecSchema,
  HttpServerConfigSchema,
  McpServerAuthSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  GetOAuthGrantStatusOutputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VaultConnectionSchema, VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { useMcpServerSetup } from "../useMcpServerSetup";

const myVault = {
  vault: null as Vault | null,
  secretNames: new Set<string>(),
  connectionAddresses: new Set<string>(),
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  setSecrets: vi.fn(async () => ({})),
  removeSecrets: vi.fn(async () => ({})),
  setConnection: vi.fn(async () => ({})),
  removeConnections: vi.fn(async () => ({})),
  isMutating: false,
};

vi.mock("../../vault/useMyVault.js", () => ({
  useMyVault: () => myVault,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  grantReads.length = 0;
});

const ORG = "acme";
const REF: ResourceRef = { org: ORG, slug: "zendesk", kind: ApiResourceKind.mcp_server };

/** A server that needs one secret and has discovered two tools. */
function serverNeedingToken() {
  const server = samples.mcpServer({ name: "Zendesk", org: ORG, slug: "zendesk" });
  server.spec = create(McpServerSpecSchema, {
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://zendesk.example/mcp",
        headers: { Authorization: "Bearer ${ZENDESK_TOKEN}" },
      }),
    },
    env: {
      ZENDESK_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }),
      ZENDESK_SUBDOMAIN: create(EnvVarDeclarationSchema, { isSecret: true }),
    },
  });
  server.status = create(McpServerStatusSchema, {
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, { name: "get_ticket" }),
        create(DiscoveredToolSchema, { name: "delete_ticket", destructiveHint: true }),
      ],
    }),
  });
  return server;
}

const LINEAR_REF: ResourceRef = { org: ORG, slug: "linear", kind: ApiResourceKind.mcp_server };
const LINEAR_URL = "https://linear.example/mcp";

/** A server whose one variable a sign-in fills. */
function serverSignedInTo() {
  const server = samples.mcpServer({ id: "mcp_linear", name: "Linear", org: ORG, slug: "linear" });
  server.spec = create(McpServerSpecSchema, {
    serverType: { case: "http", value: create(HttpServerConfigSchema, { url: LINEAR_URL }) },
    auth: create(McpServerAuthSchema, { targetEnvVar: "LINEAR_ACCESS_TOKEN", oauthOnly: true }),
    env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  });
  return server;
}

/** The server reads the hook made, by slug: one per evaluation. */
const serverReads: string[] = [];

/** The grant reads the hook made; the grant is My vault's and always connected here. */
const grantReads: string[] = [];

/** The shared vault a conversation may list; tests set what it holds. */
let teamVault = create(VaultSchema, {});

/** When set, a read of a server answers only once this settles. */
let serverRead: Promise<void> | undefined;

/** A shared vault holding `secrets` by name and logins at `addresses`. */
function vaultHolding(secrets: readonly string[], addresses: readonly string[] = []) {
  return create(VaultSchema, {
    metadata: { id: "vlt_team", org: ORG, slug: "team" },
    spec: {
      owner: { case: "org", value: ORG },
      secrets: Object.fromEntries(secrets.map((name) => [name, { value: "" }])),
      connections: Object.fromEntries(addresses.map((address) => [address, { token: "" }])),
    },
  });
}

/** A conversation that leaves My vault out and lists the team vault. */
const LISTED: ConversationVaults = { includeMyVault: false, vaults: [{ org: ORG, slug: "team" }] };

function wrapper({ children }: { readonly children: ReactNode }) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router) => {
      router.service(McpServerQueryController, {
        getByReference: async (ref) => {
          serverReads.push(ref.slug);
          await serverRead;
          if (ref.slug === "missing") throw new ConnectError("no server 'missing'", Code.NotFound);
          return ref.slug === "linear" ? serverSignedInTo() : serverNeedingToken();
        },
        getOAuthGrantStatus: (input) => {
          grantReads.push(input.resourceId);
          return create(GetOAuthGrantStatusOutputSchema, {
            connected: true,
            connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          });
        },
      });
      router.service(VaultQueryController, {
        getByReference: () => teamVault,
      });
    }),
  });
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

const WHOLE_SERVER_USAGE = {
  mcpServerRef: { org: ORG, slug: "zendesk", kind: ApiResourceKind.mcp_server },
};

async function addNeedingSetup(poolKeys?: Set<string>, choice?: ConversationVaults) {
  const hook = renderHook(
    ({ pool }: { pool?: Set<string> }) => useMcpServerSetup(ORG, pool, choice),
    { wrapper, initialProps: { pool: poolKeys } },
  );
  await act(() => hook.result.current.addServer(REF));
  expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("needsSetup");
  return hook;
}

describe("useMcpServerSetup", () => {
  it("readies a server after saving its login at its address and its other secret by name in My vault", async () => {
    const { result } = await addNeedingSetup();

    let saved = false;
    await act(async () => {
      saved = await result.current.submitEnvVars(REF, {
        ZENDESK_TOKEN: { value: "t", isSecret: true },
        ZENDESK_SUBDOMAIN: { value: "acme", isSecret: true },
      });
    });

    expect(saved).toBe(true);
    expect(myVault.setConnection).toHaveBeenCalledWith("https://zendesk.example/mcp", "t");
    expect(myVault.setSecrets).toHaveBeenCalledWith({ ZENDESK_SUBDOMAIN: "acme" });
    expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
    expect(result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });

  it("resolves false and keeps the server waiting with the reason when My vault refuses the save", async () => {
    myVault.setSecrets.mockRejectedValueOnce(new Error("vault write refused"));
    const { result } = await addNeedingSetup();

    let saved = true;
    await act(async () => {
      saved = await result.current.submitEnvVars(REF, {
        ZENDESK_TOKEN: { value: "t", isSecret: true },
        ZENDESK_SUBDOMAIN: { value: "acme", isSecret: true },
      });
    });

    expect(saved).toBe(false);
    expect(result.current.entries["acme/zendesk"]?.status).toBe("needsSetup");
    expect(result.current.entries["acme/zendesk"]?.error?.message).toBe("vault write refused");
    expect(result.current.usageInputs).toEqual([]);
  });

  it("readies a waiting server once the pool covers its credentials", async () => {
    const hook = await addNeedingSetup();

    hook.rerender({ pool: new Set(["ZENDESK_TOKEN", "ZENDESK_SUBDOMAIN"]) });

    await waitFor(() =>
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready"),
    );
    expect(hook.result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });

  it("readies a server at once when My vault holds its login at its address and its other secret", async () => {
    myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
    try {
      const { result } = renderHook(() => useMcpServerSetup(ORG), { wrapper });
      await act(() => result.current.addServer(REF));
      expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
      expect(result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
    } finally {
      myVault.vault = null;
    }
  });

  it("counts My vault's secrets and logins only while the conversation includes My vault", async () => {
    myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
    teamVault = vaultHolding([]);
    try {
      const { result } = await addNeedingSetup(undefined, LISTED);
      const entry = result.current.entries["acme/zendesk"];
      expect(entry?.status === "needsSetup" && entry.missingVariables.map((v) => v.key).sort()).toEqual([
        "ZENDESK_SUBDOMAIN",
        "ZENDESK_TOKEN",
      ]);
    } finally {
      myVault.vault = null;
    }
  });

  it("readies a server at once when a listed vault holds its login at its address and its other secret", async () => {
    teamVault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
    const { result } = renderHook(() => useMcpServerSetup(ORG, undefined, LISTED), { wrapper });
    await act(() => result.current.addServer(REF));
    expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
    expect(result.current.usageInputs).toEqual([WHOLE_SERVER_USAGE]);
  });

  it("gives a My vault sign-in no credit when the conversation leaves My vault out", async () => {
    const mine = renderHook(() => useMcpServerSetup(ORG), { wrapper });
    await act(() => mine.result.current.addServer(LINEAR_REF));
    expect(mine.result.current.entries["acme/linear"]?.status).toBe("ready");
    expect(grantReads).toEqual(["mcp_linear"]);

    grantReads.length = 0;
    teamVault = vaultHolding([]);
    const listed = renderHook(() => useMcpServerSetup(ORG, undefined, LISTED), { wrapper });
    await act(() => listed.result.current.addServer(LINEAR_REF));
    const entry = listed.result.current.entries["acme/linear"];
    expect(entry?.status).toBe("needsSetup");
    expect(entry?.status === "needsSetup" ? entry.missingVariables.map((v) => v.key) : []).toEqual([
      "LINEAR_ACCESS_TOKEN",
    ]);
    expect(grantReads).toEqual([]);
    expect(listed.result.current.usageInputs).toEqual([]);
  });

  it("counts a listed vault's sign-in only for the server that started it", async () => {
    const signedInBy = (minter: string) => {
      const vault = vaultHolding([]);
      vault.spec!.connections[LINEAR_URL] = create(VaultConnectionSchema, {
        source: VaultConnectionSource.sign_in,
        signIn: { mcpServerId: minter },
      });
      return vault;
    };

    teamVault = signedInBy("mcp_other");
    const foreign = renderHook(() => useMcpServerSetup(ORG, undefined, LISTED), { wrapper });
    await act(() => foreign.result.current.addServer(LINEAR_REF));
    expect(foreign.result.current.entries["acme/linear"]?.status).toBe("needsSetup");

    teamVault = signedInBy("mcp_linear");
    const own = renderHook(() => useMcpServerSetup(ORG, undefined, LISTED), { wrapper });
    await act(() => own.result.current.addServer(LINEAR_REF));
    expect(own.result.current.entries["acme/linear"]?.status).toBe("ready");
    expect(grantReads).toEqual([]);
  });

  it("saves typed values in My vault even when the conversation leaves My vault out", async () => {
    teamVault = vaultHolding([]);
    const { result } = await addNeedingSetup(undefined, LISTED);
    const values = {
      ZENDESK_TOKEN: { value: "t", isSecret: true },
      ZENDESK_SUBDOMAIN: { value: "acme", isSecret: true },
    };

    await act(() => result.current.submitEnvVars(REF, values));

    expect(myVault.setConnection).toHaveBeenCalledWith("https://zendesk.example/mcp", "t");
    expect(myVault.setSecrets).toHaveBeenCalledWith({ ZENDESK_SUBDOMAIN: "acme" });
    expect(result.current.entries["acme/zendesk"]?.status).toBe("ready");
  });

  it("readies a waiting server once My vault, when included, comes to hold what it lacks", async () => {
    const hook = await addNeedingSetup(undefined, MY_VAULT_ONLY);
    try {
      myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
      hook.rerender({ pool: undefined });
      await waitFor(() => expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready"));
    } finally {
      myVault.vault = null;
    }
  });

  it("keeps a server waiting when My vault comes to hold what it lacks but the conversation leaves it out", async () => {
    teamVault = vaultHolding([]);
    const hook = await addNeedingSetup(undefined, LISTED);
    try {
      myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
      hook.rerender({ pool: undefined });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("needsSetup");
    } finally {
      myVault.vault = null;
    }
  });

  it("readies a waiting server once the pool covers what the listed vaults lack", async () => {
    teamVault = vaultHolding(["ZENDESK_SUBDOMAIN"]);
    const hook = await addNeedingSetup(undefined, LISTED);

    // A value for something else changes nothing it still lacks.
    hook.rerender({ pool: new Set(["UNRELATED_KEY"]) });
    const waiting = hook.result.current.entries["acme/zendesk"];
    expect(waiting?.status).toBe("needsSetup");
    expect(waiting?.status === "needsSetup" ? waiting.missingVariables.map((v) => v.key) : []).toEqual([
      "ZENDESK_TOKEN",
    ]);

    hook.rerender({ pool: new Set(["ZENDESK_TOKEN"]) });

    await waitFor(() =>
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready"),
    );
  });

  it("reset forgets every server", async () => {
    const { result } = await addNeedingSetup();
    act(() => result.current.reset());
    expect(result.current.entries).toEqual({});
  });

  it("evaluates every added server again when the conversation's vault choice changes", async () => {
    myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
    teamVault = vaultHolding([]);
    try {
      const hook = renderHook(
        ({ choice }: { choice: ConversationVaults }) => useMcpServerSetup(ORG, undefined, choice),
        { wrapper, initialProps: { choice: MY_VAULT_ONLY } },
      );
      await act(() => hook.result.current.addServer(REF));
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready");

      // Now the conversation leaves My vault out and reads only the team vault, which holds nothing.
      hook.rerender({ choice: LISTED });
      await waitFor(() => expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("needsSetup"));

      hook.rerender({ choice: MY_VAULT_ONLY });
      await waitFor(() => expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready"));
    } finally {
      myVault.vault = null;
    }
  });

  it("drops the answer for a vault pick changed again while it was read, and settles the newer pick's", async () => {
    myVault.vault = vaultHolding(["ZENDESK_SUBDOMAIN"], ["https://zendesk.example/mcp"]);
    teamVault = vaultHolding([]);
    try {
      const hook = renderHook(
        ({ choice }: { choice: ConversationVaults }) => useMcpServerSetup(ORG, undefined, choice),
        { wrapper, initialProps: { choice: MY_VAULT_ONLY } },
      );
      await act(() => hook.result.current.addServer(REF));
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready");

      // The team vault alone is picked, then the pick goes back to My vault alone; both server reads hang.
      let answerFirst = (): void => undefined;
      let answerSecond = (): void => undefined;
      const readsBefore = serverReads.length;
      serverRead = new Promise<void>((resolve) => {
        answerFirst = resolve;
      });
      hook.rerender({ choice: LISTED });
      await waitFor(() => expect(serverReads.length).toBe(readsBefore + 1));
      serverRead = new Promise<void>((resolve) => {
        answerSecond = resolve;
      });
      hook.rerender({ choice: MY_VAULT_ONLY });
      await waitFor(() => expect(serverReads.length).toBe(readsBefore + 2));

      // The team vault's answer (nothing saved there) lands first and is dropped.
      await act(async () => {
        answerFirst();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("loading");

      // The newer pick's answer (My vault holds both) settles the server.
      await act(async () => {
        answerSecond();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready");
    } finally {
      myVault.vault = null;
      serverRead = undefined;
    }
  });

  it("holds a server it cannot read as that server's error", async () => {
    const { result } = renderHook(() => useMcpServerSetup(ORG), { wrapper });
    await act(() => result.current.addServer({ org: ORG, slug: "missing", kind: ApiResourceKind.mcp_server }));
    expect(result.current.entries["acme/missing"]?.error?.message).toMatch(/no server 'missing'/);
  });

  it("leaves a server mid-submit to land when the vaults change", async () => {
    teamVault = vaultHolding([]);
    let finishSave: (vault: object) => void = () => undefined;
    myVault.setSecrets.mockImplementationOnce(
      () => new Promise<object>((resolve) => {
        finishSave = resolve;
      }),
    );
    const hook = renderHook(
      ({ choice }: { choice: ConversationVaults }) => useMcpServerSetup(ORG, undefined, choice),
      { wrapper, initialProps: { choice: LISTED } },
    );
    await act(() => hook.result.current.addServer(REF));
    let submitted: Promise<boolean> = Promise.resolve(true);
    act(() => {
      submitted = hook.result.current.submitEnvVars(REF, { ZENDESK_SUBDOMAIN: { value: "a", isSecret: true } });
    });
    expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("submitting");

    const readsBefore = serverReads.length;
    hook.rerender({ choice: MY_VAULT_ONLY });
    expect(serverReads.length).toBe(readsBefore);
    expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("submitting");

    await act(async () => {
      finishSave({});
      await submitted;
    });
    expect(hook.result.current.entries["acme/zendesk"]?.status).toBe("ready");
  });
});
