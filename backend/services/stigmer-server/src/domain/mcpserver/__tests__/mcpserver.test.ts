/**
 * Pins the McpServer CRUD slice against Go's mcpserver_controller_test.go
 * + validate_default_enabled_tools_test.go + enrich_oauth_status_test.go +
 * org_oauth_app_unimplemented_test.go — through the REAL stack: a composed
 * server on an ephemeral port, a native gRPC client, the full interceptor
 * chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (needs direct
 * store access or surfaces it doesn't roster): the #402 enabledtools arms
 * (capabilities only exist post-connect, which needs store seeding here),
 * the #523 oauth_status enrichment matrix (needs seeded OAuthApps), the
 * updateVisibility ordering (no conformance coverage for this domain —
 * the D4-disclosed gap), and the #558 UNIMPLEMENTED guard (unit-level in
 * Go too).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  DiscoveredCapabilitiesSchema,
  McpServerStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "McpServer";
const ORG = "acme";

type CommandClient = Client<typeof McpServerCommandController>;
type QueryClient = Client<typeof McpServerQueryController>;

let server: ComposedServer;
let command: CommandClient;
let query: QueryClient;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mcpserver-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(McpServerCommandController, transport);
  query = createClient(McpServerQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function serverInput(overrides?: {
  name?: string;
  org?: string;
  defaultEnabledTools?: string[];
  oauthAppSlug?: string;
  /** An auth block WITHOUT an oauth_app_ref — the DCR/manual-token arm. */
  dcrAuth?: boolean;
}) {
  counter += 1;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: overrides?.name ?? `Test Server ${counter}`,
      org: overrides?.org ?? ORG,
    },
    spec: {
      description: "created by the domain test",
      serverType: {
        case: "stdio" as const,
        value: { command: "npx", args: ["-y", "@example/mcp"] },
      },
      defaultEnabledTools: overrides?.defaultEnabledTools ?? [],
      ...(overrides?.oauthAppSlug !== undefined
        ? {
            auth: {
              oauthAppRef: {
                org: ORG,
                slug: overrides.oauthAppSlug,
                kind: ApiResourceKind.oauth_app,
              },
              targetEnvVar: "EXAMPLE_TOKEN",
            },
          }
        : {}),
      ...(overrides?.dcrAuth === true
        ? { auth: { targetEnvVar: "EXAMPLE_TOKEN" } }
        : {}),
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: Code, arm: string): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(
      connectError.code,
      `${arm}: expected ${Code[code]}, got ${Code[connectError.code]} (${connectError.rawMessage})`,
    ).toBe(code);
    return connectError;
  }
  throw new Error(`${arm}: expected a ${Code[code]} error, got success`);
}

/**
 * Grafts discovered capabilities onto a stored server, modeling the state
 * a connect leaves behind — the only way to reach the #402 arms before
 * #19 ports the connect slice.
 */
async function seedCapabilities(
  serverId: string,
  tools: string[],
  resourceTemplates: string[],
): Promise<void> {
  const stored = await server.store.getResource(
    ApiResourceKind.mcp_server,
    serverId,
    McpServerSchema,
  );
  const patched = fromBinary(McpServerSchema, toBinary(McpServerSchema, stored));
  patched.status ??= create(McpServerStatusSchema, {});
  patched.status.discoveredCapabilities = create(DiscoveredCapabilitiesSchema, {
    tools: tools.map((name) => ({ name })),
    resourceTemplates: resourceTemplates.map((name) => ({ name })),
  });
  await server.store.saveResource(
    ApiResourceKind.mcp_server,
    serverId,
    McpServerSchema,
    patched,
  );
}

