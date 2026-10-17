/**
 * Pins the ONE grant and revoke path of the Grant domain: the two
 * ordering invariants, recorded
 * event by event through a fake store and a recording lifecycle:
 *
 *   - CREATE: the row persists, THEN onGranted fires. On the
 *     duplicate arm no row is written and the hook STILL fires with
 *     `duplicate: true` — the inline heal for a row whose tuple never
 *     landed. A hook throw fails the grant with the row in place (the
 *     cloud's boot backfill heals it; the caller's retry heals it too).
 *   - REVOKE: onRevoked fires, THEN the row is deleted. A hook throw
 *     leaves row and tuple (retry converges; the reverse order was the
 *     fail-open incident class). The absent arm fires the hook with the
 *     spec and no grant, so a composition can still delete a bare tuple
 *     written before the row mirror existed.
 *   - cleanupResource is bidirectional (as principal first, then as
 *     target with the owner rows last), deduplicated, revoking each row
 *     through the same revoke order; a fault stops it with the owners
 *     still holding, since an organization's delete runs it before the
 *     organization's row goes and its owner is the one who retries.
 *   - revokeOrgAccess revokes the account's direct rows on the
 *     organization; the inert org-column arm the cloud carried is gone.
 *   - Leaving an organization: once an account holds no row on an
 *     organization, the rows it holds on that organization's resources
 *     go too (shares, team memberships, an owner someone else granted),
 *     found through the resources' scope links, each through the revoke
 *     order; its authorship (`owner`/`creator` naming the resource's
 *     recorded creator) stays, as open source's derived tuple does, for
 *     the model's organization bound to govern. revokeOrgAccess always
 *     sweeps, so a retry converges; a revoke by spec sweeps only when it
 *     removed the last role; cleanupResource never sweeps.
 *   - With no lifecycle composed (the OSS default before the built-in
 *     posture, and any unit that implements only the three required
 *     methods), the path writes rows and notifies nothing.
 *   - The row for a triple is found BY TRIPLE, never by derived id (slice
 *     2): the cloud's legacy rows carry random `iamp_<ulid>` ids and must
 *     revoke and deduplicate through this path, so a legacy row makes a
 *     re-grant the duplicate arm and is what `revokeBySpec` deletes.
 *   - The path is the one writer, so it is the one gate: an unknown
 *     resource or principal kind, or a triple holding a delimiter, is
 *     INVALID_ARGUMENT before any read, write or hook — on grant AND on
 *     revoke, so a composition never receives a garbage spec to delete a
 *     bare tuple from.
 *
 *   - Who and why: every access row the path writes or deletes reaches the
 *     store with its change record (the caller's id and class, the door,
 *     the row's organization), and nothing else does: no record for a
 *     structural link, no write at all on a duplicate grant or a revoke of
 *     a row that is not held. The organization is read before any row of
 *     the operation goes, so a cleanup that deletes a resource's scope link
 *     before its owner still names the owner row's organization. A row
 *     revoked after an earlier delete removed its resource's links takes
 *     the organization from the stored row the walk ends at (the resource,
 *     or the session a run walks to), and records none when this server
 *     stores no such row (stigmer#1603); a grant on a resource with no link
 *     takes it from the same row. The log lines carry the same facts.
 *
 * The row the path builds is pinned too: the proto's apiVersion const, the
 * derived id, the caller's audit stamp — the cloud's `buildNewPolicy`
 * stamped neither org nor creator, and this path stamps the creator.
 */
