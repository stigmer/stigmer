/**
 * The built-in evaluator's cost, measured — the plan's storage-impact line
 * ("a measurement, not an assumption, decides whether a driver needs
 * anything"). Gated on `AUTHORIZATION_MEASURE=1` and SKIPPED otherwise
 * (the `TEST_DATABASE_URL` idiom: an environment variable read once,
 * `describe.skipIf`), because ten thousand rows on Postgres take a while
 * and the numbers are recorded in a project log, not asserted: timing on
 * a shared machine is noise in a unit suite. No budget is ruled for open
 * source, and the cloud's 300 ms is a different engine's; an edition that
 * serves teams over this evaluator holds a page of a paged list to 300 ms
 * and a point check to 50 ms, read from these lines, and records the
 * single 10,000-candidate call (a request that asks for every row, the
 * enumeration lanes) as its worst case.
 *
 * Two axes. The CANDIDATE count (1k and 10k rows of the listed kind) and
 * the POLICY TABLE every check and every list batch reads a person's rows
 * from through the IamPolicy port (indexed by principal on the OSS
 * adapter; resource-store.ts).
 * Every shape runs at an Enterprise-sized population: one organization of
 * 1,000 members in 50 teams of 20, teams granted `viewer` on half the
 * candidate agents, one person granted directly on 2% of them, and other
 * members' direct grants filling the table to the candidate count (10,000
 * rows at 10k; the base population alone is past 1k).
 *
 * The shapes, each timed once after the seed, both drivers:
 *   - the five open-source shapes: the restrict verb over a pure
 *     owner-only kind (session), over a kind with one userset hop
 *     (org-visible agents for a member), over the parent hop at two
 *     densities (executions in ten sessions, and in a thousand), over the
 *     kind whose `derived` rule reads the row (instances of one agent);
 *     the enumeration verb over the blueprint kind (the console library's
 *     path);
 *   - five Enterprise shapes over private agents: a team member's grants
 *     (the team hop through the model's organization bound); the same for
 *     a person in five teams (one more policy read per team); a person's
 *     direct grants; a former member who keeps the team's row and is
 *     admitted by none of it (the bound's correctness at volume); and the
 *     enumeration verb for the team member;
 *   - pages, as the paged lanes run them (pipeline/steps/list-page.ts): a
 *     page that fills in one batch (one scope call of 100 candidates) and
 *     a caller's worst page (five calls of 100, the examine budget of 500,
 *     each call its own source as `admit` makes it), for the team member,
 *     the direct grantee and an organization member, at the population of
 *     10,000 policy rows;
 *   - point checks: one `can_view` through a team grant and one through a
 *     direct grant, each over 100 checks with a fresh source per check
 *     (the Authorizer's own shape), the mean reported.
 *
 * Every shape states what its caller keeps, so a measurement over an
 * evaluator that answered wrongly measures nothing. The model is the
 * built-in one, which declares the Enterprise team type beside the
 * open-source ones.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole, triple } from "../../domain/iampolicy/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListEntryMeta } from "../../extensions/list-read-scope.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { rowAuthorizationFactsOf } from "../../pipeline/steps/authorization-facts.js";
import { newBuiltInAuthorizer } from "../authorizer.js";
import { newBuiltInListReadScope } from "../list-read-scope.js";
import type { KindDeclaration } from "../model/rewrite.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { builtInModel } from "../model/index.js";
import { fixtureRow, storedDeclaration } from "./support.js";
import type { FixtureRowFacts } from "./support.js";

const MEASURE = process.env["AUTHORIZATION_MEASURE"] === "1";
const SIZES = [1_000, 10_000];

const FOUNDER = accountIdFor("auth0|founder");
const MEMBER = accountIdFor("auth0|member");
const VIEWER = accountIdFor("auth0|viewer");
/** In team 0. */
const TEAM_MEMBER = accountIdFor("auth0|team-member");
/** In teams 0 to 4. */
const MULTI_TEAM = accountIdFor("auth0|multi-team");
/** Granted `viewer` directly on 2% of the candidate agents. */
const DIRECT = accountIdFor("auth0|direct");
/** Still holds team 0's `member` row; holds no organization role. */
const FORMER = accountIdFor("auth0|former");
const ORG = "acme";

