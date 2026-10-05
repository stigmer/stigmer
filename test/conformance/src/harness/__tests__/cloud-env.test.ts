// Pins the pure arm of the cloud-env identity helpers: the member grant's
// shape — the ordinary IamPolicy create the
// Members page performs, naming the organization by ID (the FGA object) and
// the `member` role the organization kind declares grantable.
import { describe, expect, it } from "vitest";
import { organizationMemberGrant } from "../cloud-env";

describe("organizationMemberGrant", () => {
  it("names the identity account as principal, the organization by id, and the member role", () => {
    // An IamPolicySpec message (the create RPC's input), so the shape is
    // matched field by field rather than as a bare object.
    expect(organizationMemberGrant("org_01acme", "ida_01member")).toMatchObject({
      principal: { kind: "identity_account", id: "ida_01member" },
      resource: { kind: "organization", id: "org_01acme" },
      relation: "member",
    });
  });

  it("refuses empty ids rather than minting a grant on nothing", () => {
    expect(() => organizationMemberGrant("", "ida_01member")).toThrow(
      /non-empty/,
    );
    expect(() => organizationMemberGrant("org_01acme", "")).toThrow(
      /non-empty/,
    );
  });
});
