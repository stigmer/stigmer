/**
 * The write side of content-addressed versioning, shared by every
 * versioned kind (workflows, agents, skills, plugins): the version-metadata
 * rule an applied kind's write runs once its hash is known, the "archive
 * the head" step a write runs after the head is fully populated, and the
 * best-effort archive cleanup a delete runs before the row. Skills carried
 * the archive and the cleanup alone (#341, adopted for skills in #475; the
 * Go ArchiveCurrentSkillStep / DeleteSkillArchivesStep port); one copy
 * serves every kind, and each kind names its step (`SaveVersionAudit`,
 * `ArchiveCurrentSkill`, `ArchiveCurrentPlugin`, …), where its head rides
 * and where its hash and tag live.
 *
 * The load-bearing semantics, all preserved from the skill port:
 *   - repoint-never-duplicate: re-writing EVER-archived content repoints
 *     the head to the existing audit row (an A→B→A re-push must not
 *     duplicate A's row);
 *   - snapshots archive TAGLESS; the audit tag COLUMN is the tag's only
 *     home, assigned through the single-holder setAuditTag primitive —
 *     assigned even when the content was already archived, because a
 *     re-push or an unchanged re-apply naming a new tag moves it there;
 *   - safe degradation: archive failure clears the version hash from the
 *     head (the persisted head never references an unresolvable audit
 *     entry); tag-assignment failure clears the live tag. A chain whose
 *     archive runs after its last write re-persists either revert
 *     (`persistOnRevert`); a chain that persists after the archive needs
 *     no such arm.
 *
 * The version-metadata rule (PopulateVersionHash) is for kinds applied as a
 * whole resource (workflows, agents), whose update replaces
 * metadata.version with whatever the client sent. On a changed hash the
 * version id becomes the new hash, previous_version_id the old one, and
 * message and tag are the client's. On an unchanged hash id,
 * previous_version_id and message stay the stored head's, and the tag is
 * the client's when it names one, else the stored head's. An unchanged
 * apply therefore archives nothing (the archive step repoints) yet still
 * moves a newly named tag, so the head and the audit column never disagree
 * about where a tag is.
 *
 * Proven by the skill domain's __tests__/push-degradation.test.ts (the
 * failing-store arms), the workflow and agent domains' version tests, and
 * every versioned kind's conformance suite (the content-addressed
 * versioning blocks).
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { RESOURCE_ID_KEY } from "./delete.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/** The context key a kind's hash step stashes the head's new content hash under. */
export const VERSION_HASH_KEY = "version_hash";

/** Where an applied kind keeps its head hash. */
export interface PopulateVersionBinding<Desc extends DescMessage> {
  headHashOf(resource: MessageShape<Desc>): string;
  setHeadHash(resource: MessageShape<Desc>, hash: string): void;
}

/**
 * PopulateVersionHash — writes the hash under VERSION_HASH_KEY into the
 * head and applies the version-metadata rule (the module doc). On update
 * the head's status is the stored one (BuildUpdateState carries it over),
 * so its hash is the stored hash, and the stored metadata.version is read
 * from the loaded row. No hash (a hash step with nothing to hash) leaves
 * the head as it is.
 */
export function newPopulateVersionStep<Desc extends DescMessage>(
  binding: PopulateVersionBinding<Desc>,
): PipelineStep<Desc> {
  return {
    name: "PopulateVersionHash",
    execute(ctx: RequestContext<Desc>): void {
      const newHash = ctx.get(VERSION_HASH_KEY);
      if (typeof newHash !== "string" || newHash === "") {
        return;
      }
      const head = ctx.newState;
      const metadata = metadataOf(head);
      if (metadata === undefined) {
        return;
      }
      const previousHash = binding.headHashOf(head);
      const version =
        metadata.version ?? create(ApiResourceMetadataVersionSchema);
      metadata.version = version;
      binding.setHeadHash(head, newHash);

      if (newHash !== previousHash) {
        version.id = newHash;
        version.previousVersionId = previousHash;
      } else {
        const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
        const stored =
          existing === undefined ? undefined : metadataOf(existing)?.version;
        // An earlier release saved an unchanged apply with the client's
        // empty version id; the head's own hash repairs it.
        version.id = stored?.id || newHash;
        version.previousVersionId = stored?.previousVersionId ?? "";
        version.message = stored?.message ?? "";
        if (version.tag === "") {
          version.tag = stored?.tag ?? "";
        }
      }
      ctx.setNewState(head);
    },
  };
}

/** What a content-versioned kind must expose for its head to be archived. */
export interface ArchiveCurrentVersionBinding<Desc extends DescMessage> {
  /** The step's name in the chain; shared vocabulary, never renamed. */
  readonly stepName: string;
  /**
   * The context key the fully populated head rides; undefined for a chain
   * whose head is its new state (an applied kind's create and update).
   */
  readonly resourceKey: string | undefined;
  /**
   * Re-persist the head after a revert, for a chain in which no write
   * follows the archive (it runs after the chain's last persist).
   */
  readonly persistOnRevert?: boolean;
  readonly schema: Desc;
  /** The noun in log lines: "workflow", "agent", "skill", "plugin". */
  readonly noun: string;
  headHashOf(resource: MessageShape<Desc>): string;
  /** Degradation arm: the head must never reference an unresolvable audit row. */
  clearHeadHash(resource: MessageShape<Desc>): void;
  liveTagOf(resource: MessageShape<Desc>): string;
  /** Degradation arm: the live tag must agree with the audit column. */
  clearLiveTag(resource: MessageShape<Desc>): void;
}

