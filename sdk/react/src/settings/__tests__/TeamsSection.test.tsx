/**
 * Pins TeamsSection's edition posture and its create gate:
 *
 *   - where the edition does not serve teams (open source) the section
 *     says so and never asks the server for a team list it would answer
 *     UNIMPLEMENTED;
 *   - on Enterprise and Cloud it lists the organization's teams;
 *   - "New team" is offered only to a caller who holds `can_create_team`
 *     on the organization, checked on the organization's id;
 *   - on Cloud, an organization whose plan lacks teams sees the upgrade
 *     notice in place of "New team", naming the cheapest plan that
 *     includes them; Enterprise never reads a plan or the catalog.
 *
 * The data hooks and the permission gate are stubbed; the panels are real.
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
  planAllowsTeams: null as boolean | null,
  entitlementsRead: [] as Array<{ orgId: string | null; enabled: boolean | undefined }>,
  catalogReads: [] as Array<boolean | undefined>,
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
vi.mock("../../billing/useEntitlements.js", () => ({
  useEntitlements: (orgId: string | null, options?: { enabled?: boolean }) => {
    stubs.entitlementsRead.push({ orgId, enabled: options?.enabled });
    return {
      entitlements: null,
      allows: () => (options?.enabled === false ? null : stubs.planAllowsTeams),
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));
vi.mock("../../billing/usePlans.js", async () => {
  const { BUSINESS, TEAM } = await import("../../billing/__tests__/fixtures");
  return {
    usePlans: (options?: { enabled?: boolean }) => {
      stubs.catalogReads.push(options?.enabled);
      const plans = options?.enabled === false ? null : [BUSINESS, TEAM];
      return { plans, isLoading: false, isRefetching: false, error: null, refetch: () => {} };
    },
  };
});
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
  stubs.planAllowsTeams = null;
  stubs.entitlementsRead = [];
  stubs.catalogReads = [];
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

  it("on Cloud, shows the upgrade notice in place of New team when the plan lacks teams", () => {
    stubs.allowed = new Set(["can_create_team"]);
    stubs.planAllowsTeams = false;
    renderSection("cloud");
    expect(screen.getByText("Teams need the Team plan or above.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New team/ })).toBeNull();
    expect(stubs.entitlementsRead).toContainEqual({ orgId: "org_acme", enabled: true });
  });

  it("never reads a plan on Enterprise, where every organization has teams", () => {
    stubs.allowed = new Set(["can_create_team"]);
    stubs.planAllowsTeams = false;
    renderSection("enterprise");
    expect(screen.getByRole("button", { name: /New team/ })).toBeTruthy();
    expect(stubs.entitlementsRead.every((read) => read.enabled === false)).toBe(true);
    expect(stubs.catalogReads.every((enabled) => enabled === false)).toBe(true);
  });
});
