import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import {
  SearchRequestSchema,
  type SearchResponse,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchAgentsOptions {
  query: string;
  org: string;
  excludePublic?: boolean;
  page?: { num: number; size: number };
}

export interface AgentQueryService {
  get(id: string): Promise<Agent>;
  getByReference(org: string, slug: string): Promise<Agent>;
  search(options: SearchAgentsOptions): Promise<SearchResponse>;
}

// ---------------------------------------------------------------------------
// Factory
//
// protobuf-es codegenv1 descriptors cause generic inference loss with strict
// TS, so Connect-RPC clients type all inputs/outputs as Message<string>. The
// typed wrapper methods below restore the correct domain types at each call
// site — the underlying runtime behavior is identical.
// ---------------------------------------------------------------------------

export function createAgentQueryService(
  transport: Transport,
): AgentQueryService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentClient: any = createClient(AgentQueryController, transport);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchClient: any = createClient(SearchService, transport);

  return {
    async get(id) {
      const request = create(AgentIdSchema, { value: id });
      return agentClient.get(request) as Promise<Agent>;
    },

    async getByReference(org, slug) {
      const ref = create(ApiResourceReferenceSchema, {
        org,
        kind: ApiResourceKind.agent,
        slug,
      });
      return agentClient.getByReference(ref) as Promise<Agent>;
    },

    async search(options) {
      const request = create(SearchRequestSchema, {
        kinds: [ApiResourceKind.agent],
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
      return searchClient.search(request) as Promise<SearchResponse>;
    },
  };
}
