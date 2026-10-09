// Conformance suite for Connect links (Class A).
// Domain: agentic / vault — the Connect link facet.
//
// The contract: an integrator makes a one-time link for a shared vault and an
// address (VaultCommandController.createConnectLink, can_edit on the vault);
// someone with no Stigmer account opens it, signs in at the address, and the
// login is saved into that vault (ConnectLinkController, every method public
// with the link's secret as the authority). Pinned here:
//
//   - creation refuses My vault (a link is for someone else), an address
//     nothing can sign in to, and a return URL that is not https (http only
//     for this machine); it answers the console page's URL and the expiry;
//   - the page reads what the link is for, starts the sign-in, and completes
//     it with no credential at all; completion saves the login at the
//     address in the link's vault, recorded as saved by the link's maker,
//     and answers the return URL with stigmer_connect=connected;
//   - a link works once: after its login is saved, every method answers the
//     same NOT_FOUND an unknown link does;
//   - a state belongs to the link that started it: another link cannot
//     complete it, and a person's completeSignIn refuses it;
//   - a failure after the login page (the customer declined, the sign-in
//     took too long) answers the return URL with stigmer_connect=error and a
//     reason, and leaves the link usable;
//   - on the enforcing lane, a link whose maker can no longer edit the vault
//     saves nothing.
//
// Out of scope: the link's expiry by time (its clock is minutes long; the
// server's unit suite pins it with a controlled clock).
import { Code } from "@connectrpc/connect";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";
import { HERMETIC_OAUTH_REDIRECT_URI } from "@stigmer/test-support/server-process";
import { uniqueName } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { makeSharedVault, myVaultTarget, setConnectionInput, setSecretsInput, vaultTarget } from "../support/vaults";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  enforcing = await enforcingLaneOf(target);
  await mockAs.start();
});

afterEach(async () => {
  mockAs.reset();
  await fixtures.cleanup();
});

afterAll(async () => {
  await mockAs.close();
  await target?.teardown();
});

const RETURN_URL = "https://integrator.test/back";
const UNKNOWN_LINK = "Connect link not found: it has expired or was already used";

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

// The link's secret, from its page URL.
function tokenOf(url: string): string {
  return new URL(url).pathname.replace(/^\/connect\//, "");
}

// A shared vault and an address an organization's app serves (tokens from
// the mock login server), as an integrator would set them up.
async function setUp(c: ConformanceClients, org: string, deferCleanup = true) {
  const vault = await c.vaultCommand.create(makeSharedVault({ org, name: uniqueName("customer") }));
  const address = mockAs.resourceAddress(uniqueName("tool"));
  const app = await c.oauthAppCommand.create(
    makeOAuthApp(org, uniqueName("link-app"), { addresses: [address], tokenUrl: mockAs.tokenEndpoint() }),
  );
  if (deferCleanup) {
    fixtures.defer(() => c.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
    fixtures.defer(() => c.vaultCommand.delete({ resourceId: vault.metadata!.id }));
  }
  return { vaultId: vault.metadata!.id, address, app };
}

async function createLink(c: ConformanceClients, org: string, vaultId: string, address: string) {
  return c.vaultCommand.createConnectLink({ org, vaultId, address, returnUrl: RETURN_URL });
}

describe("Connect link conformance — creation", () => {
  it("[rpc:VaultCommandController.createConnectLink] answers the console page's URL and an expiry 30 minutes out by default", async () => {
    const { org } = await target.provisionTenancy();
    const { vaultId, address } = await setUp(clients, org);
    const before = Date.now();

    const link = await createLink(clients, org, vaultId, address);

    const url = new URL(link.url);
    expect(url.origin, "the console's origin").toBe(new URL(HERMETIC_OAUTH_REDIRECT_URI).origin);
    expect(url.pathname).toMatch(/^\/connect\/[A-Za-z0-9_-]{43}$/);
    const expiresMs = Number(link.expiresAt!.seconds) * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 2000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000 + 2000);
  });

  it("[rpc:VaultCommandController.createConnectLink] refuses My vault, an address nothing can sign in to, a return URL that is not https, and a lifetime under a minute", async () => {
    const { org } = await target.provisionTenancy();
    const { vaultId, address } = await setUp(clients, org);
    const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { CONF_LINK_KEY: "v" }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));

    const myVaultErr = await expectGrpcCode(
      () => createLink(clients, org, mine.metadata!.id, address),
      Code.FailedPrecondition,
      "a link to My vault",
    );
    expect(myVaultErr.rawMessage).toBe(
      "a Connect link saves into a shared vault: My vault is its person's own, and a link is for someone else",
    );

    const noLogin = await expectGrpcCode(
      () => createLink(clients, org, vaultId, "git.conformance.test"),
      Code.FailedPrecondition,
      "a link to an address nothing signs in to",
    );
    expect(noLogin.rawMessage).toBe(
      "nothing can sign in to git.conformance.test: no login app serves this Git host. " +
        "Add a login app for git.conformance.test in Settings, or paste a token",
    );

    const plainHttp = await expectGrpcCode(
      () => clients.vaultCommand.createConnectLink({ org, vaultId, address, returnUrl: "http://integrator.test/back" }),
      Code.InvalidArgument,
      "an http return URL off this machine",
    );
    expect(plainHttp.rawMessage).toBe("return_url must be an https URL (http only for localhost, 127.0.0.1 or [::1])");

    await expectGrpcCode(
      () => clients.vaultCommand.createConnectLink({ org, vaultId, address, returnUrl: RETURN_URL, expiresInSeconds: 30 }),
      Code.InvalidArgument,
      "a lifetime under a minute",
    );
  });

  it("[rpc:VaultCommandController.createConnectLink] answers NotFound for a vault the organization does not hold", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => createLink(clients, org, "vlt_00000000000000000000000000", "github.com"),
      Code.NotFound,
      "a link to an unknown vault",
    );
    expect(err.rawMessage).toBe("vault not found: vlt_00000000000000000000000000");
  });
});