describe("CRUD", () => {
  it("create derives identity and defaults org visibility (blueprint kind)", async () => {
    const created = await command.create(serverInput({ name: "GitHub Tools" }));
    expect(created.metadata?.id).toMatch(/^mcp_[0-9a-z]{26}$/);
    expect(created.metadata?.slug).toBe("github-tools");
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });

  it("rejects a duplicate create by slug within the org; a different org reuses the slug", async () => {
    const name = `Dup Target ${++counter}`;
    await command.create(serverInput({ name }));
    await expectCode(command.create(serverInput({ name })), Code.AlreadyExists, "duplicate create");
    const other = await command.create(serverInput({ name, org: "other-org" }));
    expect(other.metadata?.org).toBe("other-org");
  });

  it("apply branches to create then update, keeping the id stable", async () => {
    const input = serverInput();
    const created = await command.apply(input);
    const updated = await command.apply({
      ...input,
      spec: { ...input.spec, description: "changed by apply" },
    });
    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.description).toBe("changed by apply");
  });

  it("get and getByReference resolve the same resource; unknowns answer NotFound", async () => {
    const created = await command.create(serverInput());
    const byId = await query.get({ value: created.metadata!.id });
    const byRef = await query.getByReference({ org: ORG, slug: created.metadata!.slug });
    expect(byId.metadata?.id).toBe(created.metadata?.id);
    expect(byRef.metadata?.id).toBe(created.metadata?.id);
    await expectCode(query.get({ value: "mcps_missing" }), Code.NotFound, "get unknown");
    await expectCode(
      query.getByReference({ org: ORG, slug: "never-created" }),
      Code.NotFound,
      "getByReference unknown",
    );
  });

  it("delete returns the deleted server; reads answer NotFound after", async () => {
    const created = await command.create(serverInput());
    const deleted = await command.delete({ resourceId: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    await expectCode(query.get({ value: created.metadata!.id }), Code.NotFound, "get after delete");
  });

  it("update of a non-existent server and delete of a non-existent server answer NotFound; delete with an empty id is InvalidArgument", async () => {
    const ghost = create(McpServerSchema, {
      metadata: { id: "mcp_missing", name: "Ghost Server", org: ORG },
    });
    await expectCode(
      command.update(updateInput(ghost, [])),
      Code.NotFound,
      "update non-existent",
    );
    await expectCode(
      command.delete({ resourceId: "mcp_missing" }),
      Code.NotFound,
      "delete non-existent",
    );
    await expectCode(command.delete({}), Code.InvalidArgument, "delete empty id");
  });
});

describe("updateVisibility (no conformance coverage for this domain — the D4-disclosed gap)", () => {
  it("flips only metadata.visibility, stamps status_audit, and leaves spec_audit alone (#540)", async () => {
    const created = await command.create(serverInput());
    const updated = await command.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(updated.spec?.description).toBe(created.spec?.description);
    // A visibility change is a STATUS mutation: status_audit re-stamped
    // (updated event, fresh timestamp bounds are creation-or-later),
    // spec_audit byte-untouched.
    expect(updated.status?.audit?.statusAudit?.event).toBe("updated");
    expect(updated.status?.audit?.specAudit).toEqual(created.status?.audit?.specAudit);
  });

  it("answers NotFound for an unknown id", async () => {
    // NOTE: the load-before-validate ORDERING (NOT_FOUND beats level
    // validation, the cloud-parity rule) is untestable through this
    // domain — mcp_server's kind config supports EVERY visibility level,
    // so ValidateVisibilityUpdate can never fire here (same in Go). This
    // is a plain NotFound pin; the ordering is pinned by the environment
    // domain, whose kind DOES reject levels.
    await expectCode(
      command.updateVisibility({
        resourceId: "mcps_missing",
        visibility: ApiResourceVisibility.visibility_public,
      }),
      Code.NotFound,
      "unknown id",
    );
  });
});

/** A fully-typed update request for an existing server (no casts — N5). */
function updateInput(created: McpServer, defaultEnabledTools: string[]) {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      id: created.metadata!.id,
      name: created.metadata!.name,
      org: created.metadata!.org,
    },
    spec: {
      description: "updated by the domain test",
      serverType: {
        case: "stdio" as const,
        value: { command: "npx", args: ["-y", "@example/mcp"] },
      },
      defaultEnabledTools,
    },
  };
}