const TEAMS = 50;
const TEAM_SIZE = 20;
const MEMBERS = TEAMS * TEAM_SIZE;
const MULTI_TEAM_COUNT = 5;
const POINT_CHECKS = 100;
/** The page loop's largest page and its examine budget (pipeline/steps/list-page.ts). */
const PAGE_SIZE = 100;
const PAGE_EXAMINE_BUDGET = 500;
/** The population the pages run at: a 10,000-row policy table. */
const PAGE_POPULATION = 10_000;
/**
 * A case seeds up to twenty thousand rows one write at a time before its
 * timer starts; the suite's 15 s budget is for tests, not for this seed.
 */
const MEASURE_TIMEOUT_MS = 600_000;

function teamId(i: number): string {
  return `tm_${i}`;
}

function populationMemberId(i: number): string {
  return `ida_pop_${i}`;
}

/** The candidate agent of index `i`: private, the founder's. */
function enterpriseAgentId(i: number): string {
  return `agt_e_${i}`;
}

/** The team granted `viewer` on agent `i`, or undefined: every even agent, round-robin over the teams. */
function teamGrantedOn(i: number): number | undefined {
  return i % 2 === 0 ? i % TEAMS : undefined;
}

/** Whether `DIRECT` is granted `viewer` on agent `i`: 2% of the agents. */
function directGrantOn(i: number): boolean {
  return i % 50 === 1;
}

