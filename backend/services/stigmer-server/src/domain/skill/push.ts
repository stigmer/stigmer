/**
 * Skill push pipeline — ports pkg/domain/skill/controller/push.go: the
 * 12-step chain converting PushSkillRequest → Skill under the
 * content-addressed versioning model shared with workflows (#341, adopted
 * for skills in #475).
 *
 *   ValidateProto → ResolveArtifactSource → BuildInitialSkill →
 *   ExtractAndHashArtifact → ResolveSlugForPush → FindExistingBySlug →
 *   GenerateIDIfNeeded → CheckAndStoreArtifact → PopulateSkillFields →
 *   ArchiveCurrentSkill → StoreSkill → IndexSkillSearch
 *
 * Step names and context keys are Go's, verbatim. The load-bearing
 * semantics, all preserved:
 *   - exactly one artifact source (inline bytes XOR upload ref — proto
 *     CEL); a staged ref is consumed (retired) whatever happens downstream;
 *   - content addressing: same bytes = same SHA-256 = one stored copy;
 *   - repoint-never-duplicate: re-pushing EVER-archived content repoints
 *     the head to the existing audit row (an A→B→A re-push must not
 *     duplicate A's row);
 *   - snapshots archive TAGLESS; the audit tag COLUMN is the tag's only
 *     home, assigned through the single-holder setAuditTag primitive —
 *     assigned even when the content was already archived, because
 *     re-pushing under a new tag is skills' only retag path;
 *   - safe degradation: archive failure clears the version hash from the
 *     head (the persisted head never references an unresolvable audit
 *     entry); tag-assignment failure clears the live spec.tag.
 *
 * Proven by __tests__/skill.test.ts (composed-server round-trips),
 * __tests__/push-degradation.test.ts (the failing-store arms), and the
 * skill conformance suite.
 */
