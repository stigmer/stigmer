/**
 * Pins the vault service over a real SQLite store: one My vault per person
 * per organization, even when two first writes race (the name claim);
 * values sealed on write and opened in plaintext only by `open`, a
 * redacted read showing none; a login rewritten with no description
 * keeping the saved one; the entry cap; removals destroying the
 * removed entries' backing state, a replacement keeping it; two entry
 * writes racing on one vault both landing (the atomic read-modify-write);
 * a guarded login write landing only while the stored token is the one it
 * read; a sign-in rewritten without a refresh token keeping the one the
 * same server's sign-in held; reserved secret names refused; and a first
 * write whose authorization tuples fail keeping its row and claim for the
 * next write to finish (also when nothing could be cleaned up), a racing
 * first write never reporting success into a vault its person cannot see
 * or that is then removed, and a vault its person can see used as it is;
 * and a keyless server keeping the values in plaintext with one warning
 * per write.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Code, ConnectError } from "@connectrpc/connect";

import { SecretService } from "../../../encryption/encryption.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";

import { MAX_VAULT_ENTRIES, MY_VAULT_NAME, myVaultSlugOf } from "../constants.js";
import { redactVault } from "../redact.js";
import {
  externalIdNameKey,
  loadVault,
  myVaultNameKey,
  newVaultService,
  personOf,
  releaseUnstoredClaim,
} from "../service.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import type { Store } from "../../../store/interface.js";
import type { VaultRig } from "./support.js";
import { openVaultRig, seedSharedVault, silentLogger } from "./support.js";

const ORG = "acme";
const ana = testCallerIdentity({ identityId: "ida_ana" });
const ben = testCallerIdentity({ identityId: "ida_ben" });

let rig: VaultRig;

beforeEach(() => {
  rig = openVaultRig();
});

afterEach(() => {
  rig.close();
});

describe("My vault", () => {
  it("is created by the first write, once, named and slugged for its person", async () => {
    expect(await rig.vaults.findMine(ORG, "ida_ana")).toBeUndefined();
    const first = await rig.vaults.ensureMine(ORG, ana);
    const again = await rig.vaults.ensureMine(ORG, ana);
    expect(again.metadata?.id).toBe(first.metadata?.id);
    expect(first.metadata?.name).toBe(MY_VAULT_NAME);
    expect(first.metadata?.slug).toBe(myVaultSlugOf("ida_ana"));
    expect(personOf(first)).toBe("ida_ana");
    expect((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id).toBe(
      first.metadata?.id,
    );
  });

  it("two first writes in the same instant create one vault", async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, () => rig.vaults.ensureMine(ORG, ana)),
    );
    expect(new Set(created.map((vault) => vault.metadata?.id)).size).toBe(1);
  });

  it("is per person and per organization", async () => {
    const anas = await rig.vaults.ensureMine(ORG, ana);
    const bens = await rig.vaults.ensureMine(ORG, ben);
    const anasElsewhere = await rig.vaults.ensureMine("globex", ana);
    expect(
      new Set([anas, bens, anasElsewhere].map((vault) => vault.metadata?.id)).size,
    ).toBe(3);
    expect(await rig.vaults.findMine("globex", "ida_ben")).toBeUndefined();
  });

  it("refuses a caller who is no person", async () => {
    const failure = await rig.vaults
      .ensureMine(ORG, testCallerIdentity({ identityId: "" }))
      .catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
  });
});

describe("entries", () => {
  it("seals secrets and logins on write; only open shows them, a redacted read shows nothing", async () => {
    const vault = await rig.vaults.ensureMine(ORG, ana);
    const id = vault.metadata!.id;
    await rig.vaults.setSecrets(id, { API_KEY: { value: "sk-1", description: "OpenAI" } }, ana);
    const written = await rig.vaults.setConnection(
      id,
      "https://MCP.Linear.app/mcp/",
      {
        token: "lin-token",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "client",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://linear.app/token",
          refreshToken: "lin-refresh",
          mcpServerId: "mcp_linear",
        },
      },
      ana,
    );
    const secret = written.spec!.secrets["API_KEY"]!;
    const login = written.spec!.connections["https://mcp.linear.app/mcp"]!;
    expect(secret.value).toMatch(/^enc:v9:/);
    expect(secret.description).toBe("OpenAI");
    expect(secret.savedBy).toBe("ida_ana");
    expect(secret.savedAt).toBeDefined();
    expect(login.token).toMatch(/^enc:v9:/);
    expect(login.signIn?.refreshToken).toMatch(/^enc:v9:/);
    expect(login.source).toBe(VaultConnectionSource.sign_in);

    const opened = await rig.vaults.open(written);
    expect(opened.secrets.get("API_KEY")).toBe("sk-1");
    const openedLogin = opened.connections.get("https://mcp.linear.app/mcp");
    expect(openedLogin?.token).toBe("lin-token");
    expect(openedLogin?.signIn?.refreshToken).toBe("lin-refresh");

    redactVault(written);
    expect(written.spec!.secrets["API_KEY"]!.value).toBe("");
    expect(written.spec!.connections["https://mcp.linear.app/mcp"]!.token).toBe("");
    expect(
      written.spec!.connections["https://mcp.linear.app/mcp"]!.signIn?.refreshToken,
    ).toBe("");
  });

  it("a login rewritten with no description keeps the saved one, as a secret does; a new one replaces it", async () => {
    const id = (await rig.vaults.ensureMine(ORG, ana)).metadata!.id;
    const address = "https://mcp.tracker.example/mcp";
    await rig.vaults.setConnection(
      id,
      address,
      { token: "first", source: VaultConnectionSource.pasted, description: "The tracker" },
      ana,
    );
    let row = await rig.vaults.setConnection(
      id,
      address,
      { token: "second", source: VaultConnectionSource.pasted, description: "" },
      ana,
    );
    expect(row.spec!.connections[address]!.description).toBe("The tracker");
    row = await rig.vaults.setConnection(
      id,
      address,
      { token: "third", source: VaultConnectionSource.pasted, description: "The new tracker" },
      ana,
    );
    expect(row.spec!.connections[address]!.description).toBe("The new tracker");
  });

  it("refuses a write past the entry cap, naming the count", async () => {
    const vault = await seedSharedVault(rig.store, ORG, "full", {
      secrets: Object.fromEntries(
        Array.from({ length: MAX_VAULT_ENTRIES }, (_, i) => [`KEY_${i}`, "v"]),
      ),
    });
    const failure = await rig.vaults
      .setSecrets(vault.metadata!.id, { ONE_MORE: { value: "x", description: "" } }, ana)
      .catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((failure as ConnectError).rawMessage).toContain(`at most ${MAX_VAULT_ENTRIES}`);
    // Replacing an existing entry adds none and passes.
    await rig.vaults.setSecrets(vault.metadata!.id, { KEY_0: { value: "y", description: "" } }, ana);
  });

  it("removals destroy the removed entries' backing state and ignore unknown ones; a replacement keeps it", async () => {
    const vault = await rig.vaults.ensureMine(ORG, ana);
    const id = vault.metadata!.id;
    await rig.vaults.setSecrets(
      id,
      { GONE: { value: "a", description: "" }, KEPT: { value: "b", description: "" } },
      ana,
    );
    await rig.vaults.setConnection(
      id,
      "github.com",
      { token: "gh-1", source: VaultConnectionSource.pasted },
      ana,
    );
    await rig.vaults.setSecrets(id, { KEPT: { value: "b2", description: "" } }, ana);
    await rig.vaults.setConnection(
      id,
      "github.com",
      { token: "gh-2", source: VaultConnectionSource.pasted },
      ana,
    );
    expect(rig.codec.deleted).toEqual([]);

    const before = (await rig.vaults.findById(id))!;
    const { removed } = await rig.vaults.removeSecrets(id, ["GONE", "GHOST"], ana);
    expect(removed).toEqual(["GONE"]);
    const { removed: removedLogins } = await rig.vaults.removeConnections(
      id,
      ["GitHub.com", "gitlab.com"],
      ana,
    );
    expect(removedLogins).toEqual(["github.com"]);
    expect([...rig.codec.deleted].sort()).toEqual(
      [before.spec!.secrets["GONE"]!.value, before.spec!.connections["github.com"]!.token].sort(),
    );
    const after = (await rig.vaults.findById(id))!;
    expect(Object.keys(after.spec!.secrets)).toEqual(["KEPT"]);
    expect(after.spec!.connections).toEqual({});
  });

  it("two entry writes racing on one vault both land", async () => {
    const vault = await rig.vaults.ensureMine(ORG, ana);
    const id = vault.metadata!.id;
    await Promise.all([
      rig.vaults.setConnection(
        id,
        "https://mcp.linear.app/mcp",
        { token: "renewed", source: VaultConnectionSource.sign_in },
        ana,
      ),
      rig.vaults.setSecrets(id, { SAVED: { value: "same-second", description: "" } }, ana),
      rig.vaults.setSecrets(id, { ALSO: { value: "another", description: "" } }, ana),
    ]);
    const after = (await rig.vaults.findById(id))!;
    expect(Object.keys(after.spec!.secrets).sort()).toEqual(["ALSO", "SAVED"]);
    expect(Object.keys(after.spec!.connections)).toEqual(["https://mcp.linear.app/mcp"]);
  });

  it("a write to a vault that is gone is NOT_FOUND", async () => {
    const failure = await rig.vaults
      .setSecrets("vlt_missing", { K: { value: "v", description: "" } }, ana)
      .catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
  });
});

/** The store with one method replaced, everything else the real thing. */
function storeWith(overrides: Partial<Record<keyof Store, unknown>>): Store {
  return new Proxy(rig.store, {
    get(target, prop, receiver) {
      if (prop in overrides) {
        return overrides[prop as keyof Store];
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serviceOver(store: Store) {
  return newVaultService({
    store,
    logger: silentLogger,
    secretService: rig.secrets,
    authorizationLifecycle: undefined,
  });
}

const failing = async (): Promise<never> => {
  throw new Error("disk gone");
};

describe("guarded and sign-in writes", () => {
  const signIn = (refreshToken: string, mcpServerId = "mcp_linear") => ({
    expiresAt: 1n,
    clientId: "client",
    authMethod: "mcp_oauth",
    tokenEndpoint: "https://linear.app/token",
    refreshToken,
    mcpServerId,
  });
  const LINEAR = "https://mcp.linear.app/mcp";

  it("a login write expecting a stored token lands only while the vault still holds it", async () => {
    const id = (await rig.vaults.ensureMine(ORG, ana)).metadata!.id;
    const first = await rig.vaults.setConnection(
      id,
      LINEAR,
      { token: "first", source: VaultConnectionSource.sign_in, signIn: signIn("r1") },
      ana,
    );
    const read = first.spec!.connections[LINEAR]!.token;
    // Someone signs in again between the read and the renewal's write.
    await rig.vaults.setConnection(
      id,
      LINEAR,
      { token: "second", source: VaultConnectionSource.sign_in, signIn: signIn("r2") },
      ana,
    );
    await rig.vaults.setConnection(
      id,
      LINEAR,
      {
        token: "renewed-from-first",
        source: VaultConnectionSource.sign_in,
        signIn: signIn("r1"),
        expectStoredToken: read,
      },
      ana,
    );
    const opened = await rig.vaults.open((await loadVault(rig.store, id))!);
    expect(opened.connections.get(LINEAR)?.token).toBe("second");

    const current = opened.connections.get(LINEAR)!;
    await rig.vaults.setConnection(
      id,
      LINEAR,
      {
        token: "renewed-from-second",
        source: VaultConnectionSource.sign_in,
        signIn: signIn("r2"),
        expectStoredToken: current.storedToken,
      },
      ana,
    );
    const after = await rig.vaults.open((await loadVault(rig.store, id))!);
    expect(after.connections.get(LINEAR)?.token).toBe("renewed-from-second");
  });

  it("a sign-in rewritten without a refresh token keeps the same server's previous one when asked, not another server's", async () => {
    const id = (await rig.vaults.ensureMine(ORG, ana)).metadata!.id;
    await rig.vaults.setConnection(
      id,
      LINEAR,
      { token: "t1", source: VaultConnectionSource.sign_in, signIn: signIn("keep-me") },
      ana,
    );
    await rig.vaults.setConnection(
      id,
      LINEAR,
      { token: "t2", source: VaultConnectionSource.sign_in, signIn: signIn(""), keepRefreshToken: true },
      ana,
    );
    let opened = await rig.vaults.open((await loadVault(rig.store, id))!);
    expect(opened.connections.get(LINEAR)?.signIn?.refreshToken).toBe("keep-me");

    await rig.vaults.setConnection(
      id,
      LINEAR,
      {
        token: "t3",
        source: VaultConnectionSource.sign_in,
        signIn: signIn("", "mcp_other"),
        keepRefreshToken: true,
      },
      ana,
    );
    opened = await rig.vaults.open((await loadVault(rig.store, id))!);
    expect(opened.connections.get(LINEAR)?.signIn?.refreshToken).toBe("");
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses a secret named %j", async (name) => {
    const id = (await rig.vaults.ensureMine(ORG, ana)).metadata!.id;
    const secrets: Record<string, { value: string; description: string }> = {};
    Object.defineProperty(secrets, name, {
      value: { value: "x", description: "" },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const failure = await rig.vaults.setSecrets(id, secrets, ana).catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("finds no entry under an inherited name", async () => {
    const id = (await rig.vaults.ensureMine(ORG, ana)).metadata!.id;
    const { removed } = await rig.vaults.removeSecrets(id, ["constructor", "toString"], ana);
    expect(removed).toEqual([]);
    const gone = await rig.vaults.removeConnections(id, ["constructor"], ana);
    expect(gone.removed).toEqual([]);
  });
});

describe("name claims that outlive their write", () => {
  it("frees a claim a minute old whose vault never landed, and creates My vault", async () => {
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await rig.store.resourceNames.claim(myVaultNameKey(ORG, "ida_ana"), "vlt_ghost", old);
    const mine = await rig.vaults.ensureMine(ORG, ana);
    expect(mine.metadata?.id).not.toBe("vlt_ghost");
    expect((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id).toBe(mine.metadata?.id);
  });

  it("answers UNAVAILABLE while a young claim's vault has not landed, and findMine sees none", async () => {
    await rig.store.resourceNames.claim(
      myVaultNameKey(ORG, "ida_ana"),
      "vlt_inflight",
      new Date().toISOString(),
    );
    expect(await rig.vaults.findMine(ORG, "ida_ana")).toBeUndefined();
    const failure = await rig.vaults.ensureMine(ORG, ana).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Unavailable);
  });

  it("an external id whose vault is gone finds nothing", async () => {
    await rig.store.resourceNames.claim(
      externalIdNameKey(ORG, "customer-9"),
      "vlt_gone",
      new Date().toISOString(),
    );
    expect(await rig.vaults.findByExternalId(ORG, "customer-9")).toBeUndefined();
  });

  it("a first write that fails to persist releases its claim", async () => {
    const service = serviceOver(storeWith({ saveResource: failing }));
    await expect(service.ensureMine(ORG, ana)).rejects.toThrow();
    expect(
      await rig.store.resourceNames.resolve(myVaultNameKey(ORG, "ida_ana"), new Date().toISOString()),
    ).toBeUndefined();
  });

  /**
   * A tuple driver whose writes the authorizer reads back: the person can
   * see a vault once its creation tuples landed. The first `failures`
   * creation writes fail, each after `delayMs`.
   */
  function tupleRig(failures: number, delayMs = 0) {
    const tupled = new Set<string>();
    let failuresLeft = failures;
    let writes = 0;
    const lifecycle: ResourceAuthorizationLifecycle = {
      async onResourceCreated(event) {
        writes++;
        if (failuresLeft > 0) {
          failuresLeft--;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          throw new Error("tuple store down");
        }
        tupled.add(event.resourceId);
      },
      onResourceDeleted: async () => {},
      onVisibilityChanged: async () => {},
    };
    const authorizer: Authorizer = {
      authorize: (_caller, check) =>
        Promise.resolve(
          tupled.has(check.resourceId)
            ? { kind: "allow" }
            : { kind: "deny", reason: "no tuples" },
        ),
    };
    const over = (store: Store) =>
      newVaultService({
        store,
        logger: silentLogger,
        secretService: rig.secrets,
        authorizationLifecycle: lifecycle,
        authorizer,
      });
    return { tupled, over, writes: () => writes };
  }

  it("a first write whose authorization tuples fail keeps its row and claim, and the next write writes the tuples", async () => {
    const tuples = tupleRig(1);
    await expect(tuples.over(rig.store).ensureMine(ORG, ana)).rejects.toThrow();
    expect(await rig.store.listResources(ApiResourceKind.vault)).toHaveLength(1);
    const mine = await tuples.over(rig.store).ensureMine(ORG, ana);
    expect(mine.metadata?.id).toBe((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id);
    expect(tuples.tupled.has(mine.metadata!.id)).toBe(true);
    expect(await rig.store.listResources(ApiResourceKind.vault)).toHaveLength(1);
  });

  it("a My vault a failed first write could not clean up is repaired by the next write", async () => {
    const tuples = tupleRig(1);
    await expect(
      tuples.over(storeWith({ deleteResource: failing })).ensureMine(ORG, ana),
    ).rejects.toThrow();
    const mine = await tuples.over(rig.store).ensureMine(ORG, ana);
    // The person can see the vault the write lands in.
    expect(tuples.tupled.has(mine.metadata!.id)).toBe(true);
    expect((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id).toBe(mine.metadata?.id);
  });

  it("a racing first write never reports success into a vault its person cannot see or that is then removed", async () => {
    // The winner's tuple write fails after the loser has seen its row.
    const tuples = tupleRig(1, 60);
    const service = tuples.over(rig.store);
    const outcomes = await Promise.allSettled([
      service.ensureMine(ORG, ana),
      service.ensureMine(ORG, ana),
    ]);
    const succeeded = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );
    expect(succeeded.length).toBeGreaterThan(0);
    for (const vault of succeeded) {
      const id = vault.metadata!.id;
      expect(await loadVault(rig.store, id)).toBeDefined();
      expect(tuples.tupled.has(id)).toBe(true);
    }
  });

  it("an existing My vault its person can see is used as it is: no tuples are written again", async () => {
    const tuples = tupleRig(0);
    const service = tuples.over(rig.store);
    const first = await service.ensureMine(ORG, ana);
    expect(tuples.writes()).toBe(1);
    expect((await service.ensureMine(ORG, ana)).metadata?.id).toBe(first.metadata?.id);
    expect(tuples.writes()).toBe(1);
  });

  it("refuses a write, writing nothing, while it cannot tell whether its person sees their My vault", async () => {
    const tuples = tupleRig(0);
    const first = await tuples.over(rig.store).ensureMine(ORG, ana);
    const unsure = newVaultService({
      store: rig.store,
      logger: silentLogger,
      secretService: rig.secrets,
      authorizationLifecycle: {
        onResourceCreated: async () => {
          throw new Error("no tuples are written while the check is unavailable");
        },
        onResourceDeleted: async () => {},
        onVisibilityChanged: async () => {},
      },
      authorizer: {
        authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("authorizer down") }),
      },
    });
    const failure = await unsure.ensureMine(ORG, ana).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Internal);
    expect((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id).toBe(first.metadata?.id);
  });

  it("a claim whose vault did land is kept", async () => {
    const mine = await rig.vaults.ensureMine(ORG, ana);
    await releaseUnstoredClaim(rig.store, silentLogger, myVaultNameKey(ORG, "ida_ana"), mine.metadata!.id);
    expect((await rig.vaults.findMine(ORG, "ida_ana"))?.metadata?.id).toBe(mine.metadata?.id);
  });

  it("a claim that cannot be released stays, logged, and nothing throws", async () => {
    await expect(
      releaseUnstoredClaim(
        storeWith({ getResource: failing }),
        silentLogger,
        myVaultNameKey(ORG, "ida_ana"),
        "vlt_any",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("lookups and faults", () => {
  it("a reference without a slug or an organization names no vault", async () => {
    expect(
      await rig.vaults.findByReference({ org: "", kind: 0, slug: "team" } as never, ""),
    ).toBeUndefined();
    expect(
      await rig.vaults.findByReference({ org: ORG, kind: 0, slug: "" } as never, ORG),
    ).toBeUndefined();
  });

  it("a store fault on a vault read propagates", async () => {
    await expect(loadVault(storeWith({ getResource: failing }), "vlt_x")).rejects.toThrow(
      "disk gone",
    );
  });

  it("an entry write on a vault that is gone is NOT_FOUND, a store fault INTERNAL", async () => {
    const missing = await rig.vaults
      .removeSecrets("vlt_missing", ["X"], ana)
      .then(() => undefined, (error: unknown) => error);
    expect((missing as ConnectError).code).toBe(Code.NotFound);

    const shared = await seedSharedVault(rig.store, ORG, "team");
    const faulted = await serviceOver(storeWith({ updateResource: failing }))
      .removeSecrets(shared.metadata!.id, ["X"], ana)
      .then(() => undefined, (error: unknown) => error);
    expect((faulted as ConnectError).code).toBe(Code.Internal);

    const loginFault = await serviceOver(storeWith({ updateResource: failing }))
      .setConnection(shared.metadata!.id, "github.com", { token: "t", source: VaultConnectionSource.pasted }, ana)
      .then(() => undefined, (error: unknown) => error);
    expect((loginFault as ConnectError).code).toBe(Code.Internal);
  });
});

describe("a keyless server", () => {
  it("keeps a vault's secrets and logins in plaintext, with one warning per write", async () => {
    const warnings: Array<{ message: string; fields: unknown }> = [];
    const keyless = newVaultService({
      store: rig.store,
      logger: {
        ...silentLogger,
        warn: (message: string, fields?: unknown) => warnings.push({ message, fields }),
      } as typeof silentLogger,
      secretService: SecretService.create(undefined),
      authorizationLifecycle: undefined,
    });
    const shared = await seedSharedVault(rig.store, ORG, "team");
    const id = shared.metadata!.id;

    await keyless.setSecrets(
      id,
      { API_KEY: { value: "sk-plain", description: "" }, OTHER: { value: "o-plain", description: "" } },
      ana,
    );
    const written = await keyless.setConnection(
      id,
      "https://mcp.example/mcp",
      {
        token: "at-plain",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://login.example/token",
          refreshToken: "rt-plain",
          mcpServerId: "mcp_x",
        },
      },
      ana,
    );

    expect(written.spec?.secrets["API_KEY"]?.value).toBe("sk-plain");
    expect(written.spec?.connections["https://mcp.example/mcp"]?.token).toBe("at-plain");
    expect(written.spec?.connections["https://mcp.example/mcp"]?.signIn?.refreshToken).toBe("rt-plain");
    const message = "Encryption disabled: a vault's secrets and logins will be stored in plaintext";
    expect(warnings).toEqual([
      { message, fields: { vaultId: id, operation: "setSecrets" } },
      { message, fields: { vaultId: id, operation: "setConnection" } },
    ]);
  });

  it("warns nothing where a key seals the values", async () => {
    const warnings: string[] = [];
    const sealing = newVaultService({
      store: rig.store,
      logger: { ...silentLogger, warn: (message: string) => warnings.push(message) } as typeof silentLogger,
      secretService: rig.secrets,
      authorizationLifecycle: undefined,
    });
    const shared = await seedSharedVault(rig.store, ORG, "team");
    await sealing.setSecrets(shared.metadata!.id, { API_KEY: { value: "sk", description: "" } }, ana);
    expect(warnings).toEqual([]);
  });
});