import { describe, expect, it } from "vitest";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { ApiResourceRefSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import {
  AFFILIATION_NOT_GRANTABLE_MESSAGE,
  GRANT_API_VERSION,
  GRANT_KIND,
  malformedTripleMessage,
  grantIdFor,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import type { GrantActor } from "../change.js";
import { newGrantPath } from "../grant-path.js";
import type { StoredResources } from "../grant-path.js";
import { DuplicateGrantError } from "../store.js";
import {
  NO_STORED_RESOURCES,
  fakeGrantStore,
  orgRole,
  recordedCreators,
  recordingLifecycle,
  storedResources,
  triple,
} from "./support.js";
import type { FakeGrantStore, RecordedEvent } from "./support.js";

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
function legacyRow(spec: GrantSpec): Grant {
  return create(GrantSchema, {
    apiVersion: "iam.stigmer.com/v1",
    kind: GRANT_KIND,
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
  resources: StoredResources = NO_STORED_RESOURCES,
) {
  const grants = fakeGrantStore(recorded);
  const path = newGrantPath({
    resources,
    grants,
    lifecycle,
    logger: silentLogger,
  });
  return { grants, path };
}

describe("grant: row before onGranted", () => {
  it("persists the row, then fires the hook once with duplicate false; the row carries the contract's stamps", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");

    const result = await path.grant(spec, alice, "grant");

    const id = grantIdFor(spec);
    expect(result.duplicate).toBe(false);
    expect(result.grant.metadata?.id).toBe(id);
    expect(result.grant.apiVersion).toBe(GRANT_API_VERSION);
    expect(result.grant.kind).toBe("Grant");
    expect(result.grant.spec).toEqual(spec);
    expect(result.grant.status?.audit?.specAudit?.createdBy?.id).toBe(ALICE);
    expect(grants.rows.get(id)).toBeDefined();
    expect(recorded).toEqual([
      { kind: "row-save", id },
      { kind: "granted", id, duplicate: false },
    ]);
  });

  it("on a held triple writes no row and STILL fires the hook with duplicate true — the inline heal", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    const first = await path.grant(spec, alice, "grant");
    recorded.length = 0;

    const second = await path.grant(spec, alice, "grant");

    expect(second.duplicate).toBe(true);
    expect(second.grant).toEqual(first.grant);
    expect(recorded).toEqual([
      { kind: "granted", id: grantIdFor(spec), duplicate: true },
    ]);
  });

  it("a hook throw fails the grant and leaves the row in place for the heal", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(
      recorded,
      recordingLifecycle(recorded, { granted: new Error("fga is down") }),
    );
    const spec = orgRole(ALICE, "admin", "acme");

    await expect(path.grant(spec, alice, "grant")).rejects.toThrow(
      "fga is down",
    );

    expect(grants.rows.has(grantIdFor(spec))).toBe(true);
    expect(recorded).toEqual([{ kind: "row-save", id: grantIdFor(spec) }]);
  });

  it("with no lifecycle composed, writes the row and notifies nothing", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, undefined);
    await path.grant(orgRole(ALICE, "member", "acme"), alice, "grant");
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
    await path.grant(orgRole(ALICE, "member", "acme"), alice, "grant");
    await path.revokeBySpec(orgRole(ALICE, "member", "acme"), alice);
    expect(recorded.map((event) => event.kind)).toEqual([
      "row-save",
      "row-delete",
    ]);
  });
});

describe("the row for a triple is found by triple, so legacy ids converge", () => {
  it("a legacy row makes a re-grant the duplicate arm: one row, ever, and the legacy id stands", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    grants.rows.set(LEGACY_ID, legacyRow(spec));

    const result = await path.grant(spec, alice, "grant");

    expect(result.duplicate).toBe(true);
    expect(result.grant.metadata?.id).toBe(LEGACY_ID);
    expect([...grants.rows.keys()]).toEqual([LEGACY_ID]);
    expect(recorded).toEqual([
      { kind: "granted", id: LEGACY_ID, duplicate: true },
    ]);
  });

  it("revokeBySpec finds and deletes the legacy row", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    grants.rows.set(LEGACY_ID, legacyRow(spec));

    const revoked = await path.revokeBySpec(spec, alice);

    expect(revoked?.metadata?.id).toBe(LEGACY_ID);
    expect(grants.rows.size).toBe(0);
    expect(recorded).toEqual([
      { kind: "revoked", id: LEGACY_ID, relation: "admin" },
      { kind: "row-delete", id: LEGACY_ID },
    ]);
  });

  it("a refused save with no winner to read back is not a race: the refusal propagates", async () => {
    const grants = fakeGrantStore();
    grants.save = async () => {
      throw new DuplicateGrantError("refused, and nobody holds it");
    };
    const path = newGrantPath({
      resources: NO_STORED_RESOURCES,
      grants,
      lifecycle: undefined,
      logger: silentLogger,
    });
    await expect(path.grant(orgRole(ALICE, "admin", "acme"), alice, "grant")).rejects.toBeInstanceOf(
      DuplicateGrantError,
    );
  });

  it("the loser of a concurrent grant answers the winner's row as a duplicate and still fires the hook", async () => {
    const recorded: RecordedEvent[] = [];
    const grants = fakeGrantStore(recorded);
    const spec = orgRole(ALICE, "admin", "acme");
    const bob: CallerIdentity = { ...alice, identityId: BOB };
    // The other writer lands between this path's read and its write: the
    // store refuses the id and the winner's row is what the re-read finds.
    const racingSave = grants.save.bind(grants);
    let interposed = false;
    grants.save = async (grant) => {
      if (!interposed) {
        interposed = true;
        const winner = clone(GrantSchema, grant);
        winner.status = undefined;
        grants.rows.set(grantIdFor(spec), winner);
        throw new DuplicateGrantError("raced");
      }
      await racingSave(grant);
    };
    const path = newGrantPath({
      resources: NO_STORED_RESOURCES,
      grants,
      lifecycle: recordingLifecycle(recorded),
      logger: silentLogger,
    });

    const result = await path.grant(spec, bob, "grant");

    expect(result.duplicate).toBe(true);
    expect(result.grant.status).toBeUndefined();
    expect(grants.rows.size).toBe(1);
    expect(recorded).toEqual([
      { kind: "granted", id: grantIdFor(spec), duplicate: true },
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
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const refusals: ReadonlyArray<[GrantSpec, string]> = [
      [unknownResource, unknownResourceKindMessage("organisation")],
      [unknownPrincipal, unknownPrincipalKindMessage("group")],
      [malformed, malformedTripleMessage("resource.id")],
      [bothUnknown, unknownResourceKindMessage("organisation")],
    ];
    for (const [spec, message] of refusals) {
      const error = await invalidArgument(() =>
        path.grant(spec, alice, "grant"),
      );
      expect(error.rawMessage, message).toBe(message);
    }
    expect(grants.rows.size).toBe(0);
    expect(recorded).toEqual([]);
  });

  it("revokeBySpec refuses the same specs — a composition never deletes a bare tuple from garbage", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    for (const spec of [unknownResource, unknownPrincipal, malformed]) {
      await invalidArgument(() => path.revokeBySpec(spec, alice));
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
        "grant",
      ),
    );
    expect(error.rawMessage).toBe(
      unknownResourceKindMessage("api_resource_kind_unknown"),
    );
  });
});

