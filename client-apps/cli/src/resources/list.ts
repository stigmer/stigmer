// `list` dispatch: render a collection of resources for a kind.
//
// Most registry kinds are search-indexed and list through the unified
// SearchService. Kinds that are deliberately not search-indexed
// (organizations, API keys, agent instances, agent channels, channel apps,
// schedules) use their dedicated find/list RPCs with bespoke table shapes,
// registered in LIST_HANDLERS — the same map-dispatch shape as the get,
// delete, and apply registries, so the conformance test in
// registry/registry.test.ts can hold all four to the verb matrix.
//
// Handlers FETCH, the dispatcher RENDERS: every handler returns entries plus
// its schema/table pair, and listResources alone applies --limit and renders.
// That split is deliberate (stigmer/stigmer#312): when handlers owned
// rendering, honoring --limit was per-handler discipline, and the two
// unpaginated branches (organization, api_key) shipped silently ignoring it.

import { create, type DescMessage, type Message } from "@bufbuild/protobuf";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ListAgentChannelsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ListAgentInstancesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ListChannelAppsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ListSchedulesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import type { OutputFormat } from "../output/index.js";
import { bool, type JsonObject, obj, renderCollection, str, type TableShape } from "./render.js";

// Kinds that list through the SearchService (list mode: empty query, org
// scope). Must stay in step with the server's SearchableKinds allowlist
// (backend/services/stigmer-server/pkg/query/search/valueobject/
// search_criteria.go): a kind present here but absent there silently lists
// as empty. The LIST_HANDLERS kinds are deliberately NOT here — they are
// not_search_indexed by design and take dedicated-RPC handlers below.
export const SEARCH_KINDS: ReadonlySet<ApiResourceKind> = new Set<ApiResourceKind>([
  ApiResourceKind.agent,
  ApiResourceKind.workflow,
  ApiResourceKind.mcp_server,
  ApiResourceKind.project,
  ApiResourceKind.skill,
  ApiResourceKind.environment,
]);

// One fetched page of a listing: what to render (entries + schema) and how
// (table). Rendering and --limit truncation happen centrally in
// listResources — a handler cannot opt out of either.
interface ListPage {
  readonly schema: DescMessage;
  readonly entries: readonly Message[];
  readonly table: TableShape;
}

// Where the RPC paginates, the handler still forwards `limit` as the page
// size so the server does the bounding; the dispatcher's slice is then a
// no-op. Where it doesn't, the slice IS the bound.
type ListFn = (client: Stigmer, org: string, limit: number) => Promise<ListPage>;

// Dedicated-RPC list handlers for the non-search-indexed kinds. Every kind
// declaring List in the verb matrix must appear here or in SEARCH_KINDS —
// the conformance test enforces it, so the two cannot drift.
export const LIST_HANDLERS: ReadonlyMap<ApiResourceKind, ListFn> = new Map<ApiResourceKind, ListFn>([
  [
    ApiResourceKind.organization,
    async (client) => {
      // findMyOrganizations is caller-scoped and unpaginated (Empty request;
      // a caller's org set is small by nature). The paginated `find` RPC is
      // platform-admin-only — the wrong surface for `list organization`.
      const result = await client.organization.findMyOrganizations();
      return { schema: OrganizationSchema, entries: result.entries, table: ORG_TABLE };
    },
  ],
  [
    ApiResourceKind.api_key,
    async (client) => {
      // findAll is caller-scoped and unpaginated (Empty request).
      const result = await client.apiKey.findAll();
      return { schema: ApiKeySchema, entries: result.entries, table: APIKEY_TABLE };
    },
  ],
  [
    ApiResourceKind.agent_instance,
    async (client, org, limit) => {
      const result = await client.agentInstance.list(
        create(ListAgentInstancesRequestSchema, { org, pageInfo: create(PageInfoSchema, { num: 1, size: limit }) }),
      );
      return { schema: AgentInstanceSchema, entries: result.items, table: INSTANCE_TABLE };
    },
  ],
  [
    ApiResourceKind.agent_channel,
    async (client, org, limit) => {
      const result = await client.agentChannel.list(
        create(ListAgentChannelsRequestSchema, { org, pageInfo: create(PageInfoSchema, { num: 1, size: limit }) }),
      );
      return { schema: AgentChannelSchema, entries: result.items, table: AGENT_CHANNEL_TABLE };
    },
  ],
  [
    ApiResourceKind.channel_app,
    async (client, org) => {
      // listByOrg has no pagination on its contract (the per-org set is small
      // by design); the dispatcher's slice bounds the output.
      // `channelapp` (not `channelApp`) is a recorded SDK codegen naming quirk.
      const result = await client.channelapp.listByOrg(create(ListChannelAppsByOrgInputSchema, { org }));
      return { schema: ChannelAppSchema, entries: result.entries, table: CHANNEL_APP_TABLE };
    },
  ],
  [
    ApiResourceKind.schedule,
    async (client, org, limit) => {
      // ListSchedulesRequest requires an org (min_len 1), but an unset cloud
      // context resolves to "" — refuse with actionable copy instead of
      // relaying the server's raw validation error.
      if (org === "") {
        throw new UsageError(
          "schedules are org-scoped: pass --org <slug> or configure an organization context",
        );
      }
      const result = await client.schedule.list(
        create(ListSchedulesRequestSchema, { org, pageInfo: create(PageInfoSchema, { num: 1, size: limit }) }),
      );
      return { schema: ScheduleSchema, entries: result.items, table: SCHEDULE_TABLE };
    },
  ],
]);

