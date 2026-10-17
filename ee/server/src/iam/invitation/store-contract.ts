/**
 * The InvitationStore contract kit (store.ts): every outcome a driver of the
 * port must answer identically, as cases a driver's test iterates. It runs
 * over the in-memory store the lane's unit suite uses and over the adapter a
 * host runs, so the published suites exercise a double proven equal to a
 * real driver.
 *
 * The lines, in the port's words:
 *   - a saved invitation is read back by id and by token, and an unknown
 *     id or token answers undefined;
 *   - revoke writes a held invitation's state under its row lock and keeps
 *     the creation time the list orders by; it answers undefined for a row
 *     that is gone, and an already-revoked row as it is;
 *   - the list (`pageByOrg`) is the organization's invitations, newest
 *     first, ties broken by id in byte order, continuing strictly after a
 *     cursor it rendered and at most a limit; the cursor is the row's
 *     creation instant in UTC at microseconds and its id;
 *   - the sweep (`findIdsByOrg`) is every one of the organization's ids,
 *     and `findAll` every invitation of every organization;
 *   - a delete removes the invitation from every read, and an unknown id
 *     resolves;
 *   - a redemption is counted and recorded with the person and the whole
 *     second, latches `fully_redeemed` exactly when the persisted count
 *     reaches the limit, and is `refused` past the limit, on a revoked row
 *     or for an unknown id, writing nothing; of concurrent redemptions of
 *     a link's last seat, exactly one is recorded;
 *   - a release removes the one entry matching the person and the whole
 *     second, decrements the count and reopens a latch it brings back under
 *     the limit; it never reopens a revoked row, and answers `absent`,
 *     writing nothing, for another person, another second or an unknown
 *     row;
 *   - an outage is a fault, never "no invitation": a token read that
 *     answered `undefined` from a broken store would turn a valid link
 *     away, and a redemption must never read as refused.
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner: a fresh fixture per case, a failing assertion
 * winning over a failing cleanup, node:assert rather than a test framework
 * so the kit ships with the code it describes.
 */
import assert from "node:assert/strict";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import {
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { InvitationStore, RedemptionOutcome } from "./store.js";

/** The runner's fixture over this port. */
export type InvitationStoreContractFixture = PortContractFixture<InvitationStore>;

const REDEEMED_AT = new Date("2026-09-26T12:00:00Z");

/** An active invitation as the create chain shapes one. */
function invitation(fields: {
  id: string;
  org: string;
  token: string;
  maxRedemptions?: number;
  createdAt?: Date;
}): Invitation {
  const stamp = timestampFromDate(fields.createdAt ?? new Date("2026-09-26T10:00:00Z"));
  return create(InvitationSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: { id: fields.id, org: fields.org, name: fields.id },
    spec: {
      role: IamRole.member,
      maxRedemptions: fields.maxRedemptions ?? 0,
      expiresAt: timestampFromDate(new Date("2026-10-26T10:00:00Z")),
    },
    status: {
      token: fields.token,
      state: InvitationState.active,
      redemptionCount: 0,
      audit: { specAudit: { createdAt: stamp, updatedAt: stamp } },
    },
  });
}

/** The organization's ids as the list reads them, every page at once. */
async function listed(store: InvitationStore, org: string): Promise<string[]> {
  return (await store.pageByOrg(org, undefined, undefined)).map((row) => row.id);
}

function recordedOf(outcome: RedemptionOutcome): Invitation {
  assert.ok(outcome.kind === "recorded", "expected the redemption to be recorded");
  return outcome.invitation;
}

/** Revokes the invitation through the port. */
async function revoke(store: InvitationStore, id: string): Promise<void> {
  const revoked = await store.revoke(id);
  assert.equal(revoked?.status?.state, InvitationState.revoked, `invitation ${id} is held and revoked`);
}