describe("revoke: onRevoked before the row delete", () => {
  it("fires the hook with the row, then deletes it, and answers the revoked grant", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const spec = orgRole(ALICE, "admin", "acme");
    await path.grant(spec, alice, "grant");
    recorded.length = 0;

    const revoked = await path.revokeBySpec(spec, alice);

    const id = grantIdFor(spec);
    expect(revoked?.metadata?.id).toBe(id);
    expect(grants.rows.has(id)).toBe(false);
    expect(recorded).toEqual([
      { kind: "revoked", id, relation: "admin" },
      { kind: "row-delete", id },
    ]);
  });

  it("a hook throw leaves row and tuple — retry converges, nothing fails open", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(
      recorded,
      recordingLifecycle(recorded, { revoked: new Error("fga is down") }),
    );
    const spec = orgRole(ALICE, "admin", "acme");
    await path.grant(spec, alice, "grant");
    recorded.length = 0;

    await expect(path.revokeBySpec(spec, alice)).rejects.toThrow("fga is down");

    expect(grants.rows.has(grantIdFor(spec))).toBe(true);
    expect(recorded).toEqual([]);
  });

  it("the absent arm fires the hook with the spec and no grant, deletes nothing, answers undefined", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));

    const revoked = await path.revokeBySpec(
      orgRole(BOB, "viewer", "acme"),
      alice,
    );

    expect(revoked).toBeUndefined();
    expect(recorded).toEqual([
      { kind: "revoked", id: undefined, relation: "viewer" },
    ]);
  });
});

describe("cleanupResource: bidirectional, deduplicated, each row through the revoke order", () => {
  it("revokes rows where the ref is the principal, then where it is the resource, owners last", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const owner = orgRole(ALICE, "owner", "acme");
    const member = orgRole(BOB, "member", "acme");
    const asPrincipal = triple(
      { kind: "organization", id: "acme" },
      "organization",
      { kind: "agent", id: AGENT },
    );
    const unrelated = orgRole(ALICE, "member", "globex");
    // Granted owner first, so the order below is the cleanup's, not the store's.
    for (const spec of [owner, member, asPrincipal, unrelated]) {
      await path.grant(spec, alice, "grant");
    }
    recorded.length = 0;

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
      alice,
    );

    expect([...grants.rows.keys()]).toEqual([grantIdFor(unrelated)]);
    expect(recorded).toEqual([
      {
        kind: "revoked",
        id: grantIdFor(asPrincipal),
        relation: "organization",
      },
      { kind: "row-delete", id: grantIdFor(asPrincipal) },
      { kind: "revoked", id: grantIdFor(member), relation: "member" },
      { kind: "row-delete", id: grantIdFor(member) },
      { kind: "revoked", id: grantIdFor(owner), relation: "owner" },
      { kind: "row-delete", id: grantIdFor(owner) },
    ]);
  });

  it("stops at the first fault with the owner rows still in place", async () => {
    const recorded: RecordedEvent[] = [];
    const lifecycle = recordingLifecycle(recorded);
    const { grants, path } = pathOver(recorded, {
      ...lifecycle,
      onRevoked: (event) =>
        event.spec.relation === "member"
          ? Promise.reject(new Error("tuple delete refused"))
          : lifecycle.onRevoked!(event),
    });
    const owner = orgRole(ALICE, "owner", "acme");
    const member = orgRole(BOB, "member", "acme");
    for (const spec of [owner, member]) {
      await path.grant(spec, alice, "grant");
    }

    await expect(
      path.cleanupResource(
        create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
        alice,
      ),
    ).rejects.toThrow("tuple delete refused");

    expect(grants.rows.has(grantIdFor(owner))).toBe(true);
    expect(grants.rows.has(grantIdFor(member))).toBe(true);
  });

  it("a ref that is both principal and resource of one row revokes it once", async () => {
    const recorded: RecordedEvent[] = [];
    const { path } = pathOver(recorded, recordingLifecycle(recorded));
    const selfOwner = triple({ kind: "identity_account", id: ALICE }, "owner", {
      kind: "identity_account",
      id: ALICE,
    });
    await path.grant(selfOwner, alice, "grant");
    recorded.length = 0;

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "identity_account", id: ALICE }),
      alice,
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
      alice,
    );
    expect(recorded).toEqual([]);
  });
});

