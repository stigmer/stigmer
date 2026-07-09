// In-process integration test for the read verbs (get/list).
//
// Stands up a real Connect backend over h2c serving the query controllers the
// CLI calls, points an SDK node client at it, and drives the resource layer
// (fetchResource / listResources) end to end. Asserts the rendered JSON matches
// the backend's protojson (the parity contract) and that backend RPC errors map
// to the right CLI exit code via classify().

import { create, toJson } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
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
    router.service(SearchService, {
      search: () => ({ entries: [knownSearchResult], totalCount: 1, totalPages: 1 }),
    });
    router.service(OrganizationQueryController, {
      findMyOrganizations: () => ({ entries: [knownOrg] }),
    });
    router.service(ApiKeyQueryController, {
      findAll: () => ({ entries: [knownApiKey] }),
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

  it("maps a NotFound backend error to ExitCode.NotFound", async () => {
    const err = await fetchResource(client, ApiResourceKind.agent, { kind: "id", id: "missing" }).catch((e) => e);
    const classified = classify(err);
    expect(classified?.exitCode).toBe(ExitCode.NotFound);
  });

  it("rejects an unsupported kind with a usage error", async () => {
    const err = await fetchResource(client, ApiResourceKind.environment, { kind: "id", id: "x" }).catch((e) => e);
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
});
