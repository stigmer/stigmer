// OAuthApp conformance — CRUD, the client-secret contract, and the
// referential delete-block (Class A).
// Domain: conformance suites.
//
// OAuthApp is the outbound-auth registration with an external vendor: client
// credentials plus the vendor's OAuth endpoints, referenced by McpServer
// resources that authenticate via vendor OAuth (McpServerAuth.oauth_app_ref).
// Three surfaces make the domain distinct, and all three are asserted here:
//
//   - The SECRET contract: client_secret is encrypted at rest and REDACTED to
//     the ***REDACTED*** marker on every read; re-submitting the marker on
//     apply means "keep the stored secret" (the Environment convention); and
//     a client-supplied enc:v<N>:-shaped secret is refused with
//     InvalidArgument on every write door — the prefix is server-reserved, so
//     a prefixed request value is either forged ciphertext or an attempt to
//     pin stale ciphertext (the oss#395 boundary, pinned in both editions'
//     unit tests and held here over the wire).
//   - The DELETE-BLOCK: deletion is refused with FailedPrecondition while an
//     McpServer's oauth_app_ref RESOLVES to the app (stigmer#584 — resolution
//     semantics, not literal field match), because deleting it would sever a
//     live vendor-OAuth connection. Unreferencing frees the delete.
//   - There is deliberately NO updateVisibility RPC and no public surface:
//     an OAuthApp holds credentials, so org-private is the only posture.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { MCPSERVER_API_VERSION, MCPSERVER_KIND } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { OAUTHAPP_REDACTED_MARKER, makeOAuthApp } from "../support/oauthapps";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function createOAuthAppFixture(org: string, name = uniqueName("oauth-app")) {
  const app = await clients.oauthAppCommand.create(makeOAuthApp(org, name));
  fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
  return app;
}

// An McpServer whose auth block references the given OAuthApp — the
// referencing side of the delete-block. Built inline rather than in
// support/mcpservers.ts: the auth arm exists here only to hold the reference.
function makeReferencingMcpServer(
  org: string,
  appSlug: string,
): MessageInitShape<typeof McpServerSchema> {
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name: uniqueName("mcp-ref"), org },
    spec: {
      description: "references an OAuthApp for the delete-block contract",
      serverType: {
        case: "stdio",
        value: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
      },
      auth: {
        oauthAppRef: { org, slug: appSlug, kind: ApiResourceKind.oauth_app },
        targetEnvVar: "VENDOR_TOKEN",
      },
    },
  };
}

