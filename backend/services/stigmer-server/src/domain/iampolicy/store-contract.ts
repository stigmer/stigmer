/**
 * The IamPolicyStore PORT-CONTRACT KIT (20260913.01, T01_0_plan.md §3a;
 * the 2a A11/A12 discipline): every behavior an implementation of store.ts
 * must satisfy identically, as cases a driver's test iterates. Open source
 * runs them over its own adapter (resource-store.ts) on sqlite and Postgres
 * in __tests__/resource-store.test.ts; a composition runs the SAME cases
 * over the store it registers as `drivers.iamPolicyStore` (the cloud's
 * `cloud.iam_policy` store, S3), so "the port holds" is one statement
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
 * The corners A12 taught are cases from the start, not later additions:
 * every relation on a pair; distinct principals, not rows; the scope-tuple
 * exclusions verbatim; unknown-id delete a no-op; a held id refused.
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
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "./constants.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";

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

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function iamPolicyStoreContract(
  makeFixture: () => Promise<IamPolicyStoreContractFixture>,
): ReadonlyArray<IamPolicyStoreContractCase> {
  return portContractCases(CASES, makeFixture);
}
