// In-process test for the read surface: search, run
// get/list, session list, and usage reports.
//
// Stands up a real Connect backend over h2c serving the controllers these paths
// call, points an SDK node client at it, and drives the resource layer end to
// end. Asserts the SDK wiring (request shapes, RPC routing) and the protojson
// parity contract for json output. Search results and a session's agent
// reference carry their organization by id; the human table names it by slug,
// and a session that names no agent shows the built-in assistant.

import { create, toJson } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { GetSessionUsageReportOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { BUILT_IN_ASSISTANT_NAME, type Stigmer } from "@stigmer/sdk";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../../errors/index.js";
import { getRun, listAgentRuns, renderRunList } from "../runs.js";
import { listResources } from "../list.js";
import { renderResource } from "../render.js";
import { searchResources } from "../search.js";
import { getSessionUsageReport, renderSessionUsage } from "../usage.js";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const knownExec = create(RunSchema, {
  metadata: { id: "aex_1", org: "acme" },
  status: { agentId: "agt_1", phase: RunPhase.RUN_COMPLETED, startedAt: "2026-03-01T10:00:00Z" },
});

const knownSession = create(SessionSchema, {
  metadata: { id: "ses_1", org: "acme" },
  spec: {
    agentRef: { kind: ApiResourceKind.agent, org: ACME_ID, slug: "helper" },
    subject: "Fix the build",
  },
  status: { agentId: "agt_1", agentVersionHash: "a".repeat(64) },
});

// A conversation with the built-in assistant: no reference and no pin.
const assistantSession = create(SessionSchema, {
  metadata: { id: "ses_2", org: "acme" },
  spec: { subject: "Plan the week" },
});

const knownSearchResult = create(SearchResultSchema, {
  kind: ApiResourceKind.agent,
  id: "agt_1",
  name: "Reviewer",
  slug: "reviewer",
  qualifiedSlug: `${ACME_ID}/reviewer`,
  org: ACME_ID,
  description: "reviews things",
});

const knownUsage = create(GetSessionUsageReportOutputSchema, {
  sessionId: "ses_1",
  runCount: 1,
  modelBreakdown: [{ model: "claude-sonnet-4", inputTokens: 1000n, outputTokens: 100n, billableCostMicros: 500000n }],
});

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(RunQueryController, {
      get: (req) => {
        if (req.value !== "aex_1") throw new ConnectError("execution not found", Code.NotFound);
        return knownExec;
      },
      list: () => ({ totalPages: 1, entries: [knownExec] }),
      getSessionUsageReport: (req) => {
        if (req.sessionId !== "ses_1") throw new ConnectError("session not found", Code.NotFound);
        return knownUsage;
      },
    });
    router.service(SessionQueryController, {
      list: () => ({ totalPages: 1, entries: [knownSession, assistantSession] }),
    });
    router.service(SearchService, {
      search: () => ({ entries: [knownSearchResult], totalCount: 1, totalPages: 1 }),
    });
    router.service(OrganizationQueryController, {
      get: (req) => {
        if (req.value !== ACME_ID) throw new ConnectError("organization not found", Code.NotFound);
        return create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } });
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

describe("search integration", () => {
  it("queries the SearchService and renders entries as protojson", async () => {
    const outcome = await searchResources(client, ApiResourceKind.agent, "review", {
      org: "acme",
      page: 1,
      pageSize: 20,
    }, "json");
    expect(JSON.parse(outcome.rendered)).toEqual([
      toJson(SearchResultSchema, knownSearchResult, { useProtoFieldName: true }),
    ]);
    expect(outcome.totalPages).toBe(1);
  });

  it("renders a human table for search results, naming the organization by slug", async () => {
    const outcome = await searchResources(client, ApiResourceKind.agent, "review", {
      org: "acme",
      page: 1,
      pageSize: 20,
    }, "table");
    expect(outcome.rendered).toContain("acme/reviewer");
    expect(outcome.rendered).not.toContain(ACME_ID);
  });
});

describe("run integration", () => {
  it("gets an agent run by ID and renders backend protojson", async () => {
    const { schema, message } = await getRun(client, "aex_1");
    expect(JSON.parse(renderResource(schema, message, "json"))).toEqual(
      toJson(RunSchema, knownExec, { useProtoFieldName: true }),
    );
  });

  it("maps a NotFound run to ExitCode.NotFound", async () => {
    const err = await getRun(client, "aex_missing").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.NotFound);
  });

  it("lists agent runs as protojson envelope", async () => {
    const result = await listAgentRuns(client, 50);
    const json = JSON.parse(renderRunList(result, "json"));
    expect(json.entries[0].metadata.id).toBe("aex_1");
  });
});

// Session list runs through the same registry dispatch as every other kind
// (LIST_HANDLERS; promoted from a bespoke route by stigmer/stigmer#469).
describe("session integration", () => {
  it("lists sessions through the registry dispatch as a human table", async () => {
    const rendered = await listResources(client, ApiResourceKind.session, "", 50, "table");
    expect(rendered).toContain("SESSION ID");
    expect(rendered).toContain("ses_1");
    expect(rendered).toContain("Fix the build");
  });

  it("names each session's agent by org slug and slug, or the built-in assistant", async () => {
    const rendered = await listResources(client, ApiResourceKind.session, "", 50, "table");
    const lines = rendered.split("\n");
    expect(lines.find((line) => line.includes("ses_1"))).toContain("acme/helper");
    expect(lines.find((line) => line.includes("ses_2"))).toContain(BUILT_IN_ASSISTANT_NAME);
    expect(rendered).not.toContain(ACME_ID);
  });

  it("renders session list json as the entries array every list kind shares", async () => {
    const rendered = await listResources(client, ApiResourceKind.session, "", 50, "json");
    const json = JSON.parse(rendered);
    expect(json).toEqual([
      toJson(SessionSchema, knownSession, { useProtoFieldName: true }),
      toJson(SessionSchema, assistantSession, { useProtoFieldName: true }),
    ]);
  });
});

describe("usage integration", () => {
  it("fetches a session usage report and renders the table", async () => {
    const report = await getSessionUsageReport(client, "ses_1");
    expect(renderSessionUsage(report, "table")).toContain("Session: ses_1");
  });
});
