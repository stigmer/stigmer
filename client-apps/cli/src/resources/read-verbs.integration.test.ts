// In-process integration test for the read verbs (get/list).
//
// Stands up a real Connect backend over h2c serving the query controllers the
// CLI calls, points an SDK node client at it, and drives the resource layer
// (fetchResource / listResources) end to end. Asserts the rendered JSON matches
// the backend's protojson (the parity contract) and that backend RPC errors map
// to the right CLI exit code via classify().

import { create, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import { fetchResource } from "./get.js";
import { listResources } from "./list.js";
import { renderResource } from "./render.js";

const knownAgent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "Reviewer", slug: "reviewer", org: "acme", id: "agt_1" },
  spec: { description: "reviews code" },
});

const knownInstance = create(AgentInstanceSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "AgentInstance",
  metadata: { name: "reviewer-default", slug: "reviewer-default", org: "acme", id: "ain_1" },
  spec: { agentId: "agt_1", description: "Default instance (auto-created, no custom configuration)" },
});

const knownOrg = create(OrganizationSchema, {
  apiVersion: "tenancy.stigmer.ai/v1",
  kind: "Organization",
  metadata: { name: "Acme", slug: "acme", org: "acme", id: "acme" },
});

const knownApiKey = create(ApiKeySchema, {
  apiVersion: "iam.stigmer.ai/v1",
  kind: "ApiKey",
  metadata: { name: "ci", org: "acme", id: "key_1" },
  spec: { fingerprint: "abcd", neverExpires: true },
});

const knownSearchResult = create(SearchResultSchema, {
  kind: ApiResourceKind.agent,
  id: "agt_1",
  name: "Reviewer",
  slug: "reviewer",
  qualifiedSlug: "acme/reviewer",
  org: "acme",
  description: "reviews code",
});

// The three T07 cutover kinds — wired into get-bindings and list alongside
// this test. environment lists via the SearchService (it is search-indexed);
// the two channel kinds list via their dedicated query RPCs.
const knownEnvironment = create(EnvironmentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Environment",
  metadata: { name: "clinic-patient-db", slug: "clinic-patient-db", org: "acme", id: "env_1" },
});

const knownEnvironmentSearchResult = create(SearchResultSchema, {
  kind: ApiResourceKind.environment,
  id: "env_1",
  name: "clinic-patient-db",
  slug: "clinic-patient-db",
  qualifiedSlug: "acme/clinic-patient-db",
  org: "acme",
  description: "clinic patient database credentials",
});

// Spec/status populated to exercise every AGENT_CHANNEL_TABLE column:
// agent_ref, the provider oneof, install_state, and enabled.
const knownChannel = create(AgentChannelSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "AgentChannel",
  metadata: { name: "clinic-patient-whatsapp", slug: "clinic-patient-whatsapp", org: "acme", id: "ach_1" },
  spec: {
    enabled: true,
    agentRef: { kind: ApiResourceKind.agent, org: "acme", slug: "clinic-assistant" },
    providerConfig: { case: "whatsapp", value: { phoneNumberId: "106540352242922" } },
  },
  status: { installState: AgentChannelInstallState.installed },
});

// Secret fields carry the redaction marker, matching what the server's
// RedactChannelApp pipeline returns on every list/get response.
const knownChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { name: "clinic-meta-app", slug: "clinic-meta-app", org: "acme", id: "chapp_1" },
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
// and the client-side --limit slice (listByOrg has no pagination).
const secondChannelApp = create(ChannelAppSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "ChannelApp",
  metadata: { name: "clinic-slack-app", slug: "clinic-slack-app", org: "acme", id: "chapp_2" },
  spec: {
    providerConfig: {
      case: "slack",
      value: { clientId: "12.34", clientSecret: "***REDACTED***", signingSecret: "***REDACTED***" },
    },
  },
});

