/**
 * The SignInGrantLedger contract kit (sign-in-grants.ts): every answer a
 * driver of the port must give identically, as cases a driver's test
 * iterates. It runs over the in-memory ledger the federated lane's suites
 * use and over the adapter a host runs, so the published suites exercise a
 * double proven equal to a real driver.
 *
 * The lines, in the port's words:
 *   - a first sign-in is claimed once: the claim that writes the row is
 *     answered true, every later one false, and the row reads as recorded;
 *   - of any number of concurrent claims, exactly one is answered true;
 *   - each (account, organization) is its own row: another organization of
 *     the same account, or another account in the same organization, is
 *     claimed on its own;
 *   - a released row is no longer recorded and can be claimed again, and
 *     releasing a row that is not there resolves;
 *   - an organization's removal takes every account's row for that
 *     organization and no other's, answers how many went, and a second run
 *     removes nothing;
 *   - an outage is a fault, never "not recorded" and never "not claimed": a
 *     ledger that read false from a broken store would grant the sign-in
 *     role again.
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner: a fresh fixture per case, a failing assertion
 * winning over a failing cleanup, node:assert rather than a test framework
 * so the kit ships with the code it describes.
 */
import assert from "node:assert/strict";

import {
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { SignInGrantLedger } from "./sign-in-grants.js";

/** The runner's fixture over this port. */
export type SignInGrantLedgerContractFixture = PortContractFixture<SignInGrantLedger>;

const CASES: ReadonlyArray<PortContractDeclaration<SignInGrantLedger>> = [
  [
    "a first sign-in is claimed once and reads as recorded",
    async ({ store }) => {
      assert.equal(await store.recorded("ida_a", "org_alpha"), false);
      assert.equal(await store.claim("ida_a", "org_alpha", "fis_1"), true, "the claim that writes the row wins");
      assert.equal(await store.claim("ida_a", "org_alpha", "fis_1"), false, "a later claim never wins");
      assert.equal(await store.claim("ida_a", "org_alpha", "fis_2"), false, "nor a later one through another provider");
      assert.equal(await store.recorded("ida_a", "org_alpha"), true);
    },
  ],
  [
    "of concurrent claims, exactly one wins",
    async ({ store }) => {
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => store.claim("ida_race", "org_alpha", "fis_1")),
      );
      assert.equal(outcomes.filter(Boolean).length, 1);
      assert.equal(await store.recorded("ida_race", "org_alpha"), true);
    },
  ],
  [
    "each (account, organization) is its own row",
    async ({ store }) => {
      assert.equal(await store.claim("ida_b", "org_alpha", "fis_1"), true);
      assert.equal(await store.claim("ida_b", "org_beta", "fis_1"), true, "another organization of the same account");
      assert.equal(await store.claim("ida_c", "org_alpha", "fis_1"), true, "another account in the same organization");
      assert.equal(await store.recorded("ida_d", "org_alpha"), false);
      assert.equal(await store.recorded("ida_b", "org_gamma"), false);
    },
  ],
  [
    "a released row is no longer recorded and can be claimed again",
    async ({ store }) => {
      assert.equal(await store.claim("ida_e", "org_alpha", "fis_1"), true);
      assert.equal(await store.claim("ida_e", "org_beta", "fis_1"), true);
      await store.release("ida_e", "org_alpha");
      assert.equal(await store.recorded("ida_e", "org_alpha"), false);
      assert.equal(await store.recorded("ida_e", "org_beta"), true, "a release takes only the row it names");
      assert.equal(await store.claim("ida_e", "org_alpha", "fis_1"), true);
      await assert.doesNotReject(store.release("ida_never", "org_alpha"));
    },
  ],
  [
    "an organization's removal takes its rows and no other's, counts them, and a second run removes nothing",
    async ({ store }) => {
      await store.claim("ida_f", "org_gone", "fis_1");
      await store.claim("ida_g", "org_gone", "fis_2");
      await store.claim("ida_f", "org_kept", "fis_1");
      assert.equal(await store.removeByOrgId("org_gone"), 2);
      assert.equal(await store.recorded("ida_f", "org_gone"), false);
      assert.equal(await store.recorded("ida_g", "org_gone"), false);
      assert.equal(await store.recorded("ida_f", "org_kept"), true);
      assert.equal(await store.removeByOrgId("org_gone"), 0);
      assert.equal(await store.removeByOrgId("org_never"), 0);
    },
  ],
  [
    "an outage is a fault, never 'not recorded'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(store.recorded("ida_a", "org_alpha"));
      await assert.rejects(store.claim("ida_a", "org_alpha", "fis_1"));
      await assert.rejects(store.release("ida_a", "org_alpha"));
      await assert.rejects(store.removeByOrgId("org_alpha"));
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function signInGrantLedgerContract(
  makeFixture: () => Promise<SignInGrantLedgerContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
