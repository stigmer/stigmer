// `list` dispatch: render a collection of resources for a kind.
//
// Every listable kind has its own list RPC with one page shape (page_size,
// page_token, entries, next_page_token), registered in LIST_HANDLERS with
// its table. Search is for finding by words (`stigmer search`); a list
// browses. Same map-dispatch shape as the get, delete, and apply
// registries, so the conformance test in registry/registry.test.ts can hold
// all four to the verb matrix.
//
// Handlers FETCH, the dispatcher RENDERS: every handler walks its pages up
// to --limit through readCursorPages (0 walks every page) and returns
// entries plus its schema/table pair, and listResources alone applies
// --limit and renders. That split is deliberate (stigmer/stigmer#312): when
// handlers owned rendering, honoring --limit was per-handler discipline.
//
// Rows carry organizations by id. The human table names each by slug, one
// lookup per distinct organization in the listing; json and yaml stay the
// wire as-is.

import { create, type DescMessage, type Message } from "@bufbuild/protobuf";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ListAgentChannelsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ListChannelAppsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ListSchedulesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ListVaultsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ListAgentsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ListSkillsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ListApiKeysInputSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ListMyOrganizationsInputSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
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

// One fetched page of a listing: what to render (entries + schema) and how
// (table). Rendering and --limit truncation happen centrally in
// listResources — a handler cannot opt out of either.
interface ListPage {
  readonly schema: DescMessage;
  readonly entries: readonly Message[];
  readonly table: TableShape;
}

// The handler walks pages up to `limit` (0: every page), so the
// dispatcher's slice is a no-op it keeps as the one place the flag binds.
type ListFn = (
  client: Stigmer,
  org: string,
  limit: number,
) => Promise<ListPage>;

// The list handlers. Every kind declaring List in the verb matrix must
// appear here — the conformance test enforces it, so the two cannot drift.
export const LIST_HANDLERS: ReadonlyMap<ApiResourceKind, ListFn> = new Map<
  ApiResourceKind,
  ListFn
