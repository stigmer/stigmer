/**
 * Pins the vault chain steps' edges the RPC tests do not reach: create
 * refuses an owner organization other than the vault's own; an update
 * that clears or moves an external id lets go of the old one by name, and
 * logs a release it cannot make; and a failed write undoes its external
 * id move whichever way it made it (a rename reverted, an update's first
 * claim released by name, a create's unstored claim freed), logging,
 * never throwing, when the undo itself fails. Racing updates leave the
 * name table holding exactly the external id the row carries (#2034): a
 * loser's undo and a winner's late release each let go of their own name
 * only, a move holds the old id until its row is saved, a name no row
 * carries frees itself past the claim grace, and a delete lets go of
 * every external id the vault holds. And the
 * update's write is a compare-and-swap on the row the chain read, so an
 * entry saved or a visibility change made after the load makes it lose
 * (the chain then runs again from a fresh read, pinned in
 * controller.test.ts) and stands; the visibility write lands inside the
 * store's atomic read-modify-write; neither write reverts the spec audit
 * an entry write stamped. Each of update's two
 * layers, on its own, keeps the stored entries over the ones a request
 * carries: KeepStoredOwnerAndEntries puts the loaded row's back, and
 * PersistVaultUpdate writes the row's.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSchema,
  VaultSecretSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import type { VaultSpec } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../../pipeline/steps/defaults.js";
import { isWriteConflict } from "../../../pipeline/guarded-write.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../../../pipeline/steps/load-existing.js";
import type {
  ResourceNameKey,
  ResourceNameRename,
  Store,
} from "../../../store/interface.js";

import { EXTERNAL_ID_NAME_KIND, OWNER_IMMUTABLE_REFUSAL } from "../constants.js";
import { releaseVaultNames } from "../delete.js";
import { externalIdNameKey, loadVault } from "../service.js";
import { openVaultRig, seedSharedVault } from "./support.js";
import type { VaultRig } from "./support.js";
import {
  newClaimExternalIdStep,
  newKeepStoredOwnerAndEntriesStep,
  newPersistVaultUpdateStep,
  newPersistVaultVisibilityStep,
  CLAIMED_EXTERNAL_ID_KEY,
  newReleaseClearedExternalIdStep,
  newStampSharedOwnerStep,
  undoExternalIdMoveAfterFailure,
} from "../steps.js";
import { silentLogger } from "./support.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";

function vault(init: { id?: string; externalId?: string; owner?: VaultSpec["owner"] }): Vault {
  return create(VaultSchema, {
    metadata: { id: init.id ?? "vlt_1", org: "org_a" },
    spec: {
      externalId: init.externalId ?? "",
      ...(init.owner === undefined ? {} : { owner: init.owner }),
    },
  });
}

function ctxOf(next: Vault, existing?: Vault): RequestContext<typeof VaultSchema> {
  const ctx = new RequestContext(
    VaultSchema,
    next,
    testCallerIdentity({ identityId: "ida_admin" }),
    ApiResourceKind.vault,
  );
  if (existing !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, existing);
  }
  return ctx;
}

/** An update's context over the stored row as LoadExisting reads it: the row and its bytes. */
async function updateCtxOf(store: Store, id: string, edit: (next: Vault) => void): Promise<RequestContext<typeof VaultSchema>> {
  const read = await store.readResourceForWrite(ApiResourceKind.vault, id, VaultSchema);
  const next = clone(VaultSchema, read.resource);
  edit(next);
  const ctx = ctxOf(next, read.resource);
  ctx.set(EXISTING_RESOURCE_BYTES_KEY, read.bytes);
  return ctx;
}

/** The ConnectError a step fails with, or undefined when it lands. */
async function failureOf(run: () => Promise<void> | void): Promise<ConnectError | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

/** A name table that records what it is asked, or fails every call. */
function names(fail = false): { store: Store; calls: string[] } {
  const calls: string[] = [];
  const record = (what: string) => async () => {
    calls.push(what);
    if (fail) {
      throw new Error("names table gone");
    }
  };
  const store = {
    getResource: async () => {
      throw new Error("no row");
    },
    resourceNames: {
      release: record("release"),
      releaseName: (key: ResourceNameKey) => record(`releaseName:${key.name}`)(),
      revertRename: record("revertRename"),
    },
  } as unknown as Store;
  return { store, calls };
}

