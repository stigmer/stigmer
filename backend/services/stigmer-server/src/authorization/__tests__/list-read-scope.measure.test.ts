/**
 * The list scope's cost, measured — the plan's storage-impact line ("a
 * measurement, not an assumption, decides whether a driver needs
 * anything"). Gated on `AUTHORIZATION_MEASURE=1` and SKIPPED otherwise
 * (the `TEST_DATABASE_URL` idiom: an environment variable read once,
 * `describe.skipIf`), because ten thousand rows on Postgres take a while
 * and the number is recorded in the project's execution log, not asserted:
 * no budget is ruled for open source, and the cloud's 300 ms is a
 * different engine's.
 *
 * Five shapes at 1k and 10k rows, on both drivers, each timed once after
 * the seed: the restrict verb over a pure owner-only kind (session), over
 * a kind with one userset hop (org-visible agents for a member), over the
 * parent hop at two densities (executions in ten sessions, and in a
 * thousand), and over the kind whose `derived` rule reads the row
 * (instances of one agent); the enumeration verb over the blueprint kind,
 * which is the console library's path. The seed reuses the module's
 * fixtures so the rows are the rows the other tests reason about.
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
import { orgRole } from "../../domain/iampolicy/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListEntryMeta } from "../../extensions/list-read-scope.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { rowAuthorizationFactsOf } from "../../pipeline/steps/authorization-facts.js";
import { newBuiltInListReadScope } from "../list-read-scope.js";
import { builtInModel } from "../model/index.js";
import type { KindDeclaration } from "../model/rewrite.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow } from "./support.js";
import type { FixtureRowFacts } from "./support.js";

const MEASURE = process.env["AUTHORIZATION_MEASURE"] === "1";
const SIZES = [1_000, 10_000];

const FOUNDER = accountIdFor("auth0|founder");
const MEMBER = accountIdFor("auth0|member");
const VIEWER = accountIdFor("auth0|viewer");
const ORG = "acme";

function declared(type: string): KindDeclaration {
  const declaration = builtInModel.byType(type);
  if (declaration === undefined) {
    throw new Error(`${type} is declared`);
  }
  return declaration;
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
];

afterAll(dropPostgresFixture);

describe
  .skipIf(!MEASURE)
  .each(
    driverFixtures([
      ApiResourceKind.iam_policy,
      ApiResourceKind.identity_account,
      ApiResourceKind.organization,
      ApiResourceKind.agent,
      ApiResourceKind.session,
      ApiResourceKind.agent_execution,
      ApiResourceKind.agent_instance,
    ]),
  )("the built-in list read scope's cost on $name", (fixture) => {
  describe.skipIf(fixture.skip)("measured", () => {
    let opened: OpenedStore;
    let policies: IamPolicyStore;
    let accounts: IdentityAccountStore;

    async function save(type: string, facts: FixtureRowFacts): Promise<object> {
      const declaration = declared(type);
      const row = fixtureRow(declaration, facts);
      await opened.store.saveResource(
        declaration.kind,
        facts.id,
        declaration.schema,
        row,
      );
      return row;
    }

    beforeEach(async () => {
      opened = await fixture.open();
      policies = newResourceIamPolicyStore(opened.store);
      accounts = newResourceIdentityAccountStore(opened.store);
      for (const [id, subject] of [
        [FOUNDER, "auth0|founder"],
        [MEMBER, "auth0|member"],
        [VIEWER, "auth0|viewer"],
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
      for (const spec of [
        orgRole(FOUNDER, "owner", ORG),
        orgRole(MEMBER, "member", ORG),
        orgRole(VIEWER, "viewer", ORG),
      ]) {
        await policies.save(
          create(IamPolicySchema, {
            apiVersion: IAM_POLICY_API_VERSION,
            kind: IAM_POLICY_KIND,
            metadata: { id: policyIdFor(spec) },
            spec,
          }),
        );
      }
    });

    afterEach(async () => {
      await opened.close();
    });

    for (const shape of SHAPES) {
      for (const n of SIZES) {
        it(`${shape.name} at ${n} rows`, async () => {
          const declaration = declared(shape.kind);
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
            `[measure] ${fixture.name} ${kindEnumName(declaration.kind)} ${shape.verb} n=${n} elapsed=${elapsedMs}ms — ${shape.name}`,
          );
        });
      }
    }
  });
});
