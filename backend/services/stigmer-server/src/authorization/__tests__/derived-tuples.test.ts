/**
 * Pins the derivation — the ONE place edition knowledge lives in the
 * built-in authorizer: which tuples a stored row stands for, in exactly
 * the shapes the cloud's tuple driver writes (stigmer-cloud
 * iam/tuple-lifecycle.ts: `organization:<org>#viewer` for the org level,
 * the conditional `identity_account:*` for public, the owner by the
 * kind's attribution, the parent links by `kind_meta`). Two facts are the
 * OSS edition's own and are pinned here by name: the organization's owner
 * is a ROW (2b's role lifecycle), never derived from its creator stamp,
 * or a revoked founder would stay owner; and a stamp that names no person
 * (`""`, `"system"`) becomes no tuple at all.
 *
 * The second half runs the tuple SOURCE over both store drivers: rows and
 * derived tuples unioned per object, the person's rows read once per
 * source, an absent object answering nothing, a store fault propagating
 * as the fault it is — the ratified store-fault mapping, which is what
 * lets the driver above fold it to `unavailable` and never to a denial.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole, triple } from "../../domain/iampolicy/__tests__/support.js";
import type { Store } from "../../store/interface.js";
import { PostgresStore } from "../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../store/postgres/__tests__/support.js";
import { tempStore } from "../../store/sqlite/__tests__/support.js";
import { deriveTuples, newDerivedTupleSource } from "../derived-tuples.js";
import { rowFactsOf } from "../facts.js";
import { builtInModel } from "../model/index.js";
import type { KindDeclaration } from "../model/rewrite.js";
import type { Person } from "../tuples.js";
import { formatTuple, parseObjectRef } from "../tuples.js";
import { fixtureRow } from "./support.js";

function declared(type: string): KindDeclaration {
  const declaration = builtInModel.byType(type);
  if (declaration === undefined) {
    throw new Error(`${type} is declared in this slice`);
  }
  return declaration;
}

function derivedFor(
  type: string,
  facts: {
    org?: string;
    visibility?: ApiResourceVisibility;
    createdBy?: string;
  },
): string[] {
  const declaration = declared(type);
  const row = fixtureRow(declaration, {
    id: `${type}-1`,
    org: facts.org ?? "acme",
    visibility: facts.visibility ?? ApiResourceVisibility.visibility_private,
    createdBy: facts.createdBy ?? "ida_carol",
  });
  return deriveTuples(rowFactsOf(declaration, row)).map(formatTuple);
}

describe("deriveTuples — the cloud driver's shapes, from the row", () => {
  it("a private agent: its organization link and its creator as owner, nothing else", () => {
    expect(derivedFor("agent", {})).toEqual([
      "agent:agent-1#organization@organization:acme",
      "agent:agent-1#owner@identity_account:ida_carol",
    ]);
  });

  it("an org-visible blueprint adds the organization's VIEWER userset (cloud#257's shape, not `#member`)", () => {
    expect(
      derivedFor("workflow", {
        visibility: ApiResourceVisibility.visibility_org,
      }),
    ).toEqual([
      "workflow:workflow-1#organization@organization:acme",
      "workflow:workflow-1#owner@identity_account:ida_carol",
      "workflow:workflow-1#viewer@organization:acme#viewer",
    ]);
  });

  it("a public blueprint adds the conditional wildcard AND keeps the org floor", () => {
    expect(
      derivedFor("skill", {
        visibility: ApiResourceVisibility.visibility_public,
      }),
    ).toEqual([
      "skill:skill-1#organization@organization:acme",
      "skill:skill-1#owner@identity_account:ida_carol",
      "skill:skill-1#viewer@identity_account:* with allow_public",
      "skill:skill-1#viewer@organization:acme#viewer",
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

  it("the organization derives NOTHING: no scope (OWNER_ONLY) and its owner is 2b's row, never its creator stamp", () => {
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
});

// ---------------------------------------------------------------------------
// The source over both drivers.
// ---------------------------------------------------------------------------

interface OpenedStore {
  readonly store: Store;
  close(): Promise<void>;
}

interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<OpenedStore>;
}

const sqliteFixture: DriverFixture = {
  name: "sqlite",
  skip: false,
  async open() {
    const temp = tempStore();
    return { store: temp.store, close: () => temp.cleanup() };
  },
};

let postgresDatabase: TestDatabase | undefined;

const postgresFixture: DriverFixture = {
  name: "postgres",
  skip: testDatabaseAdminUrl() === undefined,
  async open() {
    if (postgresDatabase === undefined) {
      postgresDatabase = await createTestDatabase();
    }
    const store = await PostgresStore.open(postgresDatabase.databaseUrl);
    for (const kind of [
      ApiResourceKind.iam_policy,
      ApiResourceKind.organization,
      ApiResourceKind.agent,
    ]) {
      await store.deleteResourcesByKind(kind);
    }
    return { store, close: () => store.close() };
  },
};

afterAll(async () => {
  await postgresDatabase?.drop();
});

const ROOT: Person = { accountId: "ida_root", aliases: new Set(["ida_root"]) };
const DAVE: Person = { accountId: "ida_dave", aliases: new Set(["ida_dave"]) };

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

describe.each([sqliteFixture, postgresFixture])(
  "the derived tuple source on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("rows and derived tuples", () => {
      let opened: OpenedStore;
      let counted: ReturnType<typeof countingPolicies>;

      beforeEach(async () => {
        opened = await fixture.open();
        counted = countingPolicies(newResourceIamPolicyStore(opened.store));
        const organization = declared("organization");
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
        const agent = declared("agent");
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
          { store: opened.store, policies: counted.policies },
          person,
        );
      }

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

      it("an absent object, or an object of a kind this edition does not declare, answers no tuples", async () => {
        const source = sourceFor(ROOT);
        expect(
          await source.tuplesOf(parseObjectRef("agent:agt_missing"), "owner"),
        ).toEqual([]);
        expect(
          await source.tuplesOf(
            parseObjectRef("identity_provider:idp"),
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
  },
);
