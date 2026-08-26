/**
 * Pins the oauthapp domain against Go's oauthapp_secrets_test.go +
 * delete_referential_integrity_test.go + refresolution_test.go — through
 * the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, the full interceptor chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (black box; these
 * need direct store access or key control):
 *   - client_secret rests as enc:v1: CIPHERTEXT in the store, never
 *     plaintext, and the marker round-trip re-persists the IDENTICAL
 *     ciphertext (no double encryption);
 *   - the keyless WARN-degrade path stores plaintext yet still redacts on
 *     read, and the enc:v<N>: shape rejection stays UNCONDITIONAL (oss#395);
 *   - the delete RPC returns the STORED secret unredacted — Go behavior
 *     ported byte-faithfully (delete is absent from RedactOAuthApp's
 *     response list) and disclosed in the PR;
 *   - the referential delete guard's resolution semantics (stigmer#584),
 *     proven by seeding McpServer rows directly through the store — the
 *     McpServer RPC surface belongs to #9 and is not required here.
 *
 * Keys are injected via env (vi.stubEnv) so the ladder short-circuits
 * before its file steps — the real ~/.stigmer is never touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppQueryController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ENCRYPTED_PREFIX } from "../../../encryption/encryption.js";
import type { Store } from "../../../store/interface.js";
import {
  CIPHERTEXT_SHAPED_SECRET_MESSAGE,
  MARKER_ON_CREATE_MESSAGE,
  REDACTED_MARKER,
  deleteBlockedByMcpServerMessage,
} from "../constants.js";
import { resolveOAuthAppRef } from "../refresolution/refresolution.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const TEST_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const API_VERSION = "iam.stigmer.ai/v1";
const KIND = "OAuthApp";
const ORG = "acme";

type CommandClient = Client<typeof OAuthAppCommandController>;
type QueryClient = Client<typeof OAuthAppQueryController>;

interface TestServer {
  server: ComposedServer;
  command: CommandClient;
  query: QueryClient;
  dir: string;
}

async function startServer(env: Record<string, string>): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "oauthapp-domain-test-"));
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  return {
    server,
    command: createClient(OAuthAppCommandController, transport),
    query: createClient(OAuthAppQueryController, transport),
    dir,
  };
}

async function stopServer(ts: TestServer): Promise<void> {
  await ts.server.shutdown();
  rmSync(ts.dir, { recursive: true, force: true });
}

let counter = 0;
function appInput(overrides?: {
  name?: string;
  org?: string;
  clientId?: string;
  clientSecret?: string;
}) {
  counter += 1;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: overrides?.name ?? `Vendor App ${counter}`,
      org: overrides?.org ?? ORG,
    },
    spec: {
      provider: "TestVendor",
      clientId: overrides?.clientId ?? "test-client-id",
      clientSecret: overrides?.clientSecret ?? "test-client-secret",
      authorizationUrl: "https://vendor.example.com/oauth/authorize",
      tokenUrl: "https://vendor.example.com/oauth/token",
      scopes: ["read"],
    },
  };
}

/** The stored (unredacted) row, read directly from the store. */
async function storedApp(store: Store, id: string) {
  return store.getResource(ApiResourceKind.oauth_app, id, OAuthAppSchema);
}

/** Seeds an McpServer row whose auth references the given (org, slug). */
async function seedReferencingMcpServer(
  store: Store,
  id: string,
  name: string,
  refOrg: string,
  refSlug: string,
): Promise<void> {
  const mcp = create(McpServerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: { id, name, org: ORG, slug: name },
    spec: {
      description: "references an OAuthApp for the delete-block pins",
      serverType: { case: "stdio", value: { command: "npx", args: ["-y", "x"] } },
      auth: {
        oauthAppRef: { org: refOrg, slug: refSlug, kind: ApiResourceKind.oauth_app },
        targetEnvVar: "VENDOR_TOKEN",
      },
    },
  });
  await store.saveResource(ApiResourceKind.mcp_server, id, McpServerSchema, mcp);
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
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