function resolved(accountId: string): CallerIdentity {
  return {
    identityId: accountId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

interface Shape {
  readonly name: string;
  readonly kind: string;
  readonly caller: string;
  /** The row for index `i` of `n`. */
  row(i: number, n: number): FixtureRowFacts;
  /** Rows seeded beside the measured kind (parents), once per size. */
  readonly parents?: ReadonlyArray<{ type: string; facts: FixtureRowFacts }>;
  readonly verb: "restrict" | "enumerate";
  /** How many of `n` the caller keeps — every row unless the shape says otherwise. */
  kept?(n: number): number;
}

function sessionRow(i: number): FixtureRowFacts {
  return {
    id: `ses_${i}`,
    org: ORG,
    visibility: ApiResourceVisibility.visibility_private,
    createdBy: FOUNDER,
  };
}

function enterpriseAgentRow(i: number): FixtureRowFacts {
  return {
    id: enterpriseAgentId(i),
    org: ORG,
    visibility: ApiResourceVisibility.visibility_private,
    createdBy: FOUNDER,
  };
}

/** How many of `n` agents a person in teams `0..teams-1` views through team grants. */
function keptThroughTeams(n: number, teams: number): number {
  let kept = 0;
  for (let i = 0; i < n; i += 1) {
    const team = teamGrantedOn(i);
    if (team !== undefined && team < teams) {
      kept += 1;
    }
  }
  return kept;
}

function keptDirectly(n: number): number {
  let kept = 0;
  for (let i = 0; i < n; i += 1) {
    if (directGrantOn(i)) {
      kept += 1;
    }
  }
  return kept;
}

const SHAPES: ReadonlyArray<Shape> = [
  {
    name: "restrict: sessions, owner-only, the founder's own",
    kind: "session",
    caller: FOUNDER,
    verb: "restrict",
    row: sessionRow,
  },
  {
    name: "restrict: org-visible agents for a member (one userset hop)",
    kind: "agent",
    caller: MEMBER,
    verb: "restrict",
    row: (i) => ({
      id: `agt_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: FOUNDER,
    }),
  },
  {
    name: "enumerate: org-visible agents for a member (the library's path)",
    kind: "agent",
    caller: MEMBER,
    verb: "enumerate",
    row: (i) => ({
      id: `agt_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: FOUNDER,
    }),
  },
  {
    name: "restrict: executions in TEN sessions (the parent hop, dense)",
    kind: "agent_execution",
    caller: FOUNDER,
    verb: "restrict",
    parents: Array.from({ length: 10 }, (_, i) => ({
      type: "session",
      facts: sessionRow(i),
    })),
    row: (i) => ({
      id: `aex_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_private,
      createdBy: "",
      spec: { sessionId: `ses_${i % 10}` },
    }),
  },
  {
    name: "restrict: executions in a THOUSAND sessions (the parent hop, sparse)",
    kind: "agent_execution",
    caller: FOUNDER,
    verb: "restrict",
    parents: Array.from({ length: 1_000 }, (_, i) => ({
      type: "session",
      facts: sessionRow(i),
    })),
    row: (i) => ({
      id: `aex_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_private,
      createdBy: "",
      spec: { sessionId: `ses_${i % 1_000}` },
    }),
  },
  {
    name: "restrict: instances of one agent for a viewer (the `derived` rule reads each row)",
    kind: "agent_instance",
    caller: VIEWER,
    verb: "restrict",
    parents: [
      {
        type: "agent",
        facts: {
          id: "agt_shared",
          org: ORG,
          visibility: ApiResourceVisibility.visibility_org,
          createdBy: FOUNDER,
          status: { defaultInstanceId: "ai_0" },
        },
      },
    ],
    row: (i) => ({
      id: `ai_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_private,
      createdBy: FOUNDER,
      spec: { agentId: "agt_shared" },
    }),
    // The viewer reaches the DEFAULT instance through the blueprint and no
    // other; the cost measured is the rule's read of every candidate row.
    kept: () => 1,
  },
  {
    name: "restrict: private agents shared with the caller's team (the team hop through the organization bound)",
    kind: "agent",
    caller: TEAM_MEMBER,
    verb: "restrict",
    row: enterpriseAgentRow,
    kept: (n) => keptThroughTeams(n, 1),
  },
  {
    name: "restrict: private agents shared with any of the caller's five teams (one policy read more per team)",
    kind: "agent",
    caller: MULTI_TEAM,
    verb: "restrict",
    row: enterpriseAgentRow,
    kept: (n) => keptThroughTeams(n, MULTI_TEAM_COUNT),
  },
  {
    name: "restrict: private agents granted to the caller directly (a per-resource grant)",
    kind: "agent",
    caller: DIRECT,
    verb: "restrict",
    row: enterpriseAgentRow,
    kept: keptDirectly,
  },
  {
    name: "restrict: a former member keeps the team's row and is admitted by none of it",
    kind: "agent",
    caller: FORMER,
    verb: "restrict",
    row: enterpriseAgentRow,
    kept: () => 0,
  },
  {
    name: "enumerate: private agents for the team member (the library's path)",
    kind: "agent",
    caller: TEAM_MEMBER,
    verb: "enumerate",
    row: enterpriseAgentRow,
    kept: (n) => keptThroughTeams(n, 1),
  },
];

interface PageShape {
  readonly name: string;
  readonly caller: string;
  /** The candidate of index `i`, an agent. */
  row(i: number): FixtureRowFacts;
  /** How many of the first `n` candidates the caller keeps. */
  kept(n: number): number;
}

const PAGE_SHAPES: ReadonlyArray<PageShape> = [
  {
    name: "the team member's private agents shared with their team",
    caller: TEAM_MEMBER,
    row: enterpriseAgentRow,
    kept: (n) => keptThroughTeams(n, 1),
  },
  {
    name: "the direct grantee's private agents granted to them",
    caller: DIRECT,
    row: enterpriseAgentRow,
    kept: keptDirectly,
  },
  {
    name: "an organization member's org-visible agents",
    caller: MEMBER,
    row: (i) => ({
      id: `agt_${i}`,
      org: ORG,
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: FOUNDER,
    }),
    kept: (n) => n,
  },
];

/** The Enterprise population's IamPolicy rows at candidate size `n`. */
function populationPolicies(n: number): IamPolicySpec[] {
  const specs: IamPolicySpec[] = [
    orgRole(FOUNDER, "owner", ORG),
    orgRole(MEMBER, "member", ORG),
    orgRole(VIEWER, "viewer", ORG),
    orgRole(TEAM_MEMBER, "member", ORG),
    orgRole(MULTI_TEAM, "member", ORG),
    orgRole(DIRECT, "member", ORG),
  ];
  const membership = (accountId: string, team: number): IamPolicySpec =>
    triple({ kind: "identity_account", id: accountId }, "member", {
      kind: "team",
      id: teamId(team),
    });
  specs.push(membership(TEAM_MEMBER, 0), membership(FORMER, 0));
  for (let team = 0; team < MULTI_TEAM_COUNT; team += 1) {
    specs.push(membership(MULTI_TEAM, team));
  }
  for (let i = 0; i < MEMBERS; i += 1) {
    specs.push(orgRole(populationMemberId(i), "member", ORG));
    specs.push(membership(populationMemberId(i), i % TEAMS));
  }
  const viewerOn = (
    principal: { kind: string; id: string; relation?: string },
    i: number,
  ): IamPolicySpec =>
    triple(principal, "viewer", { kind: "agent", id: enterpriseAgentId(i) });
  const unclaimed: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const team = teamGrantedOn(i);
    if (team !== undefined) {
      specs.push(
        viewerOn({ kind: "team", id: teamId(team), relation: "member" }, i),
      );
    } else if (directGrantOn(i)) {
      specs.push(viewerOn({ kind: "identity_account", id: DIRECT }, i));
    } else {
      unclaimed.push(i);
    }
  }
  // Other members' direct grants fill the table to the candidate count.
  const filler = Math.min(unclaimed.length, Math.max(0, n - specs.length));
  for (let k = 0; k < filler; k += 1) {
    const i = unclaimed[k] ?? 0;
    specs.push(
      viewerOn(
        { kind: "identity_account", id: populationMemberId(i % MEMBERS) },
        i,
      ),
    );
  }
  return specs;
}

afterAll(dropPostgresFixture);

describe
  .skipIf(!MEASURE)
  .each(
    driverFixtures([
      ApiResourceKind.iam_policy,
      ApiResourceKind.identity_account,
      ApiResourceKind.organization,
      ApiResourceKind.team,
      ApiResourceKind.agent,
      ApiResourceKind.session,
      ApiResourceKind.agent_execution,
      ApiResourceKind.agent_instance,
    ]),
  )("the built-in evaluator's cost on $name", (fixture) => {
  describe.skipIf(fixture.skip)("measured", () => {
    let opened: OpenedStore;
    let policies: IamPolicyStore;
    let accounts: IdentityAccountStore;

    async function save(type: string, facts: FixtureRowFacts): Promise<object> {
      const declaration = storedDeclaration(type);
      const row = fixtureRow(declaration, facts);
      await opened.store.saveResource(
        declaration.kind,
        facts.id,
        declaration.schema,
        row,
      );
      return row;
    }

    /**
     * Writes the population's rows through the generic Store, where the
     * OSS adapter reads every policy from: the port's `save` would read
     * each id before writing it, doubling a seed of ten thousand rows.
     * Returns the policy table's size.
     */
    async function seedPopulation(n: number): Promise<number> {
      const specs = populationPolicies(n);
      for (const spec of specs) {
        const id = policyIdFor(spec);
        await opened.store.saveResource(
          ApiResourceKind.iam_policy,
          id,
          IamPolicySchema,
          create(IamPolicySchema, {
            apiVersion: IAM_POLICY_API_VERSION,
            kind: IAM_POLICY_KIND,
            metadata: { id },
            spec,
          }),
        );
      }
      return specs.length;
    }

    beforeEach(async () => {
      opened = await fixture.open();
      policies = newResourceIamPolicyStore(opened.store);
      accounts = newResourceIdentityAccountStore(opened.store);
      for (const [id, subject] of [
        [FOUNDER, "auth0|founder"],
        [MEMBER, "auth0|member"],
        [VIEWER, "auth0|viewer"],
        [TEAM_MEMBER, "auth0|team-member"],
        [MULTI_TEAM, "auth0|multi-team"],
        [DIRECT, "auth0|direct"],
        [FORMER, "auth0|former"],
      ] as const) {
        await accounts.save(
          create(IdentityAccountSchema, {
            metadata: { id, name: subject },
            spec: {
              idpId: subject,
              provisioningMode: IdentityAccountProvisioningMode.direct,
            },
          }),
        );
      }
      await save("organization", {
        id: ORG,
        org: "",
        visibility: ApiResourceVisibility.visibility_private,
        createdBy: FOUNDER,
      });
      for (let team = 0; team < TEAMS; team += 1) {
        await opened.store.saveResource(
          ApiResourceKind.team,
          teamId(team),
          storedDeclaration("team").schema,
          fixtureRow(storedDeclaration("team"), {
            id: teamId(team),
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
          }),
        );
      }
    });

    afterEach(async () => {
      await opened.close();
    });

    for (const shape of SHAPES) {
      for (const n of SIZES) {
        it(
          `${shape.name} at ${n} rows`,
          async () => {
            const declaration = storedDeclaration(shape.kind);
            const policyRows = await seedPopulation(n);
            for (const parent of shape.parents ?? []) {
              await save(parent.type, parent.facts);
            }
            const entries: ListEntryMeta[] = [];
            for (let i = 0; i < n; i += 1) {
              const row = await save(shape.kind, shape.row(i, n));
              entries.push({
                ...rowAuthorizationFactsOf(declaration.kind, row),
                labels: {},
              });
            }
            const scope = newBuiltInListReadScope({
              store: opened.store,
              policies,
              accounts,
              logger: silentLogger,
              model: builtInModel,
            });
            const started = performance.now();
            const kept =
              shape.verb === "restrict"
                ? await scope.restrictListEntries(
                    resolved(shape.caller),
                    declaration.kind,
                    entries,
                  )
                : await scope.authorizedResourceIds(
                    resolved(shape.caller),
                    declaration.kind,
                  );
            const elapsedMs = Math.round(performance.now() - started);
            // Every shape states what its caller keeps, so a measurement
            // over a scope that answered wrongly measures nothing.
            expect(kept.size).toBe(shape.kept?.(n) ?? n);
            console.log(
              `[measure] ${fixture.name} ${kindEnumName(declaration.kind)} ${shape.verb} n=${n} policies=${policyRows} elapsed=${elapsedMs}ms — ${shape.name}`,
            );
          },
          MEASURE_TIMEOUT_MS,
        );
      }
    }

    for (const shape of PAGE_SHAPES) {
      it(
        `pages: ${shape.name}, at a ${PAGE_POPULATION}-row population`,
        async () => {
          const declaration = storedDeclaration("agent");
          const policyRows = await seedPopulation(PAGE_POPULATION);
          const entries: ListEntryMeta[] = [];
          for (let i = 0; i < PAGE_EXAMINE_BUDGET; i += 1) {
            const row = await save("agent", shape.row(i));
            entries.push({
              ...rowAuthorizationFactsOf(declaration.kind, row),
              labels: {},
            });
          }
          const scope = newBuiltInListReadScope({
            store: opened.store,
            policies,
            accounts,
            logger: silentLogger,
            model: builtInModel,
          });
          const caller = resolved(shape.caller);
          // A page's batches run one after another, each through the scope
          // with its own source, exactly as the page loop calls `admit`.
          async function page(batches: number): Promise<number> {
            let kept = 0;
            for (let b = 0; b < batches; b += 1) {
              const batch = entries.slice(b * PAGE_SIZE, (b + 1) * PAGE_SIZE);
              kept += (
                await scope.restrictListEntries(caller, declaration.kind, batch)
              ).size;
            }
            return kept;
          }
          for (const batches of [1, PAGE_EXAMINE_BUDGET / PAGE_SIZE]) {
            const started = performance.now();
            const kept = await page(batches);
            const elapsedMs = Math.round(performance.now() - started);
            expect(kept).toBe(shape.kept(batches * PAGE_SIZE));
            console.log(
              `[measure] ${fixture.name} agent page calls=${batches} candidates=${batches * PAGE_SIZE} policies=${policyRows} elapsed=${elapsedMs}ms — ${batches === 1 ? "a page that fills in one batch" : "the worst page"}: ${shape.name}`,
            );
          }
        },
        MEASURE_TIMEOUT_MS,
      );
    }

    for (const [caller, agent, grant] of [
      [TEAM_MEMBER, 0, "a team grant"],
      [DIRECT, 1, "a direct grant"],
    ] as const) {
      for (const n of SIZES) {
        it(
          `point check: can_view through ${grant} at the ${n}-candidate population`,
          async () => {
            const policyRows = await seedPopulation(n);
            await save("agent", enterpriseAgentRow(agent));
            const authorizer = newBuiltInAuthorizer({
              store: opened.store,
              policies,
              accounts,
              edition: ServerEdition.oss,
              logger: silentLogger,
              model: builtInModel,
            });
            const check = {
              permission: IamPermission.can_view,
              resourceKind: ApiResourceKind.agent,
              resourceId: enterpriseAgentId(agent),
            };
            const started = performance.now();
            for (let k = 0; k < POINT_CHECKS; k += 1) {
              // Each call builds its own source, the Authorizer's shape: no
              // memo carries from one check to the next.
              expect(
                await authorizer.authorize(resolved(caller), check),
              ).toEqual({ kind: "allow" });
            }
            const meanMs = (performance.now() - started) / POINT_CHECKS;
            console.log(
              `[measure] ${fixture.name} agent point-check policies=${policyRows} mean=${meanMs.toFixed(2)}ms over ${POINT_CHECKS} — can_view through ${grant}`,
            );
          },
          MEASURE_TIMEOUT_MS,
        );
      }
    }
  });
});