>([
  [
    ApiResourceKind.organization,
    async (client, _org, limit) => {
      // listMine is caller-scoped: the organizations the caller belongs to.
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.organization.listMine(create(ListMyOrganizationsInputSchema, { pageSize, pageToken })),
      );
      return {
        schema: OrganizationSchema,
        entries,
        table: ORG_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.api_key,
    async (client, _org, limit) => {
      // list is caller-scoped: the keys that speak for the caller.
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.apiKey.list(create(ListApiKeysInputSchema, { pageSize, pageToken })),
      );
      return {
        schema: ApiKeySchema,
        entries,
        table: APIKEY_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.agent_channel,
    async (client, org, limit) => {
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.agentChannel.list(create(ListAgentChannelsRequestSchema, { org, pageSize, pageToken })),
      );
      return {
        schema: AgentChannelSchema,
        entries,
        table: AGENT_CHANNEL_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.channel_app,
    async (client, org, limit) => {
      // `channelapp` (not `channelApp`) is a recorded SDK codegen naming quirk.
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.channelapp.list(create(ListChannelAppsInputSchema, { org, pageSize, pageToken })),
      );
      return {
        schema: ChannelAppSchema,
        entries,
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
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.schedule.list(create(ListSchedulesRequestSchema, { org, pageSize, pageToken })),
      );
      return {
        schema: ScheduleSchema,
        entries,
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
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.vault.list(create(ListVaultsRequestSchema, { org, pageSize, pageToken })),
      );
      return {
        schema: VaultSchema,
        entries,
        table: VAULT_TABLE,
      };
    },
  ],
  [
    ApiResourceKind.session,
    async (client, _org, limit) => {
      // The session list is caller-scoped like organization and api_key
      // above. Promoted from a bespoke pre-gate route in commands/list.ts by
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
  [
    ApiResourceKind.agent,
    async (client, org, limit) => {
      await requireOrganization(client, org, [
        "stigmer list agents --org <org>",
        "stigmer config context set --org <org>",
      ]);
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.agent.list(create(ListAgentsRequestSchema, { org, pageSize, pageToken })),
      );
      return { schema: AgentSchema, entries, table: libraryTable("agents") };
    },
  ],
  [
    ApiResourceKind.skill,
    async (client, org, limit) => {
      await requireOrganization(client, org, [
        "stigmer list skills --org <org>",
        "stigmer config context set --org <org>",
      ]);
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.skill.list(create(ListSkillsRequestSchema, { org, pageSize, pageToken })),
      );
      return { schema: SkillSchema, entries, table: libraryTable("skills") };
    },
  ],
  [
    ApiResourceKind.plugin,
    async (client, org, limit) => {
      await requireOrganization(client, org, [
        "stigmer list plugins --org <org>",
        "stigmer config context set --org <org>",
      ]);
      const entries = await readCursorPages(limit, (pageSize, pageToken) =>
        client.plugin.list(create(ListPluginsRequestSchema, { org, pageSize, pageToken })),
      );
      return { schema: PluginSchema, entries, table: libraryTable("plugins") };
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
  // The single point where --limit binds the output (0: every entry). The
  // handler already walked at most `limit` entries, so this is a no-op;
  // binding it here rather than per-handler is what keeps the flag honest
  // for every kind (stigmer/stigmer#312).
  const entries = limit === 0 ? page.entries : page.entries.slice(0, limit);
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
  const handler = LIST_HANDLERS.get(kind);
  if (handler === undefined) {
    throw new UsageError("list is not implemented for this resource type");
  }
  return handler(client, org, limit);
}

// Agents, skills and plugins: what a person browses a library by. The
// description is the spec's, as search shows it.
function libraryTable(resourceName: string): TableShape {
  return {
    resourceName,
    headers: ["NAME", "DESCRIPTION", "VISIBILITY", "CREATED"],
    orgs: (json) => [str(obj(json, "metadata"), "org")],
    row: (json, orgLabel) => {
      const metadata = obj(json, "metadata");
      return [
        `${orgLabel(str(metadata, "org"))}/${str(metadata, "slug")}`,
        truncate(str(obj(json, "spec"), "description"), 50),
        str(metadata, "visibility"),
        date(str(obj(obj(obj(json, "status"), "audit"), "spec_audit"), "created_at")),
      ];
    },
  };
}

// The `stigmer search` table: SearchService results.
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
// STATE is whether the session works (running) or waits for input (idle),
// which the server computes from the session's events on every read
// (SessionStatus.state); a server that predates it sends none, shown "-".
const SESSION_TABLE: TableShape = {
  resourceName: "sessions",
  headers: ["SESSION ID", "STATE", "AGENT", "SUBJECT", "CREATED"],
  orgs: (json) => [str(obj(obj(json, "spec"), "agent_ref"), "org")],
  row: (json, orgLabel) => [
    str(obj(json, "metadata"), "id"),
    str(obj(json, "status"), "state") || "-",
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
  if (str(agentRef, "slug") !== "" || str(agentRef, "id") !== "") {
    return agentLabel(agentRef, orgLabel);
  }
  const pinned = str(obj(json, "status"), "agent_id");
  return pinned !== "" ? pinned : BUILT_IN_ASSISTANT_NAME;
}

// A referenced agent as `org/slug`. A reference holds its agent's id and
// the server names it by the agent's current slug; an agent deleted since
// comes back with no slug, and reads "deleted agent".
function agentLabel(agentRef: JsonObject, orgLabel: OrgLabel): string {
  const slug = str(agentRef, "slug");
  if (slug === "" && str(agentRef, "id") !== "") return "deleted agent";
  return `${orgLabel(str(agentRef, "org"))}/${slug}`;
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
      agentLabel(agentRef, orgLabel),
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
      agentLabel(agentRef, orgLabel),
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
