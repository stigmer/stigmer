// `list` dispatch: render a collection of resources for a kind.
//
// Most registry kinds list through the unified SearchService. The rest take
// dedicated find/list RPCs with bespoke table shapes, registered in
// LIST_HANDLERS — either because the kind is not search-indexed (API keys,
// agent channels, channel apps, schedules, vaults) or because the dedicated RPC is
// the better list surface than the kind's search index (organizations are
// caller-scoped; sessions carry columns search results don't have). Same map-dispatch shape as the get, delete, and apply
// registries, so the conformance test in registry/registry.test.ts can hold
// all four to the verb matrix.
//
// Handlers FETCH, the dispatcher RENDERS: every handler returns entries plus
// its schema/table pair, and listResources alone applies --limit and renders.
// That split is deliberate (stigmer/stigmer#312): when handlers owned
// rendering, honoring --limit was per-handler discipline, and the two
// unpaginated branches (organization, api_key) shipped silently ignoring it.
//
// Rows carry organizations by id. The human table names each by slug, one
// lookup per distinct organization in the listing; json and yaml stay the
// wire as-is.

import { create, type DescMessage, type Message } from "@bufbuild/protobuf";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ListAgentChannelsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ListChannelAppsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ListSchedulesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ListVaultsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { BUILT_IN_ASSISTANT_NAME, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import type { OutputFormat } from "../output/index.js";
import { readCursorPages } from "./cursor-pages.js";
import {
  bool,
  type JsonObject,
  obj,
  type OrgLabel,
  renderCollection,
  str,
  tableOrganizations,
  type TableShape,
} from "./render.js";
import { organizationLabels } from "../client/organizations.js";
import { requireOrganization } from "../client/single-org.js";

// Kinds that list through the SearchService (list mode: empty query, org
// scope). Must stay in step with the server's SearchableKinds allowlist
// (backend/services/stigmer-server/pkg/query/search/valueobject/
// search_criteria.go): a kind present here but absent there silently lists
// as empty. The LIST_HANDLERS kinds are deliberately NOT here — see the
// header: not search-indexed, or better served by their dedicated RPC.
export const SEARCH_KINDS: ReadonlySet<ApiResourceKind> =
  new Set<ApiResourceKind>([
    ApiResourceKind.agent,
    ApiResourceKind.mcp_server,
    ApiResourceKind.skill,
    ApiResourceKind.plugin,
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
type ListFn = (
  client: Stigmer,
  org: string,
  limit: number,
) => Promise<ListPage>;

// Dedicated-RPC list handlers for the non-search-indexed kinds. Every kind
// declaring List in the verb matrix must appear here or in SEARCH_KINDS —
// the conformance test enforces it, so the two cannot drift.
export const LIST_HANDLERS: ReadonlyMap<ApiResourceKind, ListFn> = new Map<
  ApiResourceKind,
  ListFn
>([
  [
    ApiResourceKind.organization,
    async (client) => {
      // findMyOrganizations is caller-scoped and unpaginated (Empty request;
      // a caller's org set is small by nature). The paginated `find` RPC is
      // platform-admin-only — the wrong surface for `list organization`.
      const result = await client.organization.findMyOrganizations();
      return {
        schema: OrganizationSchema,
        entries: result.entries,
        table: ORG_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.api_key,
    async (client) => {
      // findAll is caller-scoped and unpaginated (Empty request).
      const result = await client.apiKey.findAll();
      return {
        schema: ApiKeySchema,
        entries: result.entries,
        table: APIKEY_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.agent_channel,
    async (client, org, limit) => {
      const result = await client.agentChannel.list(
        create(ListAgentChannelsRequestSchema, {
          org,
          pageInfo: create(PageInfoSchema, { num: 1, size: limit }),
        }),
      );
      return {
        schema: AgentChannelSchema,
        entries: result.items,
        table: AGENT_CHANNEL_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.channel_app,
    async (client, org) => {
      // listByOrg has no pagination on its contract (the per-org set is small
      // by design); the dispatcher's slice bounds the output.
      // `channelapp` (not `channelApp`) is a recorded SDK codegen naming quirk.
      const result = await client.channelapp.listByOrg(
        create(ListChannelAppsByOrgInputSchema, { org }),
      );
      return {
        schema: ChannelAppSchema,
        entries: result.entries,
        table: CHANNEL_APP_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.schedule,
    async (client, org, limit) => {
      // ListSchedulesRequest requires an org (min_len 1): a server that holds
      // one fills it, and on one that holds several an unset context is
      // refused with actionable copy instead of the server's raw validation
      // error.
      await requireOrganization(client, org, [
        "stigmer list schedules --org <org>",
        "stigmer config context set --org <org>",
      ]);
      const result = await client.schedule.list(
        create(ListSchedulesRequestSchema, {
          org,
          pageInfo: create(PageInfoSchema, { num: 1, size: limit }),
        }),
      );
      return {
        schema: ScheduleSchema,
        entries: result.items,
        table: SCHEDULE_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.vault,
    async (client, org, limit) => {
      // Vaults are never search-indexed (a person's own vault names their
      // keys), so the dedicated list answers: the caller's own vault and the
      // shared vaults they may see. The request requires an org.
      await requireOrganization(client, org, [
        "stigmer list vaults --org <org>",
        "stigmer config context set --org <org>",
      ]);
      const result = await client.vault.list(
        create(ListVaultsRequestSchema, {
          org,
          pageInfo: create(PageInfoSchema, { num: 1, size: limit }),
        }),
      );
      return {
        schema: VaultSchema,
        entries: result.items,
        table: VAULT_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.session,
    async (client, _org, limit) => {
      // Sessions ARE search-indexed, but list deliberately uses the dedicated
      // RPC: the table's columns (agent, subject) don't exist on
      // SearchResult rows, and the RPC is caller-scoped like organization and
      // api_key above.
      // Promoted from a bespoke pre-gate route in commands/list.ts by
      // stigmer/stigmer#469 (it had shipped working-but-unadvertised).
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.session.list(create(ListSessionsRequestSchema, { pageSize, pageToken })),
      );
      return {
        schema: SessionSchema,
        entries,
        table: SESSION_TABLE,
      };
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
  const entries = page.entries.slice(0, limit);
  return renderCollection(
    page.schema,
    entries,
    format,
    page.table,
    await organizationLabels(client, tableOrganizations(page.schema, entries, format, page.table)),
  );
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
  const result = await client.search.query({
    kinds: [kind],
    org,
    page: { num: 1, size: limit },
  });
  return {
    schema: SearchResultSchema,
    entries: result.entries,
    table: SEARCH_TABLE,
  };
}

// Shared with `search` — both render SearchService results identically.
export const SEARCH_TABLE: TableShape = {
  resourceName: "resources",
  headers: ["NAME", "DESCRIPTION", "VISIBILITY", "CREATED"],
  orgs: (json) => [str(json, "org")],
  row: (json, orgLabel) => [
    qualifiedName(json, orgLabel),
    truncate(str(json, "description"), 50),
    str(json, "visibility"),
    date(str(json, "created_at")),
  ],
};

// A session's identity for follow-up commands is its ID (`stigmer session
// resume <id>`), so the ID leads; agent and subject are how a human
// recognizes which conversation it was.
const SESSION_TABLE: TableShape = {
  resourceName: "sessions",
  headers: ["SESSION ID", "AGENT", "SUBJECT", "CREATED"],
  orgs: (json) => [str(obj(obj(json, "spec"), "agent_ref"), "org")],
  row: (json, orgLabel) => [
    str(obj(json, "metadata"), "id"),
    sessionAgent(json, orgLabel),
    truncate(str(obj(json, "spec"), "subject") || "-", 50),
    date(str(obj(json, "metadata"), "created_at")),
  ],
};

// The agent a session names, as `org/slug`, or the built-in assistant's
// name when it names none and pins none (the reading `isBuiltInAssistant`
// gives a Session). A session that pins an agent its reference no longer
// carries shows the pinned id rather than claiming the assistant.
function sessionAgent(json: JsonObject, orgLabel: OrgLabel): string {
  const agentRef = obj(obj(json, "spec"), "agent_ref");
  const slug = str(agentRef, "slug");
  if (slug !== "") return `${orgLabel(str(agentRef, "org"))}/${slug}`;
  const pinned = str(obj(json, "status"), "agent_id");
  return pinned !== "" ? pinned : BUILT_IN_ASSISTANT_NAME;
}

// A channel serves traffic only when installed AND enabled (the install
// lifecycle and the owner's serving switch are deliberately distinct), so
// the table surfaces both signals side by side.
const AGENT_CHANNEL_TABLE: TableShape = {
  resourceName: "agent channels",
  headers: ["ID", "SLUG", "AGENT", "PROVIDER", "STATE", "ENABLED"],
  orgs: (json) => [str(obj(obj(json, "spec"), "agent_ref"), "org")],
  row: (json, orgLabel) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const agentRef = obj(spec, "agent_ref");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      `${orgLabel(str(agentRef, "org"))}/${str(agentRef, "slug")}`,
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
      date(
        str(obj(obj(obj(json, "status"), "audit"), "spec_audit"), "created_at"),
      ),
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
  orgs: (json) => [str(scheduleAgentRef(json), "org")],
  row: (json, orgLabel) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const agentRef = scheduleAgentRef(json);
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      `${orgLabel(str(agentRef, "org"))}/${str(agentRef, "slug")}`,
      str(spec, "cron"),
      str(spec, "time_zone"),
      bool(spec, "enabled") ? "true" : "false",
      str(obj(json, "status"), "paused_reason") === "" ? "active" : "paused",
    ];
  },
};

// Entry names only: a vault read never carries a value, and the table shows
// how many secrets and logins a vault holds, not what they are.
const VAULT_TABLE: TableShape = {
  resourceName: "vaults",
  headers: ["ID", "SLUG", "NAME", "OWNER", "SECRETS", "LOGINS"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    return [
      str(metadata, "id"),
      str(metadata, "slug"),
      str(metadata, "name"),
      str(spec, "person") !== "" ? "you" : "organization",
      String(Object.keys(obj(spec, "secrets")).length),
      String(Object.keys(obj(spec, "connections")).length),
    ];
  },
};

// The schedule's target is the agent it runs.
function scheduleAgentRef(json: JsonObject): JsonObject {
  return obj(obj(obj(json, "spec"), "agent"), "agent_ref");
}

// A search result's `org/slug` with the organization named by its label.
// The qualified slug leads with the org the row carries (an id); one that
// does not prints as the server gave it.
function qualifiedName(json: JsonObject, orgLabel: OrgLabel): string {
  const qualified = str(json, "qualified_slug");
  const org = str(json, "org");
  return org !== "" && qualified.startsWith(`${org}/`)
    ? `${orgLabel(org)}${qualified.slice(org.length)}`
    : qualified;
}

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
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}

function date(timestamp: string): string {
  return timestamp === "" ? "-" : timestamp.slice(0, 10);
}