describe("revokeOrgAccess: the account's direct rows on the organization", () => {
  it("revokes every relation the account holds on that organization and nothing on another", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    await path.grant(orgRole(ALICE, "admin", "acme"), alice, "grant");
    await path.grant(orgRole(ALICE, "viewer", "acme"), alice, "grant");
    await path.grant(orgRole(ALICE, "member", "globex"), alice, "grant");
    await path.grant(orgRole(BOB, "member", "acme"), alice, "grant");
    recorded.length = 0;

    await path.revokeOrgAccess(ALICE, "acme", alice);

    expect([...grants.rows.keys()].sort()).toEqual(
      [
        grantIdFor(orgRole(ALICE, "member", "globex")),
        grantIdFor(orgRole(BOB, "member", "acme")),
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
    await path.revokeOrgAccess(BOB, "acme", alice);
    expect(recorded).toEqual([]);
  });
});

describe("leaving an organization: the account's rows on its resources", () => {
  const SHARED = "agt_shared0000000000000000000";
  const AUTHORED = "agt_authored000000000000000000";
  const ELSEWHERE = "agt_elsewhere0000000000000000";
  const TEAM = "tm_sre000000000000000000000000";
  const SESSION = "ses_alice0000000000000000000000";
  const RUN = "aex_alice0000000000000000000000";

  /** The scope link a resource's creation writes: `organization:<org>` holds `organization` on it. */
  function scopeLink(kind: string, id: string, org: string): GrantSpec {
    return triple({ kind: "organization", id: org }, "organization", {
      kind,
      id,
    });
  }

  const bob: CallerIdentity = {
    ...alice,
    identityId: BOB,
    email: "bob@example.com",
  };

  /**
   * alice holds acme's admin role, a viewer share on bob's agent, the
   * owner row of the agent she created, an owner row bob granted her on
   * his agent, a team membership, and her session's owner row with a run
   * inside it; bob holds an agent in globex that alice may view.
   */
  async function seeded() {
    const recorded: RecordedEvent[] = [];
    const creators = recordedCreators({
      [`agent:${SHARED}`]: BOB,
      [`agent:${AUTHORED}`]: ALICE,
      [`agent:${ELSEWHERE}`]: BOB,
      [`session:${SESSION}`]: ALICE,
    });
    const { grants, path } = pathOver(
      recorded,
      recordingLifecycle(recorded),
      creators,
    );
    const agent = (id: string) => ({ kind: "agent", id });
    for (const spec of [
      orgRole(ALICE, "admin", "acme"),
      orgRole(ALICE, "member", "globex"),
      scopeLink("agent", SHARED, "acme"),
      scopeLink("agent", AUTHORED, "acme"),
      scopeLink("agent", ELSEWHERE, "globex"),
      scopeLink("team", TEAM, "acme"),
      scopeLink("session", SESSION, "acme"),
      triple({ kind: "session", id: SESSION }, "session", {
        kind: "run",
        id: RUN,
      }),
      triple({ kind: "identity_account", id: ALICE }, "viewer", agent(SHARED)),
      triple({ kind: "identity_account", id: ALICE }, "owner", agent(AUTHORED)),
      triple({ kind: "identity_account", id: ALICE }, "owner", agent(SHARED)),
      triple(
        { kind: "identity_account", id: ALICE },
        "viewer",
        agent(ELSEWHERE),
      ),
      triple({ kind: "identity_account", id: ALICE }, "member", {
        kind: "team",
        id: TEAM,
      }),
      triple({ kind: "identity_account", id: ALICE }, "owner", {
        kind: "session",
        id: SESSION,
      }),
      triple({ kind: "identity_account", id: ALICE }, "viewer", {
        kind: "run",
        id: RUN,
      }),
    ]) {
      await path.grant(spec, bob, "grant");
    }
    recorded.length = 0;
    return { recorded, grants, path };
  }

  function aliceHolds(grants: FakeGrantStore): ReadonlyArray<string> {
    return [...grants.rows.values()]
      .filter((grant) => grant.spec?.principal?.id === ALICE)
      .map(
        (grant) =>
          `${grant.spec?.relation} ${grant.spec?.resource?.kind}:${grant.spec?.resource?.id}`,
      )
      .sort();
  }

  it("revokeOrgAccess removes the shares and memberships the account held in the organization and keeps its authorship", async () => {
    const { recorded, grants, path } = await seeded();

    await path.revokeOrgAccess(ALICE, "acme", alice);

    expect(aliceHolds(grants)).toEqual(
      [
        "member organization:globex",
        `owner agent:${AUTHORED}`,
        `owner session:${SESSION}`,
        `viewer agent:${ELSEWHERE}`,
      ].sort(),
    );
    // Every row went through the revoke order: the hook, then the delete.
    const kinds = recorded.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "revoked")).toHaveLength(5);
    expect(kinds.filter((kind) => kind === "row-delete")).toHaveLength(5);
    for (let at = 0; at < kinds.length; at += 2) {
      expect(kinds.slice(at, at + 2)).toEqual(["revoked", "row-delete"]);
    }
  });

  it("a resource below another is placed by its parent's scope link", async () => {
    const { grants, path } = await seeded();

    await path.revokeOrgAccess(ALICE, "acme", alice);

    expect(aliceHolds(grants)).not.toContain(`viewer run:${RUN}`);
  });

  it("a retried revokeOrgAccess still sweeps when the organization rows are already gone", async () => {
    const { grants, path } = await seeded();
    for (const id of [grantIdFor(orgRole(ALICE, "admin", "acme"))]) {
      grants.rows.delete(id);
    }

    await path.revokeOrgAccess(ALICE, "acme", alice);

    expect(aliceHolds(grants)).not.toContain(`viewer agent:${SHARED}`);
    expect(aliceHolds(grants)).not.toContain(`member team:${TEAM}`);
  });

  it("revoking the last role by spec sweeps the organization", async () => {
    const { grants, path } = await seeded();

    await path.revokeBySpec(orgRole(ALICE, "admin", "acme"), alice);

    expect(aliceHolds(grants)).not.toContain(`viewer agent:${SHARED}`);
    expect(aliceHolds(grants)).toContain(`owner agent:${AUTHORED}`);
  });

  it("revoking one role by spec while another remains sweeps nothing", async () => {
    const { grants, path } = await seeded();
    await path.grant(orgRole(ALICE, "viewer", "acme"), bob, "grant");

    await path.revokeBySpec(orgRole(ALICE, "admin", "acme"), alice);

    expect(aliceHolds(grants)).toContain(`viewer agent:${SHARED}`);
    expect(aliceHolds(grants)).toContain(`member team:${TEAM}`);
  });

  it("revoking a row that is not an organization role sweeps nothing", async () => {
    const { grants, path } = await seeded();

    await path.revokeBySpec(
      triple({ kind: "identity_account", id: ALICE }, "member", {
        kind: "team",
        id: TEAM,
      }),
      alice,
    );

    expect(aliceHolds(grants)).toContain(`viewer agent:${SHARED}`);
  });

  it("an organization's delete (cleanupResource) revokes its own rows and sweeps nothing else", async () => {
    const { grants, path } = await seeded();

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
      alice,
    );

    expect(aliceHolds(grants)).toContain(`viewer agent:${SHARED}`);
    expect(aliceHolds(grants)).not.toContain("admin organization:acme");
  });

  it("an owner row whose principal is not the recorded creator is a grant, and goes", async () => {
    const { grants, path } = await seeded();

    await path.revokeOrgAccess(ALICE, "acme", alice);

    expect(aliceHolds(grants)).not.toContain(`owner agent:${SHARED}`);
  });
});

