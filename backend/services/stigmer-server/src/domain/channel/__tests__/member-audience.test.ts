/**
 * Pins AuthorizeMemberAudience (steps.ts), the member-profile lane's gate:
 * membership (can_view on the loaded web channel's organization, since the
 * link names only the channel) is asked after the channel loads; deny and
 * not-found both answer the lane's one NOT_FOUND, byte-identical to a
 * missing channel (linkNotFound), so a chat link teaches a non-member
 * nothing; unavailable is INTERNAL; the internal class skips.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelIdSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AUTHORIZATION_UNAVAILABLE_MESSAGE } from "../../../pipeline/steps/authorize.js";
import {
  RESOLVED_CHANNEL_KEY,
  linkNotFound,
  newAuthorizeMemberAudienceStep,
} from "../steps.js";

const CHANNEL_ID = "chn_01j9helper";

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
  const ctx = new RequestContext(
    ChannelIdSchema,
    create(ChannelIdSchema, { value: CHANNEL_ID }),
    caller,
    ApiResourceKind.channel,
  );
  ctx.set(
    RESOLVED_CHANNEL_KEY,
    create(ChannelSchema, {
      metadata: { id: CHANNEL_ID, org, slug: "helper" },
      spec: { type: { case: "web", value: {} } },
    }),
  );
  return ctx;
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
  it("asks can_view on the loaded channel's organization and admits an allow", async () => {
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

  it("deny and not-found both answer the lane's NOT_FOUND, byte-identical to a missing channel", async () => {
    for (const decision of [
      { kind: "deny", reason: "not a member" },
      { kind: "not-found" },
    ] as const) {
      const { authorizer } = fakeAuthorizer(decision);
      const error = await captureError(() =>
        newAuthorizeMemberAudienceStep(authorizer).execute(ctxFor("acme")),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe(linkNotFound(CHANNEL_ID).rawMessage);
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

  it("the internal class skips", async () => {
    const denying = fakeAuthorizer({ kind: "deny", reason: "" });
    await newAuthorizeMemberAudienceStep(denying.authorizer).execute(
      ctxFor("acme", testCallerIdentity({ callerClass: "internal" })),
    );
    expect(denying.checks).toEqual([]);
  });
});
