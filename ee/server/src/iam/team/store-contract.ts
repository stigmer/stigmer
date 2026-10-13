/**
 * The TeamStore contract kit (store.ts): every outcome a driver of the port
 * must answer identically, as cases a driver's test iterates. It runs over
 * the in-memory store the unit suites use and over the adapter a host runs,
 * so the published suites exercise a double proven equal to a real driver.
 *
 * The lines, in the port's words:
 *   - an insert is read back by id and in its organization's list (a
 *     lookup by slug reads the server's name table, never this port);
 *   - a slug the organization holds is `slug-taken`, writing nothing, while
 *     the same slug in another organization is admitted;
 *   - an insert whose id is already held is never answered `slug-taken`:
 *     only the organization's slug is a claim another team can hold;
 *   - the guarded write (`@stigmer/server`'s guarded-port kit): a swap on
 *     the bytes readForWrite answered lands, and loses after any write in
 *     between, on a row deleted since, or on bytes a landed swap replaced;
 *   - modifyById changes the payload and the slug together and answers the
 *     written team, so the old slug is free in the table and the new one
 *     taken; an unknown id answers undefined and writes nothing;
 *   - findByIds answers the teams of the ids that exist, skips the unknown,
 *     and an empty list reads nothing;
 *   - an organization's list is its teams, newest first, and no other
 *     organization's; its sweep is every one of their ids;
 *   - findAll is every team of every organization, oldest first;
 *   - a delete removes the team from every read, and an unknown id
 *     resolves;
 *   - an outage is a fault, never "no team": a read that answered
 *     `undefined` from a broken store would let a claim free a live team's
 *     name.
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner: a fresh fixture per case, a failing assertion
 * winning over a failing cleanup, node:assert rather than a test framework
 * so the kit ships with the code it describes.
 */
import assert from "node:assert/strict";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import {
  guardedPortDeclarations,
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { TeamStore } from "./store.js";

/** The runner's fixture over this port. */
export type TeamStoreContractFixture = PortContractFixture<TeamStore>;

/** A team as the create chain shapes one; `minute` orders creation times. */
function team(fields: { id: string; org: string; slug: string; name?: string; minute?: number }): Team {
  const stamp = timestampFromDate(new Date(Date.UTC(2026, 8, 24, 10, fields.minute ?? 0)));
  return create(TeamSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Team",
    metadata: { id: fields.id, org: fields.org, slug: fields.slug, name: fields.name ?? fields.slug },
    status: { audit: { specAudit: { createdAt: stamp, updatedAt: stamp } } },
  });
}

/** The ids of a read, in the order it answered them. */
function idsOf(teams: ReadonlyArray<Team>): Array<string | undefined> {
  return teams.map((held) => held.metadata?.id);
}

