// OAuthApp conformance — CRUD, the client-secret contract, and the
// addresses an app signs in to (Class A).
// Domain: conformance suites.
//
// OAuthApp is the outbound-auth registration with an external vendor: client
// credentials plus the vendor's OAuth endpoints, found by the addresses it
// signs in to (a sign-in at one of them uses it; the sign-in itself is
// suites/vault-sign-in.conformance.test.ts). Three surfaces make the domain
// distinct, and all three are asserted here:
//
//   - The SECRET contract: client_secret is encrypted at rest and REDACTED to
//     the ***REDACTED*** marker on every response, the delete's included
//     (stigmer/stigmer#1257); re-submitting the marker on apply means "keep
//     the stored secret"; and
//     a client-supplied enc:v<N>:-shaped secret is refused with
//     InvalidArgument on every write door — the prefix is server-reserved, so
//     a prefixed request value is either forged ciphertext or an attempt to
//     pin stale ciphertext (the oss#395 boundary, pinned in both editions'
//     unit tests and held here over the wire).
//   - The ADDRESSES: each is normalized as a vault connection's address is,
//     and belongs to one app per organization. A second app naming an
//     address another app of the organization holds is refused
//     ALREADY_EXISTS; another organization may name it; an update that
//     drops an address, or a delete, frees it.
//   - There is deliberately NO updateVisibility RPC and no public surface:
//     an OAuthApp holds credentials, so org-private is the only posture.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
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

async function createOAuthAppFixture(org: string, name = uniqueName("oauth-app"), addresses?: string[]) {
  const app = await clients.oauthAppCommand.create(
    makeOAuthApp(org, name, addresses === undefined ? {} : { addresses }),
  );
  fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
  return app;
}

