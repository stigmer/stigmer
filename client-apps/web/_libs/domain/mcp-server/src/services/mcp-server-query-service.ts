import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { ApiResourceIdSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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

export interface SearchMcpServersOptions {
  query: string;
  org: string;
  excludePublic?: boolean;
  page?: { num: number; size: number };
}

export interface McpServerQueryService {
  get(id: string): Promise<McpServer>;
  search(options: SearchMcpServersOptions): Promise<SearchResponse>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMcpServerQueryService(
  transport: Transport,
): McpServerQueryService {
  const mcpServerClient = createClient(McpServerQueryController, transport);
  const searchClient = createClient(SearchService, transport);

  return {
    async get(id) {
      const request = create(ApiResourceIdSchema, { value: id });
      return mcpServerClient.get(request);
    },

    async search(options) {
      const request = create(SearchRequestSchema, {
        kinds: [ApiResourceKind.mcp_server],
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
