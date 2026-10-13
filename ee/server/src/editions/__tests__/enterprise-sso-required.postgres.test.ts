/**
 * An organization that requires sign-in through its SSO provider, on the
 * self-hosted Enterprise server composed and driven end to end: the
 * library's credential binding asking the identity unit's rule, over real
 * Postgres, a loopback operator issuer and a loopback organization
 * provider.
 *
 * The story, as an organization lives it:
 *   - Raj worked in Acme as an admin under the server's own sign-in (his
 *     email account), before Acme connected its Okta;
 *   - Acme's owner connects Okta as its SSO provider and requires it; Raj
 *     signs in through Okta once, which makes his Okta account;
 *   - his email account, and a key it made bound to Acme, are refused in
 *     Acme with SSO_REQUIRED, the organization and the provider's slug; his
 *     Okta account is served; the owner keeps her own sign-in;
 *   - he moves his access: a ticket asked as the email account, redeemed as
 *     the Okta account, after which the Okta account holds his admin role
 *     and the email account holds nothing in Acme;
 *   - as an admin who is not an owner, he cannot turn the requirement off.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate).
 */
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import type { Transport } from "@connectrpc/connect";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { OWNERS_DECIDE_SSO_REQUIRED_MESSAGE } from "../../iam/provider/sso-required-steps.js";
import {
  bootEnterprise,
  createOrganization,
  federatedToken,
  grant,
  issueKey,
  licenseClaims,
  providerRequest,
  ref,
  refusalOf,
  signIn,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const OKTA = "acme-okta";

describe.skipIf(TEST_DATABASE_URL === undefined)("an organization that requires sign-in through its SSO provider", () => {
  const signer = newTestSigner();
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let owner: Person;
  let rajEmail: Person;
  let rajOkta: Transport;
  let rajOktaId = "";
  let acme = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: testClock(new Date(ISSUED.getTime() + 24 * 60 * 60 * 1000)).read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      dialer: issuer.fetch,
    });
    owner = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(owner, "acme");
    rajEmail = await signIn(booted, issuer, "operator|raj");
    await createClient(IamPolicyCommandController, owner.transport).create(
      grant(ref("identity_account", rajEmail.accountId), "admin", ref("organization", acme)),
    );
    const request = providerRequest(issuer, acme, OKTA, { displayName: "Acme Okta" });
    const spec = { ...request.spec, isSsoProvider: true, oidcClientId: "acme-client", ssoRequired: true };
    await createClient(IdentityProviderCommandController, owner.transport).create({ ...request, spec });
    rajOkta = transportTo(booted.port, federatedToken(issuer, OKTA, "okta|raj", "raj@acme.example"));
    rajOktaId = (await createClient(IdentityAccountQueryController, rajOkta).whoAmI({})).metadata?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  const listProviders = (transport: Transport) =>
    createClient(IdentityProviderQueryController, transport).listByOrg({ org: acme });

  it("refuses the email account in the organization with SSO_REQUIRED, the organization and the provider", async () => {
    const refused = await refusalOf(listProviders(rajEmail.transport));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe("This organization requires you to sign in through Acme Okta.");
    const [info] = refused.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("SSO_REQUIRED");
    expect(info?.metadata).toEqual({ org: acme, provider: OKTA });
  });

  it("refuses a key the email account made, bound to the organization", async () => {
    const key = await issueKey(booted.server, rajEmail.accountId, acme);
    const refused = await refusalOf(listProviders(transportTo(booted.port, key)));
    expect(refused.findDetails(ErrorInfoSchema)[0]?.reason).toBe("SSO_REQUIRED");
  });

  it("serves the account the organization's provider made, and the owner's own sign-in", async () => {
    expect((await listProviders(rajOkta)).entries).toHaveLength(1);
    expect((await listProviders(owner.transport)).entries).toHaveLength(1);
  });

  it("tells the login page the organization requires it", async () => {
    const info = await createClient(IdentityProviderQueryController, transportTo(booted.port)).getSsoProvider({
      org: "acme",
    });
    expect(info.ssoRequired).toBe(true);
    expect(info.displayName).toBe("Acme Okta");
  });

  it("moves the email account's access to the Okta account, and the email account keeps nothing there", async () => {
    const moves = createClient(IdentityProviderCommandController, rajEmail.transport);
    const ticket = await moves.createAccessMove({ org: acme });
    expect(ticket.preview?.movedPolicies).toBeGreaterThan(0);
    expect(ticket.provider?.ssoRequired).toBe(true);

    const result = await createClient(IdentityProviderCommandController, rajOkta).redeemAccessMove({
      ticket: ticket.ticket,
    });
    expect(result.moved?.movedPolicies).toBe(ticket.preview?.movedPolicies);

    const asOkta = await createClient(IamPolicyQueryController, rajOkta).checkMyPermission({
      resource: ref("organization", acme),
      relation: "can_grant_access",
    });
    expect(asOkta.isAuthorized, "the Okta account is an admin now").toBe(true);
    const asEmail = await createClient(IamPolicyQueryController, rajEmail.transport).checkMyPermission({
      resource: ref("organization", acme),
      relation: "can_view",
    });
    expect(asEmail.isAuthorized).toBe(false);
    expect(rajOktaId).not.toBe(rajEmail.accountId);

    const again = await refusalOf(
      createClient(IdentityProviderCommandController, rajOkta).redeemAccessMove({ ticket: ticket.ticket }),
    );
    expect(again.code).toBe(Code.FailedPrecondition);
  });

  it("lets only an owner turn the requirement off", async () => {
    const providers = await listProviders(owner.transport);
    const stored = providers.entries[0]!;
    const off = { ...stored, spec: { ...stored.spec!, ssoRequired: false } };
    const refused = await refusalOf(createClient(IdentityProviderCommandController, rajOkta).update(off));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(OWNERS_DECIDE_SSO_REQUIRED_MESSAGE);
    const updated = await createClient(IdentityProviderCommandController, owner.transport).update(off);
    expect(updated.spec?.ssoRequired).toBe(false);
    // Nothing is required any more, so the refusal is the plain one: the
    // email account moved everything it held and holds nothing there.
    const plain = await refusalOf(listProviders(rajEmail.transport));
    expect(plain.code).toBe(Code.PermissionDenied);
    expect(plain.findDetails(ErrorInfoSchema)).toEqual([]);
  });
});
