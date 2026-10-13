/**
 * The AccessMoveTicketStore contract kit (store.ts): every answer a driver
 * of the port must give identically, as cases a driver's test iterates. It
 * runs over the in-memory store the move's suites use and over the
 * adapter a host runs, so the suites exercise a double proven equal to a
 * real driver.
 *
 * The lines, in the port's words:
 *   - a ticket reads back as written, unredeemed, and a hash nobody holds
 *     reads as none;
 *   - a hash already held refuses a second insert;
 *   - a ticket belongs to its first redeemer: claiming it for that account
 *     again is answered true, for another account false, and claiming a
 *     hash nobody holds false;
 *   - a ticket closes once: the call that marks it redeemed is answered
 *     true, every later one false, and it reads as redeemed at that instant;
 *     marking a hash nobody holds answers false;
 *   - the sweep removes the tickets that expired before the instant asked
 *     and no other, and answers how many;
 *   - an organization's removal takes its tickets and no other's, and a
 *     second run removes nothing;
 *   - an outage is a fault, never "no ticket" and never "not redeemed".
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner, as the sign-in grant ledger's kit is.
 */
import assert from "node:assert/strict";

import {
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { AccessMoveTicketStore } from "./store.js";

/** The runner's fixture over this port. */
export type AccessMoveTicketStoreContractFixture = PortContractFixture<AccessMoveTicketStore>;

const NOW = new Date("2026-10-13T12:00:00.000Z");
const LATER = new Date("2026-10-13T12:10:00.000Z");

function ticket(tokenHash: string, org: string, expiresAt: Date = LATER) {
  return { tokenHash, accountId: `ida_${tokenHash}`, org, expiresAt };
}

const CASES: ReadonlyArray<PortContractDeclaration<AccessMoveTicketStore>> = [
  [
    "a ticket reads back as written, unredeemed, and an unknown hash reads as none",
    async ({ store }) => {
      await store.insert(ticket("hash_a", "org_alpha"));
      assert.deepEqual(await store.findByHash("hash_a"), {
        tokenHash: "hash_a",
        accountId: "ida_hash_a",
        org: "org_alpha",
        expiresAt: LATER,
        redeemedAt: undefined,
        redeemerId: undefined,
      });
      assert.equal(await store.findByHash("hash_nobody"), undefined);
    },
  ],
  [
    "a hash already held refuses a second insert",
    async ({ store }) => {
      await store.insert(ticket("hash_a", "org_alpha"));
      await assert.rejects(store.insert(ticket("hash_a", "org_beta")));
      assert.equal((await store.findByHash("hash_a"))?.org, "org_alpha");
    },
  ],
  [
    "a ticket belongs to its first redeemer, who alone may claim it again",
    async ({ store }) => {
      await store.insert(ticket("hash_a", "org_alpha"));
      assert.equal(await store.claimFor("hash_a", "ida_first"), true, "the first redeemer");
      assert.equal(await store.claimFor("hash_a", "ida_first"), true, "the same redeemer again");
      assert.equal(await store.claimFor("hash_a", "ida_second"), false, "another account");
      assert.equal((await store.findByHash("hash_a"))?.redeemerId, "ida_first");
      assert.equal(await store.claimFor("hash_nobody", "ida_first"), false);
    },
  ],
  [
    "a ticket closes once, and reads as redeemed at that instant",
    async ({ store }) => {
      await store.insert(ticket("hash_a", "org_alpha"));
      assert.equal(await store.markRedeemed("hash_a", NOW), true, "the call that closes it");
      assert.equal(await store.markRedeemed("hash_a", LATER), false, "never again");
      assert.deepEqual((await store.findByHash("hash_a"))?.redeemedAt, NOW);
      assert.equal(await store.markRedeemed("hash_nobody", NOW), false);
    },
  ],
  [
    "the sweep removes the tickets that expired before the instant asked, and no other",
    async ({ store }) => {
      await store.insert(ticket("hash_old", "org_alpha", NOW));
      await store.insert(ticket("hash_new", "org_alpha", LATER));
      assert.equal(await store.deleteExpired(LATER), 1);
      assert.equal(await store.findByHash("hash_old"), undefined);
      assert.notEqual(await store.findByHash("hash_new"), undefined);
    },
  ],
  [
    "an organization's removal takes its tickets and no other's, and a second run removes nothing",
    async ({ store }) => {
      await store.insert(ticket("hash_a", "org_alpha"));
      await store.insert(ticket("hash_b", "org_alpha"));
      await store.insert(ticket("hash_c", "org_beta"));
      assert.equal(await store.removeByOrgId("org_alpha"), 2);
      assert.equal(await store.removeByOrgId("org_alpha"), 0);
      assert.notEqual(await store.findByHash("hash_c"), undefined);
    },
  ],
  [
    "an outage is a fault, never 'no ticket' and never 'not redeemed'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(store.insert(ticket("hash_a", "org_alpha")));
      await assert.rejects(store.findByHash("hash_a"));
      await assert.rejects(store.claimFor("hash_a", "ida_first"));
      await assert.rejects(store.markRedeemed("hash_a", NOW));
      await assert.rejects(store.deleteExpired(NOW));
      await assert.rejects(store.removeByOrgId("org_alpha"));
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function accessMoveTicketStoreContract(
  makeFixture: () => Promise<AccessMoveTicketStoreContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
