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
 *   - The row for a triple is found BY TRIPLE, never by derived id (slice
 *     2): the cloud's legacy rows carry random `iamp_<ulid>` ids and must
 *     revoke and deduplicate through this path, so a legacy row makes a
 *     re-grant the duplicate arm and is what `revokeBySpec` deletes.
 *   - The path is the one writer, so it is the one gate (slice 2 ruling
 *     Q-S2-1; T01_3_execution.md S2 slice 1, ruling 2): an unknown
 *     resource or principal kind, or a triple holding a delimiter, is
 *     INVALID_ARGUMENT before any read, write or hook — on grant AND on
 *     revoke, so a composition never receives a garbage spec to delete a
 *     bare tuple from.
 *
 * The row the path builds is pinned too: the proto's apiVersion const, the
 * derived id, the caller's audit stamp — the cloud's `buildNewPolicy`
 * stamped neither org nor creator, and this path stamps the creator.
 */
import { describe, expect, it } from "vitest";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  malformedTripleMessage,
  policyIdFor,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { DuplicatePolicyError } from "../store.js";
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
/** A Java-era id: random, never derivable from the triple it holds. */
const LEGACY_ID = "iamp_01hzzzzzzzzzzzzzzzzzzzzzzz";

const alice: CallerIdentity = {
  identityId: ALICE,
  callerClass: "user",
  issuer: "https://issuer.example.com",
  rawToken: "",
  email: "alice@example.com",
};

/** A row as the cloud's Java service wrote it: random id, no audit actor. */
function legacyRow(spec: IamPolicySpec): IamPolicy {
  return create(IamPolicySchema, {
    apiVersion: "iam.stigmer.com/v1",
    kind: IAM_POLICY_KIND,
    metadata: create(ApiResourceMetadataSchema, { id: LEGACY_ID }),
    spec,
  });
}

async function invalidArgument(
  run: () => Promise<unknown>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      expect(error.code).toBe(Code.InvalidArgument);
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
}

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

describe("the row for a triple is found by triple, so legacy ids converge", () => {
  it("a legacy row makes a re-grant the duplicate arm: one row, ever, and the legacy id stands", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    policies.rows.set(LEGACY_ID, legacyRow(spec));

    const result = await path.grant(spec, alice);

    expect(result.duplicate).toBe(true);
    expect(result.policy.metadata?.id).toBe(LEGACY_ID);
    expect([...policies.rows.keys()]).toEqual([LEGACY_ID]);
    expect(recorded).toEqual([
      { kind: "granted", id: LEGACY_ID, duplicate: true },
    ]);
  });

  it("revokeBySpec finds and deletes the legacy row", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    policies.rows.set(LEGACY_ID, legacyRow(spec));

    const revoked = await path.revokeBySpec(spec);

    expect(revoked?.metadata?.id).toBe(LEGACY_ID);
    expect(policies.rows.size).toBe(0);
    expect(recorded).toEqual([
      { kind: "revoked", id: LEGACY_ID, relation: "admin" },
      { kind: "row-delete", id: LEGACY_ID },
    ]);
  });

  it("the loser of a concurrent grant answers the winner's row as a duplicate and still fires the hook", async () => {
    const recorded: RecordedEvent[] = [];
    const policies = fakeIamPolicyStore(recorded);
    const spec = orgRole(ALICE, "admin", "acme");
    const bob: CallerIdentity = { ...alice, identityId: BOB };
    // The other writer lands between this path's read and its write: the
    // store refuses the id and the winner's row is what the re-read finds.
    const racingSave = policies.save.bind(policies);
    let interposed = false;
    policies.save = async (policy) => {
      if (!interposed) {
        interposed = true;
        const winner = clone(IamPolicySchema, policy);
        winner.status = undefined;
        policies.rows.set(policyIdFor(spec), winner);
        throw new DuplicatePolicyError("raced");
      }
      await racingSave(policy);
    };
    const path = newIamPolicyGrantPath({
      policies,
      lifecycle: recordingLifecycle(recorded),
      logger: silentLogger,
    });

    const result = await path.grant(spec, bob);

    expect(result.duplicate).toBe(true);
    expect(result.policy.status).toBeUndefined();
    expect(policies.rows.size).toBe(1);
    expect(recorded).toEqual([
      { kind: "granted", id: policyIdFor(spec), duplicate: true },
    ]);
  });
});

describe("the one writer is the one gate: nothing is read, written or notified for a spec no edition can hold", () => {
  const unknownResource = triple(
    { kind: "identity_account", id: ALICE },
    "admin",
    { kind: "organisation", id: "acme" },
  );
  const unknownPrincipal = triple({ kind: "group", id: "grp_1" }, "viewer", {
    kind: "agent",
    id: AGENT,
  });
  const malformed = triple({ kind: "identity_account", id: ALICE }, "admin", {
    kind: "organization",
    id: "acme#admin",
  });
  const bothUnknown = triple({ kind: "group", id: "grp_1" }, "admin", {
    kind: "organisation",
    id: "acme",
  });

  it("grant refuses each with the pinned copy, the resource kind read first", async () => {
    const recorded: RecordedEvent[] = [];
    const { policies, path } = pathOver(recorded, recordingLifecycle(recorded));
    const refusals: ReadonlyArray<[IamPolicySpec, string]> = [
      [unknownResource, unknownResourceKindMessage("organisation")],
      [unknownPrincipal, unknownPrincipalKindMessage("group")],
      [malformed, malformedTripleMessage("resource.id")],
      [bothUnknown, unknownResourceKindMessage("organisation")],
    ];
    for (const [spec, message] of refusals) {
      const error = await invalidArgument(() => path.grant(spec, alice));
      expect(error.rawMessage, message).toBe(message);
    }
    expect(policies.rows.size).toBe(0);
    expect(recorded).toEqual([]);
  });

  it("revokeBySpec refuses the same specs — a composition never deletes a bare tuple from garbage", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    for (const spec of [unknownResource, unknownPrincipal, malformed]) {
      await invalidArgument(() => path.revokeBySpec(spec));
    }
    expect(recorded).toEqual([]);
  });

  it("the literal zero-value name is the unknown kind too", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    const error = await invalidArgument(() =>
      path.grant(
        triple({ kind: "identity_account", id: ALICE }, "admin", {
          kind: "api_resource_kind_unknown",
          id: "acme",
        }),
        alice,
      ),
    );
    expect(error.rawMessage).toBe(
      unknownResourceKindMessage("api_resource_kind_unknown"),
    );
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