describe("Connect link conformance — the page, with no credential", () => {
  it("[rpc:ConnectLinkController.getConnectLink] [rpc:ConnectLinkController.startConnectLink] [rpc:ConnectLinkController.completeConnectLink] reads, starts and completes a link anonymously, saves the login into its vault as its maker's, and works once", async () => {
    const { org } = await target.provisionTenancy();
    const { vaultId, address } = await setUp(clients, org);
    const link = await createLink(clients, org, vaultId, address);
    const token = tokenOf(link.url);
    const anonymous = target.anonymousClients();

    const info = await anonymous.connectLink.getConnectLink({ token });
    expect(info.providerName).toBe("ConformanceVendor");
    expect(info.address).toBe(address);
    expect(info.organizationName).not.toBe("");

    const started = await anonymous.connectLink.startConnectLink({ token });
    const authUrl = new URL(started.authorizationUrl);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://vendor.example.com/oauth/authorize");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(authUrl.searchParams.get("state")).toBe(started.state);

    const done = await anonymous.connectLink.completeConnectLink({ token, state: started.state, code: "customer-code" });
    expect(done.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=connected`);

    const saved = await clients.vaultQuery.get({ value: vaultId });
    const connection = saved.spec?.connections[address];
    expect(connection?.source).toBe(VaultConnectionSource.sign_in);
    expect(connection?.token, "a read never shows the token").toBe("");
    // The maker's own write records the principal a link's save must name.
    const makersOwn = await clients.vaultCommand.setConnection(
      setConnectionInput(vaultTarget(org, vaultId), "git.maker.test", "makers-token"),
    );
    expect(connection?.savedBy, "saved as the link's maker").not.toBe("");
    expect(connection?.savedBy, "saved as the link's maker").toBe(
      makersOwn.spec?.connections["git.maker.test"]?.savedBy,
    );
    expect(mockAs.capturedTokenRequests()).toHaveLength(1);

    // Spent: the same answer an unknown link gets, on every method.
    for (const [name, op] of [
      ["getConnectLink", () => anonymous.connectLink.getConnectLink({ token })],
      ["startConnectLink", () => anonymous.connectLink.startConnectLink({ token })],
      ["completeConnectLink", () => anonymous.connectLink.completeConnectLink({ token, state: started.state, code: "again" })],
      ["an unknown link", () => anonymous.connectLink.getConnectLink({ token: "never-issued-link-secret" })],
    ] as const) {
      const err = await expectGrpcCode(op, Code.NotFound, `${name} after the link was spent`);
      expect(err.rawMessage).toBe(UNKNOWN_LINK);
    }
  });

  it("[rpc:ConnectLinkController.completeConnectLink] a link's sign-in through the address's own login server names the address as resource", async () => {
    const { org } = await target.provisionTenancy();
    const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("customer") }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
    const address = mockAs.resourceAddress(uniqueName("discovered"));
    const link = await createLink(clients, org, vault.metadata!.id, address);
    const token = tokenOf(link.url);
    const anonymous = target.anonymousClients();

    const started = await anonymous.connectLink.startConnectLink({ token });
    expect(new URL(started.authorizationUrl).searchParams.get("resource")).toBe(address);
    await anonymous.connectLink.completeConnectLink({ token, state: started.state, code: "customer-code" });

    expect(mockAs.capturedTokenRequests()[0]!.resource).toBe(address);
    const saved = await clients.vaultQuery.get({ value: vault.metadata!.id });
    expect(saved.spec?.connections[address]?.source).toBe(VaultConnectionSource.sign_in);
  });

  it("[rpc:ConnectLinkController.completeConnectLink] [rpc:VaultCommandController.completeSignIn] a state belongs to the link that started it: another link cannot complete it, nor can a person", async () => {
    const { org } = await target.provisionTenancy();
    const { vaultId, address } = await setUp(clients, org);
    const anonymous = target.anonymousClients();
    const first = tokenOf((await createLink(clients, org, vaultId, address)).url);
    const second = tokenOf((await createLink(clients, org, vaultId, address)).url);

    const startedFirst = await anonymous.connectLink.startConnectLink({ token: first });
    const crossed = await expectGrpcCode(
      () => anonymous.connectLink.completeConnectLink({ token: second, state: startedFirst.state, code: "c" }),
      Code.FailedPrecondition,
      "one link completing another link's state",
    );
    expect(crossed.rawMessage).toBe("this sign-in was not started by this Connect link");

    const startedAgain = await anonymous.connectLink.startConnectLink({ token: first });
    const person = await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: startedAgain.state, code: "c" }),
      Code.FailedPrecondition,
      "a person completing a link's state",
    );
    expect(person.rawMessage).toBe("this sign-in was started by a Connect link: it finishes on the link's own page");

    // Neither saved anything, so both links are still usable.
    const saved = await clients.vaultQuery.get({ value: vaultId });
    expect(Object.keys(saved.spec?.connections ?? {})).toEqual([]);
    await anonymous.connectLink.getConnectLink({ token: first });
    await anonymous.connectLink.getConnectLink({ token: second });
  });

  it("[rpc:ConnectLinkController.completeConnectLink] a failure after the login page answers the return URL with an error and a reason, and the link stays usable", async () => {
    const { org } = await target.provisionTenancy();
    const { vaultId, address } = await setUp(clients, org);
    const token = tokenOf((await createLink(clients, org, vaultId, address)).url);
    const anonymous = target.anonymousClients();

    const declined = await anonymous.connectLink.startConnectLink({ token });
    const denied = await anonymous.connectLink.completeConnectLink({ token, state: declined.state, error: "access_denied" });
    expect(denied.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=denied`);

    const vendorError = await anonymous.connectLink.completeConnectLink({ token, error: "server_error" });
    expect(vendorError.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=provider_error`);

    const stale = await anonymous.connectLink.completeConnectLink({ token, state: "never-issued-state", code: "c" });
    expect(stale.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=expired`);

    const started = await anonymous.connectLink.startConnectLink({ token });
    mockAs.tokenStatus = 502;
    const failed = await anonymous.connectLink.completeConnectLink({ token, state: started.state, code: "c" });
    expect(failed.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=failed`);

    // Nothing was saved, and the link still works.
    mockAs.tokenStatus = 200;
    const retried = await anonymous.connectLink.startConnectLink({ token });
    const done = await anonymous.connectLink.completeConnectLink({ token, state: retried.state, code: "c" });
    expect(done.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=connected`);
  });
});

