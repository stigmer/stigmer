/**
 * Pins the derivation — the ONE place edition knowledge lives in the
 * built-in authorizer: which tuples a stored row stands for, in exactly
 * the shapes the cloud's tuple driver writes (stigmer-cloud
 * iam/tuple-lifecycle.ts: `organization:<org>#viewer` for the org level,
 * the owner by the kind's attribution, the parent links by `kind_meta`). Two facts are the
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

import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
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
import type { KindDeclaration } from "../model/rewrite.js";
import type { Person } from "../tuples.js";
import { formatTuple, parseObjectRef } from "../tuples.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
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
    spec?: Readonly<Record<string, unknown>>;
  },
): string[] {
  const declaration = declared(type);
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

  it("a run is its session's: the session link (PARENT scope) and NO owner of its own (INHERITED attribution)", () => {
    expect(derivedFor("agent_execution", {})).toEqual([
      "agent_execution:agent_execution-1#session@session:session-1",
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

  it("an environment carries its creator tuple and an org-viewer at org level, and nothing beyond its org ceiling", () => {
    expect(
      derivedFor("environment", {
        visibility: ApiResourceVisibility.visibility_org,
      }),
    ).toEqual([
      "environment:environment-1#organization@organization:acme",
      "environment:environment-1#owner@identity_account:ida_carol",
      "environment:environment-1#creator@identity_account:ida_carol",
      "environment:environment-1#viewer@organization:acme#viewer",
    ]);
    expect(
      derivedFor("environment", {
        visibility: ApiResourceVisibility.visibility_platform,
      }),
    ).toEqual([
      "environment:environment-1#organization@organization:acme",
      "environment:environment-1#owner@identity_account:ida_carol",
      "environment:environment-1#creator@identity_account:ida_carol",
    ]);
  });

  it("kinds with no visibility axis derive no viewer tuple at any level — their audience is the model's own line", () => {
    for (const type of ["artifact", "schedule", "session"]) {
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

  it("owner-only kinds carry no scope link whatever metadata.org says", () => {
    expect(derivedFor("api_key", {})).toEqual([
      "api_key:api_key-1#owner@identity_account:ida_carol",
    ]);
    expect(derivedFor("execution_context", {})).toEqual([
      "execution_context:execution_context-1#owner@identity_account:ida_carol",
    ]);
  });

  it("an instance carries its blueprint link and a run its instance link (additional parents); a user-created instance at org level adds the #viewer userset", () => {
    expect(
      derivedFor("agent_instance", {
        visibility: ApiResourceVisibility.visibility_org,
      }),
    ).toEqual([
      "agent_instance:agent_instance-1#organization@organization:acme",
      "agent_instance:agent_instance-1#agent@agent:agent-1",
      "agent_instance:agent_instance-1#owner@identity_account:ida_carol",
      "agent_instance:agent_instance-1#viewer@organization:acme#viewer",
    ]);
    expect(
      derivedFor("workflow_execution", {
        visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
      }),
    ).toEqual([
      "workflow_execution:workflow_execution-1#organization@organization:acme",
      "workflow_execution:workflow_execution-1#workflow_instance@workflow_instance:workflow_instance-1",
      "workflow_execution:workflow_execution-1#owner@identity_account:ida_carol",
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
  ApiResourceKind.agent_instance,
  ApiResourceKind.workflow_instance,
  ApiResourceKind.workflow_execution,
  ApiResourceKind.identity_account,
];

afterAll(dropPostgresFixture);

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
          { store: opened.store, policies: counted.policies, accounts },
          person,
        );
      }

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

      it("a source seeded with a candidate's facts derives that object's tuples WITHOUT loading its row; the parent hop still loads", async () => {
        let rowReads = 0;
        const agent = declared("agent");
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
        // A seeded instance: `default_of` reads the instance's blueprint
        // pointer from the row's spec, which a candidate's facts do not
        // carry, so the rule loads the row — one read, stated in the list
        // scope's cost pin as well.
        let rowReads = 0;
        const instance = declared("agent_instance");
        const row = fixtureRow(instance, {
          id: "ai_seeded",
          org: "acme",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: "ida_carol",
          spec: { agentId: "agt_team" },
        });
        await opened.store.saveResource(
          instance.kind,
          "ai_seeded",
          instance.schema,
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
          { facts: [rowFactsOf(instance.kind, row)] },
        );
        const object = parseObjectRef("agent_instance:ai_seeded");
        await seeded.tuplesOf(object, "owner");
        expect(rowReads, "facts alone serve the derived tuples").toBe(0);
        await seeded.tuplesOf(object, "default_of");
        expect(rowReads, "the rule reads the instance and the blueprint").toBe(
          2,
        );
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
     * The two derived rules through the real source and the evaluator:
     * `default_of` from the blueprint's pointer, `execution_viewer` from
     * the instance's run-observability level. Seeded: `agt_team` (org-
     * visible, its pointer at `ai_default`), `ai_default` (no level of its
     * own) and `ai_personal` (private) both naming it; `agt_other` whose
     * pointer names a row that is not `ai_stale`; `ai_orphan` naming a
     * blueprint that does not exist; `wi_shared` (organization level) and
     * `wi_private`, each with one run of Carol's.
     */
    describe.skipIf(fixture.skip)("the derived rules", () => {
      let opened: OpenedStore;
      const CAROL: Person = {
        accountId: "ida_carol",
        aliases: new Set(["ida_carol"]),
      };

      async function seed(
        type: string,
        id: string,
        facts: Omit<Parameters<typeof fixtureRow>[1], "id">,
      ): Promise<void> {
        const declaration = declared(type);
        await opened.store.saveResource(
          declaration.kind,
          id,
          declaration.schema,
          fixtureRow(declaration, { id, ...facts }),
        );
      }

      beforeEach(async () => {
        opened = await fixture.open();
        const policies = newResourceIamPolicyStore(opened.store);
        await grant(policies, orgRole(ROOT.accountId, "owner", "acme"));
        await grant(policies, orgRole(DAVE.accountId, "member", "acme"));
        await seed("organization", "acme", {
          org: "",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: ROOT.accountId,
        });
        await seed("agent", "agt_team", {
          org: "acme",
          visibility: ApiResourceVisibility.visibility_org,
          createdBy: CAROL.accountId,
          status: { defaultInstanceId: "ai_default" },
        });
        await seed("agent", "agt_other", {
          org: "acme",
          visibility: ApiResourceVisibility.visibility_org,
          createdBy: CAROL.accountId,
          status: { defaultInstanceId: "ai_elsewhere" },
        });
        for (const [id, agentId, visibility] of [
          [
            "ai_default",
            "agt_team",
            ApiResourceVisibility.api_resource_visibility_unspecified,
          ],
          ["ai_personal", "agt_team", ApiResourceVisibility.visibility_private],
          ["ai_stale", "agt_other", ApiResourceVisibility.visibility_private],
          [
            "ai_orphan",
            "agt_missing",
            ApiResourceVisibility.visibility_private,
          ],
        ] as const) {
          await seed("agent_instance", id, {
            org: "acme",
            visibility,
            createdBy: CAROL.accountId,
            spec: { agentId },
          });
        }
        for (const [id, executionVisibility] of [
          ["wi_shared", WorkflowExecutionVisibility.organization],
          ["wi_private", WorkflowExecutionVisibility.private],
        ] as const) {
          await seed("workflow_instance", id, {
            org: "acme",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: CAROL.accountId,
            spec: { executionVisibility },
          });
        }
        for (const [id, workflowInstanceId] of [
          ["we_shared", "wi_shared"],
          ["we_private", "wi_private"],
        ] as const) {
          await seed("workflow_execution", id, {
            org: "acme",
            visibility:
              ApiResourceVisibility.api_resource_visibility_unspecified,
            createdBy: CAROL.accountId,
            spec: { workflowInstanceId },
          });
        }
      });

      afterEach(async () => {
        await opened.close();
      });

      function sourceFor(person: Person) {
        return newDerivedTupleSource(
          {
            store: opened.store,
            policies: newResourceIamPolicyStore(opened.store),
            accounts: newResourceIdentityAccountStore(opened.store),
          },
          person,
        );
      }

      async function tuplesOf(
        person: Person,
        object: string,
        relation: string,
      ): Promise<string[]> {
        return (
          await sourceFor(person).tuplesOf(parseObjectRef(object), relation)
        ).map(formatTuple);
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

      it("default_of derives iff the blueprint's pointer names the instance: the default has it, a personal, a stale and an orphaned instance do not", async () => {
        expect(
          await tuplesOf(DAVE, "agent_instance:ai_default", "default_of"),
        ).toEqual(["agent_instance:ai_default#default_of@agent:agt_team"]);
        for (const instance of ["ai_personal", "ai_stale", "ai_orphan"]) {
          expect(
            await tuplesOf(DAVE, `agent_instance:${instance}`, "default_of"),
            instance,
          ).toEqual([]);
        }
      });

      it("the rule's blueprint read is the loader's: `viewer from default_of` then resolves the blueprint on the same decoded row", async () => {
        const source = sourceFor(DAVE);
        await source.tuplesOf(
          parseObjectRef("agent_instance:ai_default"),
          "default_of",
        );
        const viaRule = await source.loader.load(
          parseObjectRef("agent:agt_team"),
        );
        await source.tuplesOf(parseObjectRef("agent:agt_team"), "viewer");
        const viaWalk = await source.loader.load(
          parseObjectRef("agent:agt_team"),
        );
        expect(viaRule).toBeDefined();
        expect(viaWalk).toBe(viaRule);
      });

      it("an organization member reads the default instance of an org-visible agent through the blueprint, and NOT a personal instance of the same agent — nor does the organization's owner", async () => {
        expect(
          await allowed(DAVE, "agent_instance:ai_default", "can_view"),
        ).toBe(true);
        expect(
          await allowed(DAVE, "agent_instance:ai_default", "can_execute"),
        ).toBe(true);
        expect(
          await allowed(DAVE, "agent_instance:ai_personal", "can_view"),
        ).toBe(false);
        expect(
          await allowed(ROOT, "agent_instance:ai_personal", "can_view"),
        ).toBe(false);
        expect(
          await allowed(CAROL, "agent_instance:ai_personal", "can_view"),
        ).toBe(true);
        expect(
          await allowed(DAVE, "agent_instance:ai_default", "can_edit"),
        ).toBe(false);
      });

      it("execution_viewer derives the organization's #viewer userset at the organization level and nothing at private", async () => {
        expect(
          await tuplesOf(
            DAVE,
            "workflow_instance:wi_shared",
            "execution_viewer",
          ),
        ).toEqual([
          "workflow_instance:wi_shared#execution_viewer@organization:acme#viewer",
        ]);
        expect(
          await tuplesOf(
            DAVE,
            "workflow_instance:wi_private",
            "execution_viewer",
          ),
        ).toEqual([]);
      });

      it("an organization member reads a run whose instance is org-observable and not one whose instance is private; the triggerer reads both", async () => {
        expect(
          await allowed(DAVE, "workflow_execution:we_shared", "can_view"),
        ).toBe(true);
        expect(
          await allowed(DAVE, "workflow_execution:we_private", "can_view"),
        ).toBe(false);
        expect(
          await allowed(CAROL, "workflow_execution:we_shared", "can_view"),
        ).toBe(true);
        expect(
          await allowed(CAROL, "workflow_execution:we_private", "can_view"),
        ).toBe(true);
        expect(
          await allowed(DAVE, "workflow_execution:we_shared", "can_edit"),
        ).toBe(false);
      });
    });
  },
);
