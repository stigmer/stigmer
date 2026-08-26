/**
 * Skill search extractor — ports pkg/query/search/extractor/
 * skill_extractor.go (both sides: the #4 index side, the #14 query side).
 * Skills are knowledge documents (SKILL.md files); the search summary is
 * spec.description, extracted from the SKILL.md YAML frontmatter at push
 * time.
 */
import type { Message } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const skillSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.skill,
  schema: SkillSchema,

  getSearchSummary(resource: Message): string {
    // Go SkillExtractor.GetSearchSummary: spec.description.
    const skill = resource as unknown as Skill;
    return skill.spec?.description ?? "";
  },

  toSearchResult(resource: Message, score: number): SearchResult | undefined {
    const skill = resource as unknown as Skill;
    return buildSearchResult({
      kind: ApiResourceKind.skill,
      metadata: skill.metadata,
      summary: skill.spec?.description ?? "",
      score,
      createdAt: skill.status?.audit?.specAudit?.createdAt,
      updatedAt: skill.status?.audit?.specAudit?.updatedAt,
    });
  },

  getSearchIndexEntry(resource: Message): SearchIndexEntry | undefined {
    const skill = resource as unknown as Skill;
    const metadata = skill.metadata;
    if (metadata === undefined) {
      return undefined;
    }
    return {
      name: metadata.name,
      // Go SkillExtractor.GetSearchSummary: spec.description.
      description: skill.spec?.description ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(skill.status?.audit?.specAudit?.createdAt?.seconds ?? 0n),
    };
  },
};
