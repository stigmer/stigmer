/**
 * The vault delete chain's tail, shared by the delete RPC, the
 * organization purge and a member's departure, so every way a vault goes
 * removes the same things: the row, the grants on it, the backing state
 * of every sealed value it held, the names it claimed (a My vault's
 * person, a shared vault's external id), so the person's next first write
 * and the integrator's next create find them free, and the Connect links
 * that would save into it.
 *
 * A vault is never search-indexed, so there is no index entry to remove.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
} from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";

import {
  EXTERNAL_ID_NAME_KIND,
  MY_VAULT_NAME_KIND,
  personOf,
  sealedValuesOfVault,
} from "./service.js";
import type { VaultService } from "./service.js";
import { vaultListIndex } from "./list-index.js";

export interface VaultDeleteDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/**
 * The steps after the vault is loaded under EXISTING_RESOURCE_KEY and its
 * id under RESOURCE_ID_KEY.
 */
export function vaultDeleteSteps<Input extends DescMessage>(
  deps: VaultDeleteDeps,
): ReadonlyArray<PipelineStep<Input>> {
  return [
    newDeleteResourceStep<Input>(deps.store),
    newCleanupIamPoliciesStep<Input>(deps.authorizationLifecycle, deps.logger),
    newDestroySecretBackingStateStep<Input, typeof VaultSchema>(
      deps.secretService,
      deps.logger,
      sealedValuesOfVault,
    ),
    newReleaseVaultNamesStep<Input>(deps.store, deps.logger),
    newDeleteVaultConnectLinksStep<Input>(deps.store, deps.logger),
  ];
}

/**
 * Deletes the Connect links that would save into a deleted vault.
 * Best-effort after the row is gone: a link left behind finds no vault
 * when it is opened and answers NOT_FOUND.
 */
export function newDeleteVaultConnectLinksStep<Input extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Input> {
  return {
    name: "DeleteVaultConnectLinks",
    async execute(ctx: RequestContext<Input>): Promise<void> {
      const vault = ctx.get(EXISTING_RESOURCE_KEY) as Vault;
      const id = vault.metadata?.id ?? "";
      try {
        await store.connectLinks.deleteByVault(id);
      } catch (error) {
        logger.error("vault deleted but its Connect links could not be removed", {
          vaultId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Releases the names a deleted vault held. Best-effort after the row is
 * gone: a release that fails leaves a claim whose holder has no row, which
 * the next claim of the name frees once it is a minute old.
 */
export function newReleaseVaultNamesStep<Input extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Input> {
  return {
    name: "ReleaseVaultNames",
    async execute(ctx: RequestContext<Input>): Promise<void> {
      // Every delete chain loads the vault before its tail runs.
      await releaseVaultNames(store, logger, ctx.get(EXISTING_RESOURCE_KEY) as Vault);
    },
  };
}

/** Releases a vault's My vault and external id names, logging a failure. */
export async function releaseVaultNames(
  store: Store,
  logger: Logger,
  vault: Vault,
): Promise<void> {
  const id = vault.metadata?.id ?? "";
  const org = vault.metadata?.org ?? "";
  const releases: Array<[string, boolean]> = [
    [MY_VAULT_NAME_KIND, personOf(vault) !== undefined],
    [EXTERNAL_ID_NAME_KIND, (vault.spec?.externalId ?? "") !== ""],
  ];
  for (const [kind, held] of releases) {
    if (!held) {
      continue;
    }
    try {
      await store.resourceNames.release(kind, org, id);
    } catch (error) {
      logger.error("vault deleted but a name it held could not be released", {
        vaultId: id,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Deletes a person's My vault in one organization through the delete
 * chain's tail, as the server: a member leaving the organization takes
 * their logins and secrets with them, destroyed rather than left sealed
 * until the organization is purged. Answers whether a vault was deleted;
 * a person with none is a no-op.
 *
 * The rows are found as deleteAllMyVaultsOf finds them, by the person
 * they belong to, here within the one organization: a My vault whose
 * claim is missing or held by another row goes with its sealed values
 * too. A row that does not decode fails the departure before any vault
 * is deleted.
 */
export async function deleteMyVaultOf(
  deps: VaultDeleteDeps & { readonly vaults: VaultService },
  orgId: string,
  person: string,
  caller: CallerIdentity,
): Promise<boolean> {
  const rows = await deps.store.queryResources(vaultListIndex, {
    org: orgId,
    anyKey: [{ name: "person", value: person }],
  });
  const vaults = rows.map(decodeMyVaultRow);
  for (const vault of vaults) {
    await deleteLoadedVault(deps, vault, caller);
  }
  return vaults.length > 0;
}

/** Runs the delete chain's tail over a vault row already read. */
async function deleteLoadedVault(
  deps: VaultDeleteDeps,
  vault: Vault,
  caller: CallerIdentity,
): Promise<void> {
  const id = vault.metadata?.id ?? "";
  const input = create(ApiResourceDeleteInputSchema, { resourceId: id });
  const ctx = new RequestContext(
    VaultCommandController.method.delete.input,
    input,
    caller,
    ApiResourceKind.vault,
  );
  ctx.set(RESOURCE_ID_KEY, id);
  ctx.set(EXISTING_RESOURCE_KEY, vault);
  let pipeline = newPipeline<DeleteInput>("vault-delete-departed", deps.logger);
  for (const step of vaultDeleteSteps<DeleteInput>(deps)) {
    pipeline = pipeline.addStep(step);
  }
  await pipeline.build().execute(ctx);
}

type DeleteInput = typeof VaultCommandController.method.delete.input;

/**
 * Deletes every My vault a person holds, in every organization: an
 * account's deletion takes its logins and secrets with it, as a departure
 * from one organization does. Answers how many were deleted.
 *
 * The rows are found by the person they belong to (the list index's
 * `person` key), never through the name claim, so a My vault whose claim
 * is missing or held by another row is deleted with its sealed values
 * too.
 *
 * A row that does not decode fails the whole call before any vault is
 * deleted, so the account's deletion fails and is retried once the row
 * is repaired. Deleting that row by id instead would orphan its sealed
 * values: their backing state is found only by reading the row.
 */
export async function deleteAllMyVaultsOf(
  deps: VaultDeleteDeps & { readonly vaults: VaultService },
  person: string,
  caller: CallerIdentity,
): Promise<number> {
  const rows = await deps.store.queryResources(vaultListIndex, {
    anyKey: [{ name: "person", value: person }],
  });
  const vaults = rows.map(decodeMyVaultRow);
  for (const vault of vaults) {
    await deleteLoadedVault(deps, vault, caller);
  }
  return vaults.length;
}

/** A person's My vault row, decoded; one that does not decode refuses the deletion it is part of. */
function decodeMyVaultRow(row: ListIndexRow): Vault {
  try {
    return fromBinary(VaultSchema, row.data);
  } catch (error) {
    throw internalError(
      error,
      `vault ${row.id} does not decode: its sealed values cannot be destroyed, so no My vault of its person is deleted`,
    );
  }
}
