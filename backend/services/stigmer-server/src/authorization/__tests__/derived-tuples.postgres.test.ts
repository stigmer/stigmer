/**
 * Pins the derivation — the ONE place edition knowledge lives in the
 * built-in authorizer: which tuples a stored row stands for, in exactly
 * the shapes the cloud's tuple driver writes (stigmer-cloud
 * iam/tuple-lifecycle.ts: `organization:<org>#viewer` for the org level,
 * the owner by the kind's attribution, the parent links by `kind_meta`). Two facts are the
 * OSS edition's own and are pinned here by name: the organization's owner
 * is a ROW (the role lifecycle's), never derived from its creator stamp,
 * or a revoked founder would stay owner; and a stamp that names no person
 * (`""`, `"system"`) becomes no tuple at all.
 *
 * The second half runs the tuple SOURCE over both store drivers: rows and
 * derived tuples unioned per object, the person's rows read once per
 * source, an absent object answering nothing, a store fault propagating
 * as the fault it is — the store-fault mapping, which is what
 * lets the driver above fold it to `unavailable` and never to a denial.
 * Its grants-to-teams arm evaluates the built-in model's Enterprise team
 * type: a grant to a team reaches its members and nobody
 * who left the organization, and a person in no team — every open-source
 * caller — still costs the source exactly one read.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole, triple } from "../../domain/iampolicy/__tests__/support.js";
import { fakeIdentityAccountStore } from "../../domain/identityaccount/__tests__/support.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { deriveTuples, newDerivedTupleSource } from "../derived-tuples.js";
import { checkRelation } from "../evaluator.js";
import { rowFactsOf } from "../facts.js";
import { builtInModel } from "../model/index.js";
import type { Person } from "../tuples.js";
import { formatTuple, parseObjectRef } from "../tuples.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow, storedDeclaration } from "./support.js";
import type { StoredKindDeclaration } from "./support.js";

function derivedFor(
  type: string,
  facts: {
    org?: string;
    visibility?: ApiResourceVisibility;
    createdBy?: string;
    spec?: Readonly<Record<string, unknown>>;
  },
): string[] {
  const declaration = storedDeclaration(type);
  const row = fixtureRow(declaration, {
    id: `${type}-1`,
    org: facts.org ?? "acme",
    visibility: facts.visibility ?? ApiResourceVisibility.visibility_private,
    createdBy: facts.createdBy ?? "ida_carol",
    ...(facts.spec === undefined ? {} : { spec: facts.spec }),
  });
  return deriveTuples(rowFactsOf(declaration.kind, row)).map(formatTuple);
}

describe("deriveTuples — the cloud driver's shapes, from the row", () => {
  it("a private agent: its organization link and its creator as owner, nothing else", () => {
    expect(derivedFor("agent", {})).toEqual([
      "agent:agent-1#organization@organization:acme",
      "agent:agent-1#owner@identity_account:ida_carol",
    ]);
  });

  it("an org-visible blueprint adds the organization's VIEWER userset (not `#member`)", () => {
    expect(
      derivedFor("mcp_server", {
        visibility: ApiResourceVisibility.visibility_org,
      }),
    ).toEqual([
      "mcp_server:mcp_server-1#organization@organization:acme",
      "mcp_server:mcp_server-1#owner@identity_account:ida_carol",
      "mcp_server:mcp_server-1#viewer@organization:acme#viewer",
    ]);
  });

  it("a blueprint shared with child organizations adds the organization's CHILD_ORG_VIEWER userset beside the org floor", () => {
    expect(
      derivedFor("agent", {
        visibility: ApiResourceVisibility.visibility_child_orgs,
      }),
    ).toEqual([
      "agent:agent-1#organization@organization:acme",
      "agent:agent-1#owner@identity_account:ida_carol",
      "agent:agent-1#child_org_viewer@organization:acme#child_org_viewer",
      "agent:agent-1#viewer@organization:acme#viewer",
    ]);
  });

  it("a row that still carries the retired public level derives no viewer tuple at all — no shape reaches every account, and the level's own org floor left with it", () => {
    expect(
      derivedFor("skill", {
        visibility: ApiResourceVisibility.visibility_public,
      }),
    ).toEqual([
      "skill:skill-1#organization@organization:acme",
      "skill:skill-1#owner@identity_account:ida_carol",
    ]);
  });

  it("an unspecified level derives no visibility tuple — a legacy row reads private in both editions", () => {
    expect(
      derivedFor("mcp_server", {
        visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
      }),
    ).toEqual([
      "mcp_server:mcp_server-1#organization@organization:acme",
      "mcp_server:mcp_server-1#owner@identity_account:ida_carol",
    ]);
  });

  it("the organization derives NOTHING: no scope (OWNER_ONLY) and its owner is the role lifecycle's row, never its creator stamp", () => {
    expect(derivedFor("organization", { org: "" })).toEqual([]);
  });

  it("a stamp that names no person is no owner: the empty stamp and the unconfigured laptop's placeholder", () => {
    expect(derivedFor("agent", { createdBy: "" })).toEqual([
      "agent:agent-1#organization@organization:acme",
    ]);
    expect(derivedFor("agent", { createdBy: "system" })).toEqual([
      "agent:agent-1#organization@organization:acme",
    ]);
  });

  it("a row naming no organization has no scope link and no org-viewer userset to point at", () => {
    expect(
      derivedFor("agent", {
        org: "",
        visibility: ApiResourceVisibility.visibility_org,
      }),
    ).toEqual(["agent:agent-1#owner@identity_account:ida_carol"]);
  });

  it("a run is its session's: the session link (PARENT scope) and NO owner of its own (INHERITED attribution)", () => {
    expect(derivedFor("run", {})).toEqual([
      "run:run-1#session@session:session-1",
    ]);
  });

  it("an account owns itself (SELF attribution) and has no scope link", () => {
    expect(derivedFor("identity_account", { org: "" })).toEqual([
      "identity_account:identity_account-1#owner@identity_account:identity_account-1",
    ]);
  });

  it("a memory's one principal is its subject, from the spec field; an EMPTY subject derives no principal at all", () => {
    expect(derivedFor("memory", {})).toEqual([
      "memory:memory-1#organization@organization:acme",
      "memory:memory-1#subject@identity_account:identity_account-1",
    ]);
    // Open source stores "" today (no capture credential fills the field):
    // such a row is nobody's under an enforcing evaluator — stated, not hidden.
    expect(
      derivedFor("memory", { spec: { subjectIdentityAccountId: "" } }),
    ).toEqual(["memory:memory-1#organization@organization:acme"]);
  });

  it("a shared vault links its organization as its owner and takes an org-viewer at org level, nothing beyond its org ceiling, and no creator", () => {
    const shared = { owner: { case: "org", value: "acme" } };
    expect(
      derivedFor("vault", {
        visibility: ApiResourceVisibility.visibility_org,
        spec: shared,
      }),
    ).toEqual([
      "vault:vault-1#organization@organization:acme",
      "vault:vault-1#org_owned@organization:acme",
      "vault:vault-1#viewer@organization:acme#viewer",
    ]);
    expect(
      derivedFor("vault", {
        visibility: ApiResourceVisibility.visibility_child_orgs,
        spec: shared,
      }),
    ).toEqual([
      "vault:vault-1#organization@organization:acme",
      "vault:vault-1#org_owned@organization:acme",
    ]);
  });

  it("a My vault links its person and nothing else: no org_owned link, no creator", () => {
    expect(
      derivedFor("vault", { spec: { owner: { case: "person", value: "ida_ana" } } }),
    ).toEqual([
      "vault:vault-1#organization@organization:acme",
      "vault:vault-1#person@identity_account:ida_ana",
    ]);
  });

  it("kinds with no visibility axis derive no viewer tuple at any level — their audience is the model's own line", () => {
    for (const type of ["schedule", "session"]) {
      expect(
        derivedFor(type, {
          visibility: ApiResourceVisibility.visibility_org,
        }),
        type,
      ).toEqual([
        `${type}:${type}-1#organization@organization:acme`,
        `${type}:${type}-1#owner@identity_account:ida_carol`,
      ]);
    }
  });

  it("an owner-only kind carries no scope link whatever metadata.org says", () => {
    expect(derivedFor("api_key", {})).toEqual([
      "api_key:api_key-1#owner@identity_account:ida_carol",
    ]);
  });

});

// ---------------------------------------------------------------------------
// The source over both drivers.
// ---------------------------------------------------------------------------

/** Every kind a driver arm below seeds — cleared before each test on the shared Postgres database. */
const SEEDED_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.iam_policy,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.identity_account,
  ApiResourceKind.team,
];