// ---------------------------------------------------------------------------
// Encryption-enabled server (the production shape).
// ---------------------------------------------------------------------------

describe("oauthapp domain (encryption enabled)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({ STIGMER_ENCRYPTION_KEY: TEST_KEY_B64 });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  it("create encrypts at rest, redacts the response, and assigns an oapp_ id", async () => {
    const created = await ts.command.create(appInput());

    expect(created.metadata?.id).toMatch(/^oapp_/);
    expect(created.spec?.clientSecret).toBe(REDACTED_MARKER);

    const stored = await storedApp(ts.server.store, created.metadata!.id);
    expect(
      stored.spec?.clientSecret.startsWith(ENCRYPTED_PREFIX),
      "the stored secret must be enc:v1: ciphertext, never plaintext",
    ).toBe(true);
    expect(stored.spec?.clientSecret).not.toContain("test-client-secret");
  });

  it("the marker round-trip on update preserves the IDENTICAL ciphertext (no double encryption)", async () => {
    const created = await ts.command.create(appInput());
    const before = (await storedApp(ts.server.store, created.metadata!.id)).spec!.clientSecret;

    const fetched = await ts.query.get({ value: created.metadata!.id });
    expect(fetched.spec?.clientSecret).toBe(REDACTED_MARKER);
    const updated = await ts.command.update(fetched);
    expect(updated.spec?.clientSecret).toBe(REDACTED_MARKER);

    const after = (await storedApp(ts.server.store, created.metadata!.id)).spec!.clientSecret;
    expect(after, "marker echo restores the stored ciphertext byte-for-byte").toBe(before);
  });

  it("update with a new plaintext secret re-encrypts to a different ciphertext", async () => {
    const created = await ts.command.create(appInput());
    const before = (await storedApp(ts.server.store, created.metadata!.id)).spec!.clientSecret;

    const fetched = await ts.query.get({ value: created.metadata!.id });
    fetched.spec!.clientSecret = "rotated-secret";
    await ts.command.update(fetched);

    const after = (await storedApp(ts.server.store, created.metadata!.id)).spec!.clientSecret;
    expect(after.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(after).not.toBe(before);
  });

  it("rejects the redaction marker on create with the pinned copy", async () => {
    const err = await grpcError(() =>
      ts.command.create(appInput({ clientSecret: REDACTED_MARKER })),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(MARKER_ON_CREATE_MESSAGE);
  });

  it("rejects ciphertext-shaped secrets on create and update (oss#395)", async () => {
    for (const smuggled of ["enc:v1:Zm9yZ2Vk", "enc:v2:ZnV0dXJl"]) {
      const err = await grpcError(() =>
        ts.command.create(appInput({ clientSecret: smuggled })),
      );
      expect(err.code).toBe(Code.InvalidArgument);
      expect(err.rawMessage).toBe(CIPHERTEXT_SHAPED_SECRET_MESSAGE);
    }

    const created = await ts.command.create(appInput());
    const fetched = await ts.query.get({ value: created.metadata!.id });
    fetched.spec!.clientSecret = "enc:v1:Zm9yZ2Vk";
    const err = await grpcError(() => ts.command.update(fetched));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(CIPHERTEXT_SHAPED_SECRET_MESSAGE);
  });

  it("get, getByReference, and listByOrg all redact", async () => {
    const created = await ts.command.create(appInput());

    const got = await ts.query.get({ value: created.metadata!.id });
    expect(got.spec?.clientSecret).toBe(REDACTED_MARKER);

    const byRef = await ts.query.getByReference({
      org: ORG,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);
    expect(byRef.spec?.clientSecret).toBe(REDACTED_MARKER);

    const listed = await ts.query.listByOrg({ org: ORG });
    expect(listed.entries.length).toBeGreaterThan(0);
    for (const entry of listed.entries) {
      expect(entry.spec?.clientSecret).toBe(REDACTED_MARKER);
    }
  });

  it("listByOrg filters by org and sorts created_at descending", async () => {
    const otherOrg = "other-org";
    const first = await ts.command.create(appInput({ org: otherOrg }));
    const second = await ts.command.create(appInput({ org: otherOrg }));

    const listed = await ts.query.listByOrg({ org: otherOrg });
    expect(listed.entries).toHaveLength(2);
    // Newest first (Go's created_at-descending comparator).
    expect(listed.entries[0]?.metadata?.id).toBe(second.metadata?.id);
    expect(listed.entries[1]?.metadata?.id).toBe(first.metadata?.id);
  });

  it("delete returns the STORED resource unredacted — the ported Go behavior (disclosed)", async () => {
    const created = await ts.command.create(appInput());
    const deleted = await ts.command.delete({ resourceId: created.metadata!.id });

    // Go's delete path never calls RedactOAuthApp: the response carries the
    // stored ciphertext (plaintext on a keyless server). Pinned so the
    // faithful port cannot silently "fix" the divergence candidate.
    expect(deleted.spec?.clientSecret.startsWith(ENCRYPTED_PREFIX)).toBe(true);

    const err = await grpcError(() => ts.query.get({ value: created.metadata!.id }));
    expect(err.code).toBe(Code.NotFound);
  });

  describe("referential delete guard (stigmer#584 resolution semantics)", () => {
    afterEach(async () => {
      // Each test seeds its own McpServer rows; sweep them so arms stay
      // independent (no shared state across tests).
      await ts.server.store.deleteResourcesByKind(ApiResourceKind.mcp_server);
    });

    it("blocks deletion while an exact (org, slug) ref resolves to the app, then frees it", async () => {
      const app = await ts.command.create(appInput());
      await seedReferencingMcpServer(
        ts.server.store,
        "mcps_01refexact",
        "ref-exact",
        ORG,
        app.metadata!.slug,
      );

      const err = await grpcError(() =>
        ts.command.delete({ resourceId: app.metadata!.id }),
      );
      expect(err.code).toBe(Code.FailedPrecondition);
      expect(err.rawMessage).toBe(
        deleteBlockedByMcpServerMessage(ORG, app.metadata!.slug, "ref-exact"),
      );

      await ts.server.store.deleteResource(ApiResourceKind.mcp_server, "mcps_01refexact");
      const deleted = await ts.command.delete({ resourceId: app.metadata!.id });
      expect(deleted.metadata?.id).toBe(app.metadata?.id);
    });

    it("blocks through the unique-slug fallback (ref pinned to a foreign org)", async () => {
      const app = await ts.command.create(appInput());
      // The seedpack posture: ref pinned to `org: stigmer`, app applied in
      // the user's own org — resolution reaches it via unique slug (#584).
      await seedReferencingMcpServer(
        ts.server.store,
        "mcps_01reffallback",
        "ref-fallback",
        "stigmer",
        app.metadata!.slug,
      );

      const err = await grpcError(() =>
        ts.command.delete({ resourceId: app.metadata!.id }),
      );
      expect(err.code).toBe(Code.FailedPrecondition);

      await ts.server.store.deleteResource(ApiResourceKind.mcp_server, "mcps_01reffallback");
      await ts.command.delete({ resourceId: app.metadata!.id });
    });

    it("does not block when the ref resolves to a DIFFERENT app (literal-match is not the rule)", async () => {
      const name = `Shared Slug ${++counter}`;
      const target = await ts.command.create(appInput({ name, org: "org-a" }));
      const other = await ts.command.create(appInput({ name, org: "org-b" }));

      // The ref names org-b explicitly: it resolves to org-b's app, so
      // deleting org-a's app (same slug) must NOT be blocked.
      await seedReferencingMcpServer(
        ts.server.store,
        "mcps_01refother",
        "ref-other",
        "org-b",
        other.metadata!.slug,
      );

      const deleted = await ts.command.delete({ resourceId: target.metadata!.id });
      expect(deleted.metadata?.id).toBe(target.metadata?.id);

      // org-b's app IS still referenced — blocked.
      const err = await grpcError(() =>
        ts.command.delete({ resourceId: other.metadata!.id }),
      );
      expect(err.code).toBe(Code.FailedPrecondition);

      await ts.server.store.deleteResource(ApiResourceKind.mcp_server, "mcps_01refother");
      await ts.command.delete({ resourceId: other.metadata!.id });
    });
  });
});

// ---------------------------------------------------------------------------
// Keyless server (the WARN-degrade posture).
// ---------------------------------------------------------------------------

describe("oauthapp domain (encryption disabled)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    // An unusable explicit key → SecretService.fromEnv throws → compose
    // degrades to the keyless pass-through service (WARN, not fatal).
    ts = await startServer({ STIGMER_ENCRYPTION_KEY: "not-valid-base64!!!" });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  it("stores plaintext, still redacts on read", async () => {
    const created = await ts.command.create(appInput());
    expect(created.spec?.clientSecret).toBe(REDACTED_MARKER);

    const stored = await storedApp(ts.server.store, created.metadata!.id);
    expect(stored.spec?.clientSecret).toBe("test-client-secret");
  });

  it("still rejects ciphertext-shaped secrets — the oss#395 boundary is not gated on key state", async () => {
    const err = await grpcError(() =>
      ts.command.create(appInput({ clientSecret: "enc:v1:c211Z2dsZWQ=" })),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(CIPHERTEXT_SHAPED_SECRET_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// refresolution — Go refresolution_test.go, direct against a store.
// ---------------------------------------------------------------------------

describe("resolveOAuthAppRef", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({ STIGMER_ENCRYPTION_KEY: TEST_KEY_B64 });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  it("an empty slug resolves to nothing (the DCR/manual-token arm)", async () => {
    const resolved = await resolveOAuthAppRef(
      ts.server.store,
      create(ApiResourceReferenceSchema, { org: ORG, slug: "" }),
      silentLogger,
    );
    expect(resolved).toBeUndefined();
  });

  it("an exact (org, slug) match wins over other slug matches", async () => {
    const name = `Resolve Exact ${++counter}`;
    await ts.command.create(appInput({ name, org: "res-org-a" }));
    const exact = await ts.command.create(appInput({ name, org: "res-org-b" }));

    const resolved = await resolveOAuthAppRef(
      ts.server.store,
      create(ApiResourceReferenceSchema, { org: "res-org-b", slug: exact.metadata!.slug }),
      silentLogger,
    );
    expect(resolved?.metadata?.id).toBe(exact.metadata?.id);
  });

  it("a UNIQUE slug-only match is honored when the ref's org does not exist here", async () => {
    const app = await ts.command.create(appInput({ org: "res-org-c" }));

    const resolved = await resolveOAuthAppRef(
      ts.server.store,
      create(ApiResourceReferenceSchema, { org: "stigmer", slug: app.metadata!.slug }),
      silentLogger,
    );
    expect(resolved?.metadata?.id).toBe(app.metadata?.id);
  });

  it("two or more slug matches with no exact hit resolve to NOTHING (ambiguity refused)", async () => {
    const name = `Resolve Ambiguous ${++counter}`;
    const a = await ts.command.create(appInput({ name, org: "res-org-d" }));
    await ts.command.create(appInput({ name, org: "res-org-e" }));

    const resolved = await resolveOAuthAppRef(
      ts.server.store,
      create(ApiResourceReferenceSchema, { org: "res-org-none", slug: a.metadata!.slug }),
      silentLogger,
    );
    expect(resolved).toBeUndefined();
  });

  it("an unknown slug resolves to nothing", async () => {
    const resolved = await resolveOAuthAppRef(
      ts.server.store,
      create(ApiResourceReferenceSchema, { org: ORG, slug: "never-created" }),
      silentLogger,
    );
    expect(resolved).toBeUndefined();
  });
});
