/**
 * Composed-server tests for the two query services (D4 #14): the arms
 * conformance cannot cover on local plus the wiring proofs —
 * search/activity ANSWER on the composed server (stigmer#461: OSS
 * historically returned UNIMPLEMENTED for activity), synchronous
 * index-on-write feeds search over the wire, the protovalidate
 * interceptor answers the two InvalidArgument arms, and BOOT-TIME
 * RebuildIndex makes pre-existing rows — including a project row on an
 * adopted database, whose domain is not yet ported (#16) — searchable
 * with zero pipeline writes (DD-D/DD-F).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { SqliteStore } from "../../store/sqlite/store.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});

function bootServer(dir: string): Promise<ComposedServer> {
  return composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never
      // touch a live local Temporal.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
}

async function grpcError(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to reject");
}

describe("query services on the composed server", () => {
  let dir: string;
  let server: ComposedServer;
  let search: Client<typeof SearchService>;
  let activity: Client<typeof ActivityQueryController>;
  let organizations: Client<typeof OrganizationCommandController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "query-services-test-"));
    server = await bootServer(dir);
    const port = await server.start();
    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    search = createClient(SearchService, transport);
    activity = createClient(ActivityQueryController, transport);
    organizations = createClient(OrganizationCommandController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves synchronous index-on-write through list and query modes", async () => {
    await organizations.create(
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: "searchwired", name: "Search Wired", slug: "searchwired" },
        spec: { description: "a uniquely zebrawire description" },
      }),
    );

    // List mode: created_at ordering, score pinned 1.0, counts by kind.
    const listed = await search.search({
      kinds: [ApiResourceKind.organization],
    });
    const listedIds = listed.entries.map((entry) => entry.id);
    expect(listedIds).toContain("searchwired");
    expect(listed.countsByKind.organization).toBeGreaterThanOrEqual(1);
    for (const entry of listed.entries) {
      expect(entry.score).toBe(1);
    }

    // Query mode: the unique description token matches with a positive
    // relevance score (membership only — never pinned engine ranking values).
    const queried = await search.search({
      kinds: [ApiResourceKind.organization],
      query: "zebrawire",
    });
    expect(queried.entries.map((entry) => entry.id)).toEqual(["searchwired"]);
    expect(queried.entries[0]?.score).toBeGreaterThan(0);
  });

  it("answers the two validation arms via the protovalidate interceptor (codes only, P2)", async () => {
    const overLength = await grpcError(
      search.search({ query: "x".repeat(501) }),
    );
    expect(overLength.code).toBe(Code.InvalidArgument);

    const badOrg = await grpcError(search.search({ org: "NotASlug" }));
    expect(badOrg.code).toBe(Code.InvalidArgument);
  });

  it("activity ANSWERS on OSS (stigmer#461 — never UNIMPLEMENTED) with an empty page on an empty store", async () => {
    const response = await activity.listRecentActivity({ pageSize: 10 });
    expect(response.entries).toEqual([]);
  });
});

describe("boot-time RebuildIndex (DD-D/DD-F)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "query-rebuild-test-"));
    // Pre-seed the database DIRECTLY — resource rows only, no index
    // writes — the adopted-database shape: rows exist, the FTS index
    // knows nothing about them. The project row's domain is not even
    // ported yet (#16 in flight); only the boot rebuild through the
    // 13-kind registry can make it searchable.
    const dbPath = path.join(dir, "stigmer.db");
    const seedStore = SqliteStore.open(dbPath);
    await seedStore.saveResource(
      ApiResourceKind.organization,
      "preboot",
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: "preboot", name: "Preboot Org", slug: "preboot" },
        spec: { description: "seeded before boot" },
      }),
    );
    await seedStore.saveResource(
      ApiResourceKind.project,
      "prj_adopted",
      ProjectSchema,
      create(ProjectSchema, {
        metadata: {
          id: "prj_adopted",
          name: "adopted-project",
          slug: "adopted-project",
          org: "preboot",
        },
        spec: { description: "a project from the Go era" },
        status: {
          audit: { specAudit: { createdAt: { seconds: 1_700_000_000n } } },
        },
      }),
    );
    await seedStore.close();

    server = await bootServer(dir);
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes pre-existing rows searchable the moment the port answers", async () => {
    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    const search = createClient(SearchService, transport);

    const orgs = await search.search({
      kinds: [ApiResourceKind.organization],
    });
    expect(orgs.entries.map((entry) => entry.id)).toContain("preboot");

    const projects = await search.search({
      kinds: [ApiResourceKind.project],
      org: "preboot",
    });
    expect(projects.entries.map((entry) => entry.id)).toEqual(["prj_adopted"]);
    expect(projects.entries[0]?.description).toBe("a project from the Go era");
  });
});
