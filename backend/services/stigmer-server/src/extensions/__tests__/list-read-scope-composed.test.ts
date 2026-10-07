/**
 * Pins the ListReadScope seam END TO END:
 * one composed server with a fake scope extension, probed over the wire —
 * transport → registered handler → the compose.ts driver wiring → the
 * scope. Representative lanes from each consumer family:
 *
 *   - session.list (restrict verb, no org intersection),
 *   - apikey.findAll (restrict verb through the direct-read tail),
 *   - channelapp.listByOrg (restrict verb behind the domain's own org
 *     predicate: the scope is offered the request org's rows only, the
 *     listByOrg family's shape; stigmer/stigmer#1384),
 *   - activity.listRecentActivity (the sessions it summarizes),
 *   - search (enumeration verb feeding the engine allowlist, and the
 *     proof that no request shape bypasses it),
 *   - the OUTAGE arm: a throwing scope answers the sanitized INTERNAL,
 *     never an empty (or full!) list;
 *   - the SERVER'S OWN reads over `inProcessTransport` (stigmer#1207):
 *     the bare in-process call is stamped `internal` and the helper
 *     answers it before the scope — agentexecution.listBySession (the
 *     lane every server-internal reader of a session's turns rides); a caller
 *     PROPAGATED through the in-process header keeps its class and is
 *     narrowed exactly like the wire.
 *
 * Per-lane logic beyond the wiring is pinned in the helper matrix
 * (list-read-scope.postgres.test.ts), the summaries suite, and the store-contract
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
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { testCallerIdentity } from "../../pipeline/__tests__/support.js";
import {
  IN_PROCESS_CALLER_HEADER,
  encodeInProcessCaller,
} from "../../pipeline/interceptors/auth.js";
import type { ListReadScope } from "../list-read-scope.js";
import type { ServerExtension } from "../registry.js";
import {
  organizationId,
  seedOrganizations,
} from "../../domain/organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/**
 * Another organization's id, never created on this server: rows filed
 * under it are the "other org" every lane must keep out of acme's answers.
 * Stored rows name their organization by id, so this is id-shaped too.
 */
const RIVAL_ORG_ID = "org_01hzzzzzzzzzzzzzzzzzzzzzzz";

