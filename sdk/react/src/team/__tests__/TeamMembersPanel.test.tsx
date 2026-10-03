/**
 * TeamMembersPanel offers people from the team's organization: its person
 * picker is given the organization as `org`. The share flow, the permission
 * gate and the picker are stubbed.
 */
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const picked = vi.hoisted(() => [] as unknown[]);

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
  PrincipalPicker: ({ org }: { org: string }) => {
    picked.push(org);
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
    expect(picked).toContain("acme");
  });
});