describe("Connect link conformance — the maker's standing (on the enforcing lane)", () => {
  it("[rpc:ConnectLinkController.startConnectLink] [rpc:ConnectLinkController.completeConnectLink] a link whose maker can no longer edit the vault saves nothing", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    const { org } = tenancy;
    const owner = lane.clients;
    const { vaultId, address, app } = await setUp(owner, org, false);
    fixtures.defer(() => owner.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
    fixtures.defer(() => owner.vaultCommand.delete({ resourceId: vaultId }));
    const admin = await lane.provisionWithRole(tenancy, "admin");
    const adminId = await lane.accountIdOf(admin);

    const token = tokenOf((await createLink(admin, org, vaultId, address)).url);
    const started = await owner.connectLink.startConnectLink({ token });

    await owner.iamPolicyCommand.revokeOrgAccess({ identityAccountId: adminId, org });

    const done = await owner.connectLink.completeConnectLink({ token, state: started.state, code: "c" });
    expect(done.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=not_allowed`);
    const notStarted = await expectGrpcCode(
      () => owner.connectLink.startConnectLink({ token }),
      Code.NotFound,
      "starting a link whose maker lost the vault",
    );
    expect(notStarted.rawMessage).toBe(UNKNOWN_LINK);
    const saved = await owner.vaultQuery.get({ value: vaultId });
    expect(Object.keys(saved.spec?.connections ?? {})).toEqual([]);
    expect(mockAs.capturedTokenRequests(), "no code was exchanged").toEqual([]);
  });
});