describe("list read scope (composed server, fake scope)", () => {
  let server: ComposedServer;
  let dir: string;
  let transport: Transport;
  /**
   * acme's minted id. Rows written straight to the store and in-process
   * requests carry it; requests over the port name acme by slug, which the
   * serving chain resolves.
   */
  let acmeId: string;

  /**
   * The switchable fake: "keep" narrows to `allowed` (both verbs, the
   * cloud driver's shape), "throw" simulates the FGA outage. Kinds seen
   * are recorded so the enumeration-lane assertions can verify which
   * kind each consumer asked for, and the ids each restrict call was
   * offered so a lane can show which rows reached the scope.
   */
  let mode: "keep" | "throw" = "keep";
  let allowed: ReadonlySet<string> = new Set();
  const seenKinds: ApiResourceKind[] = [];
  const offeredIds: string[][] = [];
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
      offeredIds.push(entries.map((e) => e.id));
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
    acmeId = organizationId(
      await seedOrganizations(transport, ["acme"]),
      "acme",
    );

    // Two rows per kind — one the scope will keep, one it must hide.
    // Seeded through the store: the write path is not under test.
    for (const [id, org] of [
      ["ses_mine", acmeId],
      ["ses_foreign", acmeId],
    ]) {
      await server.store.saveResource(
        ApiResourceKind.session,
        id,
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id, name: id, org },
          spec: { subject: id },
          status: {
            audit: {
              specAudit: { createdAt: { seconds: 1_700_000_000n } },
              statusAudit: { updatedAt: { seconds: 1_700_000_000n } },
            },
          },
        }),
      );
    }
    // Two turns of one session — the rows a server-internal reader of a
    // conversation's executions asks listBySession for.
    for (const id of ["aex_turn_1", "aex_turn_2"]) {
      await server.store.saveResource(
        ApiResourceKind.run,
        id,
        RunSchema,
        create(RunSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Run",
          metadata: { id, name: id, org: acmeId },
          spec: { target: { case: "sessionId", value: "ses_mine" } },
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
          metadata: { id, name: id, org: acmeId },
        }),
      );
    }
    for (const [id, org] of [
      ["chap_mine", acmeId],
      ["chap_foreign", acmeId],
      ["chap_other_org", RIVAL_ORG_ID],
    ]) {
      await server.store.saveResource(
        ApiResourceKind.channel_app,
        id,
        ChannelAppSchema,
        create(ChannelAppSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "ChannelApp",
          metadata: { id, name: id, org },
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
          metadata: { id, name: `scopedagent ${id}`, org: acmeId },
        }),
      );
      await server.store.upsertSearchIndex(ApiResourceKind.agent, id, {
        name: `scopedagent ${id}`,
        description: "",
        tags: "",
        org: acmeId,
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
    offeredIds.length = 0;
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

  it("channelapp.listByOrg narrows the request org's apps to the scope's kept ids; no other org's app is offered (stigmer/stigmer#1384)", async () => {
    // Allowing the other org's app too proves the org predicate is the
    // domain's own, applied before the scope ever sees a row.
    allowed = new Set(["chap_mine", "chap_other_org"]);
    const query = createClient(ChannelAppQueryController, transport);
    const list = await query.listByOrg({ org: "acme" });
    expect(list.entries.map((a) => a.metadata?.id)).toEqual(["chap_mine"]);
    expect(seenKinds).toEqual([ApiResourceKind.channel_app]);
    expect(offeredIds.map((ids) => [...ids].sort())).toEqual([
      ["chap_foreign", "chap_mine"],
    ]);
  });

  it("activity narrows its sessions through the scope (lane 22)", async () => {
    allowed = new Set(["ses_mine"]);
    const query = createClient(ActivityQueryController, transport);
    const recents = await query.listRecentActivity({ pageSize: 10 });
    expect(recents.entries.map((e) => e.id)).toEqual(["ses_mine"]);
    expect(seenKinds).toEqual([ApiResourceKind.session]);
  });

  it("search narrows through the engine allowlist on every request shape — nothing bypasses the scope (lane 21)", async () => {
    allowed = new Set(["agt_mine"]);
    const search = createClient(SearchService, transport);
    const scoped = await search.search({ query: "scopedagent" });
    expect(scoped.entries.map((e) => e.id)).toEqual(["agt_mine"]);

    // The org-filtered shape asks the scope too: the one request shape
    // that once skipped it (the retired public level's cross-organization
    // discovery) no longer exists on the wire.
    seenKinds.length = 0;
    const orgScoped = await search.search({
      kinds: [ApiResourceKind.agent],
      query: "scopedagent",
      org: "acme",
    });
    expect(orgScoped.entries.map((e) => e.id)).toEqual(["agt_mine"]);
    expect(seenKinds).toEqual([ApiResourceKind.agent]);
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

  describe("the server's own reads over the in-process transport (stigmer#1207)", () => {
    it("agentexecution.listBySession, bare: every turn of the session, the scope never asked", async () => {
      // The scope would hide everything if it were asked.
      allowed = new Set();
      const query = createClient(
        RunQueryController,
        server.inProcessTransport,
      );
      const turns = await query.listBySession({ sessionId: "ses_mine" });
      expect(turns.entries.map((e) => e.metadata?.id).sort()).toEqual([
        "aex_turn_1",
        "aex_turn_2",
      ]);
      expect(seenKinds).toEqual([]);
    });

    it("a caller propagated through the in-process header keeps its class and is narrowed like the wire", async () => {
      allowed = new Set(["aex_turn_2"]);
      const query = createClient(
        RunQueryController,
        server.inProcessTransport,
      );
      const turns = await query.listBySession(
        { sessionId: "ses_mine" },
        {
          headers: {
            [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(
              testCallerIdentity({ identityId: "alice" }),
            ),
          },
        },
      );
      expect(turns.entries.map((e) => e.metadata?.id)).toEqual(["aex_turn_2"]);
      expect(seenKinds).toEqual([ApiResourceKind.run]);
    });
  });
});
