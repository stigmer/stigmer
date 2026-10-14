/**
 * The GrantStore PORT-CONTRACT KIT: every behavior an implementation of store.ts
 * must satisfy identically, as cases a driver's test iterates. Open source
 * runs them over its own adapter (resource-store.ts) on sqlite and Postgres
 * in __tests__/resource-store.postgres.test.ts; a composition runs the SAME cases
 * over the store it registers as `drivers.grantStore`, so "the port holds" is
 * one statement
 * proven per driver, never restated per repository.
 *
 * Shape. A list of declarations over the port-contract runner
 * (store/port-contract.ts): the runner owns the fresh fixture per case,
 * the cleanup, the rule that a failing assertion wins over a failing
 * cleanup, and the reason a kit returns cases instead of calling vitest's
 * `describe`. `disconnect` is the one escape hatch: the port has no
 * lifecycle by design, yet "an outage never reads as no grant" is the line
 * that matters most.
 *
 * Known corners are cases from the start, not later additions:
 * every relation on a pair; distinct principals, not rows; the scope-tuple
 * exclusions verbatim; unknown-id delete a no-op; a held id refused. A
 * change record changes nothing about the row.
 *
 * The history. A driver says whether its store keeps one
 * (`keepsHistory`), and the kit holds it to that: a store that keeps one
 * reads back exactly one change for each record handed with a write that
 * changed a row, in order, none for a duplicate, an unheld delete or a
 * write handed no record, and pages exactly at both orders' edges; a
 * store that keeps none answers no change after a recorded write. Every
 * edition above open source serves the history, so its store keeps one.
 * Retention's removal is held to its promise through the port alone: the
 * kit cannot back-date a change, so each cutoff is a time it read back
 * from `listChanges`, and the changes it expects removed are the ones read
 * back before it. What goes is a prefix of each organization, the oldest
 * first, and the numbering continues after it. Same-millisecond changes
 * across a batch boundary need back-dating, so they are the Store kit's
 * (store/__tests__/store-contract.ts).
 *
 * What the kit deliberately does not carry: open source's derived-id
 * refusal and its primary-key read, the cloud's column layout and SQLSTATE
 * 23505 mapping — driver-physical, each driver's own tests. Every fixture
 * row carries its triple's DERIVED id, so "a held triple" and "a held id"
 * are one case here; a composition's legacy random ids are the grant
 * path's by-triple read to converge (store.ts header), not a store promise.
 *
 * The duplicate arm checks `instanceof DuplicateGrantError` on the
 * exported class, because that is how the grant path's race arm catches
 * it: a driver throwing a lookalike fails here for the reason it would
 * fail a grant.
 *
 * Case names are the contract lines, in the port's words. The OSS test pins
 * the full list, so a case cannot drop out of the kit unnoticed.
 */
import assert from "node:assert/strict";

