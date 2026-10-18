// In-process test for the read verbs (get/list).
//
// Stands up a real Connect backend over h2c serving the query controllers the
// CLI calls, points an SDK node client at it, and drives the resource layer
// (fetchResource / listResources) end to end. Asserts the rendered JSON matches
// the backend's protojson (the parity contract) and that backend RPC errors map
// to the right CLI exit code via classify(). Resources carry their organization
// by id, as the server stores it; the human tables name it by slug.

import { create, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/client/node";
import type { Stigmer } from "@stigmer/client";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../../errors/index.js";
import { fetchResource } from "../get.js";
import { listResources } from "../list.js";
import { renderResource } from "../render.js";

// The organization every fixture belongs to: filed under a minted id, named acme.
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
// An organization the caller cannot see, which output names as given.
const HIDDEN_ORG_ID = "org_01jccccccccccccccccccccccc";

const knownAgent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "Reviewer", slug: "reviewer", org: ACME_ID, id: "agt_1" },
  spec: { description: "reviews code" },
});

const knownOrg = create(OrganizationSchema, {
  apiVersion: "tenancy.stigmer.ai/v1",
  kind: "Organization",
  metadata: { name: "Acme", slug: "acme", org: ACME_ID, id: ACME_ID },
});

const knownApiKey = create(ApiKeySchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "ApiKey",
  metadata: { name: "ci", org: ACME_ID, id: "key_1" },
  spec: { fingerprint: "abcd", neverExpires: true },
});

// An organization the server holds under a newer slug and no membership
// lists, so a get by its earlier slug or its id falls back to the server.
const renamedOrg = create(OrganizationSchema, {
  apiVersion: "tenancy.stigmer.ai/v1",
  kind: "Organization",
  metadata: { name: "Globex", slug: "globex", id: "org_01jbbbbbbbbbbbbbbbbbbbbbbb" },
});

// Second org/API-key entries so the list tests can pin --limit on lists
// whose fakes answer one page whatever size is asked: the dispatcher's
// slice still binds the flag (stigmer/stigmer#312).
const secondOrg = create(OrganizationSchema, {
  apiVersion: "tenancy.stigmer.ai/v1",
  kind: "Organization",
  metadata: { name: "Beta Clinic", slug: "beta-clinic", org: "beta-clinic", id: "beta-clinic" },
});

const secondApiKey = create(ApiKeySchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "ApiKey",
  metadata: { name: "local-dev", org: ACME_ID, id: "key_2" },
  spec: { fingerprint: "ef01", neverExpires: true },
});

// An agent in an organization the caller cannot see, which output names by
// its id as given, and a second agent in acme, so the table proves one
// organization lookup per distinct organization, never per row.
const hiddenAgent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "Linter", slug: "linter", org: HIDDEN_ORG_ID, id: "agt_2" },
  spec: { description: "lints code" },
});

const formatterAgent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "Formatter", slug: "formatter", org: ACME_ID, id: "agt_3" },
  spec: { description: "formats code" },
});

// Every agent list request, so a test can see the pages the CLI walked.
const agentListRequests: Array<{ pageSize: number; pageToken: string; labels?: Record<string, string> }> = [];

// More kinds wired into get-bindings and list alongside this test: a
// plugin, a vault and the two channel kinds, each listed by its own list
// RPC. The vault carries entry
// names with blank values, as every vault read does.
const knownVault = create(VaultSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Vault",
  metadata: { name: "Clinic tools", slug: "clinic-tools", org: ACME_ID, id: "vlt_1" },
  spec: {
    owner: { case: "org", value: ACME_ID },
    secrets: { CLINIC_DB_PASSWORD: { value: "", description: "clinic patient database" } },
    connections: { "https://mcp.clinic.example/mcp": { token: "" } },
  },
});

const knownPlugin = create(PluginSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Plugin",
  metadata: { name: "clinic-kit", slug: "clinic-kit", org: ACME_ID, id: "plg_1" },
  spec: { description: "clinic tools plugin" },
});

const knownSkill = create(SkillSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Skill",
  metadata: { name: "triage", slug: "triage", org: ACME_ID, id: "skl_1" },
  spec: { description: "triage a ticket" },
});

