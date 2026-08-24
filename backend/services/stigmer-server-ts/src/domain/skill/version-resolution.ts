/**
 * Skill version resolution — ports pkg/domain/skill/controller/
 * load_skill_by_reference.go and list_versions.go: the getByReference
 * version ladder and the paginated version history.
 *
 * The ladder (Go LoadSkillByReferenceStep): resolve the live head by
 * slug+org; empty/"latest" returns it; a 64-hex version matches the head's
 * hash or falls to the indexed audit-by-hash lookup; anything else is a
 * tag, matching the head's live spec.tag first (honest under the
 * single-holder model: push reconciles the live tag with the audit tag
 * column, clearing spec.tag when assignment fails) and then the indexed
 * audit-by-tag lookup.
 *
 * listVersions marks is_current by HEAD-HASH match, not recency: under
 * repoint semantics (#475) re-pushing archived content re-activates its
 * existing row, so the current version need not be the newest-archived
 * one. Tags come from the audit COLUMN (the single-holder source of
 * truth), never from the snapshot — snapshots archive tagless and a legacy
 * snapshot's embedded tag may have moved since it was written.
 *
 * Proven by __tests__/skill.test.ts's ladder and pagination blocks and
 * the conformance suite's getByReference/listVersions blocks.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  ListSkillVersionsResponseSchema,
  SkillVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { SkillVersionEntry } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug, requireOrgForReference } from "../../pipeline/steps/helpers.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/** A 64-character lowercase-hex string (a SHA-256 content hash). */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function isHash(version: string): boolean {
  return HASH_PATTERN.test(version);
}

type GetByReferenceDesc =
  typeof SkillQueryController.method.getByReference.input;

