// Pins the pure arms of the enforcing lane (harness/enforcing-lane.ts): the
// grant message a lane hands Grant create/delete, the steps that move a
// member to exactly one role, and the set of organizations a newcomer is
// revoked on. The lanes themselves boot servers and are exercised by the
// conformance suites; what is decided without a server is decided here, the
// sibling lane's revoke is driven once over a stub sibling, and the primary
// lane's exact-role move once over stub clients: the founder grants the role,
// then revokes member, on the organization's id.
import { describe, expect, it } from "vitest";

import type { ConformanceClients } from "../clients";

import { ORGANIZATION_ROLES } from "../../targets/target";
import type { SiblingServer } from "../../targets/target";
import {
  exactRoleSteps,
  newPrimaryEnforcingLane,
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
        listMine: async () => ({
          entries: [{ metadata: { id: "org_kept" } }, { metadata: { id: "org_other" } }],
        }),
      },
      grantCommand: {
        revokeOrgAccess: async (input: unknown) => {
          revoked.push(input);
          return {};
        },
      },
    } as unknown as ConformanceClients;
    const sibling: SiblingServer = {
      clientsPresenting: () => clients,
      managedAgentsBaseUrl: () => "http://127.0.0.1:0",
      teardown: async () => {},
    };

    const { lane, close } = await newSiblingEnforcingLane({ spawnSibling: async () => sibling });
    try {
      // The lane's Managed Agents address is its sibling's.
      expect(lane.managedAgentsBaseUrl()).toBe("http://127.0.0.1:0");
      await lane.provisionMember({ org: "org_kept" });
    } finally {
      await close();
    }
    expect(revoked).toEqual([{ identityAccountId: "ida_2", org: "org_other" }]);
  });
});

describe("newPrimaryEnforcingLane", () => {
  it("moves a new member to exactly the role: the founder grants it, then revokes member, on the organization's id", async () => {
    const calls: Array<{ op: string; grant: unknown }> = [];
    const founder = {
      grantCommand: {
        create: async (grant: unknown) => {
          calls.push({ op: "create", grant });
          return {};
        },
        delete: async (grant: unknown) => {
          calls.push({ op: "delete", grant });
          return {};
        },
      },
    } as unknown as ConformanceClients;
    const member = {
      identityAccountQuery: { whoAmI: async () => ({ metadata: { id: "ida_member" } }) },
    } as unknown as ConformanceClients;
    const refuse = async (): Promise<never> => {
      throw new Error("not used by this arm");
    };
    const lane = newPrimaryEnforcingLane({
      clients: founder,
      provisionTenancy: refuse,
      cleanupTenancy: refuse,
      provisionIdentity: refuse,
      provisionMember: async () => member,
      organizationIdOf: () => "org_01acme",
      directLoginTenant: undefined,
      clientsPresenting: () => founder,
      managedAgentsBaseUrl: () => "http://127.0.0.1:0",
    });

    await expect(lane.provisionWithRole({ org: "acme" }, "admin")).resolves.toBe(member);

    expect(calls).toEqual([
      { op: "create", grant: organizationRoleGrant("org_01acme", "ida_member", "admin") },
      { op: "delete", grant: organizationRoleGrant("org_01acme", "ida_member", "member") },
    ]);
  });
});
