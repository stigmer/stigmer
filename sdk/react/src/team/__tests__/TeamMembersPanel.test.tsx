/**
 * TeamMembersPanel offers people from the team's organization: its person
 * picker is given the organization as `org`, and leaves out the accounts an
 * integrator's product created for its own users (`includeAppUsers` false)
 * and the organization's service accounts (`includeServiceAccounts` false),
 * because a team is a group of the organization's people.
 * The share flow, the permission gate and the picker are stubbed.
 */
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const picked = vi.hoisted(
  () =>
    [] as {
      org: string;
      includeAppUsers: boolean | undefined;
      includeServiceAccounts: boolean | undefined;
    }[],
);

vi.mock("../../iam-policy/useShareFlow.js", () => ({
  useShareFlow: () => ({
    accessList: [],
    isLoading: false,
    fetchError: null,
    grant: async () => {},
    isGranting: false,
    grantError: null,
    revoke: async () => {},
    isRevoking: false,
    revokeError: null,
  }),
}));

vi.mock("../../iam-policy/PermissionGate.js", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../iam-policy/PrincipalPicker.js", () => ({
  PrincipalPicker: ({
    org,
    includeAppUsers,
    includeServiceAccounts,
  }: {
    org: string;
    includeAppUsers?: boolean;
    includeServiceAccounts?: boolean;
  }) => {
    picked.push({ org, includeAppUsers, includeServiceAccounts });
    return null;
  },
}));

import { TeamMembersPanel } from "../TeamMembersPanel";

afterEach(() => {
  cleanup();
  picked.length = 0;
});

describe("TeamMembersPanel", () => {
  it("offers people from the team's organization", () => {
    render(<TeamMembersPanel teamId="team_1" org="acme" />);
    expect(picked.map((p) => p.org)).toContain("acme");
  });

  it("leaves a product's users out of a team's picker", () => {
    render(<TeamMembersPanel teamId="team_1" org="acme" />);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((p) => p.includeAppUsers === false)).toBe(true);
  });

  it("leaves the organization's service accounts out of a team's picker", () => {
    render(<TeamMembersPanel teamId="team_1" org="acme" />);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((p) => p.includeServiceAccounts === false)).toBe(true);
  });
});
