/**
 * Skill search extractor — ports the GetSearchIndexEntry side of
 * pkg/query/search/extractor/skill_extractor.go. Skills are knowledge
 * documents (SKILL.md files); the search summary is spec.description,
 * extracted from the SKILL.md YAML frontmatter at push time. The query
 * side of the extractor contract arrives with the search service
 * sub-project (#14).
 */
import type { Message } from "@bufbuild/protobuf";

import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { SearchIndexEntry } from "../../store/interface.js";
import type { SearchIndexExtractor } from "../../pipeline/steps/index-search.js";

export const skillSearchExtractor: SearchIndexExtractor = {
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
      // Tags join space-separated for FTS5 (Go extractor.JoinTags).
      tags: metadata.tags.join(" "),
      org: metadata.org,
      // The enum NAME string, exactly Go's visibility.String().
      visibility: ApiResourceVisibility[metadata.visibility] ?? "",
      createdAt: Number(skill.status?.audit?.specAudit?.createdAt?.seconds ?? 0n),
    };
  },
};
