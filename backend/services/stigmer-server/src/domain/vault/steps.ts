/**
 * The vault chains' own steps: who owns a vault, what create and update may
 * change, and the external id's name claim.
 *
 * Ownership is the server's: create makes a shared vault and stamps its
 * organization; My vault is created only by the vault service on its
 * person's first entry write. A request never chooses an owner, and an
 * update never changes one. A new vault starts empty: entries arrive
 * through their own RPCs, which seal them, and update keeps the stored
 * entries whatever the request carries, so a client that sends back a
 * vault it read (every value blank) loses nothing. Update and visibility
 * changes persist inside the store's atomic read-modify-write, so an entry
 * saved, or a visibility change made, between the chain's load and its
 * write is never undone, and neither is the spec audit an entry write
 * stamps: an update stamps its own inside the write, so it is never older
 * than the row's, and a visibility change writes only the status audit.
 *
 * A vault holds an external id in the name table exactly while its row
 * carries it, however updates race (#2034). Each write lets go of only the
 * name it took or the one its saved row stopped carrying, never every
 * name of the kind, since a racing update's id may be among them; a move
 * holds the old id until the row is saved; a name no row carries frees
 * itself past the claim grace (externalIdHolder); and a delete lets go of
 * every external id the vault holds (delete.ts releaseVaultNames). These
 * chains are the only writers of a vault's external id; another writer
 * keeps the same rule.
 *
 * Proven by __tests__/controller.test.ts and __tests__/steps.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditStatusSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import {
  alreadyExistsError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { OrganizationAdmission } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { claimName } from "../../pipeline/steps/names.js";
import { moveName } from "../../pipeline/steps/rename.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { swapOntoLoadedRow } from "../../pipeline/steps/persist.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameRename,
  Store,
} from "../../store/interface.js";

import {
  EXTERNAL_ID_NAME_KIND,
  MY_VAULT_SLUG_REFUSAL,
  OWNER_IMMUTABLE_REFUSAL,
  SHARED_VAULT_OWNER_REFUSAL,
  isMyVaultSlug,
} from "./constants.js";
import { isMyVault } from "./row.js";
import {
  externalIdHolder,
  externalIdNameKey,
  releaseUnstoredClaim,
} from "./service.js";

type VaultDesc = typeof VaultSchema;

/** The external id claim this write took, for the release on failure and the old id's release on success. */
export const CLAIMED_EXTERNAL_ID_KEY = "vaultClaimedExternalId";

export const NEW_VAULT_HAS_ENTRIES_REFUSAL =
  "a new vault starts empty: save its secrets with setSecrets and its logins with setConnection";

/**
 * Create: the request may name no owner but its own organization, and no
 * entries; the owner becomes the organization. Runs after BuildNewState.
 */
export function newStampSharedOwnerStep(): PipelineStep<VaultDesc> {
  return {
    name: "StampSharedOwner",
    execute(ctx: RequestContext<VaultDesc>): void {
      const vault = ctx.newState;
      const org = vault.metadata?.org ?? "";
      const owner = vault.spec?.owner;
      if (owner?.case === "person") {
        throw invalidArgumentError(SHARED_VAULT_OWNER_REFUSAL);
      }
      if (owner?.case === "org" && owner.value !== "" && owner.value !== org) {
        throw invalidArgumentError(OWNER_IMMUTABLE_REFUSAL);
      }
      const spec = (vault.spec ??= create(VaultSpecSchema));
      if (
        Object.keys(spec.secrets).length > 0 ||
        Object.keys(spec.connections).length > 0
      ) {
        throw invalidArgumentError(NEW_VAULT_HAS_ENTRIES_REFUSAL);
      }
      spec.owner = { case: "org", value: org };
    },
  };
}

/** Create: a shared vault's slug may not take My vault's prefix. Runs after ResolveSlug. */
export function newRefuseMyVaultSlugStep(): PipelineStep<VaultDesc> {
  return {
    name: "RefuseMyVaultSlug",
    execute(ctx: RequestContext<VaultDesc>): void {
      if (isMyVaultSlug(ctx.newState.metadata?.slug ?? "")) {
        throw invalidArgumentError(MY_VAULT_SLUG_REFUSAL);
      }
    },
  };
}