import { create } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { PushSkillRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { SkillSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/spec_pb";
import {
  SkillState,
  SkillStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { Logger } from "../../boot/logger.js";
import {
  defaultVisibilityFor,
  getIdPrefix,
} from "../../pipeline/apiresource-meta.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  generateId,
  setAuditFieldsForCreate,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { generateSlug } from "../../pipeline/steps/slug.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { TRANSFER_LANE_NOT_CONFIGURED } from "./constants.js";
import { skillSearchExtractor } from "./search-extractor.js";
import { extractSkillMd } from "./storage/zip-gate.js";
import type { ExtractSkillMdResult } from "./storage/zip-gate.js";
import type { SkillArtifactStorage } from "./storage/artifact-storage.js";
import type { UploadSlots } from "./transfer/slots.js";

type PushDesc = typeof PushSkillRequestSchema;

// Context keys for the push operation (Go push.go, verbatim).
export const SKILL_KEY = "skill";
export const ARTIFACT_BYTES_KEY = "pushArtifactBytes";
export const EXTRACT_RESULT_KEY = "extractResult";
export const ARTIFACT_STORAGE_KEY_KEY = "artifactStorageKey";
export const EXISTING_SKILL_KEY = "existingSkill";
export const SHOULD_CREATE_SKILL_KEY = "shouldCreateSkill";

/**
 * ResolveArtifactSource — materializes the artifact ZIP bytes from
 * whichever source the request carries (proto validation has already
 * guaranteed exactly one): inline bytes pass through; an upload ref is
 * consumed HERE, which retires the single-use reference regardless of how
 * the rest of the pipeline fares. Downstream steps read ARTIFACT_BYTES_KEY
 * and never touch the request's artifact field, so the two sources are
 * indistinguishable past this point.
 */
export function newResolveArtifactSourceStep(
  slots: UploadSlots | undefined,
): PipelineStep<PushDesc> {
  return {
    name: "ResolveArtifactSource",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const req = ctx.input;
      if (req.artifactUploadRef === "") {
        ctx.set(ARTIFACT_BYTES_KEY, req.artifact);
        return;
      }
      if (slots === undefined) {
        throw failedPreconditionError(TRANSFER_LANE_NOT_CONFIGURED);
      }
      let data: Uint8Array;
      try {
        data = await slots.consume(req.artifactUploadRef);
      } catch (error) {
        // The reference is client-supplied state, not server fault:
        // unknown, expired, already consumed, or minted-but-never-uploaded
        // all mean the client must re-mint and re-upload.
        throw invalidArgumentError(
          `artifact_upload_ref not usable: ${error instanceof Error ? error.message : String(error)} — request a new upload URL via createArtifactUploadUrl`,
        );
      }
      ctx.set(ARTIFACT_BYTES_KEY, data);
    },
  };
}

/**
 * BuildInitialSkill — the Skill scaffold from the request. Name, ID, and
 * slug are NOT set here; they come from the SKILL.md frontmatter via the
 * later steps.
 */
export function newBuildInitialSkillStep(): PipelineStep<PushDesc> {
  return {
    name: "BuildInitialSkill",
    execute(ctx: RequestContext<PushDesc>): void {
      const req = ctx.input;
      const skill = create(SkillSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Skill",
        metadata: create(ApiResourceMetadataSchema, { org: req.org }),
        spec: create(SkillSpecSchema, { tag: req.tag }),
        status: create(SkillStatusSchema, { state: SkillState.READY }),
      });
      ctx.set(SKILL_KEY, skill);
    },
  };
}

/**
 * ExtractAndHashArtifact — the ZIP gate: bomb/limit validation, in-memory
 * SKILL.md extraction, frontmatter parse, SHA-256 content hash. Every gate
 * failure is the InvalidArgument "failed to extract SKILL.md: ..." arm.
 */
export function newExtractAndHashArtifactStep(): PipelineStep<PushDesc> {
  return {
    name: "ExtractAndHashArtifact",
    execute(ctx: RequestContext<PushDesc>): void {
      const artifactBytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      let extractResult: ExtractSkillMdResult;
      try {
        extractResult = extractSkillMd(artifactBytes);
      } catch (error) {
        throw invalidArgumentError(
          `failed to extract SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      ctx.set(EXTRACT_RESULT_KEY, extractResult);
    },
  };
}

/**
 * ResolveSlugForPush — the frontmatter name becomes metadata.name and,
 * slugified, metadata.slug. The frontmatter pattern already constrains the
 * name, so an empty slug is a defensive arm, not a reachable one.
 */
export function newResolveSlugForPushStep(): PipelineStep<PushDesc> {
  return {
    name: "ResolveSlugForPush",
    execute(ctx: RequestContext<PushDesc>): void {
      const skill = ctx.get(SKILL_KEY) as Skill;
      const extractResult = ctx.get(EXTRACT_RESULT_KEY) as ExtractSkillMdResult;
      skill.metadata!.name = extractResult.name;
      const slug = generateSlug(extractResult.name);
      if (slug === "") {
        throw invalidArgumentError(`invalid skill name: ${extractResult.name}`);
      }
      skill.metadata!.slug = slug;
    },
  };
}

/**
 * FindExistingBySlug — push is upsert-by-slug: an existing skill's ID is
 * adopted (update), otherwise the create flag is raised.
 */
export function newFindExistingBySlugStep(
  store: Store,
): PipelineStep<PushDesc> {
  return {
    name: "FindExistingBySlug",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const skill = ctx.get(SKILL_KEY) as Skill;
      let existing: Skill | undefined;
      try {
        existing = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          SkillSchema,
          skill.metadata!.slug,
          skill.metadata!.org,
        );
      } catch (error) {
        throw internalError(error, "failed to search for existing skill");
      }
      if (existing !== undefined) {
        skill.metadata!.id = existing.metadata!.id;
        ctx.set(EXISTING_SKILL_KEY, existing);
        ctx.set(SHOULD_CREATE_SKILL_KEY, false);
      } else {
        ctx.set(EXISTING_SKILL_KEY, undefined);
        ctx.set(SHOULD_CREATE_SKILL_KEY, true);
      }
    },
  };
}

/** GenerateIDIfNeeded — skl_{ulid} for new skills; updates keep theirs. */
export function newGenerateIdIfNeededStep(): PipelineStep<PushDesc> {
  return {
    name: "GenerateIDIfNeeded",
    execute(ctx: RequestContext<PushDesc>): void {
      const skill = ctx.get(SKILL_KEY) as Skill;
      const shouldCreate = ctx.get(SHOULD_CREATE_SKILL_KEY) as boolean;
      if (shouldCreate) {
        skill.metadata!.id = generateId(getIdPrefix(ctx.apiResourceKind));
      }
    },
  };
}

/**
 * CheckAndStoreArtifact — content-addressed dedupe: same hash reuses the
 * stored copy; new content is written 0600.
 */
export function newCheckAndStoreArtifactStep(
  artifactStorage: SkillArtifactStorage,
): PipelineStep<PushDesc> {
  return {
    name: "CheckAndStoreArtifact",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const artifactBytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      const extractResult = ctx.get(EXTRACT_RESULT_KEY) as ExtractSkillMdResult;

      let exists: boolean;
      try {
        exists = await artifactStorage.exists(extractResult.hash);
      } catch (error) {
        throw internalError(error, "failed to check artifact existence");
      }

      let storageKey: string;
      if (exists) {
        storageKey = artifactStorage.getStorageKey(extractResult.hash);
      } else {
        try {
          storageKey = await artifactStorage.store(
            extractResult.hash,
            artifactBytes,
          );
        } catch (error) {
          throw internalError(error, "failed to store artifact");
        }
      }
      ctx.set(ARTIFACT_STORAGE_KEY_KEY, storageKey);
    },
  };
}

/**
 * PopulateSkillFields — spec content + frontmatter identity, default
 * visibility from the kind's proto config (skill is a blueprint →
 * visibility_org, so OSS and Cloud agree by construction), git provenance
 * passthrough, status artifact fields, the metadata.version chain, and
 * the audit stamping discipline: creates stamp both slots; updates copy
 * the loaded skill's slot pointers onto a fresh wrapper and stamp
 * spec_audit ONLY (a push is a definition change; status_audit stays on
 * the shared pointer, untouched — #540: the helper sets a newly allocated
 * spec_audit message, never mutating the copied pointer in place).
 */
export function newPopulateSkillFieldsStep(): PipelineStep<PushDesc> {
  return {
    name: "PopulateSkillFields",
    execute(ctx: RequestContext<PushDesc>): void {
      const skill = ctx.get(SKILL_KEY) as Skill;
      const extractResult = ctx.get(EXTRACT_RESULT_KEY) as ExtractSkillMdResult;
      const storageKey = ctx.get(ARTIFACT_STORAGE_KEY_KEY) as string;
      const shouldCreate = ctx.get(SHOULD_CREATE_SKILL_KEY) as boolean;
      const req = ctx.input;

      skill.spec!.skillMd = extractResult.content;
      skill.spec!.name = extractResult.name;
      skill.spec!.description = extractResult.description;

      if (
        skill.metadata!.visibility ===
        ApiResourceVisibility.api_resource_visibility_unspecified
      ) {
        skill.metadata!.visibility = defaultVisibilityFor(ctx.apiResourceKind);
      }

      if (req.gitProvenance !== undefined) {
        skill.status!.gitProvenance = req.gitProvenance;
      }

      skill.status!.versionHash = extractResult.hash;
      skill.status!.artifactStorageKey = storageKey;
      skill.status!.state = SkillState.READY;

      let previousVersionHash = "";
      if (!shouldCreate) {
        const existing = ctx.get(EXISTING_SKILL_KEY) as Skill | undefined;
        previousVersionHash = existing?.status?.versionHash ?? "";
      }
      skill.metadata!.version = create(ApiResourceMetadataVersionSchema, {
        id: extractResult.hash,
        message: req.message,
        previousVersionId: previousVersionHash,
      });

      if (shouldCreate) {
        setAuditFieldsForCreate(SkillSchema, skill, ctx.callerIdentity);
      } else {
        const existing = ctx.get(EXISTING_SKILL_KEY) as Skill;
        if (existing.status?.audit !== undefined) {
          const status = skill.status!;
          status.audit ??= create(ApiResourceAuditSchema, {});
          // Copy slot pointers from the loaded skill; the helper below
          // SETS a newly allocated spec_audit, so the copied pointers are
          // never mutated in place (#540).
          status.audit.specAudit = existing.status.audit.specAudit;
          status.audit.statusAudit = existing.status.audit.statusAudit;
        }
        setAuditFieldsForUpdate(
          SkillSchema,
          skill,
          "spec_audit",
          ctx.callerIdentity,
        );
      }
    },
  };
}

/**
 * ArchiveCurrentSkill — the versioning heart (#341/#475): repoint or
 * archive, then the single-holder tag assignment, each with its safe
 * degradation (see the module doc). Runs AFTER PopulateSkillFields so the
 * archived snapshot is the fully-populated head.
 */
export function newArchiveCurrentSkillStep(
  store: Store,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "ArchiveCurrentSkill",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const skill = ctx.get(SKILL_KEY) as Skill;
      const versionHash = skill.status?.versionHash ?? "";
      if (versionHash === "") {
        return;
      }
      const tag = skill.spec?.tag ?? "";
      const skillId = skill.metadata!.id;

      // Repoint, never duplicate: if this content was ever archived, the
      // head simply repoints to the existing row and only the tag
      // assignment below still runs. An unexpected lookup failure degrades
      // to archiving anyway — a possible duplicate row beats a failed push
      // (readers resolve duplicates newest-wins).
      let alreadyArchived = false;
      try {
        await store.getAuditByHash(
          ctx.apiResourceKind,
          skillId,
          versionHash,
          SkillSchema,
        );
        alreadyArchived = true;
      } catch (error) {
        if (!(error instanceof AuditNotFoundError)) {
          logger.warn(
            "Could not check for an existing archived skill version — archiving anyway",
            {
              skillId,
              versionHash,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      if (!alreadyArchived) {
        // Archive the snapshot tagless: the tag lives only in the audit
        // tag column (the source of truth), assigned below through the
        // single-holder primitive — a later tag move never rewrites this
        // immutable content.
        try {
          await store.saveAudit(
            ctx.apiResourceKind,
            skillId,
            SkillSchema,
            skill,
            versionHash,
            "",
          );
        } catch (error) {
          logger.error(
            "Failed to archive skill version — reverting the version hash to maintain the audit-resolvability invariant",
            {
              skillId,
              versionHash,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // Revert: the persisted head must never reference an audit entry
          // that does not exist. The push still succeeds, but without
          // version tracking for this apply.
          skill.status!.versionHash = "";
          if (skill.metadata?.version !== undefined) {
            skill.metadata.version.id = "";
          }
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
            skillId,
            versionHash,
            tag,
          );
        } catch (error) {
          logger.error(
            "Archived skill version but failed to assign its tag — clearing the live tag to stay consistent with the audit column",
            {
              skillId,
              versionHash,
              tag,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // The audit head is now untagged; keep the live head consistent
          // so get / getByReference never advertise a tag the store cannot
          // resolve.
          skill.spec!.tag = "";
        }
      }

      if (alreadyArchived) {
        logger.info(
          "Skill version content already archived — repointed head without a new history row",
          { skillId, versionHash, tag },
        );
      } else {
        logger.info("Archived skill version to audit history", {
          skillId,
          versionHash,
          tag,
        });
      }
    },
  };
}

/** StoreSkill — persists the fully populated head. */
export function newStoreSkillStep(store: Store): PipelineStep<PushDesc> {
  return {
    name: "StoreSkill",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const skill = ctx.get(SKILL_KEY) as Skill;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          skill.metadata!.id,
          SkillSchema,
          skill,
        );
      } catch (error) {
        throw internalError(error, "failed to save skill");
      }
    },
  };
}

/**
 * IndexSkillSearch — search-index upsert, best-effort by contract. Domain-local
 * (not the shared IndexSearch step) because the push pipeline's message is
 * PushSkillRequest: the skill rides SKILL_KEY, not newState.
 */
export function newIndexSkillSearchStep(
  store: Store,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "IndexSkillSearch",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const skill = ctx.get(SKILL_KEY) as Skill;
      const entry = skillSearchExtractor.getSearchIndexEntry(skill);
      if (entry === undefined) {
        logger.warn(
          "IndexSkillSearch: extractor returned nil entry, skipping",
          {
            id: skill.metadata?.id ?? "",
          },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          skill.metadata!.id,
          entry,
        );
      } catch (error) {
        logger.warn(
          "IndexSkillSearch: failed to update search index (best-effort)",
          {
            id: skill.metadata?.id ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}
