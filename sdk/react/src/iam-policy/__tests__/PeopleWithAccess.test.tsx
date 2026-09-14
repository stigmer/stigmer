/**
 * Pins PeopleWithAccess's edition posture (20260913.01 slice 5, Q-S5-6):
 * on the open-source edition ("local"), a resource that is not an
 * organization is never shared with individual people — the composed
 * grant scope grants on organizations only — so the body is one honest
 * sentence naming the editions that do, never "0 people with access" with
 * no controls. Organizations, and every resource on the other editions,
 * render the list and its grant controls as before. The share flow and the
 * permission gate are stubbed: they are proven by their own tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

vi.mock("../useShareFlow.js", () => ({
  useShareFlow: () => ({
    accessList: [],
    isLoading: false,
    fetchError: null,
    revokeAccess: async () => {},
    isRevoking: false,
    revokeError: null,
    refetch: () => {},
    hasGrantableRoles: true,
  }),
}));
vi.mock("../PermissionGate.js", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { PeopleWithAccess } from "../PeopleWithAccess";

function renderPeople(mode: DeploymentMode, kind: "agent" | "organization") {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <PeopleWithAccess
        resource={{ kind, id: "x1" }}
        resourceKindString={kind}
        resourceKind={kind === "agent" ? ApiResourceKind.agent : ApiResourceKind.organization}
        orgId="acme"
      />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(cleanup);

describe("PeopleWithAccess on the open-source edition", () => {
  it("explains that an agent is not shared with individual people and offers no grant control", () => {
    renderPeople("local", "agent");
    expect(screen.getByText(/does not share agents with individual people/i)).toBeTruthy();
    expect(screen.getByText(/Stigmer Enterprise and Cloud/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add people/ })).toBeNull();
    expect(screen.queryByText(/people with access/i)).toBeNull();
  });

  it("renders the list and the grant control for an organization", () => {
    renderPeople("local", "organization");
    expect(screen.getByText(/0 people with access/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add people/ })).toBeTruthy();
  });
});

describe("PeopleWithAccess on the editions that share per resource", () => {
  it("renders the list and the grant control for an agent", () => {
    renderPeople("cloud", "agent");
    expect(screen.getByText(/0 people with access/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add people/ })).toBeTruthy();
    expect(screen.queryByText(/individual people/i)).toBeNull();
  });
});