function loggerRecording(errors: string[]): Logger {
  return { ...silentLogger, error: (message: string) => errors.push(message) } as Logger;
}

describe("StampSharedOwner", () => {
  it("refuses an owner organization other than the vault's own", () => {
    const ctx = ctxOf(vault({ owner: { case: "org", value: "org_b" } }));
    let failure: unknown;
    try {
      newStampSharedOwnerStep().execute(ctx);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect((failure as ConnectError).rawMessage).toBe(OWNER_IMMUTABLE_REFUSAL);
  });
});

describe("ReleaseClearedExternalId", () => {
  it("logs a release it cannot make and lets the update stand", async () => {
    const errors: string[] = [];
    const { store } = names(true);
    await newReleaseClearedExternalIdStep(store, loggerRecording(errors)).execute(
      ctxOf(vault({ externalId: "" }), vault({ externalId: "customer-1" })),
    );
    expect(errors).toEqual(["vault updated but its cleared external id could not be released"]);
  });

  it("lets go of the cleared id by name", async () => {
    const { store, calls } = names();
    await newReleaseClearedExternalIdStep(store, silentLogger).execute(
      ctxOf(vault({ externalId: "" }), vault({ externalId: "customer-1" })),
    );
    expect(calls).toEqual(["releaseName:customer-1"]);
  });

  it("lets go of the old id by name once a move is saved", async () => {
    const { store, calls } = names();
    await newReleaseClearedExternalIdStep(store, silentLogger).execute(
      ctxOf(vault({ externalId: "new" }), vault({ externalId: "old" })),
    );
    expect(calls).toEqual(["releaseName:old"]);
  });
});

describe("undoExternalIdMoveAfterFailure", () => {
  const rename: ResourceNameRename = {
    kind: EXTERNAL_ID_NAME_KIND,
    org: "org_a",
    id: "vlt_1",
    from: "old",
    to: "new",
    fromExpiresAt: "",
    now: "",
  };
  const entry = {
    kind: EXTERNAL_ID_NAME_KIND,
    org: "org_a",
    name: "new",
    id: "vlt_1",
    state: "current" as const,
    claimedAt: "",
    expiresAt: "",
  };

  it("reverts a rename", async () => {
    const { store, calls } = names();
    const ctx = ctxOf(vault({}), vault({ externalId: "old" }));
    ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "renamed", rename });
    await undoExternalIdMoveAfterFailure(store, silentLogger, ctx);
    expect(calls).toEqual(["revertRename"]);
  });

  it("releases an update's first claim by name", async () => {
    const { store, calls } = names();
    const ctx = ctxOf(vault({}), vault({}));
    ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "claimed", entry });
    await undoExternalIdMoveAfterFailure(store, silentLogger, ctx);
    expect(calls).toEqual(["releaseName:new"]);
  });

  it("frees a create's claim whose row never landed", async () => {
    const { store, calls } = names();
    const ctx = ctxOf(vault({}));
    ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "claimed", entry });
    await undoExternalIdMoveAfterFailure(store, silentLogger, ctx);
    // The unstored-claim release reads the row first; a failed read is logged there.
    expect(calls).toEqual([]);
  });

  it("logs an undo that fails, never throwing", async () => {
    const errors: string[] = [];
    const { store } = names(true);
    const ctx = ctxOf(vault({}), vault({ externalId: "old" }));
    ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "renamed", rename });
    await undoExternalIdMoveAfterFailure(store, loggerRecording(errors), ctx);
    expect(errors).toEqual(["vault write failed and its external id claim could not be undone"]);
  });
});

