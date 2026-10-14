/**
 * The IamPolicyStore PORT-CONTRACT KIT: every behavior an implementation of store.ts
 * must satisfy identically, as cases a driver's test iterates. Open source
 * runs them over its own adapter (resource-store.ts) on sqlite and Postgres
 * in __tests__/resource-store.postgres.test.ts; a composition runs the SAME cases
 * over the store it registers as `drivers.iamPolicyStore`, so "the port holds" is
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
 *
 * What the kit deliberately does not carry: open source's derived-id
 * refusal and its primary-key read, the cloud's column layout and SQLSTATE
 * 23505 mapping — driver-physical, each driver's own tests. Every fixture
 * row carries its triple's DERIVED id, so "a held triple" and "a held id"
 * are one case here; a composition's legacy random ids are the grant
 * path's by-triple read to converge (store.ts header), not a store promise.
 *
 * The duplicate arm checks `instanceof DuplicatePolicyError` on the
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
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import { portContractCases } from "../../store/port-contract.js";
import type {
  PortContractCase,
  PortContractDeclaration,
  PortContractFixture,
} from "../../store/port-contract.js";
import type { PolicyChange, PolicyChangeRecord } from "./change.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "./constants.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";

/** What a driver tells the kit about its store. */
export interface IamPolicyStoreContractOptions {
  /** The store keeps a permission history and reads it back (`listChanges`). */
  readonly keepsHistory: boolean;
}

/** The runner's fixture over this port — the name a driver's test and the barrel know it by. */
export type IamPolicyStoreContractFixture = PortContractFixture<IamPolicyStore>;

export type IamPolicyStoreContractCase = PortContractCase;

const ALICE = "ida_wtr3jcf281yfk9xx61kj59fsme";
const BOB = "ida_0byc5k14t1e7b7kdxft7hwz1f7";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

