// The "search" MCP tool, backed by SearchService.search.
// Go parity: mcp-server/internal/domains/search/tools.go.
//
// One tool covers listing, full-text search, and cross-kind discovery (replacing
// per-kind list_* tools); the combination of parameters selects the behavior.
// Each result entry is enriched with a resource_uri that clients can hand
// straight to resources/read, bridging discovery to read.

import { toJson, type MessageInitShape } from "@bufbuild/protobuf";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  type SearchRequestSchema,
  type SearchResponse,
  SearchResponseSchema,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { z } from "zod";

import { resolveToken, withClient, type BackendTarget } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { buildResourceURI } from "../resourceuri.js";
import { rpcError } from "../rpcerr.js";
import { textOrError } from "../toolresult.js";

/**
 * The searchable kinds and their proto enum values. Deliberately a curated
 * subset (not every ApiResourceKind): the kinds an MCP client can also read
 * and manage through tools. The backend's extractor registry supports more
 * (sessions, executions, ...) — add here only alongside a tool surface.
 */
const knownKinds: Readonly<Record<string, ApiResourceKind>> = {
  agent: ApiResourceKind.agent,
  environment: ApiResourceKind.environment,
  skill: ApiResourceKind.skill,
  mcp_server: ApiResourceKind.mcp_server,
  workflow: ApiResourceKind.workflow,
};

interface SearchArgs {
  readonly kinds?: string[];
  readonly query?: string;
  readonly org?: string;
  readonly excludePublic?: boolean;
  readonly pageSize?: number;
  readonly pageNum?: number;
}

/** Register the search tool; returns the registered tool names. */
export function registerSearchTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "search",
    {
      description:
        "Search and list Stigmer resources (agents, skills, MCP servers, workflows, " +
        "environments). Set 'kinds' to filter by resource type. Set 'query' for full-text search. " +
        "Set 'org' to scope to an organization. Omit 'query' to list all accessible resources.",
      inputSchema: {
        kinds: z
          .array(z.string())
          .optional()
          .describe(
            "Resource kinds to search. Valid: agent, skill, mcp_server, workflow, environment. Empty searches all.",
          ),
        query: z
          .string()
          .optional()
          .describe("Full-text search query. Empty lists all accessible resources."),
        org: z
          .string()
          .optional()
          .describe("Organization slug to scope the search. Empty searches all accessible orgs."),
        exclude_public: z
          .boolean()
          .optional()
          .describe("Exclude public/platform resources from results."),
        page_size: z.number().int().optional().describe("Results per page (default 20, max 100)."),
        page_num: z.number().int().optional().describe("Page number (1-indexed, default 1)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        search(target.serverAddress, resolveToken(extra, target.apiKey), {
          kinds: args.kinds,
          query: args.query,
          org: args.org,
          excludePublic: args.exclude_public,
          pageSize: args.page_size,
          pageNum: args.page_num,
        }),
      ),
  );

  return ["search"];
}

/** Run the search RPC and return the enriched protojson result. */
async function search(serverAddress: string, token: string, args: SearchArgs): Promise<string> {
  const kinds = parseKinds(args.kinds);
  return withClient(SearchService, serverAddress, token, async (client, callOptions) => {
    const req: MessageInitShape<typeof SearchRequestSchema> = {
      kinds,
      query: args.query ?? "",
      org: args.org ?? "",
      excludePublic: args.excludePublic ?? false,
    };
    // Attach pagination only when explicitly requested, letting the server apply
    // its own defaults otherwise (Go does the same).
    if ((args.pageSize ?? 0) > 0 || (args.pageNum ?? 0) > 0) {
      req.page = { size: args.pageSize ?? 0, num: args.pageNum ?? 0 };
    }

    let resp: SearchResponse;
    try {
      resp = await client.search(req, callOptions);
    } catch (err) {
      throw rpcError(err, args.org ? `search results in org "${args.org}"` : "search results");
    }
    return enrichSearchResponse(resp);
  });
}

/** Convert user-supplied kind strings to proto enum values, rejecting unknowns. */
function parseKinds(raw: string[] | undefined): ApiResourceKind[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  return raw.map((s) => {
    const kind = knownKinds[s];
    if (kind === undefined) {
      throw new Error(
        `unknown resource kind "${s}"; valid kinds: agent, skill, mcp_server, workflow, environment`,
      );
    }
    return kind;
  });
}

/**
 * Serialize the response and inject a resource_uri into each entry whose kind
 * has a registered resource template. Empty responses short-circuit to the plain
 * marshal to avoid the walk.
 */
function enrichSearchResponse(resp: SearchResponse): string {
  if (resp.entries.length === 0) {
    return toProtoJson(SearchResponseSchema, resp);
  }

  const data = toJson(SearchResponseSchema, resp, { useProtoFieldName: true }) as Record<
    string,
    unknown
  >;
  const entries = Array.isArray(data.entries)
    ? (data.entries as Array<Record<string, unknown>>)
    : [];
  for (let i = 0; i < entries.length && i < resp.entries.length; i++) {
    const r = resp.entries[i]!;
    const uri = buildResourceURI(ApiResourceKind[r.kind] ?? "", r.org, r.slug);
    if (uri !== "") {
      entries[i]!.resource_uri = uri;
    }
  }
  return JSON.stringify(data, null, 2);
}
