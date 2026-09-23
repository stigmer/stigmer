/**
 * Pins TeamsSection's edition posture and its create gate:
 *
 *   - where the edition does not serve teams (open source) the section
 *     says so and never asks the server for a team list it would answer
 *     UNIMPLEMENTED;
 *   - on Enterprise and Cloud it lists the organization's teams;
 *   - "New team" is offered only to a caller who holds `can_create_team`
 *     on the organization, checked on the organization's id.
 *
 * The data hook and the permission gate are stubbed; the panels are real.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { TeamSchema, type Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const stubs = vi.hoisted(() => ({
  listedOrg: undefined as string | null | undefined,
  teams: [] as Team[],
  allowed: new Set<string>(),
  checked: [] as Array<[string, string, string]>,
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: { metadata: { id: "org_acme", slug: "acme", name: "Acme" } },
  }),
}));
vi.mock("../../team/useTeamList.js", () => ({
  useTeamList: (org: string | null) => {
    stubs.listedOrg = org;
    return { teams: stubs.teams, isLoading: false, isRefetching: false, error: null, refetch: () => {} };
  },
}));
vi.mock("../../iam-policy/PermissionGate.js", () => ({
  PermissionGate: ({
    resource,
    relation,
    children,
  }: {
    resource: { kind: string; id: string };
    relation: string;
    children: React.ReactNode;
  }) => {
    stubs.checked.push([resource.kind, resource.id, relation]);
    return stubs.allowed.has(relation) ? <>{children}</> : null;
  },
}));

import { TeamsSection } from "../TeamsSection";

function renderSection(mode: DeploymentMode) {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <TeamsSection />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  stubs.listedOrg = undefined;
  stubs.teams = [];
  stubs.allowed = new Set();
  stubs.checked = [];
});

describe("TeamsSection", () => {
  it("says teams are not served on the open-source edition and lists nothing", () => {
    renderSection("local");
    expect(screen.getByText(/Teams are available in Stigmer Enterprise and Cloud/)).toBeTruthy();
    expect(stubs.listedOrg).toBeNull();
    expect(screen.queryByRole("button", { name: /New team/ })).toBeNull();
  });

  it("lists the organization's teams on the editions that serve them", () => {
    stubs.teams = [
      create(TeamSchema, {
        metadata: { id: "tm_sre", name: "Site Reliability" },
        spec: { description: "On call" },
      }),
    ];
    renderSection("enterprise");
    expect(stubs.listedOrg).toBe("acme");
    expect(screen.getByRole("button", { name: /Site Reliability/ })).toBeTruthy();
    expect(screen.queryByText(/available in Stigmer Enterprise and Cloud/)).toBeNull();
  });

  it("offers New team only with can_create_team on the organization", () => {
    renderSection("cloud");
    expect(screen.queryByRole("button", { name: /New team/ })).toBeNull();
    expect(stubs.checked).toContainEqual(["organization", "org_acme", "can_create_team"]);

    cleanup();
    stubs.allowed = new Set(["can_create_team"]);
    renderSection("cloud");
    expect(screen.getByRole("button", { name: /New team/ })).toBeTruthy();
  });
});
