/**
 * Pins ssoRequirementOf: an SSO_REQUIRED refusal answers the organization
 * and the provider it names, wrapped or not; any other error answers null.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { ssoRequirementOf } from "../sso-requirement";

function refusal(reason: string): ConnectError {
  return new ConnectError("This organization requires you to sign in through Acme Okta.", Code.PermissionDenied, undefined, [
    {
      desc: ErrorInfoSchema,
      value: create(ErrorInfoSchema, {
        reason,
        domain: "stigmer.ai",
        metadata: { org: "org_acme", provider: "acme-okta" },
      }),
    },
  ]);
}

describe("ssoRequirementOf", () => {
  it("answers the organization and the provider an SSO_REQUIRED refusal names, wrapped or not", () => {
    expect(ssoRequirementOf(refusal("SSO_REQUIRED"))).toEqual({ org: "org_acme", provider: "acme-okta" });
    expect(ssoRequirementOf(new Error("wrapped", { cause: refusal("SSO_REQUIRED") }))).toEqual({
      org: "org_acme",
      provider: "acme-okta",
    });
  });

  it("answers null for any other refusal", () => {
    expect(ssoRequirementOf(refusal("PLAN_UPGRADE_REQUIRED"))).toBeNull();
    expect(ssoRequirementOf(new ConnectError("denied", Code.PermissionDenied))).toBeNull();
    expect(ssoRequirementOf(undefined)).toBeNull();
  });
});