// Spec/status populated to exercise every CHANNEL_TABLE column: agent_ref,
// the type oneof, install_state (a WhatsApp channel's STATE), and enabled.
const knownChannel = create(ChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Channel",
  metadata: { name: "clinic-patient-whatsapp", slug: "clinic-patient-whatsapp", org: ACME_ID, id: "chn_1" },
  spec: {
    enabled: true,
    agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, slug: "clinic-assistant" },
    type: { case: "whatsapp", value: { phoneNumberId: "106540352242922" } },
  },
  status: { installState: ChannelInstallState.installed },
});

// A web channel's STATE is its audience; it has nothing to install. Its id
// carries the prefix chat links were minted with before they were channels.
const webChannel = create(ChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Channel",
  metadata: { name: "clinic-assistant-web", slug: "clinic-assistant-web", org: ACME_ID, id: "ash_2" },
  spec: {
    enabled: false,
    agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, slug: "clinic-assistant" },
    type: { case: "web", value: { audience: ChannelAudience.public } },
  },
});

// Secret fields carry the redaction marker, matching what the server's
// RedactChannelApp pipeline returns on every list/get response.
const knownChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { name: "clinic-meta-app", slug: "clinic-meta-app", org: ACME_ID, id: "chapp_1" },
  spec: {
    providerConfig: {
      case: "whatsapp",
      value: {
        appId: "108954",
        appSecret: "***REDACTED***",
        accessToken: "***REDACTED***",
        verifyToken: "***REDACTED***",
      },
    },
  },
  status: { audit: { specAudit: { createdAt: timestampFromDate(new Date("2026-07-20T10:00:00Z")) } } },
});

// Second entry (slack arm) so the list tests cover both provider derivations
// and the --limit slice.
const secondChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { name: "clinic-slack-app", slug: "clinic-slack-app", org: ACME_ID, id: "chapp_2" },
  spec: {
    providerConfig: {
      case: "slack",
      value: { clientId: "12.34", clientSecret: "***REDACTED***", signingSecret: "***REDACTED***" },
    },
  },
});

// Spec/status populated to exercise every ROUTINE_TABLE column — and the
// exact condition the table exists to surface (stigmer/stigmer#352): the
// owner's switch is ON (spec.enabled) while the platform's failure latch is
// SET (status.paused_reason), two different states with two different
// remedies.
const pausedRoutine = create(RoutineSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Routine",
  metadata: { name: "daily-fee-reminders", slug: "daily-fee-reminders", org: ACME_ID, id: "rtn_1" },
  spec: {
    cron: "0 9 * * *",
    timeZone: "Asia/Kolkata",
    enabled: true,
    agent: { agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, slug: "clinic-assistant" } },
  },
  status: { pausedReason: "5 consecutive failed runs", consecutiveFailures: 5 },
});

// Owner-disabled and never fired: empty status, so the row must derive
// "active" from an absent paused_reason and print no bogus timestamps.
const disabledRoutine = create(RoutineSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Routine",
  metadata: { name: "weekly-digest", slug: "weekly-digest", org: ACME_ID, id: "rtn_2" },
  spec: {
    cron: "30 6 * * 1",
    timeZone: "UTC",
    enabled: false,
    agent: { agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, slug: "reviewer" } },
  },
});

// A routine whose agent was deleted: the server answers its reference with
// the agent's id and no slug.
const orphanedRoutine = create(RoutineSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Routine",
  metadata: { name: "orphaned", slug: "orphaned", org: ACME_ID, id: "rtn_3" },
  spec: {
    cron: "0 7 * * *",
    timeZone: "UTC",
    enabled: true,
    agent: { agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, id: "agt_gone" } },
  },
});

// Networking limited to two hosts, with three packages across two managers,
// so every ENVIRONMENT_TABLE column carries a value of its own.
const limitedEnvironment = create(EnvironmentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Environment",
  metadata: { name: "data-science", slug: "data-science", org: ACME_ID, id: "env_1" },
  spec: {
    networking: {
      type: NetworkingType.limited,
      allowedHosts: ["api.example.com", "files.example.com"],
      allowPackageManagers: true,
    },
    packages: { pip: ["pandas", "numpy"], apt: ["ffmpeg"] },
  },
});

