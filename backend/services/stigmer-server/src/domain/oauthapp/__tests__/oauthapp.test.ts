/**
 * Pins the oauthapp domain against Go's oauthapp_secrets_test.go, and the
 * addresses an app signs in to — through the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, the full interceptor chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (black box; these
 * need direct store access or key control):
 *   - client_secret rests as enc:v1: CIPHERTEXT in the store, never
 *     plaintext, and the marker round-trip re-persists the IDENTICAL
 *     ciphertext (no double encryption);
 *   - the keyless WARN-degrade path stores plaintext yet still redacts on
 *     read, and the enc:v<N>: shape rejection stays UNCONDITIONAL (oss#395);
 *   - the delete RPC answers the removed app REDACTED, never the stored
 *     secret: not the ciphertext on a keyed server, not the plaintext on
 *     a keyless one (stigmer/stigmer#1257; the Go port returned it);
 *   - an app's addresses are normalized and each belongs to one app per
 *     organization: create and update claim theirs, an update lets go of
 *     the ones it drops, delete lets go of all, and an abandoned claim is
 *     freed once a minute old; a sign-in finds the app by its address.
 *
 * Keys are injected via env (vi.stubEnv) so the ladder short-circuits
 * before its file steps — the real ~/.stigmer is never touched. Who may
 * read or list an app is the enforcing lane's conformance suite's
 * (role-enforcement.conformance.test.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
} from "../constants.js";
import { findOrganizationApp, oauthAppAddressKey } from "../../vault/login-app.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import type { OrganizationIds } from "../../organization/__tests__/support.js";

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
  /**
   * The id this server minted for each seeded organization: a row written
   * straight to the store and a stored reference name an organization by
   * id, while a request may name it by slug.
   */
  orgIds: OrganizationIds;
}

async function startServer(env: Record<string, string>): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "oauthapp-domain-test-"));
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const server = await composeServer({
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
  const orgIds = await seedOrganizations(transport, [ORG, "other-org", "org-a", "org-b"]);
  return {
    server,
    command: createClient(OAuthAppCommandController, transport),
    query: createClient(OAuthAppQueryController, transport),
    dir,
    orgIds,
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
  addresses?: string[];
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
      addresses: overrides?.addresses ?? [`https://mcp${counter}.vendor.example/mcp`],
    },
  };
}