/**
 * Update: the stored owner and entries win over whatever the request
 * carries; a request naming another owner is refused rather than ignored,
 * so a client learns its write would not do what it meant. My vault takes
 * no external id (it is a shared vault's handle for an integrator). Runs
 * after BuildUpdateState.
 */
export function newKeepStoredOwnerAndEntriesStep(): PipelineStep<VaultDesc> {
  return {
    name: "KeepStoredOwnerAndEntries",
    execute(ctx: RequestContext<VaultDesc>): void {
      // The update chain loads the stored row before this step.
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Vault;
      const stored = existing.spec ?? create(VaultSpecSchema);
      const spec = (ctx.newState.spec ??= create(VaultSpecSchema));
      const requested = spec.owner;
      if (
        requested.case !== undefined &&
        (requested.case !== stored.owner.case ||
          requested.value !== stored.owner.value)
      ) {
        throw invalidArgumentError(OWNER_IMMUTABLE_REFUSAL);
      }
      spec.owner = stored.owner;
      spec.secrets = stored.secrets;
      spec.connections = stored.connections;
      if (isMyVault(existing) && spec.externalId !== "") {
        throw invalidArgumentError(
          "an external id names a shared vault for an integrator; My vault takes none",
        );
      }
    },
  };
}

/** What an external id change did to the name table, for undoing it when the write fails. */
type ExternalIdMove =
  | { readonly kind: "claimed"; readonly entry: ResourceNameEntry }
  | { readonly kind: "renamed"; readonly rename: ResourceNameRename; readonly takenBack?: ResourceNameEntry };

/**
 * Takes the external id a create sets, or moves the vault's id to the one
 * an update sets, before the row is persisted: a claim when the vault held
 * none, a rename when it held another. The rename holds the old id, so it
 * keeps finding the vault, and nobody else takes it, while the row still
 * carries it; the update lets go of it once the row no longer does
 * (newReleaseClearedExternalIdStep). A taken id answers ALREADY_EXISTS
 * naming the holder; a holder whose row no longer carries the id frees it
 * past the claim grace (externalIdHolder).
 */
export function newClaimExternalIdStep(store: Store): PipelineStep<VaultDesc> {
  return {
    name: "ClaimExternalId",
    async execute(ctx: RequestContext<VaultDesc>): Promise<void> {
      const vault = ctx.newState;
      const externalId = vault.spec?.externalId ?? "";
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Vault | undefined;
      const previous = existing?.spec?.externalId ?? "";
      if (externalId === "" || externalId === previous) {
        return;
      }
      const org = vault.metadata?.org ?? "";
      const id = vault.metadata?.id ?? "";
      const taken = (holder: string): never => {
        throw alreadyExistsError(
          "Vault",
          `external_id '${externalId}' in this organization (id: ${holder})`,
        );
      };
      const holder = externalIdHolder(store);
      const now = new Date();
      if (previous === "") {
        const claim = await claimName(
          store,
          externalIdNameKey(org, externalId),
          id,
          now,
          holder,
        );
        if (!claim.claimed) {
          taken(claim.entry.id);
        }
        ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "claimed", entry: claim.entry });
        return;
      }
      const rename: ResourceNameRename = {
        kind: EXTERNAL_ID_NAME_KIND,
        org,
        id,
        from: previous,
        to: externalId,
        fromExpiresAt: "",
        now: now.toISOString(),
      };
      const moved = await moveName(store, rename, holder);
      if (!moved.claimed) {
        taken(moved.entry.id);
      }
      ctx.set(CLAIMED_EXTERNAL_ID_KEY, {
        kind: "renamed",
        rename,
        ...(moved.claimed && moved.takenBack !== undefined
          ? { takenBack: moved.takenBack }
          : {}),
      });
    },
  };
}

/**
 * After an update persists: frees the external id the saved row no longer
 * carries, whether the update cleared it or moved it to another (a move
 * clears the old id from the vault). Only that name: a racing update may
 * hold another of the vault's external ids, and the row it saves carries
 * that one.
 */