let backend: Http2Server;
let client: Stigmer;
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
    });
    router.service(AgentInstanceQueryController, {
      get: (req) => {
        if (req.value !== "ain_1") throw new ConnectError("agent instance not found", Code.NotFound);
        return knownInstance;
      },
      getByReference: (req) => {
        if (req.slug !== "reviewer-default") throw new ConnectError("agent instance not found", Code.NotFound);
        return knownInstance;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { totalCount: 1, items: [knownInstance] };
      },
    });
    router.service(SearchService, {
      // Kind-aware: search-backed list sends a single-kind query, so the
      // environment arm proves the kind actually rode the request.
      search: (req) => {
        if (req.kinds.length === 1 && req.kinds[0] === ApiResourceKind.environment) {
          return { entries: [knownEnvironmentSearchResult], totalCount: 1, totalPages: 1 };
        }
        return { entries: [knownSearchResult], totalCount: 1, totalPages: 1 };
      },
    });
    router.service(OrganizationQueryController, {
      findMyOrganizations: () => ({ entries: [knownOrg] }),
    });
    router.service(ApiKeyQueryController, {
      findAll: () => ({ entries: [knownApiKey] }),
    });
    router.service(EnvironmentQueryController, {
      get: (req) => {
        if (req.value !== "env_1") throw new ConnectError("environment not found", Code.NotFound);
        return knownEnvironment;
      },
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-db") throw new ConnectError("environment not found", Code.NotFound);
        return knownEnvironment;
      },
    });
    router.service(AgentChannelQueryController, {
      get: (req) => {
        if (req.value !== "ach_1") throw new ConnectError("agent channel not found", Code.NotFound);
        return knownChannel;
      },
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-whatsapp") throw new ConnectError("agent channel not found", Code.NotFound);
        return knownChannel;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { totalCount: 1, items: [knownChannel] };
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
      listByOrg: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [knownChannelApp, secondChannelApp] };
      },
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

  it("fetches an agent instance by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.agent_instance, {
      kind: "ref",
      org: "acme",
      slug: "reviewer-default",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(AgentInstanceSchema, knownInstance, { useProtoFieldName: true }));
  });

  it("fetches an agent instance by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.agent_instance, { kind: "id", id: "ain_1" });
    expect(JSON.parse(renderResource(AgentInstanceSchema, message, "json"))).toMatchObject({
      metadata: { id: "ain_1" },
      spec: { agent_id: "agt_1" },
    });
  });

  it("resolves an organization by slug through findMyOrganizations", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.organization, {
      kind: "ref",
      org: "acme",
      slug: "acme",
    });
    expect(JSON.parse(renderResource(OrganizationSchema, message, "json"))).toMatchObject({
      metadata: { slug: "acme" },
    });
  });

  it("fetches an environment by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.environment, {
      kind: "ref",
      org: "acme",
      slug: "clinic-patient-db",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(EnvironmentSchema, knownEnvironment, { useProtoFieldName: true }));
  });

  it("fetches an environment by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.environment, { kind: "id", id: "env_1" });
    expect(JSON.parse(renderResource(EnvironmentSchema, message, "json"))).toMatchObject({
      metadata: { id: "env_1" },
    });
  });

  it("fetches an agent channel by org/slug and renders backend protojson", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.agent_channel, {
      kind: "ref",
      org: "acme",
      slug: "clinic-patient-whatsapp",
    });
    const rendered = JSON.parse(renderResource(schema, message, "json"));
    expect(rendered).toEqual(toJson(AgentChannelSchema, knownChannel, { useProtoFieldName: true }));
  });

  it("fetches an agent channel by ID", async () => {
    const { message } = await fetchResource(client, ApiResourceKind.agent_channel, { kind: "id", id: "ach_1" });
    expect(JSON.parse(renderResource(AgentChannelSchema, message, "json"))).toMatchObject({
      metadata: { id: "ach_1" },
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

  it("maps a NotFound backend error to ExitCode.NotFound", async () => {
    const err = await fetchResource(client, ApiResourceKind.agent, { kind: "id", id: "missing" }).catch((e) => e);
    const classified = classify(err);
    expect(classified?.exitCode).toBe(ExitCode.NotFound);
  });

  it("rejects an unsupported kind with a usage error", async () => {
    // session declares Get in the registry but has no get binding — the
    // canonical still-unwired kind (environment gained a binding).
    const err = await fetchResource(client, ApiResourceKind.session, { kind: "id", id: "x" }).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});

describe("list integration", () => {
  it("lists agents via the search service as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.agent, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(SearchResultSchema, knownSearchResult, { useProtoFieldName: true })]);
  });

  it("lists organizations via findMyOrganizations as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.organization, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(OrganizationSchema, knownOrg, { useProtoFieldName: true })]);
  });

  it("lists API keys via findAll as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.api_key, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(ApiKeySchema, knownApiKey, { useProtoFieldName: true })]);
  });

  it("renders a human table for search-backed lists", async () => {
    const out = await listResources(client, ApiResourceKind.agent, "acme", 50, "table");
    expect(out).toContain("NAME");
    expect(out).toContain("acme/reviewer");
  });

  it("lists agent instances via the dedicated list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.agent_instance, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(AgentInstanceSchema, knownInstance, { useProtoFieldName: true })]);
  });

  it("renders a human table for agent instances with their parent agent", async () => {
    const out = await listResources(client, ApiResourceKind.agent_instance, "acme", 50, "table");
    expect(out).toContain("AGENT");
    expect(out).toContain("reviewer-default");
    expect(out).toContain("agt_1");
  });

  it("lists environments via the search service as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.environment, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(SearchResultSchema, knownEnvironmentSearchResult, { useProtoFieldName: true }),
    ]);
  });

  it("renders a human table for environment lists", async () => {
    const out = await listResources(client, ApiResourceKind.environment, "acme", 50, "table");
    expect(out).toContain("NAME");
    expect(out).toContain("acme/clinic-patient-db");
  });

  it("lists agent channels via the dedicated list RPC as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.agent_channel, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([toJson(AgentChannelSchema, knownChannel, { useProtoFieldName: true })]);
  });

  it("renders a human table for agent channels with the serving signals", async () => {
    const out = await listResources(client, ApiResourceKind.agent_channel, "acme", 50, "table");
    expect(out).toContain("PROVIDER");
    expect(out).toContain("STATE");
    expect(out).toContain("ENABLED");
    expect(out).toContain("acme/clinic-assistant"); // agent_ref as org/slug
    expect(out).toContain("whatsapp"); // derived from the provider oneof
    expect(out).toContain("installed"); // status.install_state
    expect(out).toContain("true"); // spec.enabled
  });

  it("lists channel apps via listByOrg as JSON", async () => {
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

  it("applies --limit client-side for channel apps (listByOrg has no pagination)", async () => {
    const out = await listResources(client, ApiResourceKind.channel_app, "acme", 1, "json");
    expect(JSON.parse(out)).toEqual([toJson(ChannelAppSchema, knownChannelApp, { useProtoFieldName: true })]);
  });

  it("rejects a kind whose list is unwired with a usage error", async () => {
    // agent_share declares List in the registry but has no list branch —
    // the canonical still-unwired list kind (the three cutover kinds and
    // environment gained branches).
    const err = await listResources(client, ApiResourceKind.agent_share, "acme", 50, "json").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});
