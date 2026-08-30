/**
 * Pins the ListReadScope seam END TO END (20260830.01.sp.list-read-scoping):
 * one composed server with a fake scope extension, probed over the wire —
 * transport → registered handler → the compose.ts driver wiring → the
 * scope. Representative lanes from each consumer family:
 *
 *   - session.list (restrict verb, no org intersection — census lane 1),
 *   - apikey.findAll (restrict verb through the direct-read tail, lane 9),
 *   - workflowexecution.list (restrict verb + the org arm: non-blank
 *     narrows, blank spans orgs — lane 6),
 *   - activity.listRecentActivity (enumeration verb, two kinds — lane 22),
 *   - search (enumeration verb feeding the engine allowlist, and the
 *     crossOrgPublic bypass where FGA is never consulted — lane 21),
 *   - the OUTAGE arm: a throwing scope answers the sanitized INTERNAL,
 *     never an empty (or full!) list.
 *
 * Per-lane logic beyond the wiring is pinned in the helper matrix
 * (list-read-scope.test.ts), the summaries suite, and the store-contract
 * allowlist arms; cross-tenant isolation with the REAL FGA driver is the
 * cloud conformance suite's outsider arms.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import type { ListReadScope } from "../list-read-scope.js";
import type { ServerExtension } from "../registry.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe("list read scope (composed server, fake scope)", () => {
  let server: ComposedServer;
  let dir: string;
  let transport: Transport;

  /**
   * The switchable fake: "keep" narrows to `allowed` (both verbs, the
   * cloud driver's shape), "throw" simulates the FGA outage. Kinds seen
   * are recorded so the enumeration-lane assertions can verify which
   * kind each consumer asked for.
   */
  let mode: "keep" | "throw" = "keep";
  let allowed: ReadonlySet<string> = new Set();
  const seenKinds: ApiResourceKind[] = [];
  const fakeScope: ListReadScope = {
    authorizedResourceIds(_caller, kind) {
      seenKinds.push(kind);
      if (mode === "throw") {
        return Promise.reject(new Error("fga unreachable"));
      }
      return Promise.resolve(allowed);
    },
    restrictListEntries(_caller, kind, entries) {
      seenKinds.push(kind);
      if (mode === "throw") {
        return Promise.reject(new Error("fga unreachable"));
      }
      return Promise.resolve(
        new Set(entries.map((e) => e.id).filter((id) => allowed.has(id))),
      );
    },
  };

  const scopeExtension: ServerExtension = {
    name: "fake-list-read-scope",
    drivers: { listReadScope: fakeScope },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "list-read-scope-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: silentLogger,
      extensions: [scopeExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });

    // Two rows per kind — one the scope will keep, one it must hide.
    // Seeded through the store: the write path is not under test.
    for (const [id, org] of [
      ["ses_mine", "acme"],
      ["ses_foreign", "acme"],
    ] as const) {
      await server.store.saveResource(
        ApiResourceKind.session,
        id,
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id, name: id, org },
          spec: { agentInstanceId: "ain_01x", subject: id },
          status: {
            audit: {
              specAudit: { createdAt: { seconds: 1_700_000_000n } },
              statusAudit: { updatedAt: { seconds: 1_700_000_000n } },
            },
          },
        }),
      );
    }
    for (const [id, org] of [
      ["wfe_mine", "acme"],
      ["wfe_other_org", "rival"],
      ["wfe_foreign", "acme"],
    ] as const) {
      await server.store.saveResource(
        ApiResourceKind.workflow_execution,
        id,
        WorkflowExecutionSchema,
        create(WorkflowExecutionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "WorkflowExecution",
          metadata: { id, name: id, org },
          status: {
            audit: {
              specAudit: { createdAt: { seconds: 1_700_000_000n } },
              statusAudit: { updatedAt: { seconds: 1_700_000_000n } },
            },
          },
        }),
      );
    }
    for (const id of ["key_mine", "key_foreign"]) {
      await server.store.saveResource(
        ApiResourceKind.api_key,
        id,
        ApiKeySchema,
        create(ApiKeySchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "ApiKey",
          metadata: { id, name: id, org: "acme" },
        }),
      );
    }
    // The search lane: resources plus their index rows (list mode).
    for (const id of ["agt_mine", "agt_foreign"]) {
      await server.store.saveResource(
        ApiResourceKind.agent,
        id,
        AgentSchema,
        create(AgentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Agent",
          metadata: { id, name: `scopedagent ${id}`, org: "acme" },
        }),
      );
      await server.store.upsertSearchIndex(ApiResourceKind.agent, id, {
        name: `scopedagent ${id}`,
        description: "",
        tags: "",
        org: "acme",
        visibility: "visibility_private",
        createdAt: 1_700_000_000,
      });
    }
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mode = "keep";
    seenKinds.length = 0;
  });

  it("session.list narrows to the scope's kept ids (org not consulted — lane 1)", async () => {
    allowed = new Set(["ses_mine"]);
    const query = createClient(SessionQueryController, transport);
    const list = await query.list({});
    expect(list.entries.map((s) => s.metadata?.id)).toEqual(["ses_mine"]);
  });

  it("apikey.findAll narrows to the scope's kept ids (lane 9)", async () => {
    allowed = new Set(["key_mine"]);
    const query = createClient(ApiKeyQueryController, transport);
    const keys = await query.findAll({});
    expect(keys.entries.map((k) => k.metadata?.id)).toEqual(["key_mine"]);
  });

  it("workflowexecution.list: non-blank org narrows AFTER the scope; blank org spans orgs (lane 6)", async () => {
    allowed = new Set(["wfe_mine", "wfe_other_org"]);
    const query = createClient(WorkflowExecutionQueryController, transport);
    const scopedToOrg = await query.list({ org: "acme" });
    expect(scopedToOrg.entries.map((e) => e.metadata?.id)).toEqual([
      "wfe_mine",
    ]);
    const acrossOrgs = await query.list({ org: "" });
    expect(acrossOrgs.entries.map((e) => e.metadata?.id).sort()).toEqual([
      "wfe_mine",
      "wfe_other_org",
    ]);
  });

  it("activity narrows both kinds through the enumeration verb (lane 22)", async () => {
    allowed = new Set(["ses_mine", "wfe_mine"]);
    const query = createClient(ActivityQueryController, transport);
    const recents = await query.listRecentActivity({ pageSize: 10 });
    expect(recents.entries.map((e) => e.id).sort()).toEqual([
      "ses_mine",
      "wfe_mine",
    ]);
    expect(seenKinds).toEqual([
      ApiResourceKind.session,
      ApiResourceKind.workflow_execution,
    ]);
  });

  it("search narrows through the engine allowlist; crossOrgPublic bypasses the scope (lane 21)", async () => {
    allowed = new Set(["agt_mine"]);
    const search = createClient(SearchService, transport);
    const scoped = await search.search({ query: "scopedagent" });
    expect(scoped.entries.map((e) => e.id)).toEqual(["agt_mine"]);

    // The Java bypass: public-widened discovery never consults FGA.
    seenKinds.length = 0;
    await search.search({
      query: "scopedagent",
      org: "acme",
      crossOrgPublic: true,
    });
    expect(seenKinds).toEqual([]);
  });

  it("a scope outage answers the sanitized INTERNAL — never an unscoped or empty success", async () => {
    mode = "throw";
    const query = createClient(SessionQueryController, transport);
    const error = await query.list({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("internal server error");
  });

  it("an empty kept set is a real, empty answer (never an error)", async () => {
    allowed = new Set();
    const query = createClient(SessionQueryController, transport);
    const list = await query.list({});
    expect(list.entries).toEqual([]);
  });
});
