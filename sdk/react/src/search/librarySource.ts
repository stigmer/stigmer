/**
 * The Library's data source for agents, skills and plugins: the kind's own
 * `list` while the search box is empty, and search while it holds text.
 *
 * Browsing an organization's agents is a list, newest first, paged by
 * token; finding one by its words is search, ranked by relevance and paged
 * by its own token. Both answer the row the Library renders, a
 * `SearchResult`, so a listed resource is summarized here exactly as the
 * server's search extractors summarize it (identity and qualified slug,
 * the kind's summary text, the spec-audit times, an agent's icon). A token
 * from one is never sent to the other: the search box's text is part of
 * the list's identity, so typing starts again from the first page.
 *
 * Proven by __tests__/librarySource.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { type Timestamp, TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ListAgentsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ListSkillsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { type SearchResult, SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { WorkbenchListFn, WorkbenchPage, WorkbenchPageRequest } from "../resource-workbench/types.js";

/** The kinds the Library lists and searches. */
export type LibraryKind = ApiResourceKind.agent | ApiResourceKind.skill | ApiResourceKind.plugin;

/** The slice of the Stigmer client a library source needs (mockable in tests). */
export type LibraryClient = Pick<Stigmer, "agent" | "skill" | "plugin" | "search">;

/**
 * A workbench data source for one Library kind: `list` while
 * `request.query` is empty, search while it holds text.
 *
 * @example
 * ```tsx
 * const listFn = useMemo(() => createLibraryListFn(stigmer, ApiResourceKind.agent), [stigmer]);
 * <ResourceWorkbench listFn={listFn} org={org} />
 * ```
 */
export function createLibraryListFn(client: LibraryClient, kind: LibraryKind): WorkbenchListFn {
  return (request) =>
    request.query ? searchPage(client, kind, request) : listPage(client, kind, request);
}

async function searchPage(
  client: LibraryClient,
  kind: LibraryKind,
  request: WorkbenchPageRequest,
): Promise<WorkbenchPage> {
  const page = await client.search.query({
    kinds: [kind],
    org: request.org,
    query: request.query,
    pageSize: request.pageSize,
    pageToken: request.pageToken,
  });
  return { entries: page.entries, nextPageToken: page.nextPageToken };
}

async function listPage(
  client: LibraryClient,
  kind: LibraryKind,
  request: WorkbenchPageRequest,
): Promise<WorkbenchPage> {
  const { org, pageSize, pageToken } = request;
  switch (kind) {
    case ApiResourceKind.agent: {
      const page = await client.agent.list(create(ListAgentsRequestSchema, { org, pageSize, pageToken }));
      return { entries: page.entries.flatMap(agentRow), nextPageToken: page.nextPageToken };
    }
    case ApiResourceKind.skill: {
      const page = await client.skill.list(create(ListSkillsRequestSchema, { org, pageSize, pageToken }));
      return { entries: page.entries.flatMap(skillRow), nextPageToken: page.nextPageToken };
    }
    case ApiResourceKind.plugin: {
      const page = await client.plugin.list(create(ListPluginsRequestSchema, { org, pageSize, pageToken }));
      return { entries: page.entries.flatMap(pluginRow), nextPageToken: page.nextPageToken };
    }
  }
}

/** An agent's summary, as search gives it: its description, else its instructions. */
function agentRow(agent: Agent): SearchResult[] {
  const spec = agent.spec;
  const summary = spec === undefined ? "" : spec.description !== "" ? spec.description : spec.instructions;
  return row(ApiResourceKind.agent, agent.metadata, summary, agent.status?.audit?.specAudit, spec?.iconUrl ?? "");
}

function skillRow(skill: Skill): SearchResult[] {
  return row(ApiResourceKind.skill, skill.metadata, skill.spec?.description ?? "", skill.status?.audit?.specAudit, "");
}

function pluginRow(plugin: Plugin): SearchResult[] {
  return row(ApiResourceKind.plugin, plugin.metadata, plugin.spec?.description ?? "", plugin.status?.audit?.specAudit, "");
}

/** The row the server's search builds for a resource (query/search/extractor.ts, buildSearchResult). */
function row(
  kind: LibraryKind,
  metadata: ApiResourceMetadata | undefined,
  summary: string,
  audit: { readonly createdAt?: Timestamp; readonly updatedAt?: Timestamp } | undefined,
  iconUrl: string,
): SearchResult[] {
  if (metadata === undefined) return [];
  return [
    create(SearchResultSchema, {
      kind,
      id: metadata.id,
      name: metadata.name,
      slug: metadata.slug,
      org: metadata.org,
      qualifiedSlug: metadata.org === "" ? metadata.slug : `${metadata.org}/${metadata.slug}`,
      description: summary,
      visibility: metadata.visibility,
      tags: metadata.tags,
      score: 1,
      iconUrl,
      createdAt: audit?.createdAt ?? create(TimestampSchema),
      updatedAt: audit?.updatedAt ?? create(TimestampSchema),
    }),
  ];
}
