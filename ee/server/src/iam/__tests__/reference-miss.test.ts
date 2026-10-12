/**
 * Pins the answer an Enterprise lane gives when what a caller named is not
 * there (reference-miss.ts), over a recording authorizer: the question is
 * the kind's bar on the organization the caller named, about the caller;
 * allow lets the lane answer NOT_FOUND; deny and not-found (a missing
 * organization) answer the forbidden hit's refusal, code and copy alike;
 * an unavailable engine is INTERNAL with its cause, never a refusal; the
 * in-process `internal` caller is asked nothing. And the refusal's copy
 * is the method's own annotation, so a miss and a forbidden hit cannot
 * drift apart; a method with no copy is a wiring defect that throws.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { Authorizer, AuthzCheck, AuthzDecision, CallerIdentity } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { deniedCopyOf, refuseMissUnlessOrganizationBar } from "../reference-miss.js";

const PERSON: CallerIdentity = {
  identityId: "ida_ana",
  callerClass: "user",
  issuer: "https://auth.test",
  rawToken: "h.p.s",
};

const BAR = {
  organization: "acme",
  permission: IamPermission.can_view,
  deniedMessage: "unauthorized to view team",
};

function recording(decision: AuthzDecision): { authorizer: Authorizer; asked: AuthzCheck[] } {
  const asked: AuthzCheck[] = [];
  return {
    asked,
    authorizer: {
      authorize: (_caller, check) => {
        asked.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

async function thrownBy(work: Promise<unknown>): Promise<ConnectError> {
  const caught = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ConnectError);
  return caught as ConnectError;
}

describe("the answer to a lookup that finds nothing", () => {
  it("lets the lane answer not found to a caller who holds the bar, asking only the bar on the named organization", async () => {
    const { authorizer, asked } = recording({ kind: "allow" });
    await refuseMissUnlessOrganizationBar(authorizer, PERSON, BAR);
    expect(asked).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);
  });

  it.each<[string, AuthzDecision]>([
    ["deny", { kind: "deny", reason: "no relation" }],
    ["not-found", { kind: "not-found" }],
  ])("answers %s with the forbidden hit's refusal, code and copy alike", async (_case, decision) => {
    const refused = await thrownBy(refuseMissUnlessOrganizationBar(recording(decision).authorizer, PERSON, BAR));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe("unauthorized to view team");
  });

  it("answers an unavailable engine INTERNAL with its cause, never a refusal", async () => {
    const cause = new Error("engine down");
    const failed = await thrownBy(
      refuseMissUnlessOrganizationBar(recording({ kind: "unavailable", cause }).authorizer, PERSON, BAR),
    );
    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe("failed to verify organization access");
    expect(failed.cause).toBe(cause);
  });

  it("asks nothing of the in-process caller, which is the enforcement itself", async () => {
    const { authorizer, asked } = recording({ kind: "deny", reason: "" });
    await refuseMissUnlessOrganizationBar(authorizer, { ...PERSON, callerClass: "internal" }, BAR);
    expect(asked).toEqual([]);
  });
});

describe("the refusal's copy", () => {
  it("is the method's own authorization copy", () => {
    expect(deniedCopyOf(TeamQueryController.method.get)).toBe("unauthorized to view team");
    expect(deniedCopyOf(IdentityProviderQueryController.method.get)).toBe("unauthorized to view identity provider");
  });

  it("throws for a method that carries none, rather than refusing with no sentence", () => {
    expect(() => deniedCopyOf(TeamQueryController.method.getByReference)).toThrow(
      "ai.stigmer.iam.team.v1.TeamQueryController.getByReference carries no authorization copy",
    );
  });
});
