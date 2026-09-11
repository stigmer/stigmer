// Pins the pure arms of the cloud-env identity helpers: the JWT subject read
// the grants key on (the server-chosen identity-account id, never the mint's
// userId), and the member grant's shape — the ordinary IamPolicy create the
// Members page performs, naming the organization by ID (the FGA object) and
// the `member` role the organization kind declares grantable.
import { describe, expect, it } from "vitest";
import { jwtSubject, organizationMemberGrant } from "../cloud-env";

function unsignedJwt(payload: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("jwtSubject", () => {
  it("reads the sub claim of a compact JWT", () => {
    expect(
      jwtSubject(unsignedJwt({ sub: "ida_01member", iss: "stigmer" })),
    ).toBe("ida_01member");
  });

  it("refuses a token without a subject, or one that is not a JWT", () => {
    expect(() => jwtSubject(unsignedJwt({ iss: "stigmer" }))).toThrow(
      /no sub claim/,
    );
    expect(() => jwtSubject(unsignedJwt({ sub: "" }))).toThrow(/no sub claim/);
    expect(() => jwtSubject("not-a-jwt")).toThrow(/not a JWT/);
  });
});

describe("organizationMemberGrant", () => {
  it("names the identity account as principal, the organization by id, and the member role", () => {
    expect(organizationMemberGrant("org_01acme", "ida_01member")).toEqual({
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