describe("writes that keep entries saved since the load", () => {
  const admin = testCallerIdentity({ identityId: "ida_admin" });

  it("an update loses its swap to an entry saved after the chain loaded the vault, and the entry stands", async () => {
    const rig = openVaultRig();
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "team");
      const id = seeded.metadata!.id;
      const ctx = await updateCtxOf(rig.store, id, (next) => {
        next.metadata!.name = "Renamed";
      });
      await rig.vaults.setSecrets(id, { LATE: { value: "saved-meanwhile", description: "" } }, admin);
      newKeepStoredOwnerAndEntriesStep().execute(ctx);
      const conflict = await failureOf(() => newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(ctx));
      expect(conflict !== undefined && isWriteConflict(conflict)).toBe(true);
      const stored = (await loadVault(rig.store, id))!;
      expect(stored.metadata?.name).not.toBe("Renamed");
      expect(Object.keys(stored.spec?.secrets ?? {})).toEqual(["LATE"]);
    } finally {
      rig.close();
    }
  });

  it("an update loses its swap to a visibility change made after the chain loaded the vault, and the change stands", async () => {
    const rig = openVaultRig();
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "team");
      const id = seeded.metadata!.id;
      const ctx = await updateCtxOf(rig.store, id, (next) => {
        next.metadata!.name = "Renamed";
      });
      const loaded = ctx.get(EXISTING_RESOURCE_KEY) as Vault;
      expect(loaded.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
      const changed = clone(VaultSchema, loaded);
      changed.metadata!.visibility = ApiResourceVisibility.visibility_org;
      await newPersistVaultVisibilityStep(rig.store).execute(ctxOf(changed, changed));
      newKeepStoredOwnerAndEntriesStep().execute(ctx);
      const conflict = await failureOf(() => newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(ctx));
      expect(conflict !== undefined && isWriteConflict(conflict)).toBe(true);
      const stored = (await loadVault(rig.store, id))!;
      expect(stored.metadata?.name).not.toBe("Renamed");
      expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    } finally {
      rig.close();
    }
  });

  it("an update and a visibility change never revert the spec audit of an entry saved after the chain loaded the vault", async () => {
    const rig = openVaultRig();
    const writer = testCallerIdentity({ identityId: "ida_writer" });
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "team");
      const id = seeded.metadata!.id;

      const update = await updateCtxOf(rig.store, id, (next) => {
        next.metadata!.name = "Renamed";
      });
      const entry = await rig.vaults.setSecrets(id, { LATE: { value: "saved-meanwhile", description: "" } }, writer);
      newKeepStoredOwnerAndEntriesStep().execute(update);
      await failureOf(() => newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(update));
      const updated = (await loadVault(rig.store, id))!;
      expect(updated.status?.audit?.specAudit).toEqual(entry.status?.audit?.specAudit);

      const beforeVisibility = (await loadVault(rig.store, id))!;
      const visibility = ctxOf(beforeVisibility, beforeVisibility);
      const later = await rig.vaults.setSecrets(id, { LATER: { value: "saved-meanwhile", description: "" } }, writer);
      beforeVisibility.metadata!.visibility = ApiResourceVisibility.visibility_org;
      setAuditFieldsForUpdate(VaultSchema, beforeVisibility, "status_audit", admin);
      await newPersistVaultVisibilityStep(rig.store).execute(visibility);
      const shared = (await loadVault(rig.store, id))!;
      expect(shared.status?.audit?.specAudit).toEqual(later.status?.audit?.specAudit);
      expect(shared.status?.audit?.statusAudit).toEqual(beforeVisibility.status?.audit?.statusAudit);
    } finally {
      rig.close();
    }
  });

  it("KeepStoredOwnerAndEntries puts the loaded row's entries over the request's", () => {
    const existing = vault({});
    existing.spec!.secrets["API_KEY"] = create(VaultSecretSchema, { value: "enc:v9:c2VhbGVk" });
    existing.spec!.connections["github.com"] = create(VaultConnectionSchema, { token: "enc:v9:dG9rZW4=" });
    const next = clone(VaultSchema, existing);
    next.spec!.secrets["API_KEY"] = create(VaultSecretSchema, { value: "sent-plain" });
    next.spec!.secrets["NEW_KEY"] = create(VaultSecretSchema, { value: "sent-new" });
    next.spec!.connections["github.com"] = create(VaultConnectionSchema, { token: "sent-token" });
    const ctx = ctxOf(next, existing);
    newKeepStoredOwnerAndEntriesStep().execute(ctx);
    expect(ctx.newState.spec?.secrets).toEqual(existing.spec?.secrets);
    expect(ctx.newState.spec?.connections).toEqual(existing.spec?.connections);
  });

  it("PersistVaultUpdate writes the row's entries, never the request's, even with no step before it", async () => {
    const rig = openVaultRig();
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "team", {
        secrets: { API_KEY: "enc:v9:c2VhbGVk" },
        connections: { "github.com": "enc:v9:dG9rZW4=" },
      });
      const id = seeded.metadata!.id;
      const before = (await loadVault(rig.store, id))!;
      const ctx = await updateCtxOf(rig.store, id, (next) => {
        next.spec!.secrets["API_KEY"] = create(VaultSecretSchema, { value: "sent-plain" });
        next.spec!.secrets["NEW_KEY"] = create(VaultSecretSchema, { value: "sent-new" });
        next.spec!.connections["github.com"] = create(VaultConnectionSchema, { token: "sent-token" });
      });
      await newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(ctx);
      const stored = (await loadVault(rig.store, id))!;
      expect(stored.spec?.secrets).toEqual(before.spec?.secrets);
      expect(stored.spec?.connections).toEqual(before.spec?.connections);
    } finally {
      rig.close();
    }
  });

  it("a visibility change keeps an entry saved after the chain loaded the vault", async () => {
    const rig = openVaultRig();
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "team");
      const id = seeded.metadata!.id;
      const loaded = (await loadVault(rig.store, id))!;
      const ctx = ctxOf(loaded, loaded);
      await rig.vaults.setSecrets(id, { LATE: { value: "saved-meanwhile", description: "" } }, admin);
      loaded.metadata!.visibility = ApiResourceVisibility.visibility_org;
      await newPersistVaultVisibilityStep(rig.store).execute(ctx);
      const stored = (await loadVault(rig.store, id))!;
      expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
      expect(Object.keys(stored.spec?.secrets ?? {})).toEqual(["LATE"]);
      expect(Object.keys((ctx.get(EXISTING_RESOURCE_KEY) as Vault).spec?.secrets ?? {})).toEqual([
        "LATE",
      ]);
    } finally {
      rig.close();
    }
  });

  it("a vault deleted mid-chain loses the update's swap and is NOT_FOUND to visibility, and a store fault INTERNAL", async () => {
    const rig = openVaultRig();
    try {
      const seeded = await seedSharedVault(rig.store, "acme", "doomed");
      const doomed = await updateCtxOf(rig.store, seeded.metadata!.id, () => {});
      await rig.store.deleteResource(ApiResourceKind.vault, seeded.metadata!.id);
      const update = await failureOf(() => newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(doomed));
      expect(update !== undefined && isWriteConflict(update)).toBe(true);
      const gone = vault({ id: "vlt_gone" });
      gone.metadata!.org = "acme";
      const visibility = await Promise.resolve(newPersistVaultVisibilityStep(rig.store).execute(ctxOf(gone, gone))).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((visibility as ConnectError).code).toBe(Code.NotFound);
      const faulty = {
        swapResource: async () => {
          throw new Error("disk gone");
        },
      } as unknown as Store;
      const faultCtx = ctxOf(gone, gone);
      faultCtx.set(EXISTING_RESOURCE_BYTES_KEY, new Uint8Array([1]));
      const fault = await Promise.resolve(newPersistVaultUpdateStep(faulty, UNBOUND_CREDENTIAL_BINDING).execute(faultCtx)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((fault as ConnectError).code).toBe(Code.Internal);
    } finally {
      rig.close();
    }
  });
});

