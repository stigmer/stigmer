/**
 * Attachments: what the reference rule cannot say about a vault a surface
 * names, said once for every surface that names vaults (a session, a
 * schedule, a share, a channel, a platform client).
 *
 *   - A My vault serves only its own person's runs. A surface that runs
 *     for someone else (a conversation several people may send turns to, a
 *     share link, a channel, a platform client's users) refuses one. A schedule may carry its owner's own My vault: the owner
 *     attaches it, and its runs use it as theirs.
 *   - Who attached each vault is recorded, as a server-observed fact in the
 *     surface's status (`vault_attachers`, vault id to account): the
 *     writer for each vault a write introduces, the stored entry for each
 *     vault a write keeps, nothing for a removed one. A run with no person
 *     asks `can_use` of that account when it starts, so a revoked grant
 *     stops exactly the surfaces its holder fed, and an editor's unrelated
 *     edit never re-attributes someone else's attachment.
 *   - A schedule whose agent changes re-judges every vault it keeps
 *     against the updater: the vaults now feed a different agent, which is
 *     the updater's choice to make with their own permission.
 *   - While a schedule names its creator's My vault, only that person may
 *     change what it runs: its fires use their credentials, checked against
 *     them, so anyone else's change (an organization admin's included) is
 *     refused unless the same update removes that vault.
 *
 * The reference rule (pipeline/steps/references.ts) has already refused a
 * missing vault and a vault the writer may not use among the references
 * the write introduces; this step runs after it.
 *
 * Proven by __tests__/attachments.test.ts and the vault conformance suite.
 */
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import {
  failedPreconditionError,
  internalError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { createdByOf } from "../../pipeline/steps/authorization-facts.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { collectSpecReferences } from "../../pipeline/steps/references.js";
import type { SpecReference } from "../../pipeline/steps/references.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";

import { personOf } from "./service.js";

/** Where a kind keeps who attached each of its vaults. */
export interface AttachersSlot<Desc extends DescMessage> {
  get(row: MessageShape<Desc>): { readonly [vaultId: string]: string } | undefined;
  set(row: MessageShape<Desc>, attachers: { [vaultId: string]: string }): void;
}

export interface VaultAttachmentOptions<Desc extends DescMessage> {
  /** The surface, for the refusals ("a conversation", "a share"). */
  readonly surface: string;
  /** Where the kind records attachers. */
  readonly attachers: AttachersSlot<Desc>;
  /** Whether the kind may carry its owner's own My vault (a schedule). */
  readonly allowsOwnersMyVault?: boolean;
  /** When true, every vault the write keeps counts as introduced (a schedule whose agent changes). */
  readonly rejudgeAllWhen?: (existing: MessageShape<Desc>, next: MessageShape<Desc>) => boolean;
  /**
   * Whether an update changes what the surface's runs do. While the stored
   * row names a My vault, only that vault's person may make such a change;
   * anyone else's is refused unless it also removes the vault (a schedule).
   */
  readonly changesRuns?: (existing: MessageShape<Desc>, next: MessageShape<Desc>) => boolean;
}

function sameReference(a: SpecReference, b: SpecReference): boolean {
  return a.org === b.org && a.slug === b.slug;
}

function vaultReferencesOf<Desc extends DescMessage>(
  schema: Desc,
  row: MessageShape<Desc> | undefined,
): SpecReference[] {
  if (row === undefined) {
    return [];
  }
  return collectSpecReferences(schema, row as Message).filter(
    (ref) => ref.kind === ApiResourceKind.vault && ref.slug !== "",
  );
}

export function myVaultRefusal(surface: string): string {
  return (
    `a My vault cannot be attached to ${surface}: it serves only its own person's runs. ` +
    "Attach a shared vault that holds what is needed instead"
  );
}

export function rejudgedVaultRefusal(ref: SpecReference): string {
  return (
    `vault '${ref.org}/${ref.slug}' feeds this schedule's runs, and changing the agent it runs ` +
    "needs permission to use every vault it keeps; remove the vault or ask for its use"
  );
}

export function myVaultLockRefusal(): string {
  return (
    "this schedule runs with its creator's My vault, so only its creator may change what it runs; " +
    "to change it yourself, remove that vault in the same update"
  );
}

export function newVaultAttachmentsStep<Desc extends DescMessage>(
  store: Store,
  authorizer: Authorizer,
  options: VaultAttachmentOptions<Desc>,
): PipelineStep<Desc> {
  return {
    name: "VaultAttachments",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const next = ctx.newState;
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as MessageShape<Desc> | undefined;
      const refs = vaultReferencesOf(ctx.schema, next);
      const stored = vaultReferencesOf(ctx.schema, existing);
      const rejudgeAll =
        existing !== undefined && options.rejudgeAllWhen?.(existing, next) === true;
      const caller = ctx.callerIdentity;
      const org = metadataOf(next)?.org ?? "";

      const named: Array<{ ref: SpecReference; vault: Vault | undefined; kept: boolean }> = [];
      for (const ref of refs) {
        try {
          named.push({
            ref,
            vault: await findResourceBySlug(
              store,
              ApiResourceKind.vault,
              VaultSchema,
              ref.slug,
              ref.org || org,
            ),
            kept: stored.some((held) => sameReference(held, ref)),
          });
        } catch (error) {
          throw internalError(error, "failed to read an attached vault");
        }
      }

      // A kept My vault locks what the runs do to its own person. Judged
      // before anything else, so the refusal names the lock, not a
      // re-judged vault.
      if (
        existing !== undefined &&
        caller.callerClass !== "internal" &&
        options.changesRuns?.(existing, next) === true &&
        named.some(({ vault, kept }) => {
          const owner = personOf(vault);
          return kept && owner !== undefined && owner !== caller.identityId;
        })
      ) {
        throw permissionDeniedError(myVaultLockRefusal());
      }

      const attachers: { [vaultId: string]: string } = {};
      const storedAttachers =
        existing === undefined ? undefined : options.attachers.get(existing);
      for (const { ref, vault, kept } of named) {
        if (vault === undefined) {
          // A kept reference to a vault deleted since: the run refuses it,
          // naming it. A new one was refused by the reference rule.
          continue;
        }
        const vaultId = vault.metadata?.id ?? "";
        const introduced = rejudgeAll || !kept;
        if (introduced) {
          const owner = personOf(vault);
          if (owner !== undefined) {
            const ownersOwn =
              options.allowsOwnersMyVault === true &&
              owner === caller.identityId &&
              (existing === undefined ||
                createdByOf(existing as Message) === caller.identityId);
            if (!ownersOwn) {
              throw failedPreconditionError(myVaultRefusal(options.surface));
            }
          }
          if (rejudgeAll && caller.callerClass !== "internal") {
            const decision = await evaluateAuthorizer(authorizer, caller, {
              permission: IamPermission.can_use,
              resourceKind: ApiResourceKind.vault,
              resourceId: vaultId,
            });
            if (decision.kind === "unavailable") {
              throw internalError(decision.cause, "failed to authorize an attached vault");
            }
            if (decision.kind !== "allow") {
              throw permissionDeniedError(rejudgedVaultRefusal(ref));
            }
          }
          attachers[vaultId] = caller.identityId;
          continue;
        }
        const keptBy = storedAttachers?.[vaultId];
        if (keptBy !== undefined && keptBy !== "") {
          attachers[vaultId] = keptBy;
        }
      }
      options.attachers.set(next, attachers);
    },
  };
}
