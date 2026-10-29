/**
 * Skill search extractor (both sides: the index side, the query side).
 * Skills are knowledge documents (SKILL.md files); the search summary is
 * spec.description, extracted from the SKILL.md YAML frontmatter at push
 * time.
 */
import type { Message } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import { buildSearchResult } from "../../query/search/extractor.js";
import type { SearchableExtractor } from "../../query/search/extractor.js";

export const skillSearchExtractor: SearchableExtractor = {
  kind: ApiResourceKind.skill,
  schema: SkillSchema,

  getSearchSummary(resource: Message): string {
    // The search summary: spec.description.
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
      // The search summary: spec.description.
      description: skill.spec?.description ?? "",
      // Tags join space-separated — the index entry carries one tags
      // string.
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string.
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(
        skill.status?.audit?.specAudit?.createdAt?.seconds ?? 0n,
      ),
    };
  },
};