let backend: Http2Server;
let client: Stigmer;
// Every value the organization get was asked for, so a test can count lookups.
const orgGets: string[] = [];
const openSessions = new Set<ServerHttp2Session>();

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, {
      get: (req) => {
        if (req.value !== "agt_1") throw new ConnectError("agent not found", Code.NotFound);
        return knownAgent;
      },
      getByReference: (req) => {
        if (req.slug !== "reviewer") throw new ConnectError("agent not found", Code.NotFound);
        return knownAgent;
      },
      // Two pages, so a list proves the CLI follows the token.
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        agentListRequests.push({
          pageSize: req.pageSize,
          pageToken: req.pageToken,
          ...(Object.keys(req.labels).length > 0 ? { labels: { ...req.labels } } : {}),
        });
        if (req.pageToken === "") {
          return { entries: [knownAgent, hiddenAgent].slice(0, req.pageSize), nextPageToken: "agents-2" };
        }
        return { entries: [formatterAgent] };
      },
    });
    router.service(SkillQueryController, {
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [knownSkill] };
      },
    });
    router.service(PluginQueryController, {
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [knownPlugin] };
      },
    });
    router.service(OrganizationQueryController, {
      listMine: () => ({ entries: [knownOrg, secondOrg] }),
      // The server resolves an earlier slug and an id to the organization.
      get: (req) => {
        orgGets.push(req.value);
        if (req.value === ACME_ID || req.value === "acme") return knownOrg;
        // As the server refuses an organization the caller cannot see.
        if (req.value === "hidden-org") throw new ConnectError("permission denied", Code.PermissionDenied);
        // As a server that cannot answer right now.
        if (req.value === "flaky-org") throw new ConnectError("backend unavailable", Code.Unavailable);
        if (req.value !== "globex-old" && req.value !== renamedOrg.metadata?.id) {
          throw new ConnectError("organization not found", Code.NotFound);
        }
        return renamedOrg;
      },
    });
    router.service(ApiKeyQueryController, {
      list: () => ({ entries: [knownApiKey, secondApiKey] }),
    });
    router.service(VaultQueryController, {
      get: (req) => {
        if (req.value !== "vlt_1") throw new ConnectError("vault not found", Code.NotFound);
        return knownVault;
      },
      getByReference: (req) => {
        if (req.slug !== "clinic-tools") throw new ConnectError("vault not found", Code.NotFound);
        return knownVault;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("unexpected org", Code.InvalidArgument);
        return { entries: [knownVault] };
      },
    });
    router.service(ChannelQueryController, {
      get: (req) => {
        if (req.value !== "chn_1") throw new ConnectError("channel not found", Code.NotFound);
        return knownChannel;
      },
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-whatsapp") throw new ConnectError("channel not found", Code.NotFound);
        return knownChannel;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [knownChannel, webChannel] };
      },
    });
    router.service(ChannelAppQueryController, {
      get: (req) => {
        if (req.value !== "chapp_1") throw new ConnectError("channel app not found", Code.NotFound);
        return knownChannelApp;
      },
      getByReference: (req) => {
        if (req.slug !== "clinic-meta-app") throw new ConnectError("channel app not found", Code.NotFound);
        return knownChannelApp;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [knownChannelApp, secondChannelApp] };
      },
    });
    router.service(RoutineQueryController, {
      get: (req) => {
        if (req.value !== "rtn_1") throw new ConnectError("routine not found", Code.NotFound);
        return pausedRoutine;
      },
      getByReference: (req) => {
        if (req.slug !== "daily-fee-reminders") throw new ConnectError("routine not found", Code.NotFound);
        return pausedRoutine;
      },
      list: (req) => {
        if (req.org === "orphans") return { entries: [orphanedRoutine] };
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [pausedRoutine, disabledRoutine] };
      },
    });
    router.service(EnvironmentQueryController, {
      get: (req) => {
        if (req.value !== "env_1") throw new ConnectError("environment not found", Code.NotFound);
        return limitedEnvironment;
      },
      getByReference: (req) => {
        if (req.slug !== "data-science") throw new ConnectError("environment not found", Code.NotFound);
        return limitedEnvironment;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [limitedEnvironment] };
      },
    });
    // A server that holds several organizations, so an empty org is refused.
    router.service(PlatformQueryController, {
      getServerInfo: () => ({ singleOrg: false }),
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("get integration", () => {
  it("fetches an agent by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.agent, {
      kind: "ref",
      org: "acme",
      slug: "reviewer",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(AgentSchema, knownAgent, { useProtoFieldName: true }));
  });

  it("fetches an agent by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.agent, { kind: "id", id: "agt_1" });
    expect(JSON.parse(renderResource(AgentSchema, message, "json"))).toMatchObject({
      metadata: { id: "agt_1" },
    });
  });

  it("resolves an organization by slug through listMine", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.organization, {
      kind: "ref",
      org: "acme",
      slug: "acme",
    });
    expect(JSON.parse(renderResource(OrganizationSchema, message, "json"))).toMatchObject({
      metadata: { slug: "acme" },
    });
  });

  it("falls back to the server for an organization's earlier slug or id, which no membership's slug matches", async () => {
    for (const token of ["globex-old", "org_01jbbbbbbbbbbbbbbbbbbbbbbb"]) {
      const { message } = await fetchResource(client, ApiResourceKind.organization, {
        kind: "ref",
        org: "acme",
        slug: token,
      });
      expect(JSON.parse(renderResource(OrganizationSchema, message, "json"))).toMatchObject({
        metadata: { slug: "globex", id: "org_01jbbbbbbbbbbbbbbbbbbbbbbb" },
      });
    }
  });

  it("answers NotFound for an organization neither the memberships nor the server know", async () => {
    const err = await fetchResource(client, ApiResourceKind.organization, {
      kind: "ref",
      org: "acme",
      slug: "nobody",
    }).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.NotFound);
    expect(String(err)).toMatch(/organization "nobody" not found/);
  });

  it("answers NotFound for an organization the server refuses to show the caller", async () => {
    const err = await fetchResource(client, ApiResourceKind.organization, {
      kind: "ref",
      org: "acme",
      slug: "hidden-org",
    }).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.NotFound);
    expect(String(err)).toMatch(/organization "hidden-org" not found/);
  });

  it("reports a failed organization lookup as itself, never as not found", async () => {
    const err = await fetchResource(client, ApiResourceKind.organization, {
      kind: "ref",
      org: "acme",
      slug: "flaky-org",
    }).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Connection);
    expect(String(err)).toMatch(/backend unavailable/);
    expect(String(err)).not.toMatch(/not found/);
  });

  it("fetches a vault by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.vault, {
      kind: "ref",
      org: "acme",
      slug: "clinic-tools",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(VaultSchema, knownVault, { useProtoFieldName: true }));
  });

  it("fetches a vault by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.vault, { kind: "id", id: "vlt_1" });
    expect(JSON.parse(renderResource(VaultSchema, message, "json"))).toMatchObject({
      metadata: { id: "vlt_1" },
    });
  });

  it("fetches a channel by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.channel, {
      kind: "ref",
      org: "acme",
      slug: "clinic-patient-whatsapp",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(ChannelSchema, knownChannel, { useProtoFieldName: true }));
  });

  it("fetches a channel by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.channel, { kind: "id", id: "chn_1" });
    expect(JSON.parse(renderResource(ChannelSchema, message, "json"))).toMatchObject({
      metadata: { id: "chn_1" },
      spec: { enabled: true },
    });
  });

  it("fetches a channel app by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.channel_app, {
      kind: "ref",
      org: "acme",
      slug: "clinic-meta-app",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(ChannelAppSchema, knownChannelApp, { useProtoFieldName: true }));
  });

  it("fetches a channel app by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.channel_app, { kind: "id", id: "chapp_1" });
    expect(JSON.parse(renderResource(ChannelAppSchema, message, "json"))).toMatchObject({
      metadata: { id: "chapp_1" },
    });
  });

  it("fetches a routine by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.routine, {
      kind: "ref",
      org: "acme",
      slug: "daily-fee-reminders",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(RoutineSchema, pausedRoutine, { useProtoFieldName: true }));
  });

  it("fetches a routine by ID, exposing the pause diagnosis get exists for", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.routine, { kind: "id", id: "rtn_1" });
    // The full resource is where an operator reads WHY the platform paused
    // a routine (paused_reason + the streak) — the list table only flags it.
    expect(JSON.parse(renderResource(RoutineSchema, message, "json"))).toMatchObject({
      metadata: { id: "rtn_1" },
      spec: { enabled: true },
      status: { paused_reason: "5 consecutive failed runs", consecutive_failures: 5 },
    });
  });

  it("fetches an environment by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.environment, {
      kind: "ref",
      org: "acme",
      slug: "data-science",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(EnvironmentSchema, limitedEnvironment, { useProtoFieldName: true }));
  });

  it("maps a NotFound backend error to ExitCode.NotFound", async () => {
    const err = await fetchResource(client, ApiResourceKind.agent, { kind: "id", id: "missing" }).catch((e) => e);
    const classified = classify(err);
    expect(classified?.exitCode).toBe(ExitCode.NotFound);
  });

  it("rejects an unsupported kind with a usage error", async () => {
    // session's read verbs are narrowed out of the verb matrix
    // (stigmer/stigmer#354): the command layer refuses at the gate, and this
    // resource-layer fallback answers anyone bypassing the gate. Wiring
    // session get requires BOTH the binding and the matrix line — the
    // registry conformance test enforces the pairing.
    const err = await fetchResource(client, ApiResourceKind.session, { kind: "id", id: "x" }).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});

