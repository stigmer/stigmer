import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { SkillIdSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import {
  SearchRequestSchema,
  type SearchResponse,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchSkillsOptions {
  query: string;
  org: string;
  excludePublic?: boolean;
  page?: { num: number; size: number };
}

export interface SkillQueryService {
  get(id: string): Promise<Skill>;
  search(options: SearchSkillsOptions): Promise<SearchResponse>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSkillQueryService(
  transport: Transport,
): SkillQueryService {
  const skillClient = createClient(SkillQueryController, transport);
  const searchClient = createClient(SearchService, transport);

  return {
    async get(id) {
      const request = create(SkillIdSchema, { value: id });
      return skillClient.get(request);
    },

    async search(options) {
      const request = create(SearchRequestSchema, {
        kinds: [ApiResourceKind.skill],
        query: options.query,
        org: options.org,
        excludePublic: options.excludePublic ?? false,
        page: options.page
          ? create(PageInfoSchema, {
              num: options.page.num,
              size: options.page.size,
            })
          : undefined,
      });
      return searchClient.search(request);
    },
  };
}