/**
 * Repoint or archive, then the single-holder tag assignment, each with its
 * safe degradation. Runs AFTER the populate step so the archived snapshot
 * is the fully populated head.
 */
export function newArchiveCurrentVersionStep<
  Desc extends DescMessage,
  RequestDesc extends DescMessage,
>(
  store: Store,
  logger: Logger,
  binding: ArchiveCurrentVersionBinding<Desc>,
): PipelineStep<RequestDesc> {
  return {
    name: binding.stepName,
    async execute(ctx: RequestContext<RequestDesc>): Promise<void> {
      const resource = (
        binding.resourceKey === undefined
          ? ctx.newState
          : ctx.get(binding.resourceKey)
      ) as MessageShape<Desc>;
      const versionHash = binding.headHashOf(resource);
      if (versionHash === "") {
        return;
      }
      const tag = binding.liveTagOf(resource);
      const resourceId = metadataOf(resource)?.id ?? "";
      const idField = `${binding.noun}Id`;

      // A revert changes the head after the chain's last write, so in a
      // chain with no later persist it reaches the stored row only through
      // this re-persist. A failure here is logged, never a failed write:
      // the response is already consistent and the next write rewrites the
      // row.
      const flushRevert = async (revert: string): Promise<void> => {
        if (binding.persistOnRevert !== true) {
          return;
        }
        try {
          await store.saveResource(
            ctx.apiResourceKind,
            resourceId,
            binding.schema,
            resource,
          );
        } catch (persistError) {
          logger.error(`failed to re-persist ${binding.noun} after ${revert}`, {
            [idField]: resourceId,
            error:
              persistError instanceof Error
                ? persistError.message
                : String(persistError),
          });
        }
      };

      // Repoint, never duplicate: if this content was ever archived, the
      // head simply repoints to the existing row and only the tag
      // assignment below still runs. An unexpected lookup failure degrades
      // to archiving anyway — a possible duplicate row beats a failed push
      // (readers resolve duplicates newest-wins).
      let alreadyArchived = false;
      try {
        await store.getAuditByHash(
          ctx.apiResourceKind,
          resourceId,
          versionHash,
          binding.schema,
        );
        alreadyArchived = true;
      } catch (error) {
        if (!(error instanceof AuditNotFoundError)) {
          logger.warn(
            `Could not check for an existing archived ${binding.noun} version — archiving anyway`,
            {
              [idField]: resourceId,
              versionHash,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      if (!alreadyArchived) {
        // Archive the snapshot tagless: the tag lives only in the audit tag
        // column (the source of truth), assigned below through the
        // single-holder primitive — a later tag move never rewrites this
        // immutable content.
        try {
          await store.saveAudit(
            ctx.apiResourceKind,
            resourceId,
            binding.schema,
            resource,
            versionHash,
            "",
          );
        } catch (error) {
          logger.error(
            `Failed to archive ${binding.noun} version — reverting the version hash to maintain the audit-resolvability invariant`,
            {
              [idField]: resourceId,
              versionHash,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // Revert: the persisted head must never reference an audit entry
          // that does not exist. The push still succeeds, but without
          // version tracking for this apply.
          binding.clearHeadHash(resource);
          await flushRevert("reverting its version hash");
          return;
        }
      }

      // Assign the requested tag through setAuditTag — the single-holder
      // primitive — so the head version (freshly archived or repointed-to)
      // becomes the tag's sole holder; any prior holder is cleared.
      if (tag !== "") {
        try {
          await store.setAuditTag(
            ctx.apiResourceKind,
            resourceId,
            versionHash,
            tag,
          );
        } catch (error) {
          logger.error(
            `Archived ${binding.noun} version but failed to assign its tag — clearing the live tag to stay consistent with the audit column`,
            {
              [idField]: resourceId,
              versionHash,
              tag,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // The audit head is now untagged; keep the live head consistent
          // so get / getByReference never advertise a tag the store cannot
          // resolve.
          binding.clearLiveTag(resource);
          await flushRevert("clearing its tag");
        }
      }

      if (alreadyArchived) {
        logger.info(
          `${capitalize(binding.noun)} version content already archived — repointed head without a new history row`,
          { [idField]: resourceId, versionHash, tag },
        );
      } else {
        logger.info(`Archived ${binding.noun} version to audit history`, {
          [idField]: resourceId,
          versionHash,
          tag,
        });
      }
    },
  };
}

/**
 * Best-effort audit cleanup BEFORE the resource row (no FK cascade in the
 * schema, by design): failures log and never block the delete. Reads the
 * id ExtractResourceId set.
 */
export function newDeleteVersionArchivesStep<RequestDesc extends DescMessage>(
  store: Store,
  logger: Logger,
  binding: { readonly stepName: string; readonly noun: string },
): PipelineStep<RequestDesc> {
  return {
    name: binding.stepName,
    async execute(ctx: RequestContext<RequestDesc>): Promise<void> {
      const resourceId = ctx.get(RESOURCE_ID_KEY);
      if (typeof resourceId !== "string") {
        throw new Error(
          "resource id not found in context (ExtractResourceIdStep must run first)",
        );
      }
      const idField = `${binding.noun}Id`;
      try {
        const deletedCount = await store.deleteAuditByResourceId(
          ctx.apiResourceKind,
          resourceId,
        );
        if (deletedCount > 0) {
          logger.info(`Deleted archive records for ${binding.noun}`, {
            [idField]: resourceId,
            count: deletedCount,
          });
        }
      } catch (error) {
        logger.warn(`failed to delete ${binding.noun} archives (best-effort)`, {
          [idField]: resourceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