const CASES: ReadonlyArray<PortContractDeclaration<TeamStore>> = [
  [
    "an insert is read back by id and in its organization's list",
    async ({ store }) => {
      const written = team({ id: "tm_c1", org: "acme", slug: "sre", name: "Site Reliability" });
      assert.deepEqual(await store.insert(written), { kind: "inserted" });
      assert.equal((await store.findById("tm_c1"))?.metadata?.name, "Site Reliability");
      assert.deepEqual(idsOf(await store.listByOrg("acme")), ["tm_c1"]);
      assert.equal(await store.findById("tm_unknown"), undefined, "an unknown id answers undefined");
    },
  ],
  [
    "a slug the organization holds is slug-taken and writes nothing, and the same slug in another organization is admitted",
    async ({ store }) => {
      await store.insert(team({ id: "tm_c2", org: "acme", slug: "ops" }));
      assert.deepEqual(await store.insert(team({ id: "tm_c3", org: "acme", slug: "ops" })), { kind: "slug-taken" });
      assert.equal(await store.findById("tm_c3"), undefined, "a refused insert writes no row");
      assert.deepEqual(await store.insert(team({ id: "tm_c4", org: "beta", slug: "ops" })), { kind: "inserted" });
      assert.equal((await store.findById("tm_c4"))?.metadata?.slug, "ops");
    },
  ],
  [
    "an insert whose id is held is never answered slug-taken",
    async ({ store }) => {
      await store.insert(team({ id: "tm_c5", org: "acme", slug: "first" }));
      let outcome: unknown;
      try {
        outcome = await store.insert(team({ id: "tm_c5", org: "acme", slug: "second" }));
      } catch {
        outcome = "refused by the driver";
      }
      assert.notDeepEqual(outcome, { kind: "slug-taken" }, "a held id is not a held slug");
    },
  ],
  [
    "modifyById changes the payload and the slug together, and an unknown id writes nothing",
    async ({ store }) => {
      await store.insert(team({ id: "tm_c6m", org: "acme", slug: "before-move", name: "Moved" }));
      const moveTo = (slug: string) => (held: Team) => {
        if (held.metadata !== undefined) {
          held.metadata.slug = slug;
        }
      };
      const written = await store.modifyById("tm_c6m", moveTo("after-move"));
      assert.equal(written?.metadata?.slug, "after-move");
      assert.equal((await store.findById("tm_c6m"))?.metadata?.slug, "after-move");
      assert.deepEqual(
        await store.insert(team({ id: "tm_c6n", org: "acme", slug: "after-move" })),
        { kind: "slug-taken" },
        "the new slug is held",
      );
      assert.deepEqual(
        await store.insert(team({ id: "tm_c6o", org: "acme", slug: "before-move" })),
        { kind: "inserted" },
        "the old slug is free in the table",
      );
      assert.equal(await store.modifyById("tm_unknown", moveTo("anything")), undefined);
      assert.equal(await store.findById("tm_unknown"), undefined);
    },
  ],
  [
    "findByIds answers the teams that exist, skips the unknown, and reads nothing for an empty list",
    async ({ store }) => {
      await store.insert(team({ id: "tm_c7", org: "acme", slug: "f1" }));
      await store.insert(team({ id: "tm_c8", org: "beta", slug: "f2" }));
      const found = await store.findByIds(["tm_c8", "tm_unknown", "tm_c7"]);
      assert.deepEqual(idsOf(found).sort(), ["tm_c7", "tm_c8"]);
      assert.deepEqual(await store.findByIds([]), []);
    },
  ],
  [
    "an organization's list is its teams newest first, and its sweep is every one of their ids",
    async ({ store }) => {
      await store.insert(team({ id: "tm_l1", org: "listed", slug: "l1", minute: 1 }));
      await store.insert(team({ id: "tm_o1", org: "elsewhere", slug: "o1", minute: 2 }));
      await store.insert(team({ id: "tm_l2", org: "listed", slug: "l2", minute: 3 }));
      assert.deepEqual(idsOf(await store.listByOrg("listed")), ["tm_l2", "tm_l1"]);
      assert.deepEqual([...(await store.findIdsByOrg("listed"))].sort(), ["tm_l1", "tm_l2"]);
      assert.deepEqual(await store.listByOrg("nobody"), [], "an organization with no teams lists none");
    },
  ],
  [
    "findAll is every team of every organization, oldest first",
    async ({ store }) => {
      await store.insert(team({ id: "tm_a1", org: "all-a", slug: "a1", minute: 1 }));
      await store.insert(team({ id: "tm_a2", org: "all-b", slug: "a2", minute: 2 }));
      await store.insert(team({ id: "tm_a3", org: "all-a", slug: "a3", minute: 3 }));
      assert.deepEqual(idsOf(await store.findAll()), ["tm_a1", "tm_a2", "tm_a3"]);
    },
  ],
  [
    "a delete removes the team from every read, and an unknown id resolves",
    async ({ store }) => {
      await store.insert(team({ id: "tm_d1", org: "acme", slug: "gone", minute: 1 }));
      await store.insert(team({ id: "tm_d2", org: "acme", slug: "kept", minute: 2 }));
      await store.deleteById("tm_d1");
      await assert.doesNotReject(store.deleteById("tm_never"));
      assert.equal(await store.findById("tm_d1"), undefined);
      assert.deepEqual(idsOf(await store.listByOrg("acme")), ["tm_d2"]);
      assert.deepEqual(await store.findIdsByOrg("acme"), ["tm_d2"]);
      assert.deepEqual(idsOf(await store.findAll()), ["tm_d2"]);
      assert.deepEqual(
        await store.insert(team({ id: "tm_d3", org: "acme", slug: "gone", minute: 3 })),
        { kind: "inserted" },
        "a deleted team's slug is free again",
      );
    },
  ],
  [
    "an outage is a fault, never 'no team'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(store.findById("tm_any"));
      await assert.rejects(store.findByIds(["tm_any"]));
      await assert.rejects(store.listByOrg("acme"));
      await assert.rejects(store.findAll());
    },
  ],
  ...guardedPortDeclarations<TeamStore, Team>({
    async seed(store) {
      const seeded = team({ id: "tm_cg", org: "acme", slug: "guarded", name: "Before" });
      await store.insert(seeded);
      return seeded;
    },
    idOf: (held) => held.metadata?.id ?? "",
    change(held, value) {
      if (held.metadata !== undefined) {
        held.metadata.name = value;
      }
    },
    changedValueOf: (held) => held.metadata?.name ?? "",
    async interleave(store, id, value) {
      await store.modifyById(id, (held) => {
        if (held.metadata !== undefined) {
          held.metadata.name = value;
        }
      });
    },
    read: (store, id) => store.findById(id),
    remove: (store, id) => store.deleteById(id),
  }),
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function teamStoreContract(
  makeFixture: () => Promise<TeamStoreContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(CASES, makeFixture);
}
