/**
 * Pins the built-in organization directory on both store drivers as the
 * twin of the cloud's `listObjectIds(identity_account, can_view,
 * organization)`: the organizations a person holds a row in and can
 * view — one of two, both, none; a grant on something other than an
 * organization is not one; a role whose organization row is gone is
 * still answered (the controller skips it — the division of labour
 * pinned); an unprovisioned subject is `[]` and never a fault (the
 * conformance sibling's readiness probe is this RPC with a fresh
 * subject); the `internal` class is ALL_ORGANIZATIONS — the in-process
 * authorization skip, applied to a directory answer; enumeration is
 * refused, the cloud's posture; the person's rows are read once for
 * candidates and evaluation together.
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
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { ALL_ORGANIZATIONS } from "../../extensions/organization-directory.js";
import { builtInModel } from "../model/index.js";
import { newBuiltInOrganizationDirectory } from "../organization-directory.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow, storedDeclaration } from "./support.js";

const FOUNDER = accountIdFor("auth0|founder");
const MEMBER = accountIdFor("auth0|member");

function resolved(accountId: string): CallerIdentity {
  return {
    identityId: accountId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

function idpShaped(subject: string): CallerIdentity {
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url",
  );
  return {
    identityId: subject,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: `h.${payload}.unsigned`,
  };
}

afterAll(dropPostgresFixture);

describe.each(
  driverFixtures([
    ApiResourceKind.iam_policy,
    ApiResourceKind.identity_account,
    ApiResourceKind.organization,
    ApiResourceKind.agent,
  ]),
)("the built-in organization directory on $name", (fixture) => {
  describe.skipIf(fixture.skip)("listMyOrganizationIds", () => {
    let opened: OpenedStore;
    let policies: IamPolicyStore;
    let accounts: IdentityAccountStore;
    let principalReads: number;

    async function organization(id: string) {
      const declaration = storedDeclaration("organization");
      await opened.store.saveResource(
        ApiResourceKind.organization,
        id,
        declaration.schema,
        fixtureRow(declaration, {
          id,
          org: "",
          visibility: ApiResourceVisibility.visibility_private,
          createdBy: FOUNDER,
        }),
      );
    }

    async function grant(spec: ReturnType<typeof orgRole>) {
      await policies.save(
        create(IamPolicySchema, {
          apiVersion: IAM_POLICY_API_VERSION,
          kind: IAM_POLICY_KIND,
          metadata: { id: policyIdFor(spec) },
          spec,
        }),
      );
    }

    function directory() {
      return newBuiltInOrganizationDirectory({
        store: opened.store,
        policies: {
          ...policies,
          findByPrincipal(principalKind, principalId) {
            principalReads += 1;
            return policies.findByPrincipal(principalKind, principalId);
          },
        },
        accounts,
      });
    }

    beforeEach(async () => {
      opened = await fixture.open();
      principalReads = 0;
      policies = newResourceIamPolicyStore(opened.store);
      accounts = newResourceIdentityAccountStore(opened.store);
      for (const [id, subject] of [
        [FOUNDER, "auth0|founder"],
        [MEMBER, "auth0|member"],
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
      await organization("alpha");
      await organization("beta");
      await grant(orgRole(FOUNDER, "owner", "alpha"));
      await grant(orgRole(FOUNDER, "owner", "beta"));
      await grant(orgRole(MEMBER, "member", "alpha"));
    });

    afterEach(async () => {
      await opened.close();
    });

    it("refuses enumeration — the cloud's posture; `find` would otherwise hand every member every organization", () => {
      expect(directory().refusesEnumeration).toBe(true);
    });

    it("the internal class — the server acting as itself — is ALL_ORGANIZATIONS, the in-process authorization skip; no account is even asked for", async () => {
      let accountReads = 0;
      const dir = newBuiltInOrganizationDirectory({
        store: opened.store,
        policies,
        accounts: {
          findById: (id) => {
            accountReads += 1;
            return accounts.findById(id);
          },
          findDirectByIdpId: (idpId) => {
            accountReads += 1;
            return accounts.findDirectByIdpId(idpId);
          },
        },
      });
      expect(
        await dir.listMyOrganizationIds({
          identityId: "system",
          callerClass: "internal",
          issuer: "",
          rawToken: "",
          origin: "in-process",
        }),
      ).toBe(ALL_ORGANIZATIONS);
      expect(accountReads).toBe(0);
    });

    it("a member of one of two organizations sees that one; the owner of both sees both; never ALL_ORGANIZATIONS for a person", async () => {
      const dir = directory();
      expect(await dir.listMyOrganizationIds(resolved(MEMBER))).toEqual([
        "alpha",
      ]);
      const founders = await dir.listMyOrganizationIds(resolved(FOUNDER));
      expect(founders).not.toBe(ALL_ORGANIZATIONS);
      expect([...(founders as ReadonlyArray<string>)].sort()).toEqual([
        "alpha",
        "beta",
      ]);
    });

    it("an unprovisioned subject holds nothing and is answered [], never a fault (the sibling's readiness probe)", async () => {
      expect(
        await directory().listMyOrganizationIds(idpShaped("auth0|fresh")),
      ).toEqual([]);
    });

    it("a grant on an agent is not an organization, and a role whose organization row is gone is still answered — the controller skips it", async () => {
      await grant(
        triple({ kind: "identity_account", id: MEMBER }, "viewer", {
          kind: "agent",
          id: "agt_1",
        }),
      );
      await grant(orgRole(MEMBER, "viewer", "gamma")); // no `gamma` row
      const mine = await directory().listMyOrganizationIds(resolved(MEMBER));
      expect([...(mine as ReadonlyArray<string>)].sort()).toEqual([
        "alpha",
        "gamma",
      ]);
    });

    it("reads the person's rows ONCE — the candidates and the evaluation share the source's read", async () => {
      await directory().listMyOrganizationIds(resolved(FOUNDER));
      expect(principalReads).toBe(1);
    });

    it("a store fault propagates as the fault it is — the controller maps it, never this driver", async () => {
      const fault = new Error("connection reset");
      const dir = newBuiltInOrganizationDirectory({
        store: opened.store,
        policies: { ...policies, findByPrincipal: () => Promise.reject(fault) },
        accounts,
      });
      await expect(dir.listMyOrganizationIds(resolved(FOUNDER))).rejects.toBe(
        fault,
      );
    });
  });
});