export async function listResources(
  client: Stigmer,
  kind: ApiResourceKind,
  org: string,
  limit: number,
  format: OutputFormat,
): Promise<string> {
  const page = await fetchListPage(client, kind, org, limit);
  // The single point where --limit binds the output. For paginated RPCs the
  // handler already asked the server for at most `limit` entries and this is
  // a no-op; for unpaginated RPCs it is the truncation itself. Slicing here
  // rather than per-handler is what keeps the flag honest for every kind —
  // organization and api_key shipped ignoring it when handlers owned this
  // (stigmer/stigmer#312).
  return renderCollection(page.schema, page.entries.slice(0, limit), format, page.table);
}

async function fetchListPage(
  client: Stigmer,
  kind: ApiResourceKind,
  org: string,
  limit: number,
): Promise<ListPage> {
  const dedicated = LIST_HANDLERS.get(kind);
  if (dedicated !== undefined) {
    return dedicated(client, org, limit);
  }
  if (!SEARCH_KINDS.has(kind)) {
    throw new UsageError("list is not implemented for this resource type");
  }
  const result = await client.search.query({ kinds: [kind], org, page: { num: 1, size: limit } });
  return { schema: SearchResultSchema, entries: result.entries, table: SEARCH_TABLE };
}

// Shared with `search` — both render SearchService results identically.
export const SEARCH_TABLE: TableShape = {
  resourceName: "resources",
  headers: ["NAME", "DESCRIPTION", "VISIBILITY", "CREATED"],
  row: (json) => [
    str(json, "qualified_slug"),
    truncate(str(json, "description"), 50),
    str(json, "visibility"),
    date(str(json, "created_at")),
  ],
};

const INSTANCE_TABLE: TableShape = {
  resourceName: "agent instances",
  headers: ["ID", "SLUG", "AGENT", "DESCRIPTION"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      str(spec, "agent_id"),
      truncate(str(spec, "description"), 50),
    ];
  },
};

// A channel serves traffic only when installed AND enabled (the install
// lifecycle and the owner's serving switch are deliberately distinct), so
// the table surfaces both signals side by side.
const AGENT_CHANNEL_TABLE: TableShape = {
  resourceName: "agent channels",
  headers: ["ID", "SLUG", "AGENT", "PROVIDER", "STATE", "ENABLED"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const agentRef = obj(spec, "agent_ref");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      `${str(agentRef, "org")}/${str(agentRef, "slug")}`,
      providerOf(spec),
      // Zero-valued enums are omitted from protojson; a channel is
      // initialized to pending_install on create, so "-" is the rare
      // unspecified case, matching the date() empty convention.
      str(obj(json, "status"), "install_state") || "-",
      bool(spec, "enabled") ? "true" : "false",
    ];
  },
};

// Secret fields never reach this table: list responses are redacted
// server-side in both editions (the RedactChannelApp pipeline).
const CHANNEL_APP_TABLE: TableShape = {
  resourceName: "channel apps",
  headers: ["ID", "SLUG", "PROVIDER", "CREATED"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      providerOf(obj(json, "spec")),
      date(str(obj(obj(obj(json, "status"), "audit"), "spec_audit"), "created_at")),
    ];
  },
};

// ENABLED is the owner's switch (spec.enabled); STATE is the platform's
// failure latch, derived from status.paused_reason. They are different
// states with different remedies — re-apply with `enabled: true` versus
// `stigmer schedule resume` — so the table keeps them as two columns. An
// auto-paused schedule with ENABLED true is exactly the condition this
// surface exists to make visible (stigmer/stigmer#352).
const SCHEDULE_TABLE: TableShape = {
  resourceName: "schedules",
  headers: ["ID", "SLUG", "TARGET", "CRON", "TZ", "ENABLED", "STATE"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    // The target oneof has one arm today (`agent`); a future workflow arm
    // extends this accessor alongside the proto.
    const agentRef = obj(obj(spec, "agent"), "agent_ref");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      `${str(agentRef, "org")}/${str(agentRef, "slug")}`,
      str(spec, "cron"),
      str(spec, "time_zone"),
      bool(spec, "enabled") ? "true" : "false",
      str(obj(json, "status"), "paused_reason") === "" ? "active" : "paused",
    ];
  },
};

// The provider_config oneof serializes as exactly one provider-named key in
// protojson (AgentChannelSpec and ChannelAppSpec share the same oneof
// shape). Extend this list when a new provider arm lands in the protos.
const PROVIDER_KEYS = ["slack", "whatsapp"] as const;

function providerOf(spec: JsonObject): string {
  return PROVIDER_KEYS.find((key) => key in spec) ?? "-";
}

const ORG_TABLE: TableShape = {
  resourceName: "organizations",
  headers: ["NAME", "SLUG", "ID"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    return [str(metadata, "name"), str(metadata, "slug"), str(metadata, "id")];
  },
};

const APIKEY_TABLE: TableShape = {
  resourceName: "API keys",
  headers: ["ID", "NAME", "FINGERPRINT", "EXPIRES"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const fingerprint = str(spec, "fingerprint");
    return [
      str(metadata, "id"),
      str(metadata, "name") || "-",
      fingerprint === "" ? "" : `***${fingerprint}`,
      apiKeyExpiry(spec),
    ];
  },
};

function apiKeyExpiry(spec: JsonObject): string {
  if (bool(spec, "never_expires")) return "Never";
  const expiresAt = str(spec, "expires_at");
  return expiresAt === "" ? "Never" : date(expiresAt);
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function date(timestamp: string): string {
  return timestamp === "" ? "-" : timestamp.slice(0, 10);
}
