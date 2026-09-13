/**
 * Pins the ONE grant and revoke path of the IamPolicy domain
 * (T01_0_plan.md §3a "grant-path.ts"; T01_1_review.md Q-OR-1): the two
 * cloud#425 ordering invariants, now living in open source, recorded
 * event by event through a fake store and a recording lifecycle:
 *
 *   - CREATE: the row persists, THEN onPolicyGranted fires. On the
 *     duplicate arm no row is written and the hook STILL fires with
 *     `duplicate: true` — the inline heal for a row whose tuple never
 *     landed. A hook throw fails the grant with the row in place (the
 *     cloud's boot backfill heals it; the caller's retry heals it too).
 *   - REVOKE: onPolicyRevoked fires, THEN the row is deleted. A hook throw
 *     leaves row and tuple (retry converges; the reverse order was the
 *     fail-open incident class). The absent arm fires the hook with the
 *     spec and no policy, so a composition can still delete a bare tuple
 *     written before the row mirror existed.
 *   - cleanupResource is bidirectional (as target AND as principal),
 *     deduplicated, revoking each row through the same revoke order.
 *   - revokeOrgAccess revokes the account's direct rows on the
 *     organization; the inert org-column arm the cloud carried is gone
 *     (Q-OR-9).
 *   - With no lifecycle composed (the OSS default before the built-in
 *     posture, and any unit that implements only the three required
 *     methods), the path writes rows and notifies nothing.
 *
 * The row the path builds is pinned too: the proto's apiVersion const, the
 * derived id, the caller's audit stamp — the cloud's `buildNewPolicy`
 * stamped neither org nor creator, and this path stamps the creator.
 */
import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import { IAM_POLICY_API_VERSION, policyIdFor } from "../constants.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import {
  fakeIamPolicyStore,
  orgRole,
  recordingLifecycle,
  triple,
} from "./support.js";
import type { RecordedEvent } from "./support.js";

const ALICE = "ida_wtr3jcf281yfk9xx61kj59fsme";
const BOB = "ida_0byc5k14t1e7b7kdxft7hwz1f7";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

const alice: CallerIdentity = {
  identityId: ALICE,
  callerClass: "user",
  issuer: "https://issuer.example.com",
  rawToken: "",
  email: "alice@example.com",
};

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function pathOver(
  recorded: RecordedEvent[],
  lifecycle: ResourceAuthorizationLifecycle | undefined,
) {
  const policies = fakeIamPolicyStore(recorded);
  const path = newIamPolicyGrantPath({
    policies,
    lifecycle,
    logger: silentLogger,
  });
  return { policies, path };
}

describe("grant: row before onPolicyGranted", () => {
  it("persists the row, then fires the hook once with duplicate false; the row carries the contract's stamps", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");

    const result = await path.grant(spec, alice);

    const id = policyIdFor(spec);
    expect(result.duplicate).toBe(false);
    expect(result.policy.metadata?.id).toBe(id);
    expect(result.policy.apiVersion).toBe(IAM_POLICY_API_VERSION);
    expect(result.policy.kind).toBe("IamPolicy");
    expect(result.policy.spec).toEqual(spec);
    expect(result.policy.status?.audit?.specAudit?.createdBy?.id).toBe(ALICE);
    expect(policies.rows.get(id)).toBeDefined();
    expect(recorded).toEqual([
      { kind: "row-save", id },
      { kind: "granted", id, duplicate: false },
    ]);
  });

  it("on a held triple writes no row and STILL fires the hook with duplicate true — the inline heal", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    const first = await path.grant(spec, alice);
    recorded.length = 0;

    const second = await path.grant(spec, alice);

    expect(second.duplicate).toBe(true);
    expect(second.policy).toEqual(first.policy);
    expect(recorded).toEqual([
      { kind: "granted", id: policyIdFor(spec), duplicate: true },
    ]);
  });

  it("a hook throw fails the grant and leaves the row in place for the heal", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(
      recorded,
      recordingLifecycle(recorded, { granted: new Error("fga is down") }),
    );
    const spec = orgRole(ALICE, "admin", "acme");

    await expect(path.grant(spec, alice)).rejects.toThrow("fga is down");

    expect(policies.rows.has(policyIdFor(spec))).toBe(true);
    expect(recorded).toEqual([{ kind: "row-save", id: policyIdFor(spec) }]);
  });

  it("with no lifecycle composed, writes the row and notifies nothing", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, undefined);
    await path.grant(orgRole(ALICE, "member", "acme"), alice);
    expect(recorded.map((event) => event.kind)).toEqual(["row-save"]);
  });

  it("a lifecycle without the optional hooks (the three required methods only) is the same as none", async () => {
    const recorded: RecordedEvent[] = [];
    const threeMethods: ResourceAuthorizationLifecycle = {
      async onResourceCreated() {},
      async onResourceDeleted() {},
      async onVisibilityChanged() {},
    };
    const { path } = pathOver(recorded, threeMethods);
    await path.grant(orgRole(ALICE, "member", "acme"), alice);
    await path.revokeBySpec(orgRole(ALICE, "member", "acme"));
    expect(recorded.map((event) => event.kind)).toEqual([
      "row-save",
      "row-delete",
    ]);
  });
});