describe("external ids under racing updates", () => {
  const ORG = "acme";
  const OUTSIDE_THE_CLAIM_GRACE = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  /** A shared vault whose row carries `externalId` and which holds it in the name table. */
  async function seedWithExternalId(rig: VaultRig, slug: string, externalId: string): Promise<string> {
    const id = (await seedSharedVault(rig.store, ORG, slug)).metadata!.id;
    if (externalId !== "") {
      await rig.store.updateResource(ApiResourceKind.vault, id, VaultSchema, (row) => {
        row.spec!.externalId = externalId;
      });
      await rig.store.resourceNames.claim(externalIdNameKey(ORG, externalId), id, new Date().toISOString());
    }
    return id;
  }

  /** An update that has read the row and asks for `externalId`, its claim not yet made. */
  async function load(rig: VaultRig, id: string, externalId: string): Promise<RequestContext<typeof VaultSchema>> {
    const ctx = await updateCtxOf(rig.store, id, (next) => {
      next.spec!.externalId = externalId;
    });
    newKeepStoredOwnerAndEntriesStep().execute(ctx);
    return ctx;
  }

  async function claim(rig: VaultRig, ctx: RequestContext<typeof VaultSchema>): Promise<void> {
    await newClaimExternalIdStep(rig.store).execute(ctx);
  }

  /** An update through its claim, short of the save. */
  async function begin(rig: VaultRig, id: string, externalId: string): Promise<RequestContext<typeof VaultSchema>> {
    const ctx = await load(rig, id, externalId);
    await claim(rig, ctx);
    return ctx;
  }

  async function save(rig: VaultRig, ctx: RequestContext<typeof VaultSchema>): Promise<void> {
    await newPersistVaultUpdateStep(rig.store, UNBOUND_CREDENTIAL_BINDING).execute(ctx);
  }

  async function releaseAfterSave(rig: VaultRig, ctx: RequestContext<typeof VaultSchema>): Promise<void> {
    await newReleaseClearedExternalIdStep(rig.store, silentLogger).execute(ctx);
  }

  /** The update's swap loses to a write made since its read, and the chain undoes its move. */
  async function lose(rig: VaultRig, ctx: RequestContext<typeof VaultSchema>): Promise<void> {
    const conflict = await failureOf(() => save(rig, ctx));
    expect(conflict !== undefined && isWriteConflict(conflict)).toBe(true);
    await undoExternalIdMoveAfterFailure(rig.store, silentLogger, ctx);
  }

  /** The vault the name table resolves an external id to, or undefined. */
  async function holderOf(rig: VaultRig, externalId: string): Promise<string | undefined> {
    return (await rig.store.resourceNames.resolve(externalIdNameKey(ORG, externalId), new Date().toISOString()))?.id;
  }

  async function foundBy(rig: VaultRig, externalId: string): Promise<string | undefined> {
    return (await rig.vaults.findByExternalId(ORG, externalId))?.metadata?.id;
  }

  /** Another vault's create claiming `externalId`, its row not yet stored: the failure, or undefined when it wins. */
  async function createClaims(rig: VaultRig, externalId: string): Promise<ConnectError | undefined> {
    const other = vault({ id: "vlt_other", externalId });
    other.metadata!.org = ORG;
    return failureOf(() => newClaimExternalIdStep(rig.store).execute(ctxOf(other)));
  }

  async function rowOf(rig: VaultRig, id: string): Promise<string | undefined> {
    return (await loadVault(rig.store, id))?.spec?.externalId;
  }

  it("two updates from no id: the loser's undo lets go of its own claim and keeps the winner's", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "");
      const a = await begin(rig, id, "customer-x");
      const b = await begin(rig, id, "customer-y");
      await save(rig, a);
      await releaseAfterSave(rig, a);
      await lose(rig, b);
      expect(await rowOf(rig, id)).toBe("customer-x");
      expect(await holderOf(rig, "customer-x")).toBe(id);
      expect(await foundBy(rig, "customer-x")).toBe(id);
      expect(await holderOf(rig, "customer-y")).toBeUndefined();
    } finally {
      rig.close();
    }
  });

  it("a clear racing a move: the clear's release, landing after the move's retry, keeps the move's id", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "customer-x");
      const clear = await begin(rig, id, "");
      const move = await begin(rig, id, "customer-y");
      await save(rig, clear);
      await lose(rig, move);
      const retry = await begin(rig, id, "customer-y");
      await save(rig, retry);
      await releaseAfterSave(rig, retry);
      await releaseAfterSave(rig, clear);
      expect(await rowOf(rig, id)).toBe("customer-y");
      expect(await holderOf(rig, "customer-y")).toBe(id);
      expect(await foundBy(rig, "customer-y")).toBe(id);
      expect(await holderOf(rig, "customer-x")).toBeUndefined();
    } finally {
      rig.close();
    }
  });

  it("a clear racing a move: the clear's release, landing before the move's claim, leaves nothing the row does not carry", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "customer-x");
      const clear = await begin(rig, id, "");
      const move = await load(rig, id, "customer-y");
      await save(rig, clear);
      await releaseAfterSave(rig, clear);
      await claim(rig, move);
      await lose(rig, move);
      expect(await rowOf(rig, id)).toBe("");
      expect(await holderOf(rig, "customer-x")).toBeUndefined();
      expect(await holderOf(rig, "customer-y")).toBeUndefined();
    } finally {
      rig.close();
    }
  });

  it("a move holds the old id until its row is saved: it still finds the vault, and no other vault can take it", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "customer-x");
      const move = await begin(rig, id, "customer-y");
      expect(await holderOf(rig, "customer-x")).toBe(id);
      expect(await foundBy(rig, "customer-x")).toBe(id);
      expect((await createClaims(rig, "customer-x"))?.code).toBe(Code.AlreadyExists);
      await save(rig, move);
      await releaseAfterSave(rig, move);
      expect(await holderOf(rig, "customer-x")).toBeUndefined();
      expect(await foundBy(rig, "customer-y")).toBe(id);
      expect(await createClaims(rig, "customer-x")).toBeUndefined();
    } finally {
      rig.close();
    }
  });

  it("two moves, the loser's claim second: the winner's id still finds the vault after the loser's undo, and nothing else is held", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "customer-x");
      const a = await begin(rig, id, "customer-y");
      const b = await begin(rig, id, "customer-z");
      await save(rig, a);
      await releaseAfterSave(rig, a);
      await lose(rig, b);
      expect(await rowOf(rig, id)).toBe("customer-y");
      expect(await holderOf(rig, "customer-y")).toBe(id);
      expect(await foundBy(rig, "customer-y")).toBe(id);
      expect((await createClaims(rig, "customer-y"))?.code).toBe(Code.AlreadyExists);
      expect(await holderOf(rig, "customer-x")).toBeUndefined();
      expect(await holderOf(rig, "customer-z")).toBeUndefined();
      const retry = await begin(rig, id, "customer-z");
      await save(rig, retry);
      await releaseAfterSave(rig, retry);
      expect(await holderOf(rig, "customer-z")).toBe(id);
      expect(await holderOf(rig, "customer-y")).toBeUndefined();
    } finally {
      rig.close();
    }
  });

  it("an id a live vault holds but its row does not carry frees itself past the claim grace, and not inside it", async () => {
    const rig = openVaultRig();
    try {
      const stray = await seedWithExternalId(rig, "stray", "");
      await rig.store.resourceNames.claim(externalIdNameKey(ORG, "customer-old"), stray, OUTSIDE_THE_CLAIM_GRACE);
      await rig.store.resourceNames.claim(externalIdNameKey(ORG, "customer-new"), stray, new Date().toISOString());
      const carried = await seedWithExternalId(rig, "carried", "");
      await rig.store.updateResource(ApiResourceKind.vault, carried, VaultSchema, (row) => {
        row.spec!.externalId = "customer-kept";
      });
      await rig.store.resourceNames.claim(externalIdNameKey(ORG, "customer-kept"), carried, OUTSIDE_THE_CLAIM_GRACE);

      expect(await createClaims(rig, "customer-old")).toBeUndefined();
      expect(await holderOf(rig, "customer-old")).toBe("vlt_other");
      expect((await createClaims(rig, "customer-new"))?.code).toBe(Code.AlreadyExists);
      expect((await createClaims(rig, "customer-kept"))?.code).toBe(Code.AlreadyExists);
      expect(await holderOf(rig, "customer-kept")).toBe(carried);
    } finally {
      rig.close();
    }
  });

  it("a vault deleted while holding an id its row does not carry lets go of it", async () => {
    const rig = openVaultRig();
    try {
      const id = await seedWithExternalId(rig, "team", "");
      await rig.store.resourceNames.claim(externalIdNameKey(ORG, "customer-x"), id, new Date().toISOString());
      await releaseVaultNames(rig.store, silentLogger, (await loadVault(rig.store, id))!);
      expect(await holderOf(rig, "customer-x")).toBeUndefined();
    } finally {
      rig.close();
    }
  });
});