describe("affiliation: every change of an account's organization rows is announced", () => {
  const TEAM = "tm_core000000000000000000000";

  function announcing(faults: { changing?: Error } = {}) {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(
      recorded,
      recordingLifecycle(recorded, faults, { affiliation: true }),
    );
    return { recorded, grants, path };
  }

  it("a role granted announces changed after the row's grant hook, on the duplicate arm too", async () => {
    const { recorded, path } = announcing();
    await path.grant(orgRole(ALICE, "member", "acme"), alice, "grant");
    await path.grant(orgRole(ALICE, "member", "acme"), alice, "grant");
    expect(recorded.map((event) => event.kind)).toEqual([
      "row-save",
      "granted",
      "affiliation-changed",
      "granted",
      "affiliation-changed",
    ]);
    expect(recorded.at(-1)).toEqual({
      kind: "affiliation-changed",
      pair: `${ALICE}@acme`,
    });
  });

  it("a role revoked announces changing before its revoke hook and changed after the delete", async () => {
    const { recorded, path } = announcing();
    await path.grant(orgRole(ALICE, "admin", "acme"), alice, "grant");
    await path.grant(orgRole(ALICE, "viewer", "acme"), alice, "grant");
    recorded.length = 0;

    await path.revokeBySpec(orgRole(ALICE, "admin", "acme"), alice);

    expect(recorded.map((event) => event.kind)).toEqual([
      "affiliation-changing",
      "revoked",
      "row-delete",
      "affiliation-changed",
    ]);
  });

  it("a revoke that finds no row still announces changed, so a tuple that outlived its rows heals", async () => {
    const { recorded, path } = announcing();
    await path.revokeBySpec(orgRole(ALICE, "member", "acme"), alice);
    expect(recorded.map((event) => event.kind)).toEqual([
      "revoked",
      "affiliation-changed",
    ]);
  });

  it("every path that deletes a role announces it: revokeOrgAccess and an organization's delete", async () => {
    const { recorded, path } = announcing();
    await path.grant(orgRole(ALICE, "admin", "acme"), alice, "grant");
    await path.grant(orgRole(BOB, "member", "acme"), alice, "grant");
    recorded.length = 0;

    await path.revokeOrgAccess(ALICE, "acme", alice);
    expect(
      recorded.filter((event) => event.kind === "affiliation-changing"),
    ).toEqual([{ kind: "affiliation-changing", pair: `${ALICE}@acme` }]);

    recorded.length = 0;
    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "organization", id: "acme" }),
      alice,
    );
    expect(
      recorded.filter((event) => event.kind === "affiliation-changing"),
    ).toEqual([{ kind: "affiliation-changing", pair: `${BOB}@acme` }]);
  });

  it("a row of any other shape announces nothing: a share, a team membership, a userset on an organization", async () => {
    const { recorded, path } = announcing();
    await path.grant(
      triple({ kind: "identity_account", id: ALICE }, "viewer", {
        kind: "agent",
        id: AGENT,
      }),
      alice,
      "grant",
    );
    await path.grant(
      triple({ kind: "identity_account", id: ALICE }, "member", {
        kind: "team",
        id: TEAM,
      }),
      alice,
      "grant",
    );
    await path.grant(
      triple({ kind: "team", id: TEAM, relation: "member" }, "viewer", {
        kind: "organization",
        id: "acme",
      }),
      alice,
      "grant",
    );
    expect(
      recorded.filter((event) => event.kind.startsWith("affiliation")),
    ).toEqual([]);
  });

  it("a fault in changing stops the revoke with the row in place", async () => {
    const fault = new Error("tuple store down");
    const { grants, path } = announcing({ changing: fault });
    await path.grant(orgRole(ALICE, "member", "acme"), alice, "grant");

    await expect(
      path.revokeBySpec(orgRole(ALICE, "member", "acme"), alice),
    ).rejects.toBe(fault);

    expect(
      grants.rows.has(grantIdFor(orgRole(ALICE, "member", "acme"))),
    ).toBe(true);
  });

  it("affiliated is refused as a grant before any read, write or hook", async () => {
    const { recorded, path } = announcing();
    const refusal = await path
      .grant(orgRole(ALICE, "affiliated", "acme"), alice, "grant")
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(ConnectError);
    expect((refusal as ConnectError).code).toBe(Code.InvalidArgument);
    expect((refusal as ConnectError).rawMessage).toBe(
      AFFILIATION_NOT_GRANTABLE_MESSAGE,
    );
    expect(recorded).toEqual([]);
  });
});