import { create, equals } from "@bufbuild/protobuf";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Grant } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { GrantSpecSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

import { portContractCases } from "../../store/port-contract.js";
import type {
  PortContractCase,
  PortContractDeclaration,
  PortContractFixture,
} from "../../store/port-contract.js";
import type { GrantChange, GrantChangeRecord } from "./change.js";
import {
  GRANT_API_VERSION,
  GRANT_KIND,
  grantIdFor,
} from "./constants.js";
import { DuplicateGrantError } from "./store.js";
import type { GrantStore } from "./store.js";

/** What a driver tells the kit about its store. */
export interface GrantStoreContractOptions {
  /** The store keeps a permission history and reads it back (`listChanges`). */
  readonly keepsHistory: boolean;
}

/** The runner's fixture over this port — the name a driver's test and the barrel know it by. */
export type GrantStoreContractFixture = PortContractFixture<GrantStore>;

export type GrantStoreContractCase = PortContractCase;

const ALICE = "ida_wtr3jcf281yfk9xx61kj59fsme";
const BOB = "ida_0byc5k14t1e7b7kdxft7hwz1f7";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

function spec(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): GrantSpec {
  return create(GrantSpecSchema, {
    principal: {
      kind: principal.kind,
      id: principal.id,
      relation: principal.relation ?? "",
    },
    relation,
    resource: { kind: resource.kind, id: resource.id },
  });
}

/** `identity_account:<id>` holds `<relation>` on `organization:<org>`. */
function orgRole(
  accountId: string,
  relation: string,
  orgId: string,
): GrantSpec {
  return spec({ kind: "identity_account", id: accountId }, relation, {
    kind: "organization",
    id: orgId,
  });
}

/**
 * A row as the domain writes it: the contract's apiVersion and kind, the
 * triple's derived id, and a creator stamp so two rows for one triple can
 * be told apart ("the first row stands").
 */
function grantRow(grantSpec: GrantSpec, createdBy = ALICE): Grant {
  return create(GrantSchema, {
    apiVersion: GRANT_API_VERSION,
    kind: GRANT_KIND,
    metadata: create(ApiResourceMetadataSchema, {
      id: grantIdFor(grantSpec),
    }),
    spec: grantSpec,
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

function idOf(grant: Grant): string {
  const id = grant.metadata?.id ?? "";
  assert.notEqual(id, "", "a fixture grant must carry an id");
  return id;
}

function relationsOf(grants: ReadonlyArray<Grant>): string[] {
  return grants.map((grant) => grant.spec?.relation ?? "").sort();
}

async function saveAll(
  store: GrantStore,
  grants: ReadonlyArray<Grant>,
): Promise<void> {
  for (const grant of grants) {
    await store.save(grant);
  }
}

const CASES: ReadonlyArray<PortContractDeclaration<GrantStore>> = [
  [
    "save then findById round-trips the grant",
    async ({ store }) => {
      const grant = grantRow(orgRole(ALICE, "admin", "acme"));
      await store.save(grant);
      const found = await store.findById(idOf(grant));
      assert.ok(found !== undefined, "a saved grant must be readable by id");
      assert.ok(
        equals(GrantSchema, found, grant),
        "findById must return the grant exactly as it was saved",
      );
      assert.equal(
        await store.findById("grt_00000000000000000000000000"),
        undefined,
        "an unknown id must read as undefined, not as an error",
      );
    },
  ],
  [
    "a second save under a held triple is DuplicateGrantError, and the first row stands",
    async ({ store }) => {
      const triple = orgRole(ALICE, "admin", "acme");
      await store.save(grantRow(triple, ALICE));
      await assert.rejects(
        store.save(grantRow(triple, BOB)),
        DuplicateGrantError,
        "save under a held id must raise the exported DuplicateGrantError, never overwrite",
      );
      const standing = await store.findById(grantIdFor(triple));
      assert.equal(
        standing?.status?.audit?.specAudit?.createdBy?.id,
        ALICE,
        "the first writer's row must stand after a refused duplicate",
      );
    },
  ],
  [
    "findByPrincipalAndResource answers every relation on the pair and nothing on another",
    async ({ store }) => {
      await saveAll(store, [
        grantRow(orgRole(ALICE, "admin", "acme")),
        grantRow(orgRole(ALICE, "viewer", "acme")),
        grantRow(orgRole(ALICE, "member", "globex")),
        grantRow(orgRole(BOB, "member", "acme")),
      ]);
      assert.deepEqual(
        relationsOf(
          await store.findByPrincipalAndResource(
            "identity_account",
            ALICE,
            "organization",
            "acme",
          ),
        ),
        ["admin", "viewer"],
        "the pair's rows are every relation the principal holds on the resource",
      );
      assert.deepEqual(
        await store.findByPrincipalAndResource(
          "identity_account",
          BOB,
          "organization",
          "globex",
        ),
        [],
        "a pair with no rows must answer an empty list",
      );
    },
  ],
  [
    "findByPrincipal and findByResource answer each side of a row",
    async ({ store }) => {
      const structural = spec(
        { kind: "organization", id: "acme" },
        "organization",
        { kind: "agent", id: AGENT },
      );
      await saveAll(store, [
        grantRow(orgRole(ALICE, "owner", "acme")),
        grantRow(structural),
        grantRow(orgRole(BOB, "member", "globex")),
      ]);
      assert.deepEqual(
        (await store.findByPrincipal("organization", "acme")).map(idOf),
        [grantIdFor(structural)],
        "findByPrincipal answers the rows where the ref is the principal",
      );
      assert.deepEqual(
        (await store.findByResource("organization", "acme")).map(idOf),
        [grantIdFor(orgRole(ALICE, "owner", "acme"))],
        "findByResource answers the rows where the ref is the resource",
      );
      assert.deepEqual(
        await store.findByResource("organization", "nowhere"),
        [],
        "a resource with no rows must answer an empty list",
      );
    },
  ],
  [
    "findByResourceWithRelations filters to the allowlist; an empty allowlist matches nothing",
    async ({ store }) => {
      await saveAll(store, [
        grantRow(orgRole(ALICE, "admin", "acme")),
        grantRow(orgRole(BOB, "member", "acme")),
        grantRow(
          spec({ kind: "organization", id: "acme" }, "organization", {
            kind: "organization",
            id: "acme",
          }),
        ),
      ]);
      assert.deepEqual(
        relationsOf(
          await store.findByResourceWithRelations("organization", "acme", [
            "admin",
            "member",
            "viewer",
          ]),
        ),
        ["admin", "member"],
        "only rows whose relation is in the allowlist are answered",
      );
      assert.deepEqual(
        await store.findByResourceWithRelations("organization", "acme", []),
        [],
        "an empty allowlist must match nothing on every edition",
      );
    },
  ],
  [
    "countDistinctPrincipalsByResource counts (kind, id) pairs, not rows, optionally by principal kind",
    async ({ store }) => {
      const roles = ["owner", "admin", "member", "viewer"];
      await saveAll(store, [
        grantRow(orgRole(ALICE, "admin", "acme")),
        grantRow(orgRole(ALICE, "viewer", "acme")),
        grantRow(orgRole(BOB, "member", "acme")),
        grantRow(
          spec({ kind: "organization", id: "globex" }, "member", {
            kind: "organization",
            id: "acme",
          }),
        ),
        grantRow(orgRole(BOB, "member", "globex")),
      ]);
      assert.equal(
        await store.countDistinctPrincipalsByResource(
          "organization",
          "acme",
          undefined,
          roles,
        ),
        3,
        "alice (two rows), bob and the organization principal are three principals, not four rows",
      );
      assert.equal(
        await store.countDistinctPrincipalsByResource(
          "organization",
          "acme",
          "identity_account",
          roles,
        ),
        2,
        "the principal-kind filter narrows to identity accounts",
      );
      assert.equal(
        await store.countDistinctPrincipalsByResource(
          "organization",
          "acme",
          undefined,
          ["owner"],
        ),
        0,
        "no row in the allowlist is a count of zero",
      );
    },
  ],
  [
    "findScopeTuple skips identity_account and team principals and owner and creator relations",
    async ({ store }) => {
      const scope = spec({ kind: "organization", id: "acme" }, "organization", {
        kind: "agent",
        id: AGENT,
      });
      await saveAll(store, [
        grantRow(
          spec({ kind: "identity_account", id: ALICE }, "owner", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        grantRow(
          spec({ kind: "team", id: "tm_1", relation: "member" }, "viewer", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        grantRow(
          spec({ kind: "organization", id: "acme" }, "creator", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        grantRow(scope),
      ]);
      assert.equal(
        (await store.findScopeTuple("agent", AGENT))?.metadata?.id,
        grantIdFor(scope),
        "the one structural link is the row whose principal and relation are both structural",
      );
      assert.equal(
        await store.findScopeTuple("agent", "agt_nowhere"),
        undefined,
        "a resource with no structural link must read as undefined",
      );
    },
  ],
  [
    "findByResourceKindAndRelation answers every row granting the relation on the kind, and nothing on another kind or relation",
    async ({ store }) => {
      const providerA = spec({ kind: "identity_account", id: ALICE }, "owner", {
        kind: "federation_issuer",
        id: "fis_01hzaaaaaaaaaaaaaaaaaaaaaa",
      });
      const providerB = spec({ kind: "identity_account", id: BOB }, "owner", {
        kind: "federation_issuer",
        id: "fis_01hzbbbbbbbbbbbbbbbbbbbbbb",
      });
      const providerViewer = spec(
        { kind: "identity_account", id: BOB },
        "viewer",
        { kind: "federation_issuer", id: "fis_01hzaaaaaaaaaaaaaaaaaaaaaa" },
      );
      await saveAll(store, [
        grantRow(providerA),
        grantRow(providerB),
        grantRow(providerViewer),
        grantRow(orgRole(ALICE, "owner", "acme")),
      ]);
      assert.deepEqual(
        (
          await store.findByResourceKindAndRelation(
            "federation_issuer",
            "owner",
          )
        )
          .map(idOf)
          .sort(),
        [grantIdFor(providerA), grantIdFor(providerB)].sort(),
        "every owner row on the kind, on any resource, and no other relation's or kind's",
      );
      assert.deepEqual(
        await store.findByResourceKindAndRelation("invitation", "owner"),
        [],
        "a kind with no such rows answers an empty list",
      );
    },
  ],
  [
    "deleteById removes the row; the triple is free to be granted again",
    async ({ store }) => {
      const grant = grantRow(orgRole(ALICE, "admin", "acme"));
      await store.save(grant);
      await store.deleteById(idOf(grant));
      assert.equal(
        await store.findById(idOf(grant)),
        undefined,
        "a deleted grant must not be readable by id",
      );
      assert.deepEqual(
        await store.findByPrincipalAndResource(
          "identity_account",
          ALICE,
          "organization",
          "acme",
        ),
        [],
        "a deleted grant must not be readable by its pair",
      );
      await assert.doesNotReject(
        store.save(grant),
        "the triple of a deleted grant must be savable again",
      );
    },
  ],
  [
    "a change record changes nothing about the row: save and deleteById behave as without one",
    async ({ store }) => {
      const record: GrantChangeRecord = {
        actor: { id: BOB, callerClass: "user" },
        cause: "grant",
        organizationId: "acme",
      };
      const grant = grantRow(orgRole(ALICE, "admin", "acme"));
      await store.save(grant, record);
      const found = await store.findById(idOf(grant));
      assert.ok(
        found !== undefined && equals(GrantSchema, found, grant),
        "a grant saved with a record must read back exactly as saved",
      );
      await assert.rejects(
        store.save(grantRow(orgRole(ALICE, "admin", "acme"), BOB), record),
        DuplicateGrantError,
        "a held id with a record must still raise DuplicateGrantError",
      );
      await store.deleteById(idOf(grant), { ...record, cause: "revoke" });
      assert.equal(
        await store.findById(idOf(grant)),
        undefined,
        "a grant deleted with a record must be gone",
      );
      await assert.doesNotReject(
        store.deleteById(idOf(grant), { ...record, cause: "revoke" }),
        "deleting an id that is not held, with a record, must resolve",
      );
    },
  ],
  [
    "deleteById of an unknown id resolves",
    async ({ store }) => {
      await assert.doesNotReject(
        store.deleteById("grt_00000000000000000000000000"),
        "deleting an id that is not held must resolve, not reject",
      );
    },
  ],
  [
    "a disconnected store is an infrastructure fault, never 'not found'",
    async (fixture) => {
      await fixture.disconnect();
      await assert.rejects(
        fixture.store.findById(grantIdFor(orgRole(ALICE, "admin", "acme"))),
        "an id read on a disconnected store must reject, never read as undefined",
      );
      await assert.rejects(
        fixture.store.findByPrincipalAndResource(
          "identity_account",
          ALICE,
          "organization",
          "acme",
        ),
        "a pair read on a disconnected store must reject, never read as an empty list",
      );
      await assert.rejects(
        fixture.store.findByResourceKindAndRelation(
          "federation_issuer",
          "owner",
        ),
        "a kind read on a disconnected store must reject: a reconcile that read no rows would leave every one standing",
      );
      await assert.rejects(
        fixture.store.listChanges("acme", { limit: 10 }),
        "a history read on a disconnected store must reject, never read as no changes",
      );
    },
  ],
  [
    "two concurrent saves of one triple end in one row and DuplicateGrantErrors only",
    async ({ store }) => {
      const triple = orgRole(ALICE, "admin", "acme");
      const results = await Promise.allSettled([
        store.save(grantRow(triple, ALICE)),
        store.save(grantRow(triple, BOB)),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          assert.ok(
            result.reason instanceof DuplicateGrantError,
            `a losing concurrent save must fail as DuplicateGrantError, got ${String(result.reason)}`,
          );
        }
      }
      assert.ok(
        results.some((result) => result.status === "fulfilled"),
        "at least one of two concurrent saves must win",
      );
      const rows = await store.findByPrincipalAndResource(
        "identity_account",
        ALICE,
        "organization",
        "acme",
      );
      assert.equal(rows.length, 1, "one triple must end as exactly one row");
      assert.equal(
        rows[0]?.metadata?.id,
        grantIdFor(triple),
        "the surviving row carries the triple's derived id",
      );
    },
  ],
];

function recordOf(
  cause: GrantChangeRecord["cause"],
  organizationId: string,
): GrantChangeRecord {
  return { actor: { id: BOB, callerClass: "user" }, cause, organizationId };
}

function sequencesOf(changes: ReadonlyArray<GrantChange>): number[] {
  return changes.map((change) => Number(change.sequence));
}

const FIXED_WIDTH_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Waits past the clock's millisecond, so changes written either side of it are timed apart. */
function nextMillisecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 3));
}

/** Each organization's kept changes, oldest first, as `org:sequence`. */
async function keptChanges(
  store: GrantStore,
  orgs: ReadonlyArray<string>,
): Promise<string[]> {
  const kept: string[] = [];
  for (const org of orgs) {
    for (const change of await store.listChanges(org, { limit: 100, after: 0n })) {
      kept.push(`${org}:${change.sequence}`);
    }
  }
  return kept;
}

/** Records one grant per organization named, in order, each timed after the one before. */
async function grantInTurn(
  store: GrantStore,
  orgs: ReadonlyArray<string>,
): Promise<void> {
  let n = 0;
  for (const org of orgs) {
    n += 1;
    await store.save(grantRow(orgRole(`ida_${n}`, "member", org)), recordOf("grant", org));
    await nextMillisecond();
  }
}

/** The history cases of a store that keeps one. */
const HISTORY_CASES: ReadonlyArray<PortContractDeclaration<GrantStore>> = [
  [
    "with a history, each recorded write that changed a row reads back as one change, in order, and nothing else does",
    async ({ store }) => {
      const granted = grantRow(orgRole(ALICE, "admin", "acme"));
      const structural = grantRow(
        spec({ kind: "organization", id: "acme" }, "organization", {
          kind: "agent",
          id: AGENT,
        }),
      );
      const elsewhere = grantRow(orgRole(ALICE, "member", "globex"));
      await store.save(granted, recordOf("grant", "acme"));
      await assert.rejects(
        store.save(grantRow(orgRole(ALICE, "admin", "acme"), BOB), recordOf("grant", "acme")),
        DuplicateGrantError,
      );
      await store.save(structural);
      await store.deleteById("grt_00000000000000000000000000", recordOf("revoke", "acme"));
      await store.deleteById(idOf(granted), recordOf("organization_access_revoked", "acme"));
      await store.save(elsewhere, recordOf("grant", "globex"));

      const changes = await store.listChanges("acme", { limit: 10 });
      assert.deepEqual(
        changes.map((change) => [Number(change.sequence), change.change, change.cause]),
        [
          [2, "revoked", "organization_access_revoked"],
          [1, "granted", "grant"],
        ],
        "one change per recorded write that changed a row, numbered from 1, newest first",
      );
      for (const change of changes) {
        assert.deepEqual(change.actor, { id: BOB, callerClass: "user" }, "the actor reads back as recorded");
        assert.equal(change.organizationId, "acme", "the organization reads back as recorded");
        assert.ok(
          equals(GrantSchema, change.grant, granted),
          "the change carries the row as granted, or as it stood when revoked",
        );
        assert.match(change.occurredAt, FIXED_WIDTH_UTC, "times are fixed-width UTC with milliseconds");
      }
      assert.ok(
        (changes[1]?.occurredAt ?? "") <= (changes[0]?.occurredAt ?? ""),
        "a change is never timed before the change numbered before it",
      );
      assert.deepEqual(
        sequencesOf(await store.listChanges("globex", { limit: 10 })),
        [1],
        "each organization numbers its own changes from 1",
      );
    },
  ],
  [
    "with a history, newest first below a number and oldest first above one page exactly at their edges",
    async ({ store }) => {
      for (const account of [ALICE, BOB, "ida_c", "ida_d", "ida_e"]) {
        await store.save(grantRow(orgRole(account, "member", "acme")), recordOf("grant", "acme"));
      }
      const read = async (page: Parameters<GrantStore["listChanges"]>[1]) =>
        sequencesOf(await store.listChanges("acme", page));
      assert.deepEqual(await read({ limit: 2 }), [5, 4], "newest first from the newest");
      assert.deepEqual(await read({ limit: 2, before: 4n }), [3, 2], "newest first strictly below the bound");
      assert.deepEqual(await read({ limit: 2, before: 2n }), [1], "a short last page");
      assert.deepEqual(await read({ limit: 2, before: 1n }), [], "nothing below the first");
      assert.deepEqual(await read({ limit: 2, after: 0n }), [1, 2], "oldest first from the first");
      assert.deepEqual(await read({ limit: 2, after: 2n }), [3, 4], "oldest first strictly above the bound");
      assert.deepEqual(await read({ limit: 2, after: 4n }), [5], "a short last page");
      assert.deepEqual(await read({ limit: 2, after: 5n }), [], "nothing above the last");
      assert.deepEqual(
        await store.listChanges("nowhere", { limit: 2 }),
        [],
        "an organization with no changes answers an empty list",
      );
      await assert.rejects(
        store.listChanges("acme", { limit: 0 }),
        "a limit that is not a positive integer must reject",
      );
    },
  ],
  [
    "with a history, a removal takes only the changes recorded before the instant, a prefix of each organization, and the numbering continues",
    async ({ store }) => {
      await grantInTurn(store, ["acme", "globex", "acme", "globex", "acme"]);
      const [cutoffChange] = await store.listChanges("acme", { limit: 1, before: 3n });
      const cutoff = cutoffChange?.occurredAt ?? "";
      const all = [
        ...(await store.listChanges("acme", { limit: 10, after: 0n })),
        ...(await store.listChanges("globex", { limit: 10, after: 0n })),
      ];
      const expectedKept = all
        .filter((change) => change.occurredAt >= cutoff)
        .map((change) => `${change.organizationId}:${change.sequence}`);

      assert.equal(
        await store.pruneChanges(new Date(cutoff), 100),
        all.length - expectedKept.length,
        "the removal answers how many changes it removed",
      );
      assert.deepEqual(
        await keptChanges(store, ["acme", "globex"]),
        expectedKept,
        "only the changes recorded before the instant go, in every organization",
      );
      assert.deepEqual(
        expectedKept,
        ["acme:2", "acme:3", "globex:2"],
        "what goes is a prefix of each organization's numbers",
      );
      await store.save(grantRow(orgRole("ida_late", "member", "acme")), recordOf("grant", "acme"));
      assert.deepEqual(
        sequencesOf(await store.listChanges("acme", { limit: 1 })),
        [4],
        "the numbering continues after a removal",
      );
    },
  ],
  [
    "with a history, a limit removes the oldest first and leaves the rest for the next call",
    async ({ store }) => {
      await grantInTurn(store, ["acme", "globex", "acme", "acme", "globex"]);
      const cutoff = new Date(Date.now() + 60_000);
      const orgs = ["acme", "globex"];
      assert.equal(await store.pruneChanges(cutoff, 2), 2, "a call removes at most its limit");
      assert.deepEqual(
        await keptChanges(store, orgs),
        ["acme:2", "acme:3", "globex:2"],
        "the oldest two go first, across organizations",
      );
      assert.equal(await store.pruneChanges(cutoff, 2), 2);
      assert.deepEqual(await keptChanges(store, orgs), ["globex:2"], "the next call takes the next oldest");
      assert.equal(await store.pruneChanges(cutoff, 2), 1, "a short last batch");
      assert.equal(await store.pruneChanges(cutoff, 2), 0, "nothing is left to remove");
      assert.equal(
        await store.lastChangeSequence("acme"),
        3n,
        "an organization whose every change was removed still reads its last number",
      );
      assert.equal(await store.lastChangeSequence("nowhere"), 0n, "an organization with no history reads 0");
      await store.save(grantRow(orgRole("ida_late", "member", "globex")), recordOf("grant", "globex"));
      assert.deepEqual(
        await keptChanges(store, orgs),
        ["globex:3"],
        "an organization whose every change was removed continues its numbering",
      );
      await assert.rejects(
        store.pruneChanges(cutoff, 0),
        "a limit that is not a positive integer must reject",
      );
    },
  ],
];

/** The case of a store that keeps no history. */
const NO_HISTORY_CASES: ReadonlyArray<PortContractDeclaration<GrantStore>> = [
  [
    "without a history, a recorded write leaves no change to read and a removal removes nothing",
    async ({ store }) => {
      await store.save(grantRow(orgRole(ALICE, "admin", "acme")), recordOf("grant", "acme"));
      assert.deepEqual(
        await store.listChanges("acme", { limit: 10 }),
        [],
        "a store that keeps no history answers no changes",
      );
      assert.equal(
        await store.pruneChanges(new Date(Date.now() + 60_000), 10),
        0,
        "a store that keeps no history removes nothing",
      );
      assert.equal(await store.lastChangeSequence("acme"), 0n, "a store that keeps no history reads 0");
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function grantStoreContract(
  makeFixture: () => Promise<GrantStoreContractFixture>,
  options: GrantStoreContractOptions,
): ReadonlyArray<GrantStoreContractCase> {
  return portContractCases(
    [...CASES, ...(options.keepsHistory ? HISTORY_CASES : NO_HISTORY_CASES)],
    makeFixture,
  );
}