/** Go LoadSkillByReferenceStep — the reference + version ladder. */
export function newLoadSkillByReferenceStep(
  store: Store,
): PipelineStep<GetByReferenceDesc> {
  return {
    name: "LoadSkillByReference",
    async execute(ctx: RequestContext<GetByReferenceDesc>): Promise<void> {
      const ref = ctx.input;

      if (ref.slug === "") {
        throw invalidArgumentError("slug is required in reference");
      }

      // Skill is org-scoped: its slug is unique only within an org, so an
      // empty-org reference is under-specified.
      requireOrgForReference(ctx.apiResourceKind, ref.org);

      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== ApiResourceKind.skill
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected ${ApiResourceKind[ApiResourceKind.skill]}, got ${ApiResourceKind[ref.kind]}`,
        );
      }

      let mainSkill: Skill | undefined;
      try {
        mainSkill = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          SkillSchema,
          ref.slug,
          ref.org,
        );
      } catch (error) {
        throw internalError(error, "failed to list skills");
      }
      if (mainSkill === undefined) {
        throw notFoundError("skill", ref.slug);
      }

      const version = ref.version.trim();
      if (version === "" || version === "latest") {
        ctx.set(TARGET_RESOURCE_KEY, mainSkill);
        return;
      }

      if (skillMatchesVersion(mainSkill, version)) {
        ctx.set(TARGET_RESOURCE_KEY, mainSkill);
        return;
      }

      const auditSkill = await findAuditSkillByVersion(
        store,
        ctx.apiResourceKind,
        mainSkill.metadata!.id,
        version,
      );
      if (auditSkill === undefined) {
        throw notFoundError("skill version", `${ref.slug}:${version}`);
      }
      ctx.set(TARGET_RESOURCE_KEY, auditSkill);
    },
  };
}

/**
 * Whether the live head IS the requested version — by hash, or by its
 * live spec.tag (honest under the single-holder tag model, see module doc).
 */
function skillMatchesVersion(skill: Skill, version: string): boolean {
  if (skill.status === undefined) {
    return false;
  }
  if (isHash(version)) {
    return skill.status.versionHash === version;
  }
  return skill.spec !== undefined && skill.spec.tag === version;
}

/**
 * Indexed audit lookup by hash or tag (Go findAuditSkillByVersion) —
 * not-found is a normal outcome (undefined), storage failures are
 * Internal.
 */
async function findAuditSkillByVersion(
  store: Store,
  kind: ApiResourceKind,
  skillId: string,
  version: string,
): Promise<Skill | undefined> {
  if (isHash(version)) {
    try {
      return await store.getAuditByHash(kind, skillId, version, SkillSchema);
    } catch (error) {
      if (error instanceof AuditNotFoundError) {
        return undefined;
      }
      throw internalError(error, "failed to query audit by hash");
    }
  }
  try {
    return await store.getAuditByTag(kind, skillId, version, SkillSchema);
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to query audit by tag");
  }
}

// ─── listVersions ────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export const LIST_VERSIONS_SKILL_ID_KEY = "listVersionsSkillId";
export const LIST_VERSIONS_HEAD_HASH_KEY = "listVersionsHeadHash";
export const LIST_VERSIONS_RESPONSE_KEY = "listVersionsResponse";

type ListVersionsDesc = typeof SkillQueryController.method.listVersions.input;

/** Go ResolveSkillBySlugStep — resolves the skill and captures the head hash. */
export function newResolveSkillBySlugStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return {
    name: "ResolveSkillBySlug",
    async execute(ctx: RequestContext<ListVersionsDesc>): Promise<void> {
      const req = ctx.input;
      let skill: Skill | undefined;
      try {
        skill = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          SkillSchema,
          req.slug,
          req.org,
        );
      } catch (error) {
        throw internalError(error, "failed to search for skill");
      }
      if (skill === undefined) {
        throw notFoundError("skill", `${req.slug} (org: ${req.org})`);
      }
      ctx.set(LIST_VERSIONS_SKILL_ID_KEY, skill.metadata!.id);
      // The live head's hash decides is_current downstream. Under repoint
      // semantics the current version need not be the newest-archived row,
      // so recency cannot stand in for currency.
      ctx.set(LIST_VERSIONS_HEAD_HASH_KEY, skill.status?.versionHash ?? "");
    },
  };
}

/** Go LoadAndMapVersionsStep — audit records → entries → one page. */
export function newLoadAndMapVersionsStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return {
    name: "LoadAndMapVersions",
    async execute(ctx: RequestContext<ListVersionsDesc>): Promise<void> {
      const req = ctx.input;
      const skillId = ctx.get(LIST_VERSIONS_SKILL_ID_KEY) as string;

      let records;
      try {
        records = await store.listAuditRecords(ctx.apiResourceKind, skillId);
      } catch (error) {
        throw internalError(error, "failed to load version history");
      }

      // is_current = the entry whose hash matches the live head, not the
      // newest row. Legacy data may hold duplicate-hash rows (predating
      // repoint semantics); marking only the first match keeps
      // exactly-one-current true for them too.
      const headHash = ctx.get(LIST_VERSIONS_HEAD_HASH_KEY) as string;
      let currentMarked = false;
      const entries: SkillVersionEntry[] = [];
      for (const record of records) {
        let skill: Skill;
        try {
          skill = fromBinary(SkillSchema, record.data);
        } catch {
          continue;
        }
        const isCurrent: boolean =
          !currentMarked &&
          headHash !== "" &&
          (skill.status?.versionHash ?? "") === headHash;
        currentMarked = currentMarked || isCurrent;
        // Tag comes from the audit column (source of truth), not the snapshot.
        entries.push(mapSkillToVersionEntry(skill, isCurrent, record.tag));
      }

      let pageSize = req.pageSize;
      if (pageSize <= 0) {
        pageSize = DEFAULT_PAGE_SIZE;
      }
      if (pageSize > MAX_PAGE_SIZE) {
        pageSize = MAX_PAGE_SIZE;
      }

      let startIndex = 0;
      if (req.pageToken !== "") {
        startIndex = decodePageToken(req.pageToken);
      }

      let pageEntries: SkillVersionEntry[] = [];
      let nextPageToken = "";
      if (startIndex < entries.length) {
        const end = Math.min(startIndex + pageSize, entries.length);
        pageEntries = entries.slice(startIndex, end);
        if (end < entries.length) {
          nextPageToken = Buffer.from(String(end)).toString("base64");
        }
      }

      ctx.set(
        LIST_VERSIONS_RESPONSE_KEY,
        create(ListSkillVersionsResponseSchema, {
          versions: pageEntries,
          nextPageToken,
          totalCount: entries.length,
        }),
      );
    },
  };
}

/**
 * Decodes the base64 cursor with Go's strictness: base64.StdEncoding
 * rejects malformed input and strconv.Atoi rejects trailing garbage —
 * Buffer.from is lenient on both, so validity is checked explicitly.
 */
function decodePageToken(token: string): number {
  const decoded = Buffer.from(token, "base64");
  if (decoded.toString("base64") !== token) {
    throw invalidArgumentError("invalid page_token");
  }
  const text = decoded.toString("utf8");
  const index = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(index) || String(index) !== text || index < 0) {
    throw invalidArgumentError("invalid page_token");
  }
  return index;
}

/**
 * Maps an archived Skill snapshot to a version entry (Go
 * mapSkillToVersionEntry). pushed_at/pushed_by prefer the spec-audit
 * updated stamps and fall back to created (first pushes only carry
 * created).
 */
function mapSkillToVersionEntry(
  skill: Skill,
  isCurrent: boolean,
  tag: string,
): SkillVersionEntry {
  const entry = create(SkillVersionEntrySchema, { isCurrent, tag });

  if (skill.status !== undefined) {
    entry.versionHash = skill.status.versionHash;
    entry.artifactStorageKey = skill.status.artifactStorageKey;
    entry.gitProvenance = skill.status.gitProvenance;

    const specAudit = skill.status.audit?.specAudit;
    if (specAudit !== undefined) {
      entry.pushedAt = specAudit.updatedAt ?? specAudit.createdAt;
      entry.pushedBy = specAudit.updatedBy ?? specAudit.createdBy;
    }
  }

  if (skill.metadata?.version !== undefined) {
    entry.message = skill.metadata.version.message;
  }

  return entry;
}
