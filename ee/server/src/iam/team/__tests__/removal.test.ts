/**
 * The one place a team is removed. Pins:
 *   - the grants are revoked (as `team:<id>`, both directions, by the
 *     grant path) before the row is deleted, acting for the person
 *     deleting the team, so the permission history names them;
 *   - after the row, the team's slug is let go in the server's name table,
 *     and a release that faults is logged while the team is still removed;
 *   - a failed revoke leaves the row and its name, so the team still
 *     exists to retry;
 *   - an organization's teams are each removed on their own: one team's
 *     failure is logged, the rest are still removed, and the call then
 *     throws, so the organization delete stops with the organization in
 *     place; another organization's teams are untouched.
 */
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { createLogger } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { newTeamRemoval } from "../removal.js";
import { InMemoryTeamStore, storedTeam } from "./in-memory-team-store.js";
import { inMemoryNames } from "../../../__test-utils__/in-memory-names.js";

/** The person deleting, whom every revoke is made acting for. */
const DELETER = "ida_deleter";

function rig(failFor: ReadonlySet<string> = new Set()) {
  const teams = new InMemoryTeamStore();
  const names = inMemoryNames();
  const order: string[] = [];
  const actors: Array<string | undefined> = [];
  const logged: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: "error",
    pretty: false,
    write: (line: string) => {
      logged.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const removal = newTeamRemoval({
    teams: {
      findById: (id) => teams.findById(id),
      findIdsByOrg: (org) => teams.findIdsByOrg(org),
      deleteById: async (id) => {
        order.push(`row:${id}`);
        await teams.deleteById(id);
      },
    },
    grants: {
      cleanupResourceGrants: (ref: ApiResourceRef, actingFor?: string) => {
        actors.push(actingFor);
        order.push(`grants:${ref.kind}:${ref.id}`);
        return failFor.has(ref.id)
          ? Promise.reject(new Error("engine down"))
          : Promise.resolve();
      },
    },
    names,
    logger,
  });
  /** A team as its create chain stores it: its row, and its slug as its name. */
  async function seed(id: string, org: string, slug: string): Promise<void> {
    await teams.insert(storedTeam({ id, org, slug }));
    await names.resourceNames.claim({ kind: "team", org, name: slug }, id, new Date().toISOString());
  }
  return { teams, names, seed, order, actors, logged, removal };
}

describe("remove", () => {
  it("revokes the team's grants before it deletes the row", async () => {
    const r = rig();
    await r.seed("tm_sre", "acme", "sre");

    await r.removal.remove("tm_sre", DELETER);
    expect(r.order).toEqual(["grants:team:tm_sre", "row:tm_sre"]);
    expect(r.actors, "the revoke is made acting for the person deleting the team").toEqual([DELETER]);
    expect(await r.teams.findById("tm_sre")).toBeUndefined();
    expect([...r.names.entries.values()], "its slug is free for a later team").toEqual([]);
  });

  it("leaves the row when the grants cannot all be revoked", async () => {
    const r = rig(new Set(["tm_sre"]));
    await r.seed("tm_sre", "acme", "sre");

    await expect(r.removal.remove("tm_sre", DELETER)).rejects.toThrow("engine down");
    expect(r.order).toEqual(["grants:team:tm_sre"]);
    expect(await r.teams.findById("tm_sre")).toBeDefined();
    expect(r.names.entries.size, "a team that stays keeps its name").toBe(1);
  });
});

describe("removeByOrgId", () => {
  it("removes each of the organization's teams on its own, logs the one that failed, then throws", async () => {
    const r = rig(new Set(["tm_b"]));
    await r.seed("tm_a", "acme", "a");
    await r.seed("tm_b", "acme", "b");
    await r.seed("tm_c", "acme", "c");
    await r.seed("tm_x", "other", "x");

    await expect(r.removal.removeByOrgId("acme", DELETER)).rejects.toThrow(
      "team(s) of organization 'acme' could not be removed",
    );

    expect(await r.teams.findIdsByOrg("acme")).toEqual(["tm_b"]);
    expect(await r.teams.findIdsByOrg("other")).toEqual(["tm_x"]);
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({ team: "tm_b", org: "acme", error: "engine down" });
  });
});

describe("the team's name release", () => {
  it("logs a release that faults and still removes the team: the next claim frees the name", async () => {
    const teams = new InMemoryTeamStore();
    await teams.insert(storedTeam({ id: "tm_gone", org: "acme", slug: "gone" }));
    const logged: Array<Record<string, unknown>> = [];
    const removal = newTeamRemoval({
      teams,
      names: {
        resourceNames: {
          release: () => Promise.reject(new Error("name table down")),
        },
      } as unknown as Parameters<typeof newTeamRemoval>[0]["names"],
      grants: { cleanupResourceGrants: () => Promise.resolve() },
      logger: createLogger({
        level: "error",
        pretty: false,
        write: (line: string) => {
          logged.push(JSON.parse(line) as Record<string, unknown>);
        },
      }),
    });

    await removal.remove("tm_gone", "ida_deleter");
    expect(await teams.findById("tm_gone")).toBeUndefined();
    expect(logged.map((line) => line["msg"] ?? line["message"])).toEqual([
      expect.stringMatching(/its name could not be released/),
    ]);
  });
});