/** The stored (unredacted) row, read directly from the store. */
async function storedApp(store: Store, id: string) {
  return store.getResource(ApiResourceKind.oauth_app, id, OAuthAppSchema);
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

  it("delete answers the removed app redacted — never the stored ciphertext", async () => {
    const created = await ts.command.create(appInput());
    const deleted = await ts.command.delete({ resourceId: created.metadata!.id });

    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    expect(deleted.spec?.clientSecret).toBe(REDACTED_MARKER);

    const err = await grpcError(() => ts.query.get({ value: created.metadata!.id }));
    expect(err.code).toBe(Code.NotFound);
  });

  describe("addresses: one login app per address in an organization", () => {
    const orgId = () => organizationId(ts.orgIds, ORG);

    it("normalizes the addresses on create, and a sign-in finds the app by any of them", async () => {
      const app = await ts.command.create(appInput({ addresses: ["HTTPS://MCP.Slack.example:443/mcp/", "GitHub.com"] }));
      expect(app.spec?.addresses).toEqual(["https://mcp.slack.example/mcp", "github.com"]);
      const found = await findOrganizationApp(ts.server.store, orgId(), "github.com");
      expect(found?.metadata?.id).toBe(app.metadata?.id);
      await ts.command.delete({ resourceId: app.metadata!.id });
    });

    it("refuses an address another app of the organization holds, and takes it in another organization", async () => {
      const address = `https://mcp-taken-${++counter}.example/mcp`;
      const first = await ts.command.create(appInput({ addresses: [address] }));
      const err = await grpcError(() => ts.command.create(appInput({ addresses: [address] })));
      expect(err.code).toBe(Code.AlreadyExists);
      expect(err.rawMessage).toContain(`the address ${address} already belongs to another login app in this organization`);
      const elsewhere = await ts.command.create(appInput({ org: "other-org", addresses: [address] }));
      expect(elsewhere.spec?.addresses).toEqual([address]);
      await ts.command.delete({ resourceId: first.metadata!.id });
      await ts.command.delete({ resourceId: elsewhere.metadata!.id });
    });

    it("refuses a value that is no address, and two that normalize to one, naming the rule", async () => {
      const bad = await grpcError(() => ts.command.create(appInput({ addresses: ["not an address"] })));
      expect(bad.code).toBe(Code.InvalidArgument);
      expect(bad.rawMessage).toContain("spec.addresses[0]: the value given is not an address");
      const twice = await grpcError(() =>
        ts.command.create(appInput({ addresses: ["https://twice.example/mcp", "https://TWICE.example/mcp/"] })),
      );
      expect(twice.code).toBe(Code.InvalidArgument);
      expect(twice.rawMessage).toContain("spec.addresses[1] is the same address as an earlier one once normalized");
    });

    it("an update claims what it adds and lets go of what it drops; delete lets go of all", async () => {
      const kept = `https://kept-${++counter}.example/mcp`;
      const dropped = `https://dropped-${counter}.example/mcp`;
      const added = `https://added-${counter}.example/mcp`;
      const app = await ts.command.create(appInput({ addresses: [kept, dropped] }));
      const updated = await ts.command.update({ ...app, spec: { ...app.spec!, addresses: [kept, added] } });
      expect(updated.spec?.addresses).toEqual([kept, added]);
      expect(await findOrganizationApp(ts.server.store, orgId(), dropped)).toBeUndefined();
      expect((await findOrganizationApp(ts.server.store, orgId(), added))?.metadata?.id).toBe(app.metadata?.id);

      const takesDropped = await ts.command.create(appInput({ addresses: [dropped] }));
      await ts.command.delete({ resourceId: app.metadata!.id });
      expect(await findOrganizationApp(ts.server.store, orgId(), kept)).toBeUndefined();
      const takesKept = await ts.command.create(appInput({ addresses: [kept] }));
      await ts.command.delete({ resourceId: takesDropped.metadata!.id });
      await ts.command.delete({ resourceId: takesKept.metadata!.id });
    });

    it("frees a claim whose holder never stored the address once it is a minute old, and not before", async () => {
      const address = `https://abandoned-${++counter}.example/mcp`;
      const key = oauthAppAddressKey(orgId(), address);
      await ts.server.store.resourceNames.claim(key, "oap_never_stored", new Date().toISOString());
      const young = await grpcError(() => ts.command.create(appInput({ addresses: [address] })));
      expect(young.code).toBe(Code.AlreadyExists);

      await ts.server.store.resourceNames.releaseName(key, "oap_never_stored");
      await ts.server.store.resourceNames.claim(key, "oap_never_stored", new Date(Date.now() - 120_000).toISOString());
      const app = await ts.command.create(appInput({ addresses: [address] }));
      expect((await findOrganizationApp(ts.server.store, orgId(), address))?.metadata?.id).toBe(app.metadata?.id);
      await ts.command.delete({ resourceId: app.metadata!.id });
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

  it("delete answers the removed app redacted — never the stored plaintext", async () => {
    const created = await ts.command.create(appInput());
    const deleted = await ts.command.delete({ resourceId: created.metadata!.id });

    expect(deleted.spec?.clientSecret).toBe(REDACTED_MARKER);
  });

  it("still rejects ciphertext-shaped secrets — the oss#395 boundary is not gated on key state", async () => {
    const err = await grpcError(() =>
      ts.command.create(appInput({ clientSecret: "enc:v1:c211Z2dsZWQ=" })),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(CIPHERTEXT_SHAPED_SECRET_MESSAGE);
  });
});
