/**
 * The write side of content-addressed versioning, shared by every kind
 * whose version is the SHA-256 of a pushed archive (skills, plugins): the
 * "archive the head" step a push runs after the head is fully populated,
 * and the best-effort archive cleanup a delete runs before the row. Skills
 * carried both alone (#341, adopted for skills in #475; the Go
 * ArchiveCurrentSkillStep / DeleteSkillArchivesStep port); plugins need the
 * identical semantics over another schema, so the steps live here and each
 * kind names its step (`ArchiveCurrentSkill`, `ArchiveCurrentPlugin`), its
 * context key and where its hash and tag live.
 *
 * The load-bearing semantics, all preserved from the skill port:
 *   - repoint-never-duplicate: re-pushing EVER-archived content repoints the
 *     head to the existing audit row (an A→B→A re-push must not duplicate
 *     A's row);
 *   - snapshots archive TAGLESS; the audit tag COLUMN is the tag's only
 *     home, assigned through the single-holder setAuditTag primitive —
 *     assigned even when the content was already archived, because
 *     re-pushing under a new tag is the only retag path;
 *   - safe degradation: archive failure clears the version hash from the
 *     head (the persisted head never references an unresolvable audit
 *     entry); tag-assignment failure clears the live tag.
 *
 * Proven by the skill domain's __tests__/push-degradation.test.ts (the
 * failing-store arms) and both kinds' conformance suites (the
 * content-addressed versioning blocks).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { RESOURCE_ID_KEY } from "./delete.js";
import { metadataOf } from "./shapes.js";

/** What a content-versioned kind must expose for its head to be archived. */
export interface ArchiveCurrentVersionBinding<Desc extends DescMessage> {
  /** The step's name in the chain; shared vocabulary, never renamed. */
  readonly stepName: string;
  /** The context key the fully populated head rides. */
  readonly resourceKey: string;
  readonly schema: Desc;
  /** The noun in log lines: "skill", "plugin". */
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
      const resource = ctx.get(binding.resourceKey) as MessageShape<Desc>;
      const versionHash = binding.headHashOf(resource);
      if (versionHash === "") {
        return;
      }
      const tag = binding.liveTagOf(resource);
      const resourceId = metadataOf(resource)?.id ?? "";
      const idField = `${binding.noun}Id`;

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
