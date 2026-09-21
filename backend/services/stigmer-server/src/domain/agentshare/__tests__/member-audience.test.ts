/**
 * Pins AuthorizeMemberAudience (steps.ts), the member-profile lane's gate:
 * membership (can_view on the reference's organization) is asked before
 * the share is loaded; deny and not-found both answer the lane's one
 * NOT_FOUND, byte-identical to a missing share, so a share URL teaches a
 * non-member nothing; unavailable is INTERNAL; an empty org asks nothing
 * and is left to the loader's INVALID_ARGUMENT; the internal class skips.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AUTHORIZATION_UNAVAILABLE_MESSAGE } from "../../../pipeline/steps/authorize.js";
import { newAuthorizeMemberAudienceStep, sharedNotFound } from "../steps.js";

function fakeAuthorizer(decision: AuthzDecision): {
  authorizer: Authorizer;
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

function ctxFor(org: string, caller: CallerIdentity = testCallerIdentity()) {
  return new RequestContext(
    ApiResourceReferenceSchema,
    create(ApiResourceReferenceSchema, { org, slug: "helper" }),
    caller,
    ApiResourceKind.agent_share,
  );
}

async function captureError(
  run: () => void | Promise<void>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to reject");
}

describe("AuthorizeMemberAudience", () => {
  it("asks can_view on the reference's organization and admits an allow", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    await newAuthorizeMemberAudienceStep(authorizer).execute(ctxFor("acme"));
    expect(checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  it("deny and not-found both answer the lane's NOT_FOUND, byte-identical to a missing share", async () => {
    for (const decision of [
      { kind: "deny", reason: "not a member" },
      { kind: "not-found" },
    ] as const) {
      const { authorizer } = fakeAuthorizer(decision);
      const error = await captureError(() =>
        newAuthorizeMemberAudienceStep(authorizer).execute(ctxFor("acme")),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe(sharedNotFound("helper").rawMessage);
    }
  });

  it("unavailable is INTERNAL, never a refusal", async () => {
    const { authorizer } = fakeAuthorizer({
      kind: "unavailable",
      cause: new Error("backend down"),
    });
    const error = await captureError(() =>
      newAuthorizeMemberAudienceStep(authorizer).execute(ctxFor("acme")),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(AUTHORIZATION_UNAVAILABLE_MESSAGE);
  });

  it("an empty org asks nothing (the loader's INVALID_ARGUMENT answers), and the internal class skips", async () => {
    const denying = fakeAuthorizer({ kind: "deny", reason: "" });
    await newAuthorizeMemberAudienceStep(denying.authorizer).execute(
      ctxFor(""),
    );
    await newAuthorizeMemberAudienceStep(denying.authorizer).execute(
      ctxFor("acme", testCallerIdentity({ callerClass: "internal" })),
    );
    expect(denying.checks).toEqual([]);
  });
});
