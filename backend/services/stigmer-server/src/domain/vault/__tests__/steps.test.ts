/**
 * Pins the vault chain steps' edges the RPC tests do not reach: create
 * refuses an owner organization other than the vault's own; an update
 * that clears an external id logs a release it cannot make; and a failed
 * write undoes its external id move whichever way it made it (a rename
 * reverted, an update's first claim released, a create's unstored claim
 * freed), logging, never throwing, when the undo itself fails. And the
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

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSchema,
  VaultSecretSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import type { VaultSpec } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../../pipeline/steps/defaults.js";
import { isWriteConflict } from "../../../pipeline/guarded-write.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../../../pipeline/steps/load-existing.js";
import type { ResourceNameRename, Store } from "../../../store/interface.js";

import { OWNER_IMMUTABLE_REFUSAL } from "../constants.js";
import { EXTERNAL_ID_NAME_KIND, loadVault } from "../service.js";
import { openVaultRig, seedSharedVault } from "./support.js";
import {
  newKeepStoredOwnerAndEntriesStep,
  newPersistVaultUpdateStep,
  newPersistVaultVisibilityStep,
  CLAIMED_EXTERNAL_ID_KEY,
  newReleaseClearedExternalIdStep,
  newStampSharedOwnerStep,
  undoExternalIdMoveAfterFailure,
} from "../steps.js";
import { silentLogger } from "./support.js";

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

  it("releases an update's first claim", async () => {
    const { store, calls } = names();
    const ctx = ctxOf(vault({}), vault({}));
    ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "claimed", entry });
    await undoExternalIdMoveAfterFailure(store, silentLogger, ctx);
    expect(calls).toEqual(["release"]);
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
      const conflict = await failureOf(() => newPersistVaultUpdateStep(rig.store).execute(ctx));
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
      const conflict = await failureOf(() => newPersistVaultUpdateStep(rig.store).execute(ctx));
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
      await failureOf(() => newPersistVaultUpdateStep(rig.store).execute(update));
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
      await newPersistVaultUpdateStep(rig.store).execute(ctx);
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
      const update = await failureOf(() => newPersistVaultUpdateStep(rig.store).execute(doomed));
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
      const fault = await Promise.resolve(newPersistVaultUpdateStep(faulty).execute(faultCtx)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((fault as ConnectError).code).toBe(Code.Internal);
    } finally {
      rig.close();
    }
  });
});
