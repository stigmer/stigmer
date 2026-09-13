/**
 * Pins steps.ts (20260913.01 slice 5): the IamPolicy chains' domain-local
 * steps. The one with branching logic is ValidateGrantableRole (Q-OR-3 as
 * refined; Q-S3-3; Q-S5-1): the wire refusal first (an unknown kind is
 * `Unknown resource kind`, never a role sentence), then the three arms in
 * order — the PROTO lists no role for the kind → the cloud's
 * system-managed copy, byte-identical in every edition; the composed
 * SCOPE lists none → UNIMPLEMENTED naming the editions that serve
 * per-resource grants; the role is not in proto ∩ scope → the cloud's
 * second copy listing the intersection in proto order. The intersection
 * is what keeps a scope from widening the contract by accident.
 *
 * Grant and Revoke are proven for the one thing a step adds over the
 * grant path: the result they leave under POLICY_RESULT_KEY (the revoke
 * of an absent triple leaves the default instance, Java's contract).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { PolicyGrantScope } from "../../../extensions/policy-grant-scope.js";
import { trustedLocalIdentityFor } from "../../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  noGrantableRolesMessage,
  policyIdFor,
  roleNotGrantableMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { newOrganizationOnlyGrantScope } from "../grant-scope.js";
import {
  POLICY_RESULT_KEY,
  newGrantStep,
  newRevokeStep,
  newValidateGrantableRoleStep,
} from "../steps.js";
import { fakeIamPolicyStore, orgRole, triple } from "./support.js";

const caller = trustedLocalIdentityFor({
  email: "operator@example.com",
  displayName: "The Operator",
});
const silent = createLogger({ level: "error", pretty: false, write: () => {} });

function contextOf(
  spec: IamPolicySpec,
): RequestContext<typeof IamPolicySpecSchema> {
  return new RequestContext(
    IamPolicySpecSchema,
    spec,
    caller,
    ApiResourceKind.iam_policy,
  );
}

async function refusal(
  run: () => void | Promise<unknown>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function scopeOf(
  table: ReadonlyMap<ApiResourceKind, ReadonlyArray<IamRole>>,
): PolicyGrantScope {
  return { grantableRoles: (kind) => table.get(kind) ?? [] };
}

describe("ValidateGrantableRole", () => {
  const organizationOnly = newValidateGrantableRoleStep(
    newOrganizationOnlyGrantScope(),
  );

  it("admits a role the organization's kind_meta lists under the open-source scope", () => {
    expect(
      organizationOnly.execute(contextOf(orgRole("ida_bob", "viewer", "acme"))),
    ).toBeUndefined();
  });

  it("refuses an unknown resource kind with the wire copy BEFORE any role arm", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(
        contextOf(
          triple({ kind: "identity_account", id: "ida_bob" }, "viewer", {
            kind: "nope",
            id: "x",
          }),
        ),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownResourceKindMessage("nope"));
  });

  it("arm 1: a kind whose proto lists no role is system-managed in every edition — even when a scope claims otherwise", async () => {
    const widening = newValidateGrantableRoleStep(
      scopeOf(new Map([[ApiResourceKind.identity_account, [IamRole.viewer]]])),
    );
    const error = await refusal(() =>
      widening.execute(
        contextOf(
          triple({ kind: "identity_account", id: "ida_bob" }, "viewer", {
            kind: "identity_account",
            id: "ida_x",
          }),
        ),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(noGrantableRolesMessage("identity_account"));
  });

  it("arm 2: a kind the proto grants on but the scope excludes is UNIMPLEMENTED with the edition named", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(
        contextOf(
          triple({ kind: "identity_account", id: "ida_bob" }, "viewer", {
            kind: "agent",
            id: "agt_1",
          }),
        ),
      ),
    );
    expect(error.code).toBe(Code.Unimplemented);
    expect(error.rawMessage).toBe(PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE);
  });

  it("arm 3: a role outside proto ∩ scope is refused with the cloud's copy, listing the intersection in proto order", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(contextOf(orgRole("ida_bob", "editor", "acme"))),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("editor", "organization", [
        "owner",
        "admin",
        "member",
        "viewer",
      ]),
    );
  });

  it("a scope can only NARROW the proto: a role it adds is clipped from the list", async () => {
    const widening = newValidateGrantableRoleStep(
      scopeOf(
        new Map([
          [
            ApiResourceKind.organization,
            [IamRole.participant, IamRole.viewer, IamRole.owner],
          ],
        ]),
      ),
    );
    const error = await refusal(() =>
      widening.execute(contextOf(orgRole("ida_bob", "participant", "acme"))),
    );
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("participant", "organization", [
        "owner",
        "viewer",
      ]),
    );
    expect(
      widening.execute(contextOf(orgRole("ida_bob", "viewer", "acme"))),
    ).toBeUndefined();
  });

  it("the unknown kind is total for the scope, never a throw from it (Q-S3-3)", async () => {
    const throwing: PolicyGrantScope = {
      grantableRoles: () => {
        throw new Error("a scope must never be asked about an unknown kind");
      },
    };
    const step = newValidateGrantableRoleStep(throwing);
    const error = await refusal(() =>
      step.execute(
        contextOf(
          triple({ kind: "identity_account", id: "x" }, "viewer", {
            kind: "garbage",
            id: "y",
          }),
        ),
      ),
    );
    expect(error.rawMessage).toBe(unknownResourceKindMessage("garbage"));
  });
});

describe("Grant and Revoke leave their result under POLICY_RESULT_KEY", () => {
  function pathOverFreshStore() {
    return newIamPolicyGrantPath({
      policies: fakeIamPolicyStore(),
      lifecycle: undefined,
      logger: silent,
    });
  }

  it("Grant leaves the granted row — the same row on the duplicate arm", async () => {
    const path = pathOverFreshStore();
    const spec = orgRole("ida_bob", "member", "acme");
    const first = contextOf(spec);
    await newGrantStep(path).execute(first);
    const second = contextOf(spec);
    await newGrantStep(path).execute(second);
    expect((first.get(POLICY_RESULT_KEY) as IamPolicy).metadata?.id).toBe(
      policyIdFor(spec),
    );
    expect((second.get(POLICY_RESULT_KEY) as IamPolicy).metadata?.id).toBe(
      policyIdFor(spec),
    );
  });

  it("Revoke leaves the revoked row, or the default instance when there was none (Java's idempotent delete)", async () => {
    const path = pathOverFreshStore();
    const spec = orgRole("ida_bob", "member", "acme");
    await path.grant(spec, caller);
    const revoked = contextOf(spec);
    await newRevokeStep(path).execute(revoked);
    expect((revoked.get(POLICY_RESULT_KEY) as IamPolicy).metadata?.id).toBe(
      policyIdFor(spec),
    );
    const absent = contextOf(spec);
    await newRevokeStep(path).execute(absent);
    expect(
      (absent.get(POLICY_RESULT_KEY) as IamPolicy).metadata?.id ?? "",
    ).toBe("");
  });
});
