/**
 * Skill version resolution — the skill binding of the shared
 * content-addressed version steps (pipeline/steps/version-history.ts): the
 * getByReference version ladder and the paginated version history, ported
 * from pkg/domain/skill/controller/load_skill_by_reference.go and
 * list_versions.go. The ladder, the is_current rule and the pagination
 * live in the shared module since plugins needed the identical shape; what
 * is a skill's is here: the schema, the noun in sentences, the head hash in
 * status.version_hash, the live tag in spec.tag, and the SkillVersionEntry
 * mapping (pushed_at/pushed_by prefer the spec-audit updated stamps and fall
 * back to created, because first pushes only carry created).
 *
 * Proven by __tests__/skill.test.ts's ladder and pagination blocks and
 * the conformance suite's getByReference/listVersions blocks.
 */
import { create } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  ListSkillVersionsResponseSchema,
  SkillVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  ListSkillVersionsResponse,
  SkillVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";
import {
  LIST_VERSIONS_HEAD_HASH_KEY,
  LIST_VERSIONS_RESOURCE_ID_KEY,
  LIST_VERSIONS_RESPONSE_KEY,
  newLoadAndMapVersionsStep as newSharedLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  newResolveBySlugForVersionsStep,
} from "../../pipeline/steps/version-history.js";
import type { VersionHistoryBinding } from "../../pipeline/steps/version-history.js";

/** The context keys the controller's mid-chain authorize step reads. */
export const LIST_VERSIONS_SKILL_ID_KEY = LIST_VERSIONS_RESOURCE_ID_KEY;
export { LIST_VERSIONS_HEAD_HASH_KEY, LIST_VERSIONS_RESPONSE_KEY };

type GetByReferenceDesc =
  typeof SkillQueryController.method.getByReference.input;
type ListVersionsDesc = typeof SkillQueryController.method.listVersions.input;

/** Where a skill keeps its hash and its tag, and how its history renders. */
const skillVersionBinding: VersionHistoryBinding<
  typeof SkillSchema,
  ListVersionsDesc,
  SkillVersionEntry,
  ListSkillVersionsResponse
> = {
  kind: ApiResourceKind.skill,
  schema: SkillSchema,
  noun: "skill",
  headHashOf: (skill) => skill.status?.versionHash ?? "",
  liveTagOf: (skill) => skill.spec?.tag ?? "",
  input: (req) => req,
  mapEntry: mapSkillToVersionEntry,
  response: (versions, nextPageToken, totalCount) =>
    create(ListSkillVersionsResponseSchema, {
      versions,
      nextPageToken,
      totalCount,
    }),
};

/** Go LoadSkillByReferenceStep — the reference + version ladder. */
export function newLoadSkillByReferenceStep(
  store: Store,
): PipelineStep<GetByReferenceDesc> {
  return newLoadByReferenceWithVersionStep(
    store,
    skillVersionBinding,
    "LoadSkillByReference",
  );
}

/** Go ResolveSkillBySlugStep — resolves the skill and captures the head hash. */
export function newResolveSkillBySlugStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newResolveBySlugForVersionsStep(
    store,
    skillVersionBinding,
    "ResolveSkillBySlug",
  );
}

/** Go LoadAndMapVersionsStep — audit records → entries → one page. */
export function newLoadAndMapVersionsStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newSharedLoadAndMapVersionsStep(
    store,
    skillVersionBinding,
    "LoadAndMapVersions",
  );
}

/**
 * Maps an archived Skill snapshot to a version entry (Go
 * mapSkillToVersionEntry).
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
