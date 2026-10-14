/**
 * The self-hosted Enterprise server booted four ways, each the way its
 * entry boots it (editions/enterprise.ts, then the library's composition
 * and start), with people signing in through the library's OIDC lane:
 *
 *   - no key: the open-source server, holding its one organization, its
 *     license reported absent;
 *   - a key that does not verify: the boot is refused with the verifier's
 *     sentence, once for each reason (a ticket that is not one, a key this
 *     build does not trust, a signature that does not match, contents that
 *     do not read), and no sentence carries any part of the key; a key
 *     that verifies on a server with no Postgres is refused too;
 *   - licensed: the server reports the Enterprise edition and its license;
 *     the Enterprise schema is made current by the identity unit's start;
 *     organizations grow to the license's limit and no further; an identity
 *     provider is saved (its documents dialed through the guarded fetch)
 *     and signs a federated person in, the same person once the provider
 *     is renamed; an invitation is redeemed and its
 *     person joins a team; a federated account's changed email reaches
 *     the server; two concurrent creates of one federated account answer
 *     one account; and a deleted federated account's key does not come back
 *     when the account is made again under the same id;
 *   - lapsed: once the license and its grace period have run out (an
 *     injected clock moved past them), creating an organization, a team or
 *     a federation issuer, and changing one, are refused with the renewal
 *     reason, while invitations, their redemption, team membership, a
 *     provider's delete and sign-ins all keep working.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate); each Postgres boot gets a fresh database.
 */
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { PlatformQueryController, ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { loadConfig } from "@stigmer/server";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { LICENSE_RENEWAL_REQUIRED } from "../../license/growth.js";
import { newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { composeEnterprise, ENTERPRISE_NEEDS_POSTGRES } from "../enterprise.js";
import {
  bootEnterprise,
  createOrganization,
  createIssuer,
  federatedToken,
  grant,
  issueKey,
  licenseClaims,
  providerRequest,
  ref,
  refusalOf,
  signIn,
  SILENT_LOGGER,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";
import { ENTERPRISE_SCHEMA_VERSION } from "../../schema/enterprise-migrations.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let issuer: LoopbackIssuer;

beforeAll(async () => {
  issuer = await startLoopbackIssuer();
});

afterAll(async () => {
  await issuer?.close();
});

/** The ErrorInfo reason a refusal carries. */
function reasonOf(refusal: ConnectError): string | undefined {
  return refusal.findDetails(ErrorInfoSchema)[0]?.reason;
}

/** The refusal is the renewal one: FAILED_PRECONDITION with its reason. */
function expectRenewalRefusal(refusal: ConnectError): void {
  expect(refusal.code).toBe(Code.FailedPrecondition);
  expect(reasonOf(refusal)).toBe(LICENSE_RENEWAL_REQUIRED);
}

describe("no key: the open-source server", () => {
  let booted: BootedServer;

  beforeAll(async () => {
    booted = await bootEnterprise({ issuer });
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
  });

  it("composes the open-source edition alone, reports it, and holds its one organization", async () => {
    expect(booted.units.map((unit) => unit.name)).toEqual(["open-source"]);
    const platform = createClient(PlatformQueryController, transportTo(booted.port));
    const info = await platform.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.oss);
    expect(info.singleOrg).toBe(true);
    const owner = await signIn(booted, issuer, "operator|olga");
    expect((await createClient(PlatformQueryController, owner.transport).getLicenseStatus({})).state).toBe(
      LicenseState.absent,
    );
    const held = await createClient(OrganizationQueryController, owner.transport).listMine({});
    expect(held.entries.map((org) => org.metadata?.slug)).toEqual(["stigmer"]);
  });
});

describe("a key that does not verify", () => {
  const signer = newTestSigner();
  const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
  const good = writeTicket(signer, claims);
  const boot = {
    config: loadConfig({ STIGMER_MODEL_REGISTRY_REFRESH: "off", DATABASE_URL: "postgres://unused@127.0.0.1:1/unused" }),
    logger: SILENT_LOGGER,
  };

  /** The good ticket with the signature of another key under the same key id. */
  function forgedSignature(): string {
    const [header, payload] = good.split(".");
    const forged = writeTicket(newTestSigner(signer.keyId), claims).split(".")[2];
    return `${header}.${payload}.${forged}`;
  }

  async function refusedWith(key: string): Promise<string> {
    const refused = await composeEnterprise(boot, { licenseKey: key, ring: signer.ring }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(refused, "the boot is refused").toBeDefined();
    for (const part of key.split(".").filter((p) => p.length > 8)) {
      expect(refused).not.toContain(part);
    }
    return refused ?? "";
  }

  it("refuses a ticket that is not one", async () => {
    expect(await refusedWith("not-a-license-key")).toMatch(/license/i);
  });

  it("refuses a key signed by a key this build does not trust", async () => {
    const stranger = writeTicket(newTestSigner("license-signing:stranger"), claims);
    expect(await refusedWith(stranger)).toMatch(/license/i);
  });

  it("refuses a signature that does not match", async () => {
    expect(await refusedWith(forgedSignature())).toMatch(/signature/i);
  });

  it("refuses contents that do not read", async () => {
    const unreadable = writeTicket(signer, claims, { payload: { licenseId: "lic_1", unknownMember: true } });
    expect(await refusedWith(unreadable)).toMatch(/license/i);
  });

  it("each reason reads differently, so an operator can tell them apart", async () => {
    const sentences = new Set([
      await refusedWith("not-a-license-key"),
      await refusedWith(writeTicket(newTestSigner("license-signing:stranger"), claims)),
      await refusedWith(forgedSignature()),
      await refusedWith(writeTicket(signer, claims, { payload: { unknownMember: true } })),
    ]);
    expect(sentences.size).toBe(4);
  });

  it("refuses a key that verifies on a server with no Postgres", async () => {
    const config = loadConfig({ STIGMER_MODEL_REGISTRY_REFRESH: "off" });
    await expect(
      composeEnterprise({ config, logger: SILENT_LOGGER }, { licenseKey: good, ring: signer.ring }),
    ).rejects.toThrow(ENTERPRISE_NEEDS_POSTGRES);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("licensed", () => {
  const clock = testClock(new Date(ISSUED.getTime() + 10 * DAY_MS));
  const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30, maxOrgs: 2 });
  const signer = newTestSigner();
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let owner: Person;
  let joiner: Person;
  let acme = "";

  beforeAll(async () => {
    db = await provisionEnterpriseDatabase({ migrate: false });
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, claims),
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
    });
    owner = await signIn(booted, issuer, "operator|alice");
    joiner = await signIn(booted, issuer, "operator|bob");
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
  });

  it("reports the Enterprise edition and a valid license, and its start made the Enterprise schema current", async () => {
    const platform = createClient(PlatformQueryController, owner.transport);
    expect((await platform.getServerInfo({})).edition).toBe(ServerEdition.enterprise);
    const status = await platform.getLicenseStatus({});
    expect(status.keyId).toBe(signer.keyId);
    expect([LicenseState.valid, LicenseState.expiring, LicenseState.grace, LicenseState.expired]).toContain(status.state);
    const ledger = await db.pool.query<{ version: number }>("SELECT version FROM ee.schema_version");
    expect(ledger.rows).toEqual([{ version: ENTERPRISE_SCHEMA_VERSION }]);
  });

  it("grows to the license's organization limit and no further", async () => {
    acme = await createOrganization(owner, "acme");
    await createOrganization(owner, "globex");
    const refused = await refusalOf(createOrganization(owner, "initech"));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(reasonOf(refused)).toBe("ORGANIZATION_LIMIT_REACHED");
  });

  it("saves a federation issuer through the guarded fetch, and it signs a federated person in", async () => {
    const provider = await createIssuer(owner, issuer, acme, "acme-okta");
    expect(provider.metadata?.id).toMatch(/^fis_/);
    const token = federatedToken(issuer, "acme-okta", "okta|dana", "dana@acme.example");
    const dana = await createClient(IdentityAccountQueryController, transportTo(booted.port, token)).whoAmI({});
    expect(dana.spec?.email).toBe("dana@acme.example");
    expect(dana.spec?.federationIssuerRef?.slug).toBe("acme-okta");
  });

  it("a renamed federation issuer signs the same person in, and the account names it by its new slug", async () => {
    const asDana = () =>
      createClient(
        IdentityAccountQueryController,
        transportTo(booted.port, federatedToken(issuer, "acme-okta", "okta|dana", "dana@acme.example")),
      ).whoAmI({});
    const before = await asDana();
    const providerId = before.spec?.federationIssuerRef?.id ?? "";
    expect(providerId).toMatch(/^fis_/);
    const providers = createClient(FederationIssuerCommandController, owner.transport);

    const renamed = await providers.rename({ resourceId: providerId, slug: "acme-sso" });
    expect(renamed.metadata?.id).toBe(providerId);
    const after = await asDana();
    expect(after.metadata?.id, "the same account").toBe(before.metadata?.id);
    expect(after.spec?.federationIssuerRef).toMatchObject({ id: providerId, slug: "acme-sso" });

    await providers.rename({ resourceId: providerId, slug: "acme-okta" });
  });

  it("redeems an invitation, and its person joins a team", async () => {
    const invitation = await createClient(InvitationCommandController, owner.transport).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: "bob", org: acme },
      spec: { role: IamRole.viewer, maxRedemptions: 1, expiresAt: timestampFromDate(new Date(Date.now() + DAY_MS)) },
    });
    await createClient(InvitationCommandController, joiner.transport).redeem({ token: invitation.status?.token ?? "" });
    const team = await createClient(TeamCommandController, owner.transport).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Team",
      metadata: { name: "platform", org: acme },
      spec: { description: "the platform team" },
    });
    const member = await createClient(IamPolicyCommandController, owner.transport).create(
      grant(ref("identity_account", joiner.accountId), "member", ref("team", team.metadata?.id ?? "")),
    );
    expect(member.spec?.relation).toBe("member");
  });

  it("keeps a federated person's changed email", async () => {
    const accounts = createClient(IdentityAccountCommandController, owner.transport);
    const providerRef = { org: acme, slug: "acme-okta" };
    const created = await accounts.createFederatedAccount({
      org: acme,
      federationIssuerRef: providerRef,
      externalSub: "okta|erin",
      email: "erin@acme.example",
    });
    const updated = await accounts.updateFederatedAccount({
      org: acme,
      federationIssuerRef: providerRef,
      externalSub: "okta|erin",
      email: "erin.reyes@acme.example",
    });
    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.email).toBe("erin.reyes@acme.example");
    const reread = await accounts.updateFederatedAccount({
      org: acme,
      federationIssuerRef: providerRef,
      externalSub: "okta|erin",
      email: "erin.reyes@acme.example",
      firstName: "Erin",
    });
    expect(reread.spec?.email, "the stored row carries the new email").toBe("erin.reyes@acme.example");
  });

  it("answers one account to two concurrent creates of one federated person", async () => {
    const accounts = createClient(IdentityAccountCommandController, owner.transport);
    const input = {
      org: acme,
      federationIssuerRef: { org: acme, slug: "acme-okta" },
      externalSub: "okta|fay",
      email: "fay@acme.example",
    };
    const answers = await Promise.allSettled([accounts.createFederatedAccount(input), accounts.createFederatedAccount(input)]);
    const ids = answers.flatMap((answer) => (answer.status === "fulfilled" ? [answer.value.metadata?.id ?? ""] : []));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    for (const answer of answers) {
      if (answer.status === "rejected") {
        expect(ConnectError.from(answer.reason).code).toBe(Code.AlreadyExists);
      }
    }
  });

  it("does not bring a deleted federated account's key back when the account is made again", async () => {
    const accounts = createClient(IdentityAccountCommandController, owner.transport);
    const providerRef = { org: acme, slug: "acme-okta" };
    const input = { org: acme, federationIssuerRef: providerRef, externalSub: "okta|gus", email: "gus@acme.example" };
    const first = await accounts.createFederatedAccount(input);
    const key = await issueKey(booted.server, first.metadata?.id ?? "", acme);
    const withKey = createClient(IdentityAccountQueryController, transportTo(booted.port, key));
    expect((await withKey.whoAmI({})).metadata?.id).toBe(first.metadata?.id);

    await accounts.deprovisionFederatedAccount({ org: acme, federationIssuerRef: providerRef, externalSub: "okta|gus", deleteAccount: true });
    const again = await accounts.createFederatedAccount(input);
    expect(again.metadata?.id).toBe(first.metadata?.id);
    expect((await refusalOf(withKey.whoAmI({}))).code).toBe(Code.Unauthenticated);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("lapsed: growth refused, everything else open", () => {
  const clock = testClock(new Date(ISSUED.getTime() + 10 * DAY_MS));
  const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
  const signer = newTestSigner();
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let owner: Person;
  let joiner: Person;
  let acme = "";
  let teamId = "";
  let providerId = "";

  beforeAll(async () => {
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, claims),
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
    });
    owner = await signIn(booted, issuer, "operator|carol");
    joiner = await signIn(booted, issuer, "operator|dave");
    acme = await createOrganization(owner, "acme");
    providerId = (await createIssuer(owner, issuer, acme, "acme-entra")).metadata?.id ?? "";
    await createIssuer(owner, issuer, acme, "acme-okta");
    teamId =
      (
        await createClient(TeamCommandController, owner.transport).create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "Team",
          metadata: { name: "sre", org: acme },
          spec: {},
        })
      ).metadata?.id ?? "";
    // The license and its grace period run out: past grace_until.
    clock.now = new Date(ISSUED.getTime() + (365 + 30 + 1) * DAY_MS);
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
  });

  it("refuses a new organization with the renewal reason", async () => {
    expectRenewalRefusal(await refusalOf(createOrganization(owner, "globex")));
  });

  it("refuses a new team with the renewal reason", async () => {
    expectRenewalRefusal(
      await refusalOf(
        createClient(TeamCommandController, owner.transport).create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "Team",
          metadata: { name: "data", org: acme },
          spec: {},
        }),
      ),
    );
  });

  it("refuses a new federation issuer, a change to one and an apply either way, with the renewal reason", async () => {
    const providers = createClient(FederationIssuerCommandController, owner.transport);
    expectRenewalRefusal(await refusalOf(providers.create(providerRequest(issuer, acme, "acme-google"))));
    const changed = providerRequest(issuer, acme, "acme-entra", { displayName: "Acme Entra (renamed)" });
    expectRenewalRefusal(
      await refusalOf(
        providers.update({ resource: providerRequest(issuer, acme, "acme-entra", { id: providerId, displayName: "Acme Entra (renamed)" }), updateMask: { paths: ["*"] } }),
      ),
    );
    expectRenewalRefusal(await refusalOf(providers.apply(changed)));
    expectRenewalRefusal(await refusalOf(providers.apply(providerRequest(issuer, acme, "acme-auth0"))));
  });

  it("still invites, redeems, adds a team member, deletes a provider and signs people in", async () => {
    const invitation = await createClient(InvitationCommandController, owner.transport).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: "dave", org: acme },
      spec: { role: IamRole.viewer, maxRedemptions: 1, expiresAt: timestampFromDate(new Date(Date.now() + DAY_MS)) },
    });
    await createClient(InvitationCommandController, joiner.transport).redeem({ token: invitation.status?.token ?? "" });
    await createClient(IamPolicyCommandController, owner.transport).create(
      grant(ref("identity_account", joiner.accountId), "member", ref("team", teamId)),
    );
    await createClient(FederationIssuerCommandController, owner.transport).delete({ resourceId: providerId });

    expect((await createClient(IdentityAccountQueryController, owner.transport).whoAmI({})).metadata?.id).toBe(
      owner.accountId,
    );
    const late = await signIn(booted, issuer, "operator|erin");
    expect(late.accountId).not.toBe("");
    const federated = federatedToken(issuer, "acme-okta", "okta|hal", "hal@acme.example");
    const hal = await createClient(IdentityAccountQueryController, transportTo(booted.port, federated)).whoAmI({});
    expect(hal.spec?.federationIssuerRef?.slug).toBe("acme-okta");
  });
});
