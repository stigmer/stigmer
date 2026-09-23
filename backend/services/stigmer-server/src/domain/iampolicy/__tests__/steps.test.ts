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
 * is what keeps a scope from widening the contract by accident. A person
 * names no relation qualifier; a team is granted only its kind's team
 * roles (never ownership, never on a kind that lists none), always as its
 * members, and nothing at all under open source's organization-only scope.
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
  personQualifierMessage,
  policyIdFor,
  principalNotGrantableMessage,
  roleNotGrantableMessage,
  teamNotGrantableMessage,
  teamQualifierMessage,
  teamRoleNotGrantableMessage,
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

  it("arm 4: a principal that is not a person is refused — a role names an account; a structural link is bootstrapPolicy's (Q-S9-2)", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(
        contextOf(
          triple({ kind: "organization", id: "other" }, "member", {
            kind: "organization",
            id: "acme",
          }),
        ),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(principalNotGrantableMessage("organization"));
  });

  it("arm 4 runs LAST: a wrong role on a non-person principal hears the role sentence, so every answer the cloud gives today is unchanged", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(
        contextOf(
          triple({ kind: "organization", id: "other" }, "editor", {
            kind: "organization",
            id: "acme",
          }),
        ),
      ),
    );
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("editor", "organization", [
        "owner",
        "admin",
        "member",
        "viewer",
      ]),
    );
  });

  it("a person names no relation qualifier: identity_account:<id>#<anything> names nobody and would be a tuple OpenFGA refuses", async () => {
    const error = await refusal(() =>
      organizationOnly.execute(
        contextOf(
          triple(
            { kind: "identity_account", id: "ida_bob", relation: "member" },
            "viewer",
            { kind: "organization", id: "acme" },
          ),
        ),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(personQualifierMessage("member"));
  });

  describe("a team principal", () => {
    const team = { kind: "team", id: "tm_sre", relation: "member" };
    const perResource = newValidateGrantableRoleStep(
      scopeOf(
        new Map([
          [ApiResourceKind.agent, [IamRole.owner, IamRole.viewer]],
          [
            ApiResourceKind.agent_channel,
            [IamRole.owner, IamRole.viewer, IamRole.participant],
          ],
          [ApiResourceKind.session, [IamRole.owner, IamRole.viewer]],
          [
            ApiResourceKind.organization,
            [IamRole.owner, IamRole.admin, IamRole.member, IamRole.viewer],
          ],
        ]),
      ),
    );

    it("is granted a role its kind's team_grantable_roles lists, as the team's members", () => {
      expect(
        perResource.execute(
          contextOf(triple(team, "viewer", { kind: "agent", id: "agt_1" })),
        ),
      ).toBeUndefined();
      expect(
        perResource.execute(
          contextOf(
            triple(team, "participant", {
              kind: "agent_channel",
              id: "ach_1",
            }),
          ),
        ),
      ).toBeUndefined();
    });

    it("is never granted ownership, though a person could be: a team holds only its kind's team roles", async () => {
      const error = await refusal(() =>
        perResource.execute(
          contextOf(triple(team, "owner", { kind: "agent", id: "agt_1" })),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        teamRoleNotGrantableMessage("owner", "agent", ["viewer"]),
      );
    });

    it("is refused on a kind that lists no team role — a session stays personal, an organization role is no team's", async () => {
      for (const [kind, id, role] of [
        ["session", "ses_1", "viewer"],
        ["organization", "acme", "member"],
      ] as const) {
        const error = await refusal(() =>
          perResource.execute(contextOf(triple(team, role, { kind, id }))),
        );
        expect(error.code, kind).toBe(Code.InvalidArgument);
        expect(error.rawMessage, kind).toBe(teamNotGrantableMessage(kind));
      }
    });

    it("must name the team's members as its relation", async () => {
      for (const relation of ["", "admin"]) {
        const error = await refusal(() =>
          perResource.execute(
            contextOf(
              triple({ ...team, relation }, "viewer", {
                kind: "agent",
                id: "agt_1",
              }),
            ),
          ),
        );
        expect(error.code, relation).toBe(Code.InvalidArgument);
        expect(error.rawMessage, relation).toBe(teamQualifierMessage(relation));
      }
    });

    it("is granted nothing under open source's organization-only scope: per-resource grants are UNIMPLEMENTED, and the organization lists no team role", async () => {
      const onAgent = await refusal(() =>
        organizationOnly.execute(
          contextOf(triple(team, "viewer", { kind: "agent", id: "agt_1" })),
        ),
      );
      expect(onAgent.code).toBe(Code.Unimplemented);
      const onOrganization = await refusal(() =>
        organizationOnly.execute(
          contextOf(
            triple(team, "member", { kind: "organization", id: "acme" }),
          ),
        ),
      );
      expect(onOrganization.rawMessage).toBe(
        teamNotGrantableMessage("organization"),
      );
    });
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
