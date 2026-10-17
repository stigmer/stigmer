/**
 * Who may create an organization on the self-hosted Enterprise server,
 * composed and driven end to end over real Postgres: the operator's list
 * (`STIGMER_ORGANIZATION_CREATORS`, handed to the composition as the entry
 * hands it) is enforced by the license unit's step on the library's
 * organization create chain, through every lane a person creates by.
 *
 *   - a listed person creates through the operator's sign-in lane before
 *     their account exists and after, through an API key of their own,
 *     and through apply;
 *   - an unlisted person is refused on create and on apply, through a key
 *     of their own too, with PERMISSION_DENIED, the reason and their own
 *     account id, and nothing is written: the slug they asked for stays
 *     free; a person whose account does not exist yet is refused naming
 *     the id their first sign-in will make;
 *   - an unlisted person who is an admin of an organization creates a
 *     child of it;
 *   - a license of one organization with a list still makes its
 *     organization at boot;
 *   - with no list, anyone signed in creates, as without the setting.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate).
 */
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GrantCommandController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/command_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { accountIdFor } from "@stigmer/server";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { licenseClaims, newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { ORGANIZATION_CREATOR_NOT_LISTED } from "../organization-creators.js";
import {
  bootEnterprise,
  createOrganization,
  grant,
  issueKey,
  OPERATOR_AUDIENCE,
  OPERATOR_ISSUER_NAME,
  ref,
  refusalOf,
  signIn,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
/** A test that boots a server waits for it, as the suite's own setup does. */
const BOOTS = 120_000;

/** The listed person's subject on the operator's issuer, and their account. */
const LENA = "operator|lena";
const LENA_ACCOUNT = accountIdFor(LENA);

/** A request for a top-level organization, or a child of `parentOrg`. */
function organization(slug: string, parentOrg = "") {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: "an organization", parentOrg },
  };
}

/** A person's token on the operator's issuer, with no account provisioned. */
function unprovisioned(issuer: LoopbackIssuer, booted: BootedServer, sub: string): Transport {
  return transportTo(booted.port, issuer.mint(OPERATOR_ISSUER_NAME, { sub, aud: OPERATOR_AUDIENCE }));
}

/** The refusal is the creators list's, naming `account`, and wrote nothing. */
function expectNotListed(refusal: ConnectError, account: string): void {
  expect(refusal.code).toBe(Code.PermissionDenied);
  const [info] = refusal.findDetails(ErrorInfoSchema);
  expect(info?.reason).toBe(ORGANIZATION_CREATOR_NOT_LISTED);
  expect(info?.metadata).toEqual({ account });
  expect(refusal.rawMessage).toContain(`yours (${account}) is not one of them`);
}

describe.skipIf(TEST_DATABASE_URL === undefined)("who may create an organization on a licensed server", () => {
  const signer = newTestSigner();
  const clock = testClock(new Date(ISSUED.getTime() + DAY_MS));
  const licenseKey = writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 }));
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let lena: Person;
  let ugo: Person;
  let lenaOrg = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      issuer,
      licenseKey,
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      organizationCreators: new Set([LENA_ACCOUNT]),
    });
  }, BOOTS);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("lets a listed person create before their account exists and after", async () => {
    const first = await createClient(OrganizationCommandController, unprovisioned(issuer, booted, LENA)).create(
      organization("lena-first"),
    );
    expect(first.metadata?.id).toMatch(/^org_/);

    lena = await signIn(booted, issuer, LENA);
    expect(lena.accountId).toBe(LENA_ACCOUNT);
    lenaOrg = await createOrganization(lena, "lena-labs");
    expect(lenaOrg).toMatch(/^org_/);
  });

  it("lets a listed person create through an API key of their own, and through apply", async () => {
    const key = await issueKey(booted.server, LENA_ACCOUNT, lenaOrg);
    const viaKey = await createClient(OrganizationCommandController, transportTo(booted.port, key)).create(
      organization("lena-keyed"),
    );
    expect(viaKey.metadata?.id).toMatch(/^org_/);

    const applied = await createClient(OrganizationCommandController, lena.transport).apply(organization("lena-applied"));
    expect(applied.metadata?.id).toMatch(/^org_/);
  });

  it("refuses an unlisted person on create and on apply, naming their account, and writes nothing", async () => {
    ugo = await signIn(booted, issuer, "operator|ugo");
    const organizations = createClient(OrganizationCommandController, ugo.transport);
    expectNotListed(await refusalOf(organizations.create(organization("ugo-wanted"))), ugo.accountId);
    expectNotListed(await refusalOf(organizations.apply(organization("ugo-wanted"))), ugo.accountId);

    const key = await issueKey(booted.server, ugo.accountId, "");
    expectNotListed(
      await refusalOf(
        createClient(OrganizationCommandController, transportTo(booted.port, key)).create(organization("ugo-keyed")),
      ),
      ugo.accountId,
    );

    // Nothing was written: the slug the refused create asked for is free.
    expect((await createOrganization(lena, "ugo-wanted")).length).toBeGreaterThan(0);
  });

  it("refuses a person whose account does not exist yet, naming the id their first sign-in makes", async () => {
    const refusal = await refusalOf(
      createClient(OrganizationCommandController, unprovisioned(issuer, booted, "operator|vera")).create(
        organization("vera-first"),
      ),
    );
    expectNotListed(refusal, accountIdFor("operator|vera"));
  });

  it("lets an unlisted admin of an organization create a child of it", async () => {
    await createClient(GrantCommandController, lena.transport).create(
      grant(ref("identity_account", ugo.accountId), "admin", ref("organization", lenaOrg)),
    );
    const child = await createClient(OrganizationCommandController, ugo.transport).create(
      organization("lena-labs-research", lenaOrg),
    );
    expect(child.spec?.parentOrg).toBe(lenaOrg);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("a license of one organization with a creators list", () => {
  const signer = newTestSigner();
  const clock = testClock(new Date(ISSUED.getTime() + DAY_MS));
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30, maxOrgs: 1 })),
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      organizationCreators: new Set([LENA_ACCOUNT]),
    });
  }, BOOTS);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("makes its organization at boot, which the server's own create is admitted to", async () => {
    expect((await createClient(PlatformQueryController, transportTo(booted.port)).getServerInfo({})).singleOrg).toBe(true);
    const lena = await signIn(booted, issuer, LENA);
    const held = await createClient(OrganizationQueryController, lena.transport).listMine({});
    expect(held.entries.map((org) => org.metadata?.slug)).toEqual(["stigmer"]);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("a licensed server with no creators list", () => {
  const signer = newTestSigner();
  const clock = testClock(new Date(ISSUED.getTime() + DAY_MS));
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
    });
  }, BOOTS);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("lets anyone signed in create an organization", async () => {
    const ugo = await signIn(booted, issuer, "operator|ugo");
    expect(await createOrganization(ugo, "ugo-own")).toMatch(/^org_/);
  });
});