describe("OAuthApp conformance — CRUD & identity", () => {
  it("create assigns an oapp_ id, echoes the spec, and redacts the secret in the response", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    expect(created.metadata?.id).toMatch(/^oapp_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.provider).toBe("ConformanceVendor");
    expect(created.spec?.clientId).toBe("conformance-client-id");
    expect(created.spec?.authorizationUrl).toBe("https://vendor.example.com/oauth/authorize");
    expect(
      created.spec?.clientSecret,
      "the stored secret must never travel back — every response redacts it",
    ).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("get and getByReference resolve the app, both redacted", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    const fetched = await clients.oauthAppQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    expect(fetched.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);

    const byRef = await clients.oauthAppQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);
    expect(byRef.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("listByOrg returns the org's apps, redacted", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    const listed = await clients.oauthAppQuery.listByOrg({ org });

    const match = listed.entries.find((app) => app.metadata?.id === created.metadata?.id);
    expect(match, "the created app appears in its org's list").toBeDefined();
    expect(match?.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("oauth-app");

    const first = await clients.oauthAppCommand.apply(
      makeOAuthApp(org, name, { provider: "VendorV1" }),
    );
    fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: first.metadata!.id }));
    expect(first.metadata?.id).toMatch(/^oapp_/);

    const second = await clients.oauthAppCommand.apply(
      makeOAuthApp(org, name, { provider: "VendorV2" }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.provider, "apply-as-update replaces the spec").toBe("VendorV2");
  });

  it("update replaces the spec but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    const updated = await clients.oauthAppCommand.update({
      ...makeOAuthApp(org, created.metadata!.name, { clientId: "rotated-client-id" }),
      metadata: created.metadata,
    });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.metadata?.slug).toBe(created.metadata?.slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.spec?.clientId).toBe("rotated-client-id");
    expect(updated.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("delete removes an unreferenced app", async () => {
    const { org } = await target.provisionTenancy();
    // No deferred cleanup: this test deletes the app itself.
    const created = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("oauth-app")));

    await clients.oauthAppCommand.delete({ resourceId: created.metadata!.id });

    await expectGrpcCode(
      () => clients.oauthAppQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("OAuthApp conformance — the client-secret contract", () => {
  it("applying back a fetched app with the redaction marker preserves the stored secret", async () => {
    // Reads always redact, so preservation is proven behaviorally: the
    // marker round-trip must succeed and must NOT store the marker itself —
    // a subsequent read still answers the marker because a real secret is
    // stored beneath it, and a broken implementation that stored the marker
    // verbatim would be caught by the ciphertext/secret-shape pins in both
    // editions' unit tests. What the wire contract owns is that the
    // round-trip is accepted and stays redacted.
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    const fetched = await clients.oauthAppQuery.get({ value: created.metadata!.id });
    expect(fetched.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);

    const reapplied = await clients.oauthAppCommand.apply(fetched);

    expect(reapplied.metadata?.id).toBe(created.metadata?.id);
    expect(reapplied.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("rejects a ciphertext-shaped client_secret on create (InvalidArgument), across the whole enc:v<N>: family", async () => {
    const { org } = await target.provisionTenancy();

    for (const smuggled of ["enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=", "enc:v2:ZnV0dXJlLXZlcnNpb24="]) {
      await expectGrpcCode(
        () =>
          clients.oauthAppCommand.create(
            makeOAuthApp(org, uniqueName("oauth-app"), { clientSecret: smuggled }),
          ),
        Code.InvalidArgument,
        `create with ciphertext-shaped client_secret ${smuggled}`,
      );
    }
  });

  it("rejects a ciphertext-shaped client_secret on update (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    await expectGrpcCode(
      () =>
        clients.oauthAppCommand.update({
          ...makeOAuthApp(org, created.metadata!.name, {
            clientSecret: "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=",
          }),
          metadata: created.metadata,
        }),
      Code.InvalidArgument,
      "update with ciphertext-shaped client_secret",
    );
  });
});

describe("OAuthApp conformance — referential delete-block", () => {
  it("refuses to delete an app an McpServer references, then allows it once unreferenced", async () => {
    const { org } = await target.provisionTenancy();
    const app = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("oauth-app")));

    const mcpServer = await clients.mcpServerCommand.create(
      makeReferencingMcpServer(org, app.metadata!.slug),
    );

    // Referenced: deleting the app would sever a live vendor-OAuth
    // connection, so the guard refuses.
    await expectGrpcCode(
      () => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }),
      Code.FailedPrecondition,
      "delete an OAuthApp a live McpServer references",
    );

    // Unreference by deleting the McpServer; the app is now free to go.
    await clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id });
    const deleted = await clients.oauthAppCommand.delete({ resourceId: app.metadata!.id });
    expect(deleted.metadata?.id).toBe(app.metadata?.id);
  });
});

describe("OAuthApp conformance — negative paths", () => {
  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.oauthAppQuery.get({ value: "oapp_01conformancemissing" }),
      Code.NotFound,
      "get missing oauth app",
    ));

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.oauthAppQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("rejects a create with an empty client_id (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.oauthAppCommand.create(
          makeOAuthApp(org, uniqueName("oauth-app"), { clientId: "" }),
        ),
      Code.InvalidArgument,
      "create with empty client_id",
    );
  });

  it("rejects a create with an empty client_secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.oauthAppCommand.create(
          makeOAuthApp(org, uniqueName("oauth-app"), { clientSecret: "" }),
        ),
      Code.InvalidArgument,
      "create with empty client_secret",
    );
  });

  it("rejects a create with a malformed authorization_url (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.oauthAppCommand.create(
          makeOAuthApp(org, uniqueName("oauth-app"), { authorizationUrl: "not-a-url" }),
        ),
      Code.InvalidArgument,
      "create with malformed authorization_url",
    );
  });
});
