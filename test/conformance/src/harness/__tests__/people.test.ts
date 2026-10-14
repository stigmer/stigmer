// Pins the pure arms of the people an enforcing primary makes: the member
// grant's shape — the ordinary IamPolicy create the Members page performs,
// naming the organization by ID (the FGA object) and the `member` role the
// organization kind declares grantable — and a first sign-in that answers no
// account refused rather than carried on as a person. The targets that make
// people through it pin the rest (targets/__tests__/cloud-people.test.ts,
// targets/__tests__/enterprise-target.test.ts).
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../clients";
import { organizationMemberGrant, provisionPerson } from "../people";

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

describe("provisionPerson", () => {
  const presenting =
    (id: string | undefined) =>
    (): Pick<ConformanceClients, "identityAccountCommand"> =>
      ({
        identityAccountCommand: {
          provisionMyAccount: async () => ({ metadata: id === undefined ? undefined : { id } }),
        },
      }) as unknown as Pick<ConformanceClients, "identityAccountCommand">;

  it("is the token and the account its first sign-in made", async () => {
    expect(await provisionPerson("token-1", presenting("ida_01person"))).toEqual({
      token: "token-1",
      accountId: "ida_01person",
    });
  });

  it("refuses a first sign-in that answers no account", async () => {
    await expect(provisionPerson("token-1", presenting(undefined))).rejects.toThrow(
      "provisionMyAccount answered no account for a fresh person",
    );
  });
});
