/**
 * The host duties the identity unit asks of every host
 * (extension/enterprise-identity.ts), as the self-hosted Enterprise server
 * meets them, each pinned by composing that server and driving it:
 *
 *   - the operator's issuer is reserved: a provider naming it is refused,
 *     and so is the same issuer with a trailing slash;
 *   - the library's own OIDC lane claims ahead of the federated lane, and a
 *     token from the operator's issuer resolves to the person's own direct
 *     account;
 *   - every URL a provider names is dialed through the guarded fetch under
 *     the operator's egress posture: by default (strict) a provider on a
 *     loopback address is refused without ever being dialed; on the
 *     operator's word (relaxed) it is saved, its documents dialed through
 *     the composition's dialer, while a link-local key set or issuer (the
 *     instance metadata address) is still refused without being dialed;
 *   - a person a provider vouches for is refused the direct provisioning;
 *   - no unit declares the require-authentication posture: the library's
 *     own OIDC configuration is what signs callers in.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate).
 */
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { ENTERPRISE_IDENTITY_UNIT } from "../../extension/enterprise-identity.js";
import {
  bootEnterprise,
  createOrganization,
  federatedToken,
  licenseClaims,
  OPERATOR_ISSUER_NAME,
  providerRequest,
  refusalOf,
  signIn,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const LINK_LOCAL = "169.254.169.254";

describe.skipIf(TEST_DATABASE_URL === undefined)("the self-hosted Enterprise server's host duties", () => {
  const signer = newTestSigner();
  const dialed: string[] = [];
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let owner: Person;
  let acme = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    const loopback = issuer.fetch;
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: testClock(new Date(ISSUED.getTime() + 24 * 60 * 60 * 1000)).read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      dialer: (input, init) => {
        dialed.push(new URL(input instanceof Request ? input.url : String(input)).href);
        return loopback(input, init);
      },
    });
    owner = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(owner, "acme");
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("reserves the operator's issuer, its trailing-slash spelling included", async () => {
    const providers = createClient(FederationIssuerCommandController, owner.transport);
    const operator = issuer.issuerUrl(OPERATOR_ISSUER_NAME);
    for (const spelling of [operator, `${operator}/`]) {
      const refused = await refusalOf(
        providers.create(providerRequest(issuer, acme, "acme-captured", { issuers: [spelling] })),
      );
      expect(refused.code, spelling).toBe(Code.InvalidArgument);
      expect(refused.rawMessage).toContain("this platform's own sign-in issuer");
    }
  });

  it("runs the library's OIDC lane ahead of the federated lane, and an operator token is the person's direct account", async () => {
    const names = booted.server.identityVerifiers.map((verifier) => verifier.name);
    const federated = names.indexOf("federated-idp");
    expect(federated, `verifiers: ${names.join(", ")}`).toBeGreaterThan(-1);
    const oidc = names.findIndex((name) => name.toLowerCase().includes("oidc"));
    expect(oidc, `verifiers: ${names.join(", ")}`).toBeGreaterThan(-1);
    expect(oidc).toBeLessThan(federated);
    const me = await createClient(IdentityAccountQueryController, owner.transport).whoAmI({});
    expect(me.metadata?.id).toBe(owner.accountId);
    expect(me.spec?.provisioningMode).toBe(IdentityAccountProvisioningMode.direct);
  });

  it("by default refuses a provider on a loopback address without dialing it", async () => {
    const strictDialed: string[] = [];
    const strictDb = await provisionEnterpriseDatabase();
    const loopback = issuer.fetch;
    const strict = await bootEnterprise({
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: testClock(new Date(ISSUED.getTime() + 24 * 60 * 60 * 1000)).read,
      databaseUrl: strictDb.databaseUrl,
      pool: strictDb.pool,
      dialer: (input, init) => {
        strictDialed.push(new URL(input instanceof Request ? input.url : String(input)).href);
        return loopback(input, init);
      },
    });
    try {
      const strictOwner = await signIn(strict, issuer, "operator|bea");
      const org = await createOrganization(strictOwner, "beta");
      const refused = await refusalOf(
        createClient(FederationIssuerCommandController, strictOwner.transport).create(
          providerRequest(issuer, org, "beta-okta"),
        ),
      );
      expect(refused.code).toBe(Code.InvalidArgument);
      expect(strictDialed).toEqual([]);
    } finally {
      await strict.close();
      await strictDb.drop();
    }
  }, 120_000);

  it("on the operator's word dials every provider URL through the guarded fetch: a loopback provider is saved, link-local is never dialed", async () => {
    const providers = createClient(FederationIssuerCommandController, owner.transport);
    dialed.length = 0;
    await providers.create(providerRequest(issuer, acme, "acme-okta"));
    expect(dialed).toContain(`${issuer.tlsIssuerUrl("acme-okta")}/.well-known/openid-configuration`);
    expect(dialed).toContain(`${issuer.tlsIssuerUrl("acme-okta")}/jwks`);

    dialed.length = 0;
    const metadataIssuer = `https://${LINK_LOCAL}/acme`;
    const issuerRefused = await refusalOf(
      providers.create(
        providerRequest(issuer, acme, "acme-metadata", {
          issuers: [metadataIssuer],
          jwksUri: `${metadataIssuer}/jwks`,
        }),
      ),
    );
    expect(issuerRefused.code).toBe(Code.InvalidArgument);
    expect(dialed.filter((url) => url.includes(LINK_LOCAL))).toEqual([]);
  });

  it("refuses a person a provider vouches for the direct provisioning", async () => {
    const token = federatedToken(issuer, "acme-okta", "okta|dana", "dana@acme.example");
    const dana = transportTo(booted.port, token);
    expect((await createClient(IdentityAccountQueryController, dana).whoAmI({})).spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.federated,
    );
    const refused = await refusalOf(createClient(IdentityAccountCommandController, dana).provisionMyAccount({}));
    expect(refused.code).toBe(Code.PermissionDenied);
  });

  it("declares no require-authentication posture on any unit; the library's OIDC configuration requires it", async () => {
    expect(booted.units.map((unit) => unit.name)).toContain(ENTERPRISE_IDENTITY_UNIT);
    for (const unit of booted.units) {
      expect(unit.requireAuthentication, unit.name).toBeUndefined();
    }
    const info = await createClient(PlatformQueryController, transportTo(booted.port)).getServerInfo({});
    expect(info.authenticationRequired).toBe(true);
  });
});