describe("revoke: onPolicyRevoked before the row delete", () => {
  it("fires the hook with the row, then deletes it, and answers the revoked policy", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    await path.grant(spec, alice);
    recorded.length = 0;

    const revoked = await path.revokeBySpec(spec);

    const id = policyIdFor(spec);
    expect(revoked?.metadata?.id).toBe(id);
    expect(policies.rows.has(id)).toBe(false);
    expect(recorded).toEqual([
      { kind: "revoked", id, relation: "admin" },
      { kind: "row-delete", id },
    ]);
  });

  it("a hook throw leaves row and tuple — retry converges, nothing fails open", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(
      recorded,
      recordingLifecycle(recorded, { revoked: new Error("fga is down") }),
    );
    const spec = orgRole(ALICE, "admin", "acme");
    await path.grant(spec, alice);
    recorded.length = 0;

    await expect(path.revokeBySpec(spec)).rejects.toThrow("fga is down");

    expect(policies.rows.has(policyIdFor(spec))).toBe(true);
    expect(recorded).toEqual([]);
  });

  it("the absent arm fires the hook with the spec and no policy, deletes nothing, answers undefined", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));

    const revoked = await path.revokeBySpec(orgRole(BOB, "viewer", "acme"));

    expect(revoked).toBeUndefined();
    expect(recorded).toEqual([
      { kind: "revoked", id: undefined, relation: "viewer" },
    ]);
  });
});

describe("cleanupResource: bidirectional, deduplicated, each row through the revoke order", () => {
  it("revokes rows where the ref is the resource AND rows where it is the principal", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const asResource = orgRole(ALICE, "owner", "acme");
    const asPrincipal = triple(
      { kind: "organization", id: "acme" },
      "organization",
      { kind: "agent", id: AGENT },
    );
    const unrelated = orgRole(ALICE, "member", "globex");
    for (const spec of [asResource, asPrincipal, unrelated]) {
      await path.grant(spec, alice);
    }
    recorded.length = 0;

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
    );

    expect([...policies.rows.keys()]).toEqual([policyIdFor(unrelated)]);
    expect(recorded).toEqual([
      { kind: "revoked", id: policyIdFor(asResource), relation: "owner" },
      { kind: "row-delete", id: policyIdFor(asResource) },
      {
        kind: "revoked",
        id: policyIdFor(asPrincipal),
        relation: "organization",
      },
      { kind: "row-delete", id: policyIdFor(asPrincipal) },
    ]);
  });

  it("a ref that is both principal and resource of one row revokes it once", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    const selfOwner = triple({ kind: "identity_account", id: ALICE }, "owner", {
      kind: "identity_account",
      id: ALICE,
    });
    await path.grant(selfOwner, alice);
    recorded.length = 0;

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "identity_account", id: ALICE }),
    );

    expect(
      recorded.filter((event) => event.kind === "row-delete"),
    ).toHaveLength(1);
  });

  it("nothing to clean is a no-op, not an error", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "agent", id: AGENT }),
    );
    expect(recorded).toEqual([]);
  });
});

describe("revokeOrgAccess: the account's direct rows on the organization", () => {
  it("revokes every relation the account holds on that organization and nothing on another", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    await path.grant(orgRole(ALICE, "admin", "acme"), alice);
    await path.grant(orgRole(ALICE, "viewer", "acme"), alice);
    await path.grant(orgRole(ALICE, "member", "globex"), alice);
    await path.grant(orgRole(BOB, "member", "acme"), alice);
    recorded.length = 0;

    await path.revokeOrgAccess(ALICE, "acme");

    expect([...policies.rows.keys()].sort()).toEqual(
      [
        policyIdFor(orgRole(ALICE, "member", "globex")),
        policyIdFor(orgRole(BOB, "member", "acme")),
      ].sort(),
    );
    expect(recorded.map((event) => event.kind)).toEqual([
      "revoked",
      "row-delete",
      "revoked",
      "row-delete",
    ]);
  });

  it("an account with no rows on the organization is a no-op", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    await path.revokeOrgAccess(BOB, "acme");
    expect(recorded).toEqual([]);
  });
});