function spec(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): IamPolicySpec {
  return create(IamPolicySpecSchema, {
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
): IamPolicySpec {
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
function policyRow(policySpec: IamPolicySpec, createdBy = ALICE): IamPolicy {
  return create(IamPolicySchema, {
    apiVersion: IAM_POLICY_API_VERSION,
    kind: IAM_POLICY_KIND,
    metadata: create(ApiResourceMetadataSchema, {
      id: policyIdFor(policySpec),
    }),
    spec: policySpec,
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

function idOf(policy: IamPolicy): string {
  const id = policy.metadata?.id ?? "";
  assert.notEqual(id, "", "a fixture policy must carry an id");
  return id;
}

function relationsOf(policies: ReadonlyArray<IamPolicy>): string[] {
  return policies.map((policy) => policy.spec?.relation ?? "").sort();
}

async function saveAll(
  store: IamPolicyStore,
  policies: ReadonlyArray<IamPolicy>,
): Promise<void> {
  for (const policy of policies) {
    await store.save(policy);
  }
}

const CASES: ReadonlyArray<PortContractDeclaration<IamPolicyStore>> = [
  [
    "save then findById round-trips the policy",
    async ({ store }) => {
      const policy = policyRow(orgRole(ALICE, "admin", "acme"));
      await store.save(policy);
      const found = await store.findById(idOf(policy));
      assert.ok(found !== undefined, "a saved policy must be readable by id");
      assert.ok(
        equals(IamPolicySchema, found, policy),
        "findById must return the policy exactly as it was saved",
      );
      assert.equal(
        await store.findById("iamp_00000000000000000000000000"),
        undefined,
        "an unknown id must read as undefined, not as an error",
      );
    },
  ],
  [
    "a second save under a held triple is DuplicatePolicyError, and the first row stands",
    async ({ store }) => {
      const triple = orgRole(ALICE, "admin", "acme");
      await store.save(policyRow(triple, ALICE));
      await assert.rejects(
        store.save(policyRow(triple, BOB)),
        DuplicatePolicyError,
        "save under a held id must raise the exported DuplicatePolicyError, never overwrite",
      );
      const standing = await store.findById(policyIdFor(triple));
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
        policyRow(orgRole(ALICE, "admin", "acme")),
        policyRow(orgRole(ALICE, "viewer", "acme")),
        policyRow(orgRole(ALICE, "member", "globex")),
        policyRow(orgRole(BOB, "member", "acme")),
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
        policyRow(orgRole(ALICE, "owner", "acme")),
        policyRow(structural),
        policyRow(orgRole(BOB, "member", "globex")),
      ]);
      assert.deepEqual(
        (await store.findByPrincipal("organization", "acme")).map(idOf),
        [policyIdFor(structural)],
        "findByPrincipal answers the rows where the ref is the principal",
      );
      assert.deepEqual(
        (await store.findByResource("organization", "acme")).map(idOf),
        [policyIdFor(orgRole(ALICE, "owner", "acme"))],
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
        policyRow(orgRole(ALICE, "admin", "acme")),
        policyRow(orgRole(BOB, "member", "acme")),
        policyRow(
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
        policyRow(orgRole(ALICE, "admin", "acme")),
        policyRow(orgRole(ALICE, "viewer", "acme")),
        policyRow(orgRole(BOB, "member", "acme")),
        policyRow(
          spec({ kind: "organization", id: "globex" }, "member", {
            kind: "organization",
            id: "acme",
          }),
        ),
        policyRow(orgRole(BOB, "member", "globex")),
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
        policyRow(
          spec({ kind: "identity_account", id: ALICE }, "owner", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        policyRow(
          spec({ kind: "team", id: "tm_1", relation: "member" }, "viewer", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        policyRow(
          spec({ kind: "organization", id: "acme" }, "creator", {
            kind: "agent",
            id: AGENT,
          }),
        ),
        policyRow(scope),
      ]);
      assert.equal(
        (await store.findScopeTuple("agent", AGENT))?.metadata?.id,
        policyIdFor(scope),
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
        policyRow(providerA),
        policyRow(providerB),
        policyRow(providerViewer),
        policyRow(orgRole(ALICE, "owner", "acme")),
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
        [policyIdFor(providerA), policyIdFor(providerB)].sort(),
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
      const policy = policyRow(orgRole(ALICE, "admin", "acme"));
      await store.save(policy);
      await store.deleteById(idOf(policy));
      assert.equal(
        await store.findById(idOf(policy)),
        undefined,
        "a deleted policy must not be readable by id",
      );
      assert.deepEqual(
        await store.findByPrincipalAndResource(
          "identity_account",
          ALICE,
          "organization",
          "acme",
        ),
        [],
        "a deleted policy must not be readable by its pair",
      );
      await assert.doesNotReject(
        store.save(policy),
        "the triple of a deleted policy must be savable again",
      );
    },
  ],
  [
    "a change record changes nothing about the row: save and deleteById behave as without one",
    async ({ store }) => {
      const record: PolicyChangeRecord = {
        actor: { id: BOB, callerClass: "user" },
        cause: "grant",
        organizationId: "acme",
      };
      const policy = policyRow(orgRole(ALICE, "admin", "acme"));
      await store.save(policy, record);
      const found = await store.findById(idOf(policy));
      assert.ok(
        found !== undefined && equals(IamPolicySchema, found, policy),
        "a policy saved with a record must read back exactly as saved",
      );
      await assert.rejects(
        store.save(policyRow(orgRole(ALICE, "admin", "acme"), BOB), record),
        DuplicatePolicyError,
        "a held id with a record must still raise DuplicatePolicyError",
      );
      await store.deleteById(idOf(policy), { ...record, cause: "revoke" });
      assert.equal(
        await store.findById(idOf(policy)),
        undefined,
        "a policy deleted with a record must be gone",
      );
      await assert.doesNotReject(
        store.deleteById(idOf(policy), { ...record, cause: "revoke" }),
        "deleting an id that is not held, with a record, must resolve",
      );
    },
  ],
  [
    "deleteById of an unknown id resolves",
    async ({ store }) => {
      await assert.doesNotReject(
        store.deleteById("iamp_00000000000000000000000000"),
        "deleting an id that is not held must resolve, not reject",
      );
    },
  ],
  [
    "a disconnected store is an infrastructure fault, never 'not found'",
    async (fixture) => {
      await fixture.disconnect();
      await assert.rejects(
        fixture.store.findById(policyIdFor(orgRole(ALICE, "admin", "acme"))),
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
    "two concurrent saves of one triple end in one row and DuplicatePolicyErrors only",
    async ({ store }) => {
      const triple = orgRole(ALICE, "admin", "acme");
      const results = await Promise.allSettled([
        store.save(policyRow(triple, ALICE)),
        store.save(policyRow(triple, BOB)),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          assert.ok(
            result.reason instanceof DuplicatePolicyError,
            `a losing concurrent save must fail as DuplicatePolicyError, got ${String(result.reason)}`,
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
        policyIdFor(triple),
        "the surviving row carries the triple's derived id",
      );
    },
  ],
];

function recordOf(
  cause: PolicyChangeRecord["cause"],
  organizationId: string,
): PolicyChangeRecord {
  return { actor: { id: BOB, callerClass: "user" }, cause, organizationId };
}

function sequencesOf(changes: ReadonlyArray<PolicyChange>): number[] {
  return changes.map((change) => Number(change.sequence));
}

const FIXED_WIDTH_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The history cases of a store that keeps one. */
const HISTORY_CASES: ReadonlyArray<PortContractDeclaration<IamPolicyStore>> = [
  [
    "with a history, each recorded write that changed a row reads back as one change, in order, and nothing else does",
    async ({ store }) => {
      const granted = policyRow(orgRole(ALICE, "admin", "acme"));
      const structural = policyRow(
        spec({ kind: "organization", id: "acme" }, "organization", {
          kind: "agent",
          id: AGENT,
        }),
      );
      const elsewhere = policyRow(orgRole(ALICE, "member", "globex"));
      await store.save(granted, recordOf("grant", "acme"));
      await assert.rejects(
        store.save(policyRow(orgRole(ALICE, "admin", "acme"), BOB), recordOf("grant", "acme")),
        DuplicatePolicyError,
      );
      await store.save(structural);
      await store.deleteById("iamp_00000000000000000000000000", recordOf("revoke", "acme"));
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
          equals(IamPolicySchema, change.policy, granted),
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
        await store.save(policyRow(orgRole(account, "member", "acme")), recordOf("grant", "acme"));
      }
      const read = async (page: Parameters<IamPolicyStore["listChanges"]>[1]) =>
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
];

/** The case of a store that keeps no history. */
const NO_HISTORY_CASES: ReadonlyArray<PortContractDeclaration<IamPolicyStore>> = [
  [
    "without a history, a recorded write leaves no change to read",
    async ({ store }) => {
      await store.save(policyRow(orgRole(ALICE, "admin", "acme")), recordOf("grant", "acme"));
      assert.deepEqual(
        await store.listChanges("acme", { limit: 10 }),
        [],
        "a store that keeps no history answers no changes",
      );
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function iamPolicyStoreContract(
  makeFixture: () => Promise<IamPolicyStoreContractFixture>,
  options: IamPolicyStoreContractOptions,
): ReadonlyArray<IamPolicyStoreContractCase> {
  return portContractCases(
    [...CASES, ...(options.keepsHistory ? HISTORY_CASES : NO_HISTORY_CASES)],
    makeFixture,
  );
}