describe("ValidateDefaultEnabledTools (#402)", () => {
  it("accepts names the server exposes; skips when the list is empty or the server never connected", async () => {
    // Never connected: any names pass (no authoritative toolset yet).
    const fresh = await command.create(serverInput());
    const freshUpdate = await command.update(updateInput(fresh, ["anything-goes"]));
    expect(freshUpdate.spec?.defaultEnabledTools).toEqual(["anything-goes"]);

    // Connected: valid names pass.
    const connected = await command.create(serverInput());
    await seedCapabilities(connected.metadata!.id, ["search", "fetch"], []);
    const ok = await command.update(updateInput(connected, ["search"]));
    expect(ok.spec?.defaultEnabledTools).toEqual(["search"]);
  });

  it("rejects unknown tools and resource templates with the byte-pinned teaching copy", async () => {
    const created = await command.create(serverInput());
    await seedCapabilities(created.metadata!.id, ["search", "fetch"], ["files"]);

    const err = await expectCode(
      command.update(updateInput(created, ["serch", "files"])),
      Code.InvalidArgument,
      "unknown + template",
    );
    expect(err.rawMessage).toBe(
      `MCP server '${created.metadata!.slug}': default_enabled_tools names tool(s) this server does not expose: 'serch'; default_enabled_tools names resource template(s): 'files' — resource templates are read-only data endpoints, not callable tools, and must not appear in default_enabled_tools. Discovered tools: 'search', 'fetch'. If the server's toolset changed, run 'stigmer connect' on it to refresh discovered capabilities.`,
    );
  });
});