export function newReleaseClearedExternalIdStep(
  store: Store,
  logger: Logger,
): PipelineStep<VaultDesc> {
  return {
    name: "ReleaseClearedExternalId",
    async execute(ctx: RequestContext<VaultDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Vault | undefined;
      const previous = existing?.spec?.externalId ?? "";
      if (previous === "" || (ctx.newState.spec?.externalId ?? "") === previous) {
        return;
      }
      const org = existing?.metadata?.org ?? "";
      const id = existing?.metadata?.id ?? "";
      try {
        await store.resourceNames.releaseName(externalIdNameKey(org, previous), id);
      } catch (error) {
        logger.error("vault updated but its cleared external id could not be released", {
          vaultId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** Undoes the external id move a failed create or update made. */
export async function undoExternalIdMoveAfterFailure(
  store: Store,
  logger: Logger,
  ctx: RequestContext<VaultDesc>,
): Promise<void> {
  const move = ctx.get(CLAIMED_EXTERNAL_ID_KEY) as ExternalIdMove | undefined;
  if (move === undefined) {
    return;
  }
  try {
    if (move.kind === "renamed") {
      await store.resourceNames.revertRename(move.rename, move.takenBack);
      return;
    }
    if (ctx.get(EXISTING_RESOURCE_KEY) !== undefined) {
      // An update from no external id frees exactly this claim, never a
      // name a racing update of the same vault holds.
      await store.resourceNames.releaseName(move.entry, move.entry.id);
      return;
    }
    await releaseUnstoredClaim(store, logger, move.entry, move.entry.id);
  } catch (error) {
    logger.error("vault write failed and its external id claim could not be undone", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A vault deleted mid-chain is NOT_FOUND; any other fault INTERNAL. */
function persistFailure(error: unknown, id: string): Error {
  return error instanceof ResourceNotFoundError
    ? notFoundError("vault", id)
    : internalError(error, "failed to save resource to store");
}

/**
 * Update's persist: the vault's own fields from the request, its entries,
 * visibility and slug (rename's alone) from the row the chain read
 * (KeepStoredOwnerAndEntries, BuildUpdateState), stored by compare-and-swap
 * on that row. An entry saved, a visibility change or a rename that lands
 * after the chain's read makes the swap lose, and the chain runs again from
 * a fresh read (pipeline/guarded-write.ts), so none of them is undone (an
 * update never changes visibility, and a reverted row would disagree with
 * the visibility tuples updateVisibility wrote). Runs where Persist would.
 */
export function newPersistVaultUpdateStep(
  store: Store,
  binding: OrganizationAdmission,
): PipelineStep<VaultDesc> {
  return {
    name: "PersistVaultUpdate",
    async execute(ctx: RequestContext<VaultDesc>): Promise<void> {
      await refuseBoundElsewhere(
        binding,
        ctx.callerIdentity,
        ctx.newState.metadata?.org ?? "",
      );
      // The loaded row's entries, whatever a step before put there: an
      // update never writes a request's entries (setSecrets is their door).
      const loaded = ctx.get(EXISTING_RESOURCE_KEY) as Vault | undefined;
      const spec = (ctx.newState.spec ??= create(VaultSpecSchema));
      spec.secrets = loaded?.spec?.secrets ?? {};
      spec.connections = loaded?.spec?.connections ?? {};
      await swapOntoLoadedRow(store, ctx);
    },
  };
}

/**
 * updateVisibility's persist: the visibility and status audit the chain
 * set on the loaded vault (EXISTING_RESOURCE_KEY), applied to the row
 * inside the store's atomic read-modify-write, so entries saved since the
 * load stay, and so does the spec audit their writes stamped. The written
 * row replaces the loaded one under the key.
 */
export function newPersistVaultVisibilityStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "PersistVaultVisibility",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const loaded = ctx.get(EXISTING_RESOURCE_KEY) as Vault;
      let written: Vault;
      try {
        written = await store.updateResource(
          ApiResourceKind.vault,
          loaded.metadata?.id ?? "",
          VaultSchema,
          (row) => {
            if (row.metadata !== undefined) {
              row.metadata.visibility = loaded.metadata?.visibility ?? row.metadata.visibility;
            }
            const audit = ((row.status ??= create(ApiResourceAuditStatusSchema)).audit ??=
              create(ApiResourceAuditSchema));
            audit.statusAudit = loaded.status?.audit?.statusAudit;
          },
        );
      } catch (error) {
        throw persistFailure(error, loaded.metadata?.id ?? "");
      }
      ctx.set(EXISTING_RESOURCE_KEY, written);
    },
  };
}
