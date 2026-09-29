/**
 * Pins open source's own authorization over the kinds a unit keeps in a
 * store of its own, on both store drivers: the rows of an identity
 * provider and a team live only behind a registered row reader
 * (extensions/resource-row-reader.ts), never in the generic Store, and
 * every answer below needs them.
 *
 *   - The derived source reads a team through its reader, so a grant to
 *     the team reaches its member and nobody who left the organization.
 *   - The built-in Authorizer at edition `enterprise` answers the
 *     provider's and the team's checks from the model; a missing
 *     provider, invitation or team, and the rowless platform, are
 *     denials with the annotation's copy, never not-found, the cloud's
 *     answer for the same kinds (NOT_FOUND_EXEMPT_KINDS).
 *   - The built-in policy check (policy-check.ts) answers the unit's
 *     three structural questions: whether a resource is an
 *     organization's, whether a person views an organization, and
 *     whether an account id could still grant access on it; contextual
 *     policies and userset principals are refused.
 *   - `kindsWithoutRows` names each served kind the built-in posture could
 *     not read, which is what refuses such a boot (compose.ts).
 */
import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { createLogger } from "../../boot/logger.js";
import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole, triple } from "../../domain/iampolicy/__tests__/support.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceRowReader } from "../../extensions/resource-row-reader.js";
import { newBuiltInAuthorizer } from "../authorizer.js";
import { newDerivedTupleSource } from "../derived-tuples.js";
import { checkRelation } from "../evaluator.js";
import { builtInModel } from "../model/index.js";
import { newBuiltInPolicyCheck } from "../policy-check.js";
import { kindsWithoutRows } from "../posture.js";
import type { Person } from "../tuples.js";
import { parseObjectRef } from "../tuples.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow, storedDeclaration } from "./support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ROOT = "ida_root"; // owner of acme
const ADMIN = "ida_admin"; // admin of acme
const DAVE = "ida_dave"; // member of acme, member of tm_core
const ERIN = "ida_erin"; // member of tm_core, no role on acme (she left)

function personOf(accountId: string): Person {
  return { accountId, aliases: new Set([accountId]) };
}

