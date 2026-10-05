/**
 * Pins the permission the visibility control asks before it offers the
 * interactive selector: `can_manage_audience` on the resource, the same bar
 * the server's `updateVisibility` annotations carry. Visibility decides who
 * reaches a resource, so it is the owner's; an editor, who holds `can_edit`
 * and not `can_manage_audience`, gets the read-only badge. Never
 * `can_grant_access`: the self-check answers that false on every kind the
 * edition grants no roles on, which would hide the selector from the owner
 * on open source (stigmer#1495).
 *
 * The gate itself is PermissionGate's to test; here it is stubbed to record
 * the relation it was asked for and render both its fallback and its
 * children, so the assertions are about which question the control asks,
 * per kind, and which levels it offers.
 *
 * It also pins the gate on the child-organizations level: offered for a
 * blueprint only when the server holds more than one organization and the
 * owning organization is not itself a child.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ResourceVisibilityControl } from "../ResourceVisibilityControl";
import type { VisibilityLevelOption } from "../visibilityLevels";
import type { VisibilityResourceKind } from "../useUpdateVisibility";

vi.mock("../../iam-policy/PermissionGate", () => ({
  PermissionGate: ({
    relation,
    resource,
    fallback,
    children,
  }: {
    relation: string;
    resource: { kind: string; id: string };
    fallback?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="gate" data-relation={relation} data-kind={resource.kind}>
      {fallback}
      {children}
    </div>
  ),
}));

vi.mock("../VisibilitySelector", () => ({
  VisibilityBadge: () => <span data-testid="badge" />,
  VisibilitySelector: ({
    options,
  }: {
    options: readonly VisibilityLevelOption[];
  }) => (
    <ul data-testid="levels">
      {options.map((option) => (
        <li key={option.value}>{option.label}</li>
      ))}
    </ul>
  ),
}));

const state: {
  singleOrg: boolean | undefined;
  owner: Organization | null;
  ownerLookups: Array<string | null>;
} = { singleOrg: false, owner: null, ownerLookups: [] };

vi.mock("../../server-info", () => ({
  useSingleOrg: () => state.singleOrg,
}));

vi.mock("../../organization/useOrganization", () => ({
  useOrganization: (id: string | null) => {
    state.ownerLookups.push(id);
    return { organization: id === null ? null : state.owner };
  },
}));

function organization(parentOrg: string): Organization {
  return { spec: { parentOrg } } as unknown as Organization;
}

vi.mock("../useUpdateVisibility", () => ({
  useUpdateVisibility: () => ({ updateVisibility: vi.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
  state.singleOrg = false;
  state.owner = null;
  state.ownerLookups = [];
});

const KINDS: ReadonlyArray<[VisibilityResourceKind, string]> = [
  ["agent", "agent"],
  ["workflow", "workflow"],
  ["mcpServer", "mcp_server"],
  ["skill", "skill"],
  ["plugin", "plugin"],
  ["workflowInstance", "workflow_instance"],
];

describe("ResourceVisibilityControl", () => {
  it.each(KINDS)(
    "asks can_manage_audience on %s before offering the selector, never can_edit or can_grant_access",
    (kind, fgaKind) => {
      render(
        <ResourceVisibilityControl
          kind={kind}
          resourceId="res_1"
          visibility={ApiResourceVisibility.visibility_private}
          org="acme"
        />,
      );
      const gate = screen.getByTestId("gate");
      expect(gate.getAttribute("data-relation")).toBe("can_manage_audience");
      expect(gate.getAttribute("data-kind")).toBe(fgaKind);
    },
  );
});

describe("ResourceVisibilityControl's child-organizations level", () => {
  function offered(kind: VisibilityResourceKind = "agent"): string[] {
    render(
      <ResourceVisibilityControl
        kind={kind}
        resourceId="res_1"
        visibility={ApiResourceVisibility.visibility_org}
        org="org_parent"
      />,
    );
    return Array.from(
      screen.getByTestId("levels").querySelectorAll("li"),
      (item) => item.textContent ?? "",
    );
  }

  it("is offered on a blueprint whose organization is not a child, on a server of many organizations", () => {
    state.owner = organization("");
    expect(offered()).toEqual(["Private", "Organization", "Child organizations"]);
    expect(state.ownerLookups).toContain("org_parent");
  });

  it("is not offered when the owning organization is itself a child", () => {
    state.owner = organization("org_planton");
    expect(offered()).toEqual(["Private", "Organization"]);
  });

  it("is not offered on a single-organization server, which never reads the organization", () => {
    state.singleOrg = true;
    state.owner = organization("");
    expect(offered()).toEqual(["Private", "Organization"]);
    expect(state.ownerLookups.every((id) => id === null)).toBe(true);
  });

  it("is not offered while the owning organization is unknown", () => {
    state.owner = null;
    expect(offered()).toEqual(["Private", "Organization"]);
  });

  it("is never offered on an instance", () => {
    state.owner = organization("");
    expect(offered("workflowInstance")).toEqual(["Private", "Organization"]);
  });
});
