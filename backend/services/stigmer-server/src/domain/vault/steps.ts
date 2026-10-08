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
 * Proven by __tests__/controller.test.ts and __tests__/steps.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditStatusSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import {
  alreadyExistsError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameRename,
  Store,
} from "../../store/interface.js";

import {
  MY_VAULT_SLUG_REFUSAL,
  OWNER_IMMUTABLE_REFUSAL,
  SHARED_VAULT_OWNER_REFUSAL,
  isMyVaultSlug,
} from "./constants.js";
import {
  EXTERNAL_ID_NAME_KIND,
  claimVaultName,
  externalIdNameKey,
  isMyVault,
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
 * none, a rename when it held another (the old id frees at once). A taken
 * id answers ALREADY_EXISTS naming the holder. An update that clears the
 * id releases it after the persist (newReleaseClearedExternalIdStep).
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
      if (previous === "") {
        const claim = await claimVaultName(
          store,
          externalIdNameKey(org, externalId),
          id,
        );
        if (!claim.claimed) {
          taken(claim.entry.id);
        }
        ctx.set(CLAIMED_EXTERNAL_ID_KEY, { kind: "claimed", entry: claim.entry });
        return;
      }
      const now = new Date().toISOString();
      const rename: ResourceNameRename = {
        kind: EXTERNAL_ID_NAME_KIND,
        org,
        id,
        from: previous,
        to: externalId,
        fromExpiresAt: now,
        now,
      };
      const moved = await store.resourceNames.rename(rename);
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

/** After an update persists: frees the external id an update cleared. */
export function newReleaseClearedExternalIdStep(
  store: Store,
  logger: Logger,
): PipelineStep<VaultDesc> {
  return {
    name: "ReleaseClearedExternalId",
    async execute(ctx: RequestContext<VaultDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Vault | undefined;
      const previous = existing?.spec?.externalId ?? "";
      if (previous === "" || (ctx.newState.spec?.externalId ?? "") !== "") {
        return;
      }
      const org = existing?.metadata?.org ?? "";
      const id = existing?.metadata?.id ?? "";
      try {
        await store.resourceNames.release(EXTERNAL_ID_NAME_KIND, org, id);
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
      // An update from no external id: the vault holds no other name of
      // this kind, so its release frees exactly this claim.
      await store.resourceNames.release(move.entry.kind, move.entry.org, move.entry.id);
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
 * Update's persist: the vault's own fields from the request, its entries
 * and its visibility as the row holds them at the moment of the write,
 * inside the store's atomic read-modify-write, so an entry saved or a
 * visibility change made after the chain loaded the vault is never undone
 * (an update never changes visibility, and a reverted row would disagree
 * with the visibility tuples updateVisibility wrote). Runs where Persist
 * would.
 */
export function newPersistVaultUpdateStep(store: Store): PipelineStep<VaultDesc> {
  return {
    name: "PersistVaultUpdate",
    async execute(ctx: RequestContext<VaultDesc>): Promise<void> {
      const id = ctx.newState.metadata?.id ?? "";
      refuseBoundElsewhere(ctx.callerIdentity, ctx.newState.metadata?.org ?? "");
      const next = ctx.newState;
      let written: Vault;
      try {
        written = await store.updateResource(ApiResourceKind.vault, id, VaultSchema, (row) => {
          const spec = (next.spec ??= create(VaultSpecSchema));
          spec.secrets = row.spec?.secrets ?? {};
          spec.connections = row.spec?.connections ?? {};
          const metadata = next.metadata;
          if (metadata !== undefined && row.metadata !== undefined) {
            metadata.visibility = row.metadata.visibility;
          }
          row.apiVersion = next.apiVersion;
          row.kind = next.kind;
          row.metadata = metadata;
          row.spec = spec;
          row.status = next.status;
          // Stamped here, under the row lock: the chain's stamp predates
          // any entry write that landed since its load.
          setAuditFieldsForUpdate(VaultSchema, row, "spec_audit", ctx.callerIdentity);
        });
      } catch (error) {
        throw persistFailure(error, id);
      }
      ctx.setNewState(written);
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