const CASES: ReadonlyArray<PortContractDeclaration<InvitationStore>> = [
  [
    "a saved invitation is read back by id and by token, and an unknown one answers undefined",
    async ({ store }) => {
      const written = invitation({ id: "inv_c1", org: "acme", token: "RoundTrip" });
      await store.save(written);
      assert.deepEqual(await store.findById("inv_c1"), written);
      assert.deepEqual(await store.findByToken("RoundTrip"), written);
      assert.equal(await store.findById("inv_unknown"), undefined);
      assert.equal(await store.findByToken("NoSuchToken"), undefined);
    },
  ],
  [
    "revoke writes a held invitation's state and keeps the creation time the list orders by",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_u1", org: "updated", token: "Tokenu1", createdAt: new Date("2026-09-20T09:00:00Z") }));
      await store.save(invitation({ id: "inv_u2", org: "updated", token: "Tokenu2", createdAt: new Date("2026-09-20T11:00:00Z") }));
      await revoke(store, "inv_u1");
      assert.equal((await store.findById("inv_u1"))?.status?.state, InvitationState.revoked);
      assert.deepEqual(await listed(store, "updated"), ["inv_u2", "inv_u1"]);
    },
  ],
  [
    "revoke answers undefined for a row that is gone, and an already-revoked row as it is",
    async ({ store }) => {
      assert.equal(await store.revoke("inv_gone"), undefined);
      await store.save(invitation({ id: "inv_r1", org: "revoked", token: "Tokenr1" }));
      await revoke(store, "inv_r1");
      const again = await store.revoke("inv_r1");
      assert.equal(again?.status?.state, InvitationState.revoked);
      assert.deepEqual(again, await store.findById("inv_r1"));
    },
  ],
  [
    "the list is newest first, ties by id in byte order, strictly after a cursor and at most a limit",
    async ({ store }) => {
      const tie = new Date("2026-09-25T12:00:00Z");
      for (const [id, token, createdAt] of [
        ["inv_k_old", "KOld", new Date("2026-09-25T11:00:00Z")],
        ["inv_k_a", "KA", tie],
        ["inv_k_B", "KB", tie],
        ["inv_k_new", "KNew", new Date("2026-09-25T13:00:00Z")],
      ] as const) {
        await store.save(invitation({ id, org: "keyset", token, createdAt }));
      }
      await store.save(invitation({ id: "inv_k_other", org: "elsewhere", token: "KOther", createdAt: tie }));

      // Byte order puts "B" (0x42) before "a" (0x61), so newest first reads
      // inv_k_a before inv_k_B; a collation-aware order would not.
      const all = await store.pageByOrg("keyset", undefined, undefined);
      assert.deepEqual(all.map((row) => row.id), ["inv_k_new", "inv_k_a", "inv_k_B", "inv_k_old"]);
      assert.deepEqual(all[1]?.cursor, { createdAt: "2026-09-25T12:00:00.000000Z", id: "inv_k_a" });

      const first = await store.pageByOrg("keyset", undefined, 2);
      assert.deepEqual(first.map((row) => row.id), ["inv_k_new", "inv_k_a"]);
      const rest = await store.pageByOrg("keyset", first[1]?.cursor, 2);
      assert.deepEqual(rest.map((row) => row.id), ["inv_k_B", "inv_k_old"]);
      assert.deepEqual(await store.pageByOrg("keyset", rest[1]?.cursor, 2), []);
    },
  ],
  [
    "the sweep is every id of the organization, and findAll every invitation of every organization",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_s1", org: "swept", token: "Tokens1" }));
      await store.save(invitation({ id: "inv_s2", org: "swept", token: "Tokens2" }));
      await store.save(invitation({ id: "inv_s3", org: "kept", token: "Tokens3" }));
      assert.deepEqual([...(await store.findIdsByOrg("swept"))].sort(), ["inv_s1", "inv_s2"]);
      assert.deepEqual(
        (await store.findAll()).map((row) => row.metadata?.id).sort(),
        ["inv_s1", "inv_s2", "inv_s3"],
      );
    },
  ],
  [
    "a delete removes the invitation from every read, and an unknown id resolves",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_d1", org: "acme", token: "Tokend1" }));
      await store.save(invitation({ id: "inv_d2", org: "acme", token: "Tokend2" }));
      await store.deleteById("inv_d1");
      await assert.doesNotReject(store.deleteById("inv_never"));
      assert.equal(await store.findById("inv_d1"), undefined);
      assert.equal(await store.findByToken("Tokend1"), undefined);
      assert.deepEqual(await listed(store, "acme"), ["inv_d2"]);
      assert.deepEqual(await store.findIdsByOrg("acme"), ["inv_d2"]);
      assert.deepEqual((await store.findAll()).map((row) => row.metadata?.id), ["inv_d2"]);
    },
  ],
  [
    "a redemption is counted and recorded, latches fully_redeemed at the limit, and is refused past it",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_r", org: "acme", token: "Redeem", maxRedemptions: 2 }));

      const first = recordedOf(await store.recordRedemption("inv_r", "ida_one", REDEEMED_AT));
      assert.equal(first.status?.redemptionCount, 1);
      assert.equal(first.status?.state, InvitationState.active);

      const second = recordedOf(await store.recordRedemption("inv_r", "ida_two", new Date(REDEEMED_AT.getTime() + 1500)));
      assert.equal(second.status?.redemptionCount, 2);
      assert.equal(second.status?.state, InvitationState.fully_redeemed);
      assert.deepEqual(
        second.status?.redemptions.map((entry) => [entry.identityAccountId, entry.redeemedAt?.seconds]),
        [
          ["ida_one", BigInt(REDEEMED_AT.getTime() / 1000)],
          ["ida_two", BigInt(REDEEMED_AT.getTime() / 1000) + 1n],
        ],
        "each entry keeps the person and the whole second",
      );
      assert.deepEqual(await store.findById("inv_r"), second, "the answer is the persisted row");

      assert.deepEqual(await store.recordRedemption("inv_r", "ida_three", REDEEMED_AT), { kind: "refused" });
      assert.equal((await store.findById("inv_r"))?.status?.redemptionCount, 2, "a refused redemption writes nothing");
    },
  ],
  [
    "an unlimited link counts every redemption and never latches",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_open", org: "acme", token: "Open" }));
      for (const person of ["ida_a", "ida_b", "ida_c"]) {
        recordedOf(await store.recordRedemption("inv_open", person, REDEEMED_AT));
      }
      const row = await store.findById("inv_open");
      assert.equal(row?.status?.redemptionCount, 3);
      assert.equal(row?.status?.state, InvitationState.active);
    },
  ],
  [
    "a redemption is refused on a revoked row and for an unknown id, writing nothing",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_rv", org: "acme", token: "Revoked" }));
      await revoke(store, "inv_rv");
      assert.deepEqual(await store.recordRedemption("inv_rv", "ida_one", REDEEMED_AT), { kind: "refused" });
      assert.equal((await store.findById("inv_rv"))?.status?.redemptionCount, 0);
      assert.deepEqual(await store.recordRedemption("inv_never", "ida_one", REDEEMED_AT), { kind: "refused" });
      assert.equal(await store.findById("inv_never"), undefined);
    },
  ],
  [
    "of concurrent redemptions of a link's last seat, exactly one is recorded",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_c", org: "acme", token: "Raced", maxRedemptions: 1 }));
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, (_, index) => store.recordRedemption("inv_c", `ida_${index}`, REDEEMED_AT)),
      );
      assert.equal(outcomes.filter((outcome) => outcome.kind === "recorded").length, 1);
      const row = await store.findById("inv_c");
      assert.equal(row?.status?.redemptionCount, 1);
      assert.equal(row?.status?.redemptions.length, 1);
      assert.equal(row?.status?.state, InvitationState.fully_redeemed);
    },
  ],
  [
    "a release removes the one entry it names and reopens the latch it brings back under the limit",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_rl", org: "acme", token: "Release", maxRedemptions: 2 }));
      const early = REDEEMED_AT;
      const late = new Date(REDEEMED_AT.getTime() + 5000);
      await store.recordRedemption("inv_rl", "ida_one", early);
      await store.recordRedemption("inv_rl", "ida_two", late);
      assert.equal((await store.findById("inv_rl"))?.status?.state, InvitationState.fully_redeemed);

      // The ledger keeps whole seconds, so the same second names the entry.
      const sameSecond = new Date(late.getTime() + 400);
      assert.deepEqual(await store.releaseRedemption("inv_rl", "ida_two", sameSecond), { kind: "released" });
      const released = await store.findById("inv_rl");
      assert.equal(released?.status?.redemptionCount, 1);
      assert.deepEqual(released?.status?.redemptions.map((entry) => entry.identityAccountId), ["ida_one"]);
      assert.equal(released?.status?.state, InvitationState.active);
    },
  ],
  [
    "a release answers absent for another person, another second or an unknown row, writing nothing",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_ab", org: "acme", token: "Absent", maxRedemptions: 1 }));
      await store.recordRedemption("inv_ab", "ida_one", REDEEMED_AT);
      assert.deepEqual(await store.releaseRedemption("inv_ab", "ida_two", REDEEMED_AT), { kind: "absent" });
      assert.deepEqual(
        await store.releaseRedemption("inv_ab", "ida_one", new Date(REDEEMED_AT.getTime() + 2000)),
        { kind: "absent" },
      );
      assert.deepEqual(await store.releaseRedemption("inv_never", "ida_one", REDEEMED_AT), { kind: "absent" });
      const row = await store.findById("inv_ab");
      assert.equal(row?.status?.redemptionCount, 1);
      assert.equal(row?.status?.state, InvitationState.fully_redeemed);
    },
  ],
  [
    "a release never reopens a revoked row",
    async ({ store }) => {
      await store.save(invitation({ id: "inv_rr", org: "acme", token: "RevokedRelease", maxRedemptions: 1 }));
      await store.recordRedemption("inv_rr", "ida_one", REDEEMED_AT);
      await revoke(store, "inv_rr");
      assert.deepEqual(await store.releaseRedemption("inv_rr", "ida_one", REDEEMED_AT), { kind: "released" });
      const row = await store.findById("inv_rr");
      assert.equal(row?.status?.redemptionCount, 0);
      assert.equal(row?.status?.state, InvitationState.revoked);
    },
  ],
  [
    "an outage is a fault, never 'no invitation'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(store.findByToken("RoundTrip"));
      await assert.rejects(store.findById("inv_any"));
      await assert.rejects(store.pageByOrg("acme", undefined, undefined));
      await assert.rejects(store.findAll());
      await assert.rejects(store.recordRedemption("inv_any", "ida_one", REDEEMED_AT), "an outage never reads as refused");
      await assert.rejects(store.releaseRedemption("inv_any", "ida_one", REDEEMED_AT), "an outage never reads as absent");
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function invitationStoreContract(
  makeFixture: () => Promise<InvitationStoreContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