describe("OAuthApp conformance — CRUD & identity", () => {
  it("[rpc:OAuthAppCommandController.create] create assigns an oapp_ id, echoes the spec, and redacts the secret in the response", async () => {
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

  it("[rpc:OAuthAppQueryController.get] [rpc:OAuthAppQueryController.getByReference] get and getByReference resolve the app, both redacted", async () => {
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

  it("[rpc:OAuthAppQueryController.listByOrg] listByOrg returns the org's apps, redacted", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createOAuthAppFixture(org);

    const listed = await clients.oauthAppQuery.listByOrg({ org });

    const match = listed.entries.find((app) => app.metadata?.id === created.metadata?.id);
    expect(match, "the created app appears in its org's list").toBeDefined();
    expect(match?.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });

  it("[rpc:OAuthAppCommandController.apply] apply creates on first call and updates on second (same name + org)", async () => {
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

  it("[rpc:OAuthAppCommandController.update] update replaces the spec but preserves id, slug, and org", async () => {
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

  it("[rpc:OAuthAppCommandController.delete] delete removes an app", async () => {
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
  it("[rpc:OAuthAppCommandController.apply] applying back a fetched app with the redaction marker preserves the stored secret", async () => {
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

  it("[rpc:OAuthAppCommandController.create] rejects a ciphertext-shaped client_secret on create (InvalidArgument), across the whole enc:v<N>: family", async () => {
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

  it("[rpc:OAuthAppCommandController.update] rejects a ciphertext-shaped client_secret on update (InvalidArgument)", async () => {
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

  it("[rpc:OAuthAppCommandController.delete] delete answers the removed app with its secret redacted, like every read", async () => {
    const { org } = await target.provisionTenancy();
    // No deferred cleanup: this test deletes the app itself.
    const created = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("oauth-app")));

    const deleted = await clients.oauthAppCommand.delete({ resourceId: created.metadata!.id });

    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    expect(deleted.spec?.clientSecret).toBe(OAUTHAPP_REDACTED_MARKER);
  });
});

describe("OAuthApp conformance — the addresses an app signs in to", () => {
  it("[rpc:OAuthAppCommandController.create] normalizes each address as a vault connection's address is", async () => {
    const { org } = await target.provisionTenancy();
    const app = await clients.oauthAppCommand.create(
      makeOAuthApp(org, uniqueName("oauth-app"), {
        addresses: ["HTTPS://MCP.Vendor.test:443/mcp/?x=1", "GitHub.com"],
      }),
    );
    fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));

    expect(app.spec?.addresses).toEqual(["https://mcp.vendor.test/mcp", "github.com"]);
  });

  it("[rpc:OAuthAppCommandController.create] refuses an address another app of the organization holds (AlreadyExists), and admits it in another organization", async () => {
    const { org } = await target.provisionTenancy();
    const address = `https://mcp.vendor.test/${uniqueName("held")}`;
    await createOAuthAppFixture(org, uniqueName("first"), [address]);

    const err = await expectGrpcCode(
      () => clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("second"), { addresses: [address] })),
      Code.AlreadyExists,
      "a second app naming a held address",
    );
    expect(err.rawMessage).toBe(
      `the address ${address} already belongs to another login app in this organization: remove it there first`,
    );

    const other = await target.provisionTenancy();
    const elsewhere = await createOAuthAppFixture(other.org, uniqueName("elsewhere"), [address]);
    expect(elsewhere.spec?.addresses).toEqual([address]);
  });

  it("[rpc:OAuthAppCommandController.update] an update that drops an address frees it, and one that adds a held address is refused", async () => {
    const { org } = await target.provisionTenancy();
    const kept = `https://mcp.vendor.test/${uniqueName("kept")}`;
    const moved = `https://mcp.vendor.test/${uniqueName("moved")}`;
    const first = await createOAuthAppFixture(org, uniqueName("first"), [kept, moved]);
    const second = await createOAuthAppFixture(org, uniqueName("second"));

    await expectGrpcCode(
      () =>
        clients.oauthAppCommand.update({
          ...makeOAuthApp(org, second.metadata!.name, { addresses: [moved] }),
          metadata: second.metadata,
        }),
      Code.AlreadyExists,
      "update adding an address another app holds",
    );

    await clients.oauthAppCommand.update({
      ...makeOAuthApp(org, first.metadata!.name, { addresses: [kept] }),
      metadata: first.metadata,
    });
    const taken = await clients.oauthAppCommand.update({
      ...makeOAuthApp(org, second.metadata!.name, { addresses: [moved] }),
      metadata: second.metadata,
    });
    expect(taken.spec?.addresses).toEqual([moved]);
  });

  it("[rpc:OAuthAppCommandController.delete] a delete frees the app's addresses", async () => {
    const { org } = await target.provisionTenancy();
    const address = `https://mcp.vendor.test/${uniqueName("freed")}`;
    const app = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("gone"), { addresses: [address] }));
    await clients.oauthAppCommand.delete({ resourceId: app.metadata!.id });

    const successor = await createOAuthAppFixture(org, uniqueName("successor"), [address]);
    expect(successor.spec?.addresses).toEqual([address]);
  });

  it("[rpc:OAuthAppCommandController.create] refuses no address, a value that is no address, and two that normalize alike (InvalidArgument each)", async () => {
    const { org } = await target.provisionTenancy();
    for (const [addresses, label] of [
      [[], "no address"],
      [["not an address"], "a value that is no address"],
      [["https://mcp.vendor.test/a", "HTTPS://mcp.vendor.test/a/"], "two addresses that normalize alike"],
    ] as const) {
      await expectGrpcCode(
        () => clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("bad"), { addresses: [...addresses] })),
        Code.InvalidArgument,
        `create with ${label}`,
      );
    }
  });
});

describe("OAuthApp conformance — negative paths", () => {
  it("[rpc:OAuthAppQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.oauthAppQuery.get({ value: "oapp_01conformancemissing" }),
      Code.NotFound,
      "get missing oauth app",
    ));

  it("[rpc:OAuthAppQueryController.getByReference] getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.oauthAppQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("[rpc:OAuthAppCommandController.create] rejects a create with an empty client_id (InvalidArgument)", async () => {
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

  it("[rpc:OAuthAppCommandController.create] rejects a create with an empty client_secret (InvalidArgument)", async () => {
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

  it("[rpc:OAuthAppCommandController.create] rejects a create with a malformed authorization_url (InvalidArgument)", async () => {
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