describe("who and why: every access row reaches the store with its change record", () => {
  const TEAM = "tm_audit0000000000000000000";
  const SHARED = "agt_audited00000000000000000";
  const bob: CallerIdentity = {
    ...alice,
    identityId: BOB,
    email: "bob@example.com",
  };
  const aliceActor: GrantActor = { id: ALICE, callerClass: "user" };
  const bobActor: GrantActor = { id: BOB, callerClass: "user" };

  function scopeLink(kind: string, id: string, org: string): GrantSpec {
    return triple({ kind: "organization", id: org }, "organization", {
      kind,
      id,
    });
  }

  function share(principal: string, relation: string): GrantSpec {
    return triple({ kind: "identity_account", id: principal }, relation, {
      kind: "agent",
      id: SHARED,
    });
  }

  it("a fresh grant hands the store its actor, its door and its organization; a duplicate hands nothing", async () => {
    const { grants, path } = pathOver([], undefined);
    const spec = orgRole(BOB, "member", "acme");

    await path.grant(spec, alice, "grant");
    await path.grant(spec, alice, "grant");

    expect(grants.changes).toEqual([
      {
        op: "save",
        id: grantIdFor(spec),
        record: { actor: aliceActor, cause: "grant", organizationId: "acme" },
      },
    ]);
  });

  it("the actor is the caller's id and class, never its email or token", async () => {
    const { grants, path } = pathOver([], undefined);
    await path.grant(orgRole(BOB, "member", "acme"), alice, "first_sign_in");
    expect(grants.changes[0]?.record?.actor).toStrictEqual(aliceActor);
  });

  it("a structural link carries no record; a share below the organization finds it through the link, and a team's audience is an access row", async () => {
    const { grants, path } = pathOver([], undefined);
    const link = scopeLink("agent", SHARED, "acme");
    const toTeam = triple(
      { kind: "team", id: TEAM, relation: "member" },
      "viewer",
      { kind: "agent", id: SHARED },
    );

    await path.grant(link, alice, "structural");
    await path.grant(share(BOB, "viewer"), alice, "grant");
    await path.grant(toTeam, alice, "grant");

    expect(grants.changes.map((change) => change.record)).toEqual([
      undefined,
      { actor: aliceActor, cause: "grant", organizationId: "acme" },
      { actor: aliceActor, cause: "grant", organizationId: "acme" },
    ]);
  });

  it("a resource whose organization cannot be found is recorded with none, never refused", async () => {
    const { grants, path } = pathOver([], undefined);
    await path.grant(share(BOB, "viewer"), alice, "grant");
    expect(grants.changes[0]?.record?.organizationId).toBe("");
  });

  it("a revoke names its revoker; revoking a row that is not held records nothing", async () => {
    const { grants, path } = pathOver([], undefined);
    const spec = orgRole(BOB, "member", "acme");
    await path.grant(orgRole(BOB, "admin", "acme"), alice, "grant");
    await path.grant(spec, alice, "grant");
    grants.changes.length = 0;

    await path.revokeBySpec(spec, alice);
    await path.revokeBySpec(orgRole(BOB, "viewer", "acme"), alice);

    expect(grants.changes).toEqual([
      {
        op: "delete",
        id: grantIdFor(spec),
        record: { actor: aliceActor, cause: "revoke", organizationId: "acme" },
      },
    ]);
  });

  it("removing a person records the removal on their roles and left_organization on what the sweep takes, both as the remover", async () => {
    const { grants, path } = pathOver([], undefined);
    await path.grant(scopeLink("agent", SHARED, "acme"), alice, "structural");
    await path.grant(orgRole(BOB, "member", "acme"), alice, "grant");
    await path.grant(share(BOB, "viewer"), alice, "grant");
    grants.changes.length = 0;

    await path.revokeOrgAccess(BOB, "acme", alice);

    expect(grants.changes).toEqual([
      {
        op: "delete",
        id: grantIdFor(orgRole(BOB, "member", "acme")),
        record: {
          actor: aliceActor,
          cause: "organization_access_revoked",
          organizationId: "acme",
        },
      },
      {
        op: "delete",
        id: grantIdFor(share(BOB, "viewer")),
        record: {
          actor: aliceActor,
          cause: "left_organization",
          organizationId: "acme",
        },
      },
    ]);
  });

  it("the last role's revoke sweeps as the revoker", async () => {
    const { grants, path } = pathOver([], undefined);
    await path.grant(scopeLink("agent", SHARED, "acme"), alice, "structural");
    await path.grant(orgRole(BOB, "member", "acme"), alice, "grant");
    await path.grant(share(BOB, "viewer"), alice, "grant");
    grants.changes.length = 0;

    await path.revokeBySpec(orgRole(BOB, "member", "acme"), alice);

    expect(grants.changes.map((change) => change.record?.cause)).toEqual([
      "revoke",
      "left_organization",
    ]);
  });

  it("a resource's cleanup reads its organization before its scope link goes, and names whoever deleted it", async () => {
    const { grants, path } = pathOver([], undefined);
    const link = scopeLink("agent", SHARED, "acme");
    await path.grant(link, alice, "structural");
    await path.grant(share(ALICE, "viewer"), alice, "grant");
    await path.grant(share(BOB, "owner"), bob, "structural");
    grants.changes.length = 0;

    await path.cleanupResource(
      create(ApiResourceRefSchema, { kind: "agent", id: SHARED }),
      bob,
    );

    const deleted = {
      actor: bobActor,
      cause: "resource_deleted",
      organizationId: "acme",
    };
    expect(grants.changes).toEqual([
      { op: "delete", id: grantIdFor(link), record: undefined },
      {
        op: "delete",
        id: grantIdFor(share(ALICE, "viewer")),
        record: deleted,
      },
      { op: "delete", id: grantIdFor(share(BOB, "owner")), record: deleted },
    ]);
  });

  // stigmer#1603. A delete can remove a resource's scope links before
  // another cleanup reaches the resource's access rows: an organization's
  // delete removes every link that names it and keeps the resources, and
  // the owner's account goes later. The walk then finds nothing, and the
  // resource's own stored row is what still names its organization.
  const organizationRef = create(ApiResourceRefSchema, {
    kind: "organization",
    id: "acme",
  });
  const bobRef = create(ApiResourceRefSchema, {
    kind: "identity_account",
    id: BOB,
  });

  it("a revoke whose scope links a delete already removed takes the organization from the resource's stored row", async () => {
    const { grants, path } = pathOver(
      [],
      undefined,
      storedResources({ organizations: { [`agent:${SHARED}`]: "acme" } }),
    );
    await path.grant(scopeLink("agent", SHARED, "acme"), alice, "structural");
    await path.grant(share(BOB, "owner"), bob, "structural");
    await path.cleanupResource(organizationRef, alice);
    grants.changes.length = 0;

    await path.cleanupResource(bobRef, bob);

    expect(grants.changes).toEqual([
      {
        op: "delete",
        id: grantIdFor(share(BOB, "owner")),
        record: {
          actor: bobActor,
          cause: "resource_deleted",
          organizationId: "acme",
        },
      },
    ]);
  });

  it("a run's revoke walks to its session and takes the organization from the session's stored row", async () => {
    const RUN = "aex_audited00000000000000000";
    const SESSION = "ses_audited00000000000000000";
    const { grants, path } = pathOver(
      [],
      undefined,
      storedResources({ organizations: { [`session:${SESSION}`]: "acme" } }),
    );
    const viewer = triple({ kind: "identity_account", id: BOB }, "viewer", {
      kind: "run",
      id: RUN,
    });
    await path.grant(
      scopeLink("session", SESSION, "acme"),
      alice,
      "structural",
    );
    await path.grant(
      triple({ kind: "session", id: SESSION }, "session", {
        kind: "run",
        id: RUN,
      }),
      alice,
      "structural",
    );
    await path.grant(viewer, alice, "grant");
    await path.cleanupResource(organizationRef, alice);
    grants.changes.length = 0;

    await path.cleanupResource(bobRef, bob);

    expect(grants.changes).toEqual([
      {
        op: "delete",
        id: grantIdFor(viewer),
        record: {
          actor: bobActor,
          cause: "resource_deleted",
          organizationId: "acme",
        },
      },
    ]);
  });

  it("a grant on a resource with no scope link records the organization of its stored row", async () => {
    const { grants, path } = pathOver(
      [],
      undefined,
      storedResources({ organizations: { [`agent:${SHARED}`]: "acme" } }),
    );

    await path.grant(share(BOB, "viewer"), alice, "grant");

    expect(grants.changes).toEqual([
      {
        op: "save",
        id: grantIdFor(share(BOB, "viewer")),
        record: { actor: aliceActor, cause: "grant", organizationId: "acme" },
      },
    ]);
  });

  it("a resource this server stores no row of still records no organization once its links are gone", async () => {
    const { grants, path } = pathOver([], undefined);
    await path.grant(scopeLink("agent", SHARED, "acme"), alice, "structural");
    await path.grant(share(BOB, "owner"), bob, "structural");
    await path.cleanupResource(organizationRef, alice);
    grants.changes.length = 0;

    await path.cleanupResource(bobRef, bob);

    expect(
      grants.changes.map((change) => change.record?.organizationId),
    ).toEqual([""]);
  });

  it("the grant and revoke log lines carry who, why and where", async () => {
    const lines: Array<{ message: string; fields: Record<string, unknown> }> =
      [];
    const capture = (message: string, fields?: Record<string, unknown>) => {
      lines.push({ message, fields: fields ?? {} });
    };
    const path = newGrantPath({
      resources: NO_STORED_RESOURCES,
      grants: fakeGrantStore(),
      lifecycle: undefined,
      logger: { ...silentLogger, info: capture },
    });
    const spec = orgRole(BOB, "member", "acme");

    await path.grant(spec, alice, "grant");
    await path.revokeBySpec(spec, alice);

    expect(lines.map(({ message, fields }) => [message, fields])).toEqual([
      [
        "grant created",
        expect.objectContaining({
          actorId: ALICE,
          actorClass: "user",
          cause: "grant",
          organizationId: "acme",
        }),
      ],
      [
        "grant revoked",
        expect.objectContaining({
          actorId: ALICE,
          actorClass: "user",
          cause: "revoke",
          organizationId: "acme",
        }),
      ],
    ]);
  });
});

describe("a corrupt row", () => {
  it("a revoke that meets a stored row with no spec fails naming it, and removes nothing", async () => {
    const recorded: RecordedEvent[] = [];
    const { grants, path } = pathOver(recorded, recordingLifecycle(recorded));
    const corrupt = create(GrantSchema, { metadata: { id: "grt_corrupt" } });
    grants.findByPrincipalAndResource = () => Promise.resolve([corrupt]);

    await expect(path.revokeOrgAccess(ALICE, "acme", alice)).rejects.toThrow(
      "grant grt_corrupt has no spec — corrupt row",
    );
    expect(recorded).toEqual([]);
  });
});
