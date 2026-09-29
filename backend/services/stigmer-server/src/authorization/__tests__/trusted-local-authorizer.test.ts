/**
 * Pins the trusted-local Authorizer arm by arm: a check on an Organization
 * the store does not hold is `not-found` (the answer the built-in
 * authorizer's arm 4 and the cloud's deny-path probe give, so a server
 * without sign-in refuses a phantom write with the same sentence as one
 * with it, stigmer#1163), on both store drivers; a stored Organization is
 * `allow`; every other check is `allow` without touching the store (the
 * laptop separates no callers); an empty target id is `allow`, never
 * `not-found`, because the Authorize step maps a not-found on an empty id
 * to INTERNAL; and a store fault is `unavailable` with its cause, never a
 * denial, a not-found or a throw.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { AuthzCheck } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { newTrustedLocalAuthorizer } from "../trusted-local-authorizer.js";
import type { TrustedLocalAuthorizerStore } from "../trusted-local-authorizer.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

/** The trusted-local identity: the operator's email, no token (pipeline/interceptors/auth.ts). */
const OPERATOR: CallerIdentity = {
  identityId: "operator@example.com",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

function onOrganization(id: string, permission: IamPermission): AuthzCheck {
  return {
    permission,
    resourceKind: ApiResourceKind.organization,
    resourceId: id,
  };
}

/** A store whose every read is counted and fails: `fault`, or a sentinel no arm may reach. */
function countingStore(fault?: Error): {
  readonly store: TrustedLocalAuthorizerStore;
  reads(): number;
} {
  let reads = 0;
  return {
    store: {
      getResource() {
        reads += 1;
        return Promise.reject(fault ?? new Error("the store must not be read"));
      },
    },
    reads: () => reads,
  };
}

afterAll(dropPostgresFixture);

describe.each(driverFixtures([ApiResourceKind.organization]))(
  "trusted-local authorizer over $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("authorize", () => {
      let opened: OpenedStore;

      beforeEach(async () => {
        opened = await fixture.open();
        await opened.store.saveResource(
          ApiResourceKind.organization,
          "acme",
          OrganizationSchema,
          create(OrganizationSchema, {
            apiVersion: "tenancy.stigmer.ai/v1",
            kind: "Organization",
            metadata: { id: "acme", name: "Acme", slug: "acme" },
          }),
        );
      });

      afterEach(async () => {
        await opened.close();
      });

      it("a check on an Organization the store does not hold is not-found, whatever the permission", async () => {
        const authorizer = newTrustedLocalAuthorizer({ store: opened.store });
        for (const permission of [
          IamPermission.can_create_agent,
          IamPermission.can_view,
          IamPermission.can_grant_access,
        ]) {
          expect(
            await authorizer.authorize(
              OPERATOR,
              onOrganization("stigmer", permission),
            ),
          ).toEqual({ kind: "not-found" });
        }
      });

      it("a check on a stored Organization is allowed", async () => {
        const authorizer = newTrustedLocalAuthorizer({ store: opened.store });
        expect(
          await authorizer.authorize(
            OPERATOR,
            onOrganization("acme", IamPermission.can_create_agent),
          ),
        ).toEqual({ kind: "allow" });
      });
    });
  },
);

describe("trusted-local authorizer, the arms that never read", () => {
  it.each([
    [
      "an Organization check with an empty id (a platform-scoped write)",
      onOrganization("", IamPermission.can_create_agent),
    ],
    [
      "a check on another kind, even one whose row does not exist",
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_does_not_exist",
      },
    ],
    [
      "a check on the rowless platform",
      {
        permission: IamPermission.can_manage_plans,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ],
  ] as const)("%s is allowed without a read", async (_name, check) => {
    const counted = countingStore();
    const decision = await newTrustedLocalAuthorizer({
      store: counted.store,
    }).authorize(OPERATOR, check);
    expect(decision).toEqual({ kind: "allow" });
    expect(counted.reads()).toBe(0);
  });

  it("a store fault on the Organization read is unavailable with its cause, read once", async () => {
    const fault = new Error("database is locked");
    const counted = countingStore(fault);
    const decision = await newTrustedLocalAuthorizer({
      store: counted.store,
    }).authorize(OPERATOR, onOrganization("acme", IamPermission.can_view));
    expect(decision).toEqual({ kind: "unavailable", cause: fault });
    expect(counted.reads()).toBe(1);
  });
});