afterAll(dropPostgresFixture);

const ROOT: Person = { accountId: "ida_root", aliases: new Set(["ida_root"]) };
const DAVE: Person = { accountId: "ida_dave", aliases: new Set(["ida_dave"]) };
/** A read-only viewer of acme's child organization, and nobody in acme. */
const VIC: Person = { accountId: "ida_vic", aliases: new Set(["ida_vic"]) };

async function grant(
  policies: IamPolicyStore,
  spec: ReturnType<typeof orgRole>,
): Promise<void> {
  await policies.save(
    create(IamPolicySchema, {
      apiVersion: IAM_POLICY_API_VERSION,
      kind: IAM_POLICY_KIND,
      metadata: { id: policyIdFor(spec) },
      spec,
    }),
  );
}

/** Wraps the port so the test can count the one read the source is allowed. */
function countingPolicies(inner: IamPolicyStore): {
  readonly policies: IamPolicyStore;
  reads(): number;
} {
  let reads = 0;
  return {
    policies: {
      ...inner,
      findByPrincipal(principalKind, principalId) {
        reads += 1;
        return inner.findByPrincipal(principalKind, principalId);
      },
    },
    reads: () => reads,
  };
}

describe.each(driverFixtures(SEEDED_KINDS))(
  "the derived tuple source on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("rows and derived tuples", () => {
      let opened: OpenedStore;
      let counted: ReturnType<typeof countingPolicies>;
      let accounts: IdentityAccountStore;

      beforeEach(async () => {
        opened = await fixture.open();
        counted = countingPolicies(newResourceIamPolicyStore(opened.store));
        accounts = newResourceIdentityAccountStore(opened.store);
        const organization = storedDeclaration("organization");
        await opened.store.saveResource(
          ApiResourceKind.organization,
          "acme",
          organization.schema,
          fixtureRow(organization, {
            id: "acme",
            org: "",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: ROOT.accountId,
          }),
        );
        const agent = storedDeclaration("agent");
        await opened.store.saveResource(
          ApiResourceKind.agent,
          "agt_team",
          agent.schema,
          fixtureRow(agent, {
            id: "agt_team",
            org: "acme",
            visibility: ApiResourceVisibility.visibility_org,
            createdBy: "ida_carol",
          }),
        );
        await grant(counted.policies, orgRole(ROOT.accountId, "owner", "acme"));
        await grant(
          counted.policies,
          orgRole(DAVE.accountId, "member", "acme"),
        );
        // A structural row (the cloud's `bootstrapPolicy` shape): a
        // userset principal, carried as a userset subject.
        await grant(
          counted.policies,
          triple(
            { kind: "organization", id: "partner", relation: "member" },
            "viewer",
            { kind: "organization", id: "acme" },
          ),
        );
      });

      afterEach(async () => {
        await opened.close();
      });

      function sourceFor(person: Person) {
        return newDerivedTupleSource(
          { store: opened.store, policies: counted.policies, accounts },
          person,
        );
      }

      it("derives a parent's child_org edges from the organization list index and a child's parent_org from its row: the child's viewer reads what the parent shares, and the parent's owner manages the child without reading it", async () => {
        const organization = storedDeclaration("organization");
        await opened.store.saveResource(
          ApiResourceKind.organization,
          "acme-cust",
          organization.schema,
          fixtureRow(organization, {
            id: "acme-cust",
            org: "",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: "system",
            spec: { parentOrg: "acme" },
          }),
        );
        const agent = storedDeclaration("agent");
        await opened.store.saveResource(
          ApiResourceKind.agent,
          "agt_catalog",
          agent.schema,
          fixtureRow(agent, {
            id: "agt_catalog",
            org: "acme",
            visibility: ApiResourceVisibility.visibility_child_orgs,
            createdBy: ROOT.accountId,
          }),
        );
        await opened.store.saveResource(
          ApiResourceKind.agent,
          "agt_customer",
          agent.schema,
          fixtureRow(agent, {
            id: "agt_customer",
            org: "acme-cust",
            visibility: ApiResourceVisibility.visibility_org,
            createdBy: VIC.accountId,
          }),
        );
        await grant(
          counted.policies,
          orgRole(VIC.accountId, "viewer", "acme-cust"),
        );

        const vic = sourceFor(VIC);
        expect(
          (
            await vic.tuplesOf(parseObjectRef("organization:acme"), "child_org")
          ).map(formatTuple),
        ).toEqual(["organization:acme#child_org@organization:acme-cust"]);
        expect(
          (
            await vic.tuplesOf(
              parseObjectRef("organization:acme-cust"),
              "parent_org",
            )
          ).map(formatTuple),
        ).toEqual(["organization:acme-cust#parent_org@organization:acme"]);
        const check = (
          person: Person,
          object: string,
          relation: string,
        ): Promise<boolean> =>
          checkRelation(
            { model: builtInModel, source: sourceFor(person) },
            parseObjectRef(object),
            relation,
            person,
          );
        expect(await check(VIC, "agent:agt_catalog", "can_execute")).toBe(true);
        expect(await check(VIC, "organization:acme", "can_view")).toBe(false);
        expect(await check(ROOT, "organization:acme-cust", "can_edit")).toBe(
          true,
        );
        expect(
          await check(ROOT, "organization:acme-cust", "can_grant_access"),
        ).toBe(true);
        expect(await check(ROOT, "organization:acme-cust", "can_view")).toBe(
          false,
        );
        expect(await check(ROOT, "agent:agt_customer", "can_view")).toBe(false);
        // acme's member is no admin of acme, so manages nothing in its child.
        expect(await check(DAVE, "organization:acme-cust", "can_edit")).toBe(
          false,
        );
        // An organization with no children derives no child_org edge.
        expect(
          await sourceFor(ROOT).tuplesOf(
            parseObjectRef("organization:acme-cust"),
            "child_org",
          ),
        ).toEqual([]);
      });

      it("an identity_account object is read through the account PORT, so a person owns their own row wherever accounts live", async () => {
        // A port that is NOT the generic store: the row lives in memory
        // only, so a read around the port would miss it. The source must
        // read it through the port.
        const detached = fakeIdentityAccountStore();
        detached.rows.set(
          ROOT.accountId,
          create(IdentityAccountSchema, {
            metadata: { id: ROOT.accountId, name: "auth0|root" },
            spec: {
              idpId: "auth0|root",
              provisioningMode: IdentityAccountProvisioningMode.direct,
            },
          }),
        );
        const source = newDerivedTupleSource(
          {
            store: opened.store,
            policies: counted.policies,
            accounts: detached,
          },
          ROOT,
        );
        const self = parseObjectRef(`identity_account:${ROOT.accountId}`);
        expect((await source.tuplesOf(self, "owner")).map(formatTuple)).toEqual(
          [`identity_account:ida_root#owner@identity_account:ida_root`],
        );
        expect(
          await source.tuplesOf(
            parseObjectRef("identity_account:ida_ghost"),
            "owner",
          ),
        ).toEqual([]);
      });

      it("derives the organization's affiliated tuple from each role row the person holds there, in the same read", async () => {
        const affiliated = async (person: Person) =>
          (
            await sourceFor(person).tuplesOf(
              parseObjectRef("organization:acme"),
              "affiliated",
            )
          ).map(formatTuple);
        expect(await affiliated(ROOT)).toEqual([
          "organization:acme#affiliated@identity_account:ida_root",
        ]);
        expect(await affiliated(DAVE)).toEqual([
          "organization:acme#affiliated@identity_account:ida_dave",
        ]);
        // The userset row (a partner organization's members as viewers)
        // is structure, not a role the person holds: no affiliation.
        expect(
          await sourceFor(ROOT).tuplesOf(
            parseObjectRef("organization:partner"),
            "affiliated",
          ),
        ).toEqual([]);
      });

      it("answers the person's own rows on the organization, and nobody else's", async () => {
        const source = sourceFor(ROOT);
        expect(
          (
            await source.tuplesOf(parseObjectRef("organization:acme"), "owner")
          ).map(formatTuple),
        ).toEqual(["organization:acme#owner@identity_account:ida_root"]);
        expect(
          await source.tuplesOf(parseObjectRef("organization:acme"), "member"),
        ).toEqual([]);
        expect(
          (
            await sourceFor(DAVE).tuplesOf(
              parseObjectRef("organization:acme"),
              "member",
            )
          ).map(formatTuple),
        ).toEqual(["organization:acme#member@identity_account:ida_dave"]);
      });

      it("reads the person's rows ONCE, however many objects and relations are asked", async () => {
        const source = sourceFor(ROOT);
        await source.tuplesOf(parseObjectRef("organization:acme"), "owner");
        await source.tuplesOf(parseObjectRef("organization:acme"), "admin");
        await source.tuplesOf(parseObjectRef("organization:other"), "owner");
        await source.tuplesOf(parseObjectRef("agent:agt_team"), "owner");
        expect(counted.reads()).toBe(1);
      });

      it("derives a stored row's tuples and unions them with rows, per relation", async () => {
        const source = sourceFor(DAVE);
        const agent = parseObjectRef("agent:agt_team");
        expect(
          (await source.tuplesOf(agent, "organization")).map(formatTuple),
        ).toEqual(["agent:agt_team#organization@organization:acme"]);
        expect(
          (await source.tuplesOf(agent, "owner")).map(formatTuple),
        ).toEqual(["agent:agt_team#owner@identity_account:ida_carol"]);
        expect(
          (await source.tuplesOf(agent, "viewer")).map(formatTuple),
        ).toEqual(["agent:agt_team#viewer@organization:acme#viewer"]);
        expect(await source.tuplesOf(agent, "can_view")).toEqual([]);
      });

      it("rows naming another principal never enter a person's source — the structural `organization:partner#member` row is nobody's here", async () => {
        const source = sourceFor(ROOT);
        expect(
          await source.tuplesOf(parseObjectRef("organization:acme"), "viewer"),
        ).toEqual([]);
      });

      it("an absent object, a declared kind this edition stores no row of, a rowless kind, or a kind the model does not declare answers no tuples", async () => {
        const source = sourceFor(ROOT);
        expect(
          await source.tuplesOf(parseObjectRef("agent:agt_missing"), "owner"),
        ).toEqual([]);
        // Declared, served by the wider editions: the store has no such row.
        expect(
          await source.tuplesOf(
            parseObjectRef("identity_provider:idp"),
            "owner",
          ),
        ).toEqual([]);
        // Rowless: no row is loaded for it at all.
        expect(
          await source.tuplesOf(parseObjectRef("platform:stigmer"), "operator"),
        ).toEqual([]);
        expect(
          await source.tuplesOf(
            parseObjectRef("api_resource_version:v1"),
            "owner",
          ),
        ).toEqual([]);
        expect(
          await source.tuplesOf(parseObjectRef("nonsense:x"), "owner"),
        ).toEqual([]);
      });

      it("loads a row once and serves every relation from it — the loader hands back the same decoded row", async () => {
        const source = sourceFor(ROOT);
        const agent = parseObjectRef("agent:agt_team");
        await source.tuplesOf(agent, "organization");
        const first = await source.loader.load(agent);
        await source.tuplesOf(agent, "owner");
        const second = await source.loader.load(agent);
        expect(first).toBeDefined();
        expect(second).toBe(first);
      });

      it("a source seeded with a candidate's facts derives that object's tuples WITHOUT loading its row; the parent hop still loads", async () => {
        let rowReads = 0;
        const agent = storedDeclaration("agent");
        const seeded = newDerivedTupleSource(
          {
            store: {
              ...opened.store,
              getResource(kind, id, schema) {
                rowReads += 1;
                return opened.store.getResource(kind, id, schema);
              },
            },
            policies: counted.policies,
            accounts,
          },
          DAVE,
          {
            facts: [
              rowFactsOf(
                agent.kind,
                fixtureRow(agent, {
                  id: "agt_team",
                  org: "acme",
                  visibility: ApiResourceVisibility.visibility_org,
                  createdBy: "ida_carol",
                }),
              ),
            ],
          },
        );
        const object = parseObjectRef("agent:agt_team");
        expect(
          (await seeded.tuplesOf(object, "viewer")).map(formatTuple),
        ).toEqual(["agent:agt_team#viewer@organization:acme#viewer"]);
        expect(
          (await seeded.tuplesOf(object, "owner")).map(formatTuple),
        ).toEqual(["agent:agt_team#owner@identity_account:ida_carol"]);
        expect(rowReads, "the seeded object's row is never read").toBe(0);
        // The member reads the org-visible agent through the organization,
        // whose row the walk loads — the one read a seeded check makes.
        expect(
          await checkRelation(
            { model: builtInModel, source: seeded },
            object,
            "can_view",
            DAVE,
          ),
        ).toBe(true);
        expect(rowReads).toBe(1);
      });

      it("a seeded fact stands in for the row only where the row would have been read for FACTS: a `derived` rule still reads the row it needs", async () => {
        // A seeded child organization: `parent_org` reads the child's
        // `spec.parent_org`, which a candidate's facts do not carry, so
        // the rule loads the row — one read.
        let rowReads = 0;
        const organization = storedDeclaration("organization");
        const row = fixtureRow(organization, {
          id: "org_seeded",
          org: "",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: "ida_carol",
          spec: { parentOrg: "acme" },
        });
        await opened.store.saveResource(
          organization.kind,
          "org_seeded",
          organization.schema,
          row,
        );
        const seeded = newDerivedTupleSource(
          {
            store: {
              ...opened.store,
              getResource(kind, id, schema) {
                rowReads += 1;
                return opened.store.getResource(kind, id, schema);
              },
            },
            policies: counted.policies,
            accounts,
          },
          DAVE,
          { facts: [rowFactsOf(organization.kind, row)] },
        );
        const object = parseObjectRef("organization:org_seeded");
        await seeded.tuplesOf(object, "owner");
        expect(rowReads, "facts alone serve the derived tuples").toBe(0);
        expect(
          (await seeded.tuplesOf(object, "parent_org")).map(formatTuple),
        ).toEqual([
          "organization:org_seeded#parent_org@organization:acme",
        ]);
        expect(rowReads, "the rule reads the organization's row").toBe(1);
      });

      it("a store fault propagates as the fault it is — never as 'no tuples'", async () => {
        const source = sourceFor(ROOT);
        await opened.store.close();
        await expect(
          source.tuplesOf(parseObjectRef("agent:agt_team"), "owner"),
        ).rejects.toThrow();
        await expect(
          source.tuplesOf(parseObjectRef("organization:acme"), "owner"),
        ).rejects.toThrow();
      });
    });

    /**
     * The grants made to a person's teams, through the real source and the
     * evaluator over the built-in model's Enterprise team type. Seeded:
     * `acme` with Dave a member and Root its owner; `tm_core` and
     * `tm_other` in `acme`; Dave and Erin granted `member` on `tm_core`,
     * Erin holding no organization role (she left); `agt_core` shared with
     * `tm_core#member` and `agt_other` with `tm_other#member`, both private
     * and Carol's.
     */
    describe.skipIf(fixture.skip)("the grants made to a person's teams", () => {
      let opened: OpenedStore;
      let counted: ReturnType<typeof countingPolicies>;
      const ERIN: Person = {
        accountId: "ida_erin",
        aliases: new Set(["ida_erin"]),
      };

      async function seed(
        declaration: StoredKindDeclaration,
        facts: Parameters<typeof fixtureRow>[1],
      ): Promise<void> {
        await opened.store.saveResource(
          declaration.kind,
          facts.id,
          declaration.schema,
          fixtureRow(declaration, facts),
        );
      }

      beforeEach(async () => {
        opened = await fixture.open();
        counted = countingPolicies(newResourceIamPolicyStore(opened.store));
        await seed(storedDeclaration("organization"), {
          id: "acme",
          org: "",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: ROOT.accountId,
        });
        for (const id of ["tm_core", "tm_other"]) {
          await seed(storedDeclaration("team"), {
            id,
            org: "acme",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: ROOT.accountId,
          });
        }
        for (const [id, team] of [
          ["agt_core", "tm_core"],
          ["agt_other", "tm_other"],
        ] as const) {
          await seed(storedDeclaration("agent"), {
            id,
            org: "acme",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: "ida_carol",
          });
          await grant(
            counted.policies,
            triple({ kind: "team", id: team, relation: "member" }, "viewer", {
              kind: "agent",
              id,
            }),
          );
        }
        await grant(counted.policies, orgRole(ROOT.accountId, "owner", "acme"));
        await grant(
          counted.policies,
          orgRole(DAVE.accountId, "member", "acme"),
        );
        for (const member of [DAVE, ERIN]) {
          await grant(
            counted.policies,
            triple(
              { kind: "identity_account", id: member.accountId },
              "member",
              { kind: "team", id: "tm_core" },
            ),
          );
        }
      });

      afterEach(async () => {
        await opened.close();
      });

      function sourceFor(person: Person) {
        return newDerivedTupleSource(
          {
            store: opened.store,
            policies: counted.policies,
            accounts: newResourceIdentityAccountStore(opened.store),
            model: builtInModel,
          },
          person,
        );
      }

      async function allowed(
        person: Person,
        object: string,
        relation: string,
      ): Promise<boolean> {
        return checkRelation(
          { model: builtInModel, source: sourceFor(person) },
          parseObjectRef(object),
          relation,
          person,
        );
      }

      it("a grant to a team reaches its member: the source serves the team's row on the object, and the member views it", async () => {
        expect(
          (
            await sourceFor(DAVE).tuplesOf(
              parseObjectRef("agent:agt_core"),
              "viewer",
            )
          ).map(formatTuple),
        ).toEqual(["agent:agt_core#viewer@team:tm_core#member"]);
        expect(await allowed(DAVE, "agent:agt_core", "can_view")).toBe(true);
      });

      it("a member who left the organization reads the team's rows and is admitted by none of them — the model's bound, not a cleanup", async () => {
        expect(
          (
            await sourceFor(ERIN).tuplesOf(
              parseObjectRef("agent:agt_core"),
              "viewer",
            )
          ).map(formatTuple),
        ).toEqual(["agent:agt_core#viewer@team:tm_core#member"]);
        expect(await allowed(ERIN, "agent:agt_core", "can_view")).toBe(false);
      });

      it("a grant to a team the person is not in never enters their source", async () => {
        expect(
          await sourceFor(DAVE).tuplesOf(
            parseObjectRef("agent:agt_other"),
            "viewer",
          ),
        ).toEqual([]);
        expect(await allowed(DAVE, "agent:agt_other", "can_view")).toBe(false);
        expect(await allowed(ROOT, "agent:agt_core", "can_view")).toBe(true);
      });

      it("reads once for a person in no team and once more per team held, however many objects are asked", async () => {
        const root = sourceFor(ROOT);
        await root.tuplesOf(parseObjectRef("agent:agt_core"), "viewer");
        await root.tuplesOf(parseObjectRef("agent:agt_other"), "viewer");
        expect(counted.reads()).toBe(1);
        const dave = sourceFor(DAVE);
        await dave.tuplesOf(parseObjectRef("agent:agt_core"), "viewer");
        await dave.tuplesOf(parseObjectRef("agent:agt_other"), "viewer");
        await dave.tuplesOf(parseObjectRef("organization:acme"), "member");
        expect(counted.reads()).toBe(1 + 2);
      });

      it("personTuples stays the person's own rows — the organization directory's candidates do not grow with team grants", async () => {
        expect(
          (await sourceFor(DAVE).personTuples()).map(formatTuple).sort(),
        ).toEqual([
          "organization:acme#affiliated@identity_account:ida_dave",
          "organization:acme#member@identity_account:ida_dave",
          "team:tm_core#member@identity_account:ida_dave",
        ]);
      });
    });
  },
);
