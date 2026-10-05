/**
 * Pins the organization domain against Go's
 * organization_controller_test.go — through the REAL stack: a composed
 * server on an ephemeral port, a native gRPC client, the full interceptor
 * chain (incl. apiresource kind injection and protovalidate).
 *
 * The load-bearing pins the conformance suite does NOT cover (its
 * negatives are NF/UI/IA only):
 *   - an organization's id is minted (org_<ulid>) and its slug is its
 *     name, never its id;
 *   - a duplicate slug is refused globally, and a create that names an
 *     organization of its own (a non-empty metadata.org) is refused, since
 *     an organization belongs to none;
 *   - the byte-pinned AlreadyExists copy.
 *
 * Child organizations are pinned beside it, in children.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof OrganizationCommandController>;
let query: Client<typeof OrganizationQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "org-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  command = createClient(OrganizationCommandController, transport);
  query = createClient(OrganizationQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Organization";

function orgInput(name: string, extras?: { org?: string; slug?: string }) {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name, org: extras?.org ?? "", slug: extras?.slug ?? "" },
    spec: { description: "created by the domain test" },
  };
}

async function grpcCode(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

describe("organization create (minted id, slug as name)", () => {
  it("mints an org_ id distinct from the derived slug and stamps the created audit", async () => {
    const created = await command.create(orgInput("Alpha Corp"));
    expect(created.metadata?.id).toMatch(/^org_[0-9a-z]{26}$/);
    expect(created.metadata?.slug).toBe("alpha-corp");
    expect(created.metadata?.org).toBe("");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe("system");
  });

  it("rejects a duplicate slug globally", async () => {
    await command.create(orgInput("Dup Target"));

    const error = await grpcCode(() => command.create(orgInput("Dup Target")));
    expect(error.code).toBe(Code.AlreadyExists);
    expect(error.rawMessage).toBe(
      "Organization already exists: slug 'dup-target'",
    );
  });

  it("refuses a create that names an organization of its own", async () => {
    // An organization belongs to no organization, so a non-empty
    // metadata.org is bad input rather than a second scope to check.
    const error = await grpcCode(() =>
      command.create(orgInput("Owned Org", { org: "some-other-org" })),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "an organization belongs to no organization: metadata.org must be empty",
    );
  });

  it("rejects an invalid (uppercase) slug at the protovalidate boundary", async () => {
    const error = await grpcCode(() =>
      command.create(orgInput("Bad Slug Org", { slug: "BadSlug" })),
    );
    expect(error.code).toBe(Code.InvalidArgument);
  });
});

describe("organization apply / update", () => {
  it("apply creates, then updates on the second call with the same name", async () => {
    const first = await command.apply(orgInput("Apply Target"));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await command.apply({
      ...orgInput("Apply Target"),
      spec: { description: "updated by apply" },
    });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("updated by apply");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update preserves id and slug under an attempted slug change, allows rename", async () => {
    const created = await command.create(orgInput("Rename Me"));
    const updated = await command.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: {
        id: created.metadata!.id,
        name: "Renamed",
        slug: "attempted-different-slug",
      },
    });
    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.metadata?.slug).toBe(created.metadata?.slug);
    expect(updated.metadata?.name).toBe("Renamed");
  });
});

describe("organization query surface", () => {
  it("get returns the resource; delete returns it and makes get NotFound", async () => {
    const created = await command.create(orgInput("Ephemeral"));
    const id = created.metadata!.id;

    const fetched = await query.get({ value: id });
    expect(fetched.metadata?.id).toBe(id);

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    const error = await grpcCode(() => query.get({ value: id }));
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`Organization not found: ${id}`);
  });

  it("find paginates with totalPages; findMyOrganizations returns everything (no IAM filter)", async () => {
    const all = await query.find({ org: "conformance", pageSize: 100 });
    const mine = await query.findMyOrganizations({});
    expect(mine.entries.length).toBe(all.entries.length);

    const page = await query.find({ org: "conformance", pageSize: 2 });
    expect(page.entries.length).toBeLessThanOrEqual(2);
    expect(page.totalPages).toBe(Math.ceil(all.entries.length / 2));
  });

});
