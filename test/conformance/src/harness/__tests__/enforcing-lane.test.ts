// Pins the pure arms of the enforcing lane (harness/enforcing-lane.ts): the
// grant message a lane hands IamPolicy create/delete, the steps that move a
// member to exactly one role, and the set of organizations a newcomer is
// revoked on. The lanes themselves boot servers and are exercised by the
// conformance suites; what is decided without a server is decided here, and
// the sibling lane's revoke is driven once over a stub sibling.
import { describe, expect, it } from "vitest";

import type { ConformanceClients } from "../clients";

import { ORGANIZATION_ROLES } from "../../targets/target";
import type { SiblingServer } from "../../targets/target";
import {
  exactRoleSteps,
  newSiblingEnforcingLane,
  organizationRoleGrant,
  organizationsToRevoke,
} from "../enforcing-lane";

describe("organizationRoleGrant", () => {
  it("names the identity account as principal, the organization by id, and the role as the relation", () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(organizationRoleGrant("acme", "ida_01person", role)).toMatchObject(
        {
          principal: { kind: "identity_account", id: "ida_01person" },
          resource: { kind: "organization", id: "acme" },
          relation: role,
        },
      );
    }
  });

  it("refuses empty ids rather than minting a grant on nothing", () => {
    expect(() => organizationRoleGrant("", "ida_01person", "member")).toThrow(
      /non-empty/,
    );
    expect(() => organizationRoleGrant("acme", "", "member")).toThrow(
      /non-empty/,
    );
  });
});

describe("exactRoleSteps", () => {
  it("is nothing for member — the newcomer already holds exactly that", () => {
    expect(exactRoleSteps("member")).toEqual([]);
  });

  it("grants the role BEFORE revoking member, for every other role", () => {
    for (const role of ORGANIZATION_ROLES.filter((r) => r !== "member")) {
      expect(exactRoleSteps(role)).toEqual([
        { op: "grant", role },
        { op: "revoke", role: "member" },
      ]);
    }
  });
});

describe("organizationsToRevoke", () => {
  it("is every organization the founder holds, in order, minus the spared one", () => {
    expect(
      organizationsToRevoke(["acme", "globex", "initech"], "globex"),
    ).toEqual(["acme", "initech"]);
  });

  it("spares nothing when no tenancy is kept — the outsider", () => {
    expect(organizationsToRevoke(["acme", "globex"], undefined)).toEqual([
      "acme",
      "globex",
    ]);
  });

  it("drops an empty id a malformed row could hand back rather than revoking on nothing", () => {
    expect(organizationsToRevoke(["acme", ""], undefined)).toEqual(["acme"]);
  });
});

describe("newSiblingEnforcingLane", () => {
  it("revokes a newcomer by org on every organization the founder holds but the one it joins", async () => {
    const revoked: unknown[] = [];
    let accounts = 0;
    const clients = {
      identityAccountCommand: {
        provisionMyAccount: async () => ({ metadata: { id: `ida_${++accounts}` } }),
      },
      organizationQuery: {
        findMyOrganizations: async () => ({
          entries: [{ metadata: { id: "org_kept" } }, { metadata: { id: "org_other" } }],
        }),
      },
      iamPolicyCommand: {
        revokeOrgAccess: async (input: unknown) => {
          revoked.push(input);
          return {};
        },
      },
    } as unknown as ConformanceClients;
    const sibling: SiblingServer = {
      clientsPresenting: () => clients,
      teardown: async () => {},
    };

    const { lane, close } = await newSiblingEnforcingLane({ spawnSibling: async () => sibling });
    try {
      await lane.provisionMember({ org: "org_kept" });
    } finally {
      await close();
    }
    expect(revoked).toEqual([{ identityAccountId: "ida_2", org: "org_other" }]);
  });
});