describe("list integration", () => {
  it("lists agents through their list RPC as JSON, every page, the organization ids as the wire carries them", async () => {
    orgGets.length = 0;
    agentListRequests.length = 0;
    const out = await listResources(client, ApiResourceKind.agent, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual(
      [knownAgent, hiddenAgent, formatterAgent].map((entry) => toJson(AgentSchema, entry, { useProtoFieldName: true })),
    );
    expect(agentListRequests).toEqual([
      { pageSize: 50, pageToken: "" },
      { pageSize: 48, pageToken: "agents-2" },
    ]);
    expect(orgGets).toEqual([]);
  });

  it("sends the --label filter on every page it reads", async () => {
    agentListRequests.length = 0;
    await listResources(client, ApiResourceKind.agent, "acme", 0, "json", { team: "support" });
    expect(agentListRequests).toEqual([
      { pageSize: 100, pageToken: "", labels: { team: "support" } },
      { pageSize: 100, pageToken: "agents-2", labels: { team: "support" } },
    ]);
  });

  it("stops reading pages once --limit is met", async () => {
    agentListRequests.length = 0;
    const out = await listResources(client, ApiResourceKind.agent, "acme", 1, "json");
    expect(JSON.parse(out)).toEqual([toJson(AgentSchema, knownAgent, { useProtoFieldName: true })]);
    expect(agentListRequests).toEqual([{ pageSize: 1, pageToken: "" }]);
  });

  it("reads every page for --limit 0", async () => {
    agentListRequests.length = 0;
    const out = await listResources(client, ApiResourceKind.agent, "acme", 0, "json");
    expect(JSON.parse(out)).toHaveLength(3);
    expect(agentListRequests).toEqual([
      { pageSize: 100, pageToken: "" },
      { pageSize: 100, pageToken: "agents-2" },
    ]);
  });

  it("lists organizations via listMine as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.organization, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(OrganizationSchema, knownOrg, { useProtoFieldName: true }),
      toJson(OrganizationSchema, secondOrg, { useProtoFieldName: true }),
    ]);
  });

  it("applies --limit to organizations", async () => {
    const out = await listResources(client, ApiResourceKind.organization, "acme", 1, "json");
    expect(JSON.parse(out)).toEqual([toJson(OrganizationSchema, knownOrg, { useProtoFieldName: true })]);
  });

  it("lists API keys via list as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.api_key, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(ApiKeySchema, knownApiKey, { useProtoFieldName: true }),
      toJson(ApiKeySchema, secondApiKey, { useProtoFieldName: true }),
    ]);
  });

  it("applies --limit to API keys", async () => {
    const out = await listResources(client, ApiResourceKind.api_key, "acme", 1, "json");
    expect(JSON.parse(out)).toEqual([toJson(ApiKeySchema, knownApiKey, { useProtoFieldName: true })]);
  });

  it("renders a human agent table, naming each organization by slug once", async () => {
    orgGets.length = 0;
    const out = await listResources(client, ApiResourceKind.agent, "acme", 50, "table");
    expect(out).toContain("NAME");
    expect(out).toContain("acme/reviewer");
    expect(out).toContain("acme/formatter");
    expect(out).not.toContain(`${ACME_ID}/reviewer`);
    // One the caller cannot see prints by the id the wire carries.
    expect(out).toContain(`${HIDDEN_ORG_ID}/linter`);
    // Two rows name acme: one lookup per distinct organization, never per row.
    expect([...orgGets].sort()).toEqual([ACME_ID, HIDDEN_ORG_ID]);
  });

  it("lists skills through their list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.skill, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(SkillSchema, knownSkill, { useProtoFieldName: true })]);
  });

  it("lists plugins through their list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.plugin, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(PluginSchema, knownPlugin, { useProtoFieldName: true })]);
  });

  it("renders a human table for plugin lists", async () => {
    const out = await listResources(client, ApiResourceKind.plugin, "acme", 50, "table");
    expect(out).toContain("NAME");
    expect(out).toContain("acme/clinic-kit");
  });

  it("lists vaults via the dedicated list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.vault, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(VaultSchema, knownVault, { useProtoFieldName: true })]);
  });

  it("renders a vault table counting entries, never showing a value", async () => {
    const out = await listResources(client, ApiResourceKind.vault, "acme", 50, "table");
    for (const header of ["ID", "SLUG", "NAME", "OWNER", "SECRETS", "LOGINS"]) {
      expect(out).toContain(header);
    }
    const row = out.split("\n").find((line) => line.includes("vlt_1"));
    expect(row).toMatch(/clinic-tools\s+Clinic tools\s+organization\s+1\s+1/);
  });

  it("lists channels via the dedicated list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.channel, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(ChannelSchema, knownChannel, { useProtoFieldName: true }),
      toJson(ChannelSchema, webChannel, { useProtoFieldName: true }),
    ]);
  });

  it("renders a human table for channels with the type and the serving signals", async () => {
    const out = await listResources(client, ApiResourceKind.channel, "acme", 50, "table");
    for (const header of ["ID", "SLUG", "AGENT", "TYPE", "STATE", "ENABLED"]) {
      expect(out).toContain(header);
    }
    expect(out).not.toContain("PROVIDER");
    expect(out).not.toContain(ACME_ID);
    const rows = out.split("\n");
    // A WhatsApp channel's STATE is its install state.
    expect(rows.find((line) => line.includes("chn_1"))).toMatch(
      /clinic-patient-whatsapp\s+acme\/clinic-assistant\s+whatsapp\s+installed\s+true/,
    );
    // A web channel's STATE is its audience, never an install state.
    expect(rows.find((line) => line.includes("ash_2"))).toMatch(
      /clinic-assistant-web\s+acme\/clinic-assistant\s+web\s+public\s+false/,
    );
  });

  it("lists channel apps via list as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.channel_app, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(ChannelAppSchema, knownChannelApp, { useProtoFieldName: true }),
      toJson(ChannelAppSchema, secondChannelApp, { useProtoFieldName: true }),
    ]);
  });

  it("renders a human table for channel apps with provider and created date", async () => {
    const out = await listResources(client, ApiResourceKind.channel_app, "acme", 50, "table");
    expect(out).toContain("PROVIDER");
    expect(out).toContain("whatsapp");
    expect(out).toContain("slack");
    expect(out).toContain("2026-07-20"); // status.audit.spec_audit.created_at
    // Secrets never reach the table (redaction markers stay in json/yaml only).
    expect(out).not.toContain("***REDACTED***");
  });

  it("applies --limit to channel apps", async () => {
    const out = await listResources(client, ApiResourceKind.channel_app, "acme", 1, "json");
    expect(JSON.parse(out)).toEqual([toJson(ChannelAppSchema, knownChannelApp, { useProtoFieldName: true })]);
  });

  it("lists routines as a table keeping the owner switch and the platform latch distinct", async () => {
    orgGets.length = 0;
    const out = await listResources(client, ApiResourceKind.routine, "acme", 50, "table");
    // Both agents name acme by id: one lookup, and the table prints the slug.
    expect(orgGets).toEqual([ACME_ID]);
    expect(out).not.toContain(ACME_ID);
    for (const header of ["ID", "SLUG", "AGENT", "CRON", "TZ", "ENABLED", "STATE"]) {
      expect(out).toContain(header);
    }
    const rows = out.split("\n");
    // The stigmer/stigmer#352 condition: enabled by the owner, paused by the
    // platform. Collapsing these into one column would hide exactly this.
    const pausedRow = rows.find((line) => line.includes("rtn_1"));
    expect(pausedRow).toContain("acme/clinic-assistant");
    expect(pausedRow).toContain("0 9 * * *");
    expect(pausedRow).toContain("Asia/Kolkata");
    expect(pausedRow).toContain("true");
    expect(pausedRow).toContain("paused");
    // Owner-disabled with an empty status: derived state is "active" (no
    // platform latch), and the absent timestamps render nothing bogus.
    const disabledRow = rows.find((line) => line.includes("rtn_2"));
    expect(disabledRow).toContain("acme/reviewer");
    expect(disabledRow).toContain("false");
    expect(disabledRow).toContain("active");
    expect(disabledRow).not.toContain("paused");
  });

  it("shows a routine whose agent was deleted as running a deleted agent, never a name", async () => {
    const out = await listResources(client, ApiResourceKind.routine, "orphans", 50, "table");
    const row = out.split("\n").find((line) => line.includes("rtn_3"));
    expect(row).toContain("deleted agent");
    expect(row).not.toContain("agt_gone");
  });

  it("lists routines as JSON matching backend protojson", async () => {
    const out = await listResources(client, ApiResourceKind.routine, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(RoutineSchema, pausedRoutine, { useProtoFieldName: true }),
      toJson(RoutineSchema, disabledRoutine, { useProtoFieldName: true }),
    ]);
  });

  it("refuses to list routines without an org context, before any RPC", async () => {
    // ListRoutinesRequest requires org (min_len 1); an unset cloud context
    // resolves to "". The branch refuses with actionable copy instead of
    // relaying the server's raw validation error.
    const err = await listResources(client, ApiResourceKind.routine, "", 50, "table").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(String(err.message)).toContain("--org");
  });

  it("lists environments as a table naming the networking and counting hosts and packages", async () => {
    const out = await listResources(client, ApiResourceKind.environment, "acme", 50, "table");
    const lines = out.split("\n");
    const header = lines.find((line) => line.includes("ID"));
    expect(header?.split(/\s+/).filter(Boolean)).toEqual(["ID", "SLUG", "NETWORK", "HOSTS", "PACKAGES"]);
    const row = lines.find((line) => line.includes("env_1"));
    expect(row?.split(/\s+/).filter(Boolean)).toEqual(["env_1", "data-science", "limited", "2", "3"]);
  });

  it("refuses to list environments without an org context, before any RPC", async () => {
    const err = await listResources(client, ApiResourceKind.environment, "", 50, "table").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(String(err.message)).toContain("stigmer list environments --org <org>");
  });

  it("rejects a kind whose list is unwired with a usage error", async () => {
    // oauth_app's read verbs are narrowed out of the verb matrix
    // (stigmer/stigmer#354): the command layer refuses at the gate, and this
    // resource-layer fallback answers anyone bypassing the gate. Wiring
    // oauth_app list requires BOTH the LIST_HANDLERS entry and the matrix
    // line — the registry conformance test enforces the pairing.
    const err = await listResources(client, ApiResourceKind.oauth_app, "acme", 50, "json").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});
