/**
 * TeamMembersPanel offers people from the team's organization: its person
 * picker is given the organization as `org`, and leaves out the accounts an
 * integrator's product created for its own users (`includeAppUsers` false)
 * and the organization's service accounts (`includeServiceAccounts` false),
 * because a team is a group of the organization's people. As a team's
 * section it says how many people are in the team and draws each one's
 * name as the kit's list row does (14/20, medium).
 * The share flow, the permission gate and the picker are stubbed.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const flow = vi.hoisted(() => ({ accessList: [] as unknown[] }));

vi.mock("../../grant/useShareFlow.js", () => ({
  useShareFlow: () => ({
    accessList: flow.accessList,
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

vi.mock("../../grant/PermissionGate.js", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../grant/PrincipalPicker.js", () => ({
  PrincipalPicker: ({
    org,
    includeAppUsers,
    includeServiceAccounts,
    onChange,
  }: {
    org: string;
    includeAppUsers?: boolean;
    includeServiceAccounts?: boolean;
    onChange?: (selected: unknown) => void;
  }) => {
    picked.push({ org, includeAppUsers, includeServiceAccounts });
    // A stand-in pick, so a test can add someone.
    return (
      <button type="button" onClick={() => onChange?.({ grantee: { kind: "identity_account", id: "ida_grace" } })}>
        Pick Grace
      </button>
    );
  },
}));

import { TeamMembersPanel } from "../TeamMembersPanel";

afterEach(() => {
  cleanup();
  picked.length = 0;
  flow.accessList = [];
});

function person(id: string, name: string) {
  return { principal: { kind: "identity_account", id, name, email: `${id}@acme.test`, relation: "" }, roles: [] };
}

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

  it("as a team's section, waits for Add a person before it shows the picker", () => {
    render(<TeamMembersPanel teamId="team_1" org="acme" asSection />);
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(picked).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    expect(picked.map((p) => p.org)).toContain("acme");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add a person" })).toBeTruthy();
  });

  it("as a team's section, closes the picker once someone is added", async () => {
    render(<TeamMembersPanel teamId="team_1" org="acme" asSection />);
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick Grace" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    });
    expect(screen.getByRole("button", { name: "Add a person" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pick Grace" })).toBeNull();
  });

  it("as a team's section, says how many people are in it and draws each name as a list row's name", () => {
    flow.accessList = [person("ida_ada", "Ada Lovelace"), person("ida_alan", "Alan Turing")];
    render(<TeamMembersPanel teamId="team_1" org="acme" asSection />);
    const section = screen.getByRole("heading", { name: /Members/ }).closest("section");
    expect(section?.textContent).toMatch(/Members\s*2/);
    const name = screen.getByText("Ada Lovelace");
    expect(name.className).toContain("stg:text-sm");
    expect(name.className).toContain("stg:font-medium");
    expect(name.className).not.toContain("stg:text-xs");
  });
});