describe("EnrichOAuthStatus (#523) — response-only oauth_status", () => {
  async function seedOAuthApp(
    slug: string,
    approval: VendorApprovalStatus,
    docsUrl: string,
  ): Promise<void> {
    const id = `oaa_${slug.replaceAll("-", "")}`;
    await server.store.saveResource(
      ApiResourceKind.oauth_app,
      id,
      OAuthAppSchema,
      create(OAuthAppSchema, {
        metadata: { id, org: ORG, slug, name: slug },
        spec: { vendorApprovalStatus: approval, vendorApprovalDocsUrl: docsUrl },
      }),
    );
  }

  it("servers without an oauth_app_ref are untouched", async () => {
    const created = await command.create(serverInput());
    const got = await query.get({ value: created.metadata!.id });
    expect(got.status?.oauthStatus).toBeUndefined();
  });

  it("a missing OAuthApp skips enrichment (the initiate path owns refusing)", async () => {
    const created = await command.create(serverInput({ oauthAppSlug: "never-applied" }));
    const got = await query.get({ value: created.metadata!.id });
    expect(got.status?.oauthStatus).toBeUndefined();
  });

  it("nothing-to-report means ABSENT — presence itself is the SDK's signal", async () => {
    await seedOAuthApp("plain-app", VendorApprovalStatus.UNSPECIFIED, "");
    const created = await command.create(serverInput({ oauthAppSlug: "plain-app" }));
    const got = await query.get({ value: created.metadata!.id });
    expect(got.status?.oauthStatus).toBeUndefined();
  });

  // The two boundary arms below are the mutation killers for the presence
  // rule (UNSPECIFIED && docs==""): EITHER a gating status OR a docs URL
  // alone must enrich (Go enrich_oauth_status_test.go's docs-only and
  // status-only arms — the executable spec of the #523 shared contract).
  it("a docs URL ALONE enriches, even with an UNSPECIFIED approval status", async () => {
    await seedOAuthApp("docs-only-app", VendorApprovalStatus.UNSPECIFIED, "https://vendor.example/setup");
    const created = await command.create(serverInput({ oauthAppSlug: "docs-only-app" }));
    const got = await query.get({ value: created.metadata!.id });
    expect(got.status?.oauthStatus?.vendorApprovalStatus).toBe(VendorApprovalStatus.UNSPECIFIED);
    expect(got.status?.oauthStatus?.vendorApprovalDocsUrl).toBe("https://vendor.example/setup");
  });

  it("a non-default approval status ALONE enriches — REJECTED and even APPROVED are reported", async () => {
    await seedOAuthApp("rejected-app", VendorApprovalStatus.REJECTED, "");
    const rejected = await command.create(serverInput({ oauthAppSlug: "rejected-app" }));
    const gotRejected = await query.get({ value: rejected.metadata!.id });
    expect(gotRejected.status?.oauthStatus?.vendorApprovalStatus).toBe(VendorApprovalStatus.REJECTED);
    expect(gotRejected.status?.oauthStatus?.vendorApprovalDocsUrl).toBe("");

    await seedOAuthApp("approved-app", VendorApprovalStatus.APPROVED, "");
    const approved = await command.create(serverInput({ oauthAppSlug: "approved-app" }));
    const gotApproved = await query.get({ value: approved.metadata!.id });
    expect(gotApproved.status?.oauthStatus?.vendorApprovalStatus).toBe(VendorApprovalStatus.APPROVED);
  });

  it("an auth block WITHOUT an oauth_app_ref (the DCR arm) is untouched", async () => {
    const created = await command.create(serverInput({ dcrAuth: true }));
    const got = await query.get({ value: created.metadata!.id });
    expect(got.spec?.auth?.targetEnvVar).toBe("EXAMPLE_TOKEN");
    expect(got.status?.oauthStatus).toBeUndefined();
  });

  it("a gating approval status or docs URL enriches BOTH read paths, response-only", async () => {
    await seedOAuthApp("gated-app", VendorApprovalStatus.PENDING, "https://vendor.example/approval");
    const created = await command.create(serverInput({ oauthAppSlug: "gated-app" }));

    for (const loaded of [
      await query.get({ value: created.metadata!.id }),
      await query.getByReference({ org: ORG, slug: created.metadata!.slug }),
    ]) {
      expect(loaded.status?.oauthStatus?.vendorApprovalStatus).toBe(
        VendorApprovalStatus.PENDING,
      );
      expect(loaded.status?.oauthStatus?.vendorApprovalDocsUrl).toBe(
        "https://vendor.example/approval",
      );
    }

    // Response-only: the stored row never carries the enrichment.
    const stored = await server.store.getResource(
      ApiResourceKind.mcp_server,
      created.metadata!.id,
      McpServerSchema,
    );
    expect(stored.status?.oauthStatus).toBeUndefined();
  });
});

describe("org-OAuth-app surface — UNIMPLEMENTED by design (#558, DD-019)", () => {
  // The three RPCs are ONE capability; the SDK probes getOrgOAuthApp and
  // hides every BYOA affordance on UNIMPLEMENTED. Codes AND grpc-go's
  // generated texts are pinned — implementing any one RPC without the
  // other two + the SDK gate would resurrect dead affordances on OSS.
  it("getOrgOAuthApp / setOrgOAuthApp / deleteOrgOAuthApp answer Unimplemented with Go's text", async () => {
    const getErr = await expectCode(
      query.getOrgOAuthApp({ resourceId: "mcps_test", org: ORG }),
      Code.Unimplemented,
      "getOrgOAuthApp",
    );
    expect(getErr.rawMessage).toBe("method GetOrgOAuthApp not implemented");

    const setErr = await expectCode(
      command.setOrgOAuthApp({ resourceId: "mcps_test", org: ORG, clientId: "x", clientSecret: "y" }),
      Code.Unimplemented,
      "setOrgOAuthApp",
    );
    expect(setErr.rawMessage).toBe("method SetOrgOAuthApp not implemented");

    const deleteErr = await expectCode(
      command.deleteOrgOAuthApp({ resourceId: "mcps_test", org: ORG }),
      Code.Unimplemented,
      "deleteOrgOAuthApp",
    );
    expect(deleteErr.rawMessage).toBe("method DeleteOrgOAuthApp not implemented");
  });
});
