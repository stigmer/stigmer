/**
 * The self-hosted Enterprise server's account service
 * (editions/enterprise-accounts.ts) held to the account surface's contract
 * kit (iam/account/port-contract.ts): a federated account made through the
 * library's own create path and found by its natural key, a held account
 * answered as `DuplicateAccountError`, a profile written email included,
 * and a delete that leaves no key, no policy row and no row behind.
 *
 * The service is the one the server composes, filled from the same
 * hand-over: a unit composed after the entry's receives the composition's
 * account domain and in-process transport, on a licensed server over
 * Postgres whose two federation issuers (acme-okta and acme-entra, in one
 * organization) vouch for every account the cases make; the provider
 * lines read one subject under both, and each provider's own accounts.
 * Keys are made through the library's own key lane as the account's
 * person, and read back as the server.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate).
 */
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import {
  identityAccountServiceContract,
  type IdentityAccountServiceUnderTest,
} from "../../iam/account/port-contract.js";
import { licenseClaims, newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { newEnterpriseAccounts } from "../enterprise-accounts.js";
import {
  bootEnterprise,
  createOrganization,
  createIssuer,
  issueKey,
  keysOf,
  policyRowsNaming,
  signIn,
  testClock,
  type BootedServer,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");

describe.skipIf(TEST_DATABASE_URL === undefined)("the Enterprise account service holds the account surface's contract", () => {
  const signer = newTestSigner();
  const accounts = newEnterpriseAccounts();
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let underTest: IdentityAccountServiceUnderTest;

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
      extraUnits: [
        {
          name: "account-service-under-test",
          onComposed: (services) => {
            accounts.fill(services);
          },
        },
      ],
    });
    const owner = await signIn(booted, issuer, "operator|alice");
    const acme = await createOrganization(owner, "acme");
    const provider = await createIssuer(owner, issuer, acme, "acme-okta");
    const otherIssuer = await createIssuer(owner, issuer, acme, "acme-entra");
    const server = booted.server;
    underTest = {
      service: accounts.service,
      provider: { org: acme, slug: "acme-okta", id: provider.metadata?.id ?? "" },
      otherIssuer: { org: acme, slug: "acme-entra", id: otherIssuer.metadata?.id ?? "" },
      issueKey: async (account) => {
        await issueKey(server, account.metadata?.id ?? "", acme);
      },
      keysOf: (accountId) => keysOf(server, accountId),
      policyRowsNaming: (accountId) => policyRowsNaming(server, accountId),
    };
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  for (const contractCase of identityAccountServiceContract(() =>
    Promise.resolve({
      store: underTest,
      disconnect: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    }),
  )) {
    it(contractCase.name, contractCase.run);
  }
});
