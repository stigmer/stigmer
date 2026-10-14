/**
 * The one place an invitation is removed: with its organization, since an
 * invitation has no delete RPC. Pins what removal.ts promises:
 *   - each invitation's grants are removed (as `invitation:<id>`, by the
 *     grant path) before its row is deleted, acting for the person
 *     deleting the organization;
 *   - an invitation whose grants cannot all be removed keeps its row, and
 *     the failure is logged with the invitation and its organization;
 *   - the organization's invitations are each removed on their own: one
 *     failure does not stop the rest, the call then throws so the
 *     organization delete stops with the organization in place, and
 *     another organization's invitations are untouched.
 */
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { createLogger } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { newInvitationRemoval } from "../removal.js";
import { InMemoryInvitationStore, storedInvitation } from "./in-memory-invitation-store.js";

/** The person deleting, whom every revoke is made acting for. */
const DELETER = "ida_deleter";

function rig(failFor: ReadonlySet<string> = new Set()) {
  const invitations = new InMemoryInvitationStore();
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
  const removal = newInvitationRemoval({
    invitations: {
      findIdsByOrg: (org) => invitations.findIdsByOrg(org),
      deleteById: async (id) => {
        order.push(`row:${id}`);
        await invitations.deleteById(id);
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
    logger,
  });
  return { invitations, order, actors, logged, removal };
}

describe("removeByOrgId", () => {
  it("removes an invitation's grants before its row", async () => {
    const r = rig();
    await r.invitations.save(storedInvitation({ id: "inv_a", org: "acme", token: "TokenA" }));

    await r.removal.removeByOrgId("acme", DELETER);

    expect(r.order).toEqual(["grants:invitation:inv_a", "row:inv_a"]);
    expect(r.actors, "the revoke is made acting for the person deleting the organization").toEqual([DELETER]);
    expect(await r.invitations.findById("inv_a")).toBeUndefined();
    expect(r.logged).toEqual([]);
  });

  it("keeps the row whose grants could not be removed, logs it, still removes the rest and no other organization's, then throws", async () => {
    const r = rig(new Set(["inv_b"]));
    await r.invitations.save(storedInvitation({ id: "inv_a", org: "acme", token: "TokenA" }));
    await r.invitations.save(storedInvitation({ id: "inv_b", org: "acme", token: "TokenB" }));
    await r.invitations.save(storedInvitation({ id: "inv_c", org: "acme", token: "TokenC" }));
    await r.invitations.save(storedInvitation({ id: "inv_x", org: "other", token: "TokenX" }));

    await expect(r.removal.removeByOrgId("acme", DELETER)).rejects.toThrow(
      "invitation(s) of organization 'acme' could not be removed",
    );

    expect(r.order).not.toContain("row:inv_b");
    expect(await r.invitations.findIdsByOrg("acme")).toEqual(["inv_b"]);
    expect(await r.invitations.findIdsByOrg("other")).toEqual(["inv_x"]);
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({ invitation: "inv_b", org: "acme", error: "engine down" });
  });
});