function caller(accountId: string): CallerIdentity {
  return {
    identityId: accountId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

/** A reader over rows held in memory, recording every id it is asked for. */
function memoryReader(rows: ReadonlyArray<[string, Message]>): {
  readonly reader: ResourceRowReader;
  readonly asked: string[];
} {
  const byId = new Map(rows);
  const asked: string[] = [];
  return {
    asked,
    reader: {
      findById(id) {
        asked.push(id);
        return Promise.resolve(byId.get(id));
      },
    },
  };
}

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

const SEEDED_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.iam_policy,
  ApiResourceKind.identity_account,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
];

afterAll(dropPostgresFixture);

describe.each(driverFixtures(SEEDED_KINDS))(
  "kinds a unit keeps itself, on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("through their row readers", () => {
      let opened: OpenedStore;
      let policies: IamPolicyStore;
      let accounts: IdentityAccountStore;
      let teams: ReturnType<typeof memoryReader>;
      let providers: ReturnType<typeof memoryReader>;
      let readers: ReadonlyMap<ApiResourceKind, ResourceRowReader>;

      beforeEach(async () => {
        opened = await fixture.open();
        policies = newResourceIamPolicyStore(opened.store);
        accounts = newResourceIdentityAccountStore(opened.store);
        const organization = storedDeclaration("organization");
        for (const id of ["acme", "globex"]) {
          await opened.store.saveResource(
            ApiResourceKind.organization,
            id,
            organization.schema,
            fixtureRow(organization, {
              id,
              org: "",
              visibility: ApiResourceVisibility.visibility_private,
              createdBy: ROOT,
            }),
          );
        }
        const agent = storedDeclaration("agent");
        await opened.store.saveResource(
          ApiResourceKind.agent,
          "agt_core",
          agent.schema,
          fixtureRow(agent, {
            id: "agt_core",
            org: "acme",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: "ida_carol",
          }),
        );
        // The unit's rows: in memory behind their readers, never in the
        // generic Store, so every answer that needs them proves the read.
        teams = memoryReader([
          [
            "tm_core",
            fixtureRow(storedDeclaration("team"), {
              id: "tm_core",
              org: "acme",
              visibility: ApiResourceVisibility.visibility_private,
              createdBy: ROOT,
            }),
          ],
        ]);
        providers = memoryReader([
          [
            "idp_acme",
            fixtureRow(storedDeclaration("identity_provider"), {
              id: "idp_acme",
              org: "acme",
              visibility: ApiResourceVisibility.visibility_private,
              createdBy: ADMIN,
            }),
          ],
        ]);
        readers = new Map([
          [ApiResourceKind.team, teams.reader],
          [ApiResourceKind.identity_provider, providers.reader],
          [ApiResourceKind.invitation, memoryReader([]).reader],
        ]);
        await grant(policies, orgRole(ROOT, "owner", "acme"));
        await grant(policies, orgRole(ADMIN, "admin", "acme"));
        await grant(policies, orgRole(DAVE, "member", "acme"));
        for (const member of [DAVE, ERIN]) {
          await grant(
            policies,
            triple({ kind: "identity_account", id: member }, "member", {
              kind: "team",
              id: "tm_core",
            }),
          );
        }
        await grant(
          policies,
          triple(
            { kind: "team", id: "tm_core", relation: "member" },
            "viewer",
            {
              kind: "agent",
              id: "agt_core",
            },
          ),
        );
      });

      afterEach(async () => {
        await opened.close();
      });

      async function allowed(
        accountId: string,
        object: string,
        relation: string,
      ): Promise<boolean> {
        const person = personOf(accountId);
        const source = newDerivedTupleSource(
          {
            store: opened.store,
            policies,
            accounts,
            rowReaders: readers,
            model: builtInModel,
          },
          person,
        );
        return checkRelation(
          { model: builtInModel, source },
          parseObjectRef(object),
          relation,
          person,
        );
      }

      it("a grant to a team kept by a unit reaches its member through the team's reader, and not one who left the organization", async () => {
        expect(await allowed(DAVE, "agent:agt_core", "can_view")).toBe(true);
        expect(await allowed(ERIN, "agent:agt_core", "can_view")).toBe(false);
        expect(teams.asked).toContain("tm_core");
      });

      it("without the reader the team's organization is unknown, so the grant reaches nobody", async () => {
        readers = new Map();
        expect(await allowed(DAVE, "agent:agt_core", "can_view")).toBe(false);
      });

      describe("the built-in Authorizer at edition enterprise", () => {
        function authorizer() {
          return newBuiltInAuthorizer({
            store: opened.store,
            policies,
            accounts,
            rowReaders: readers,
            edition: ServerEdition.enterprise,
            logger: silentLogger,
          });
        }

        it("answers an identity provider from the model over its reader's row: its organization's admin views it, a member does not", async () => {
          const check = {
            permission: IamPermission.can_view,
            resourceKind: ApiResourceKind.identity_provider,
            resourceId: "idp_acme",
          };
          expect(await authorizer().authorize(caller(ADMIN), check)).toEqual({
            kind: "allow",
          });
          expect(await authorizer().authorize(caller(DAVE), check)).toEqual({
            kind: "deny",
            reason: "",
          });
          expect(providers.asked).toContain("idp_acme");
        });

        it("answers a team: a member of its organization views it, one who left does not", async () => {
          const check = {
            permission: IamPermission.can_view,
            resourceKind: ApiResourceKind.team,
            resourceId: "tm_core",
          };
          expect(await authorizer().authorize(caller(DAVE), check)).toEqual({
            kind: "allow",
          });
          expect(await authorizer().authorize(caller(ERIN), check)).toEqual({
            kind: "deny",
            reason: "",
          });
        });

        it.each([
          [ApiResourceKind.identity_provider, "idp_missing"],
          [ApiResourceKind.invitation, "inv_missing"],
          [ApiResourceKind.team, "tm_missing"],
          [ApiResourceKind.platform, "stigmer"],
        ])(
          "a missing %s row is a denial, never not-found, so its ids cannot be enumerated",
          async (resourceKind, resourceId) => {
            expect(
              await authorizer().authorize(caller(ADMIN), {
                permission: IamPermission.can_view,
                resourceKind,
                resourceId,
              }),
            ).toEqual({ kind: "deny", reason: "" });
          },
        );
      });

      describe("the built-in policy check", () => {
        function queries() {
          return newBuiltInPolicyCheck({
            store: opened.store,
            policies,
            accounts,
            rowReaders: readers,
          });
        }

        it("answers whether a resource is an organization's own, by the resource's derived link", async () => {
          const onAgent = (org: string) =>
            triple({ kind: "organization", id: org }, "organization", {
              kind: "agent",
              id: "agt_core",
            });
          expect(await queries().check(onAgent("acme"), [])).toBe(true);
          expect(await queries().check(onAgent("globex"), [])).toBe(false);
        });

        it("answers whether a person views an organization", async () => {
          const views = (accountId: string) =>
            triple({ kind: "identity_account", id: accountId }, "viewer", {
              kind: "organization",
              id: "acme",
            });
          expect(await queries().check(views(DAVE), [])).toBe(true);
          expect(await queries().check(views(ERIN), [])).toBe(false);
        });

        it("answers whether an account id, with no caller behind it, could still grant access", async () => {
          const grants = (accountId: string) =>
            triple(
              { kind: "identity_account", id: accountId },
              "can_grant_access",
              { kind: "organization", id: "acme" },
            );
          expect(await queries().check(grants(ADMIN), [])).toBe(true);
          expect(await queries().check(grants(DAVE), [])).toBe(false);
        });

        it("refuses contextual policies and a userset principal as programming errors", async () => {
          const held = orgRole(DAVE, "viewer", "acme");
          await expect(queries().check(held, [held])).rejects.toThrowError(
            /contextual policies are not supported/,
          );
          await expect(
            queries().check(
              triple(
                { kind: "organization", id: "acme", relation: "member" },
                "viewer",
                { kind: "agent", id: "agt_core" },
              ),
              [],
            ),
          ).rejects.toThrowError(/takes a direct principal/);
        });
      });
    });
  },
);

describe("kindsWithoutRows", () => {
  const reader: ResourceRowReader = {
    findById: () => Promise.resolve(undefined),
  };
  const all = new Map([
    [ApiResourceKind.identity_provider, reader],
    [ApiResourceKind.invitation, reader],
    [ApiResourceKind.team, reader],
  ]);

  it("is empty for open source, which keeps every kind it serves itself", () => {
    expect(
      kindsWithoutRows({
        edition: ServerEdition.oss,
        model: builtInModel,
        readers: new Map(),
      }),
    ).toEqual([]);
  });

  it("names every Enterprise kind with rows and no reader, and not the rowless platform", () => {
    expect(
      kindsWithoutRows({
        edition: ServerEdition.enterprise,
        model: builtInModel,
        readers: new Map([[ApiResourceKind.invitation, reader]]),
      }),
    ).toEqual([ApiResourceKind.identity_provider, ApiResourceKind.team]);
  });

  it("is empty once each kind the edition serves has a reader", () => {
    expect(
      kindsWithoutRows({
        edition: ServerEdition.enterprise,
        model: builtInModel,
        readers: all,
      }),
    ).toEqual([]);
  });
});
