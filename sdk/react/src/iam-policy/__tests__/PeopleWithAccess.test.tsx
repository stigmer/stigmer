/**
 * Pins PeopleWithAccess's edition posture and its team rows:
 *
 *   - on the open-source edition ("local"), a resource that is not an
 *     organization is never shared with individual people (the composed
 *     grant scope grants on organizations only), so the body is one honest
 *     sentence naming the editions that do, never "0 with access" with no
 *     controls; organizations, and every resource on the other editions,
 *     render the list and its grant control;
 *   - the grant control offers teams exactly where the share flow says a
 *     team can be granted, and people only elsewhere;
 *   - a team row reads as a team, never as a person, and removing it hands
 *     the share flow the TEAM grantee, so the revoke names
 *     `team:<id>#member` rather than a person with the team's id.
 *
 * The share flow and the permission gate are stubbed: they are proven by
 * their own tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  PrincipalAccessSchema,
  type PrincipalAccess,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { teamGrantee, type DeploymentMode, type Grantee } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const share = vi.hoisted(() => ({
  accessList: [] as PrincipalAccess[],
  canShareWithTeams: false,
  revoke: vi.fn<(grantee: Grantee) => Promise<void>>(async () => {}),
}));

vi.mock("../useShareFlow.js", () => ({
  useShareFlow: () => ({
    accessList: share.accessList,
    isLoading: false,
    fetchError: null,
    revoke: share.revoke,
    isRevoking: false,
    revokeError: null,
    refetch: () => {},
    hasGrantableRoles: true,
    canShareWithTeams: share.canShareWithTeams,
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

afterEach(() => {
  cleanup();
  share.accessList = [];
  share.canShareWithTeams = false;
  share.revoke.mockClear();
});

describe("PeopleWithAccess on the open-source edition", () => {
  it("explains that an agent is not shared with individual people and offers no grant control", () => {
    renderPeople("local", "agent");
    expect(screen.getByText(/does not share agents with individual people/i)).toBeTruthy();
    expect(screen.getByText(/Stigmer Enterprise and Cloud/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add people/ })).toBeNull();
    expect(screen.queryByText(/with access/i)).toBeNull();
  });

  it("renders the list and the grant control for an organization", () => {
    renderPeople("local", "organization");
    expect(screen.getByText(/0 with access/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add people" })).toBeTruthy();
  });
});

describe("PeopleWithAccess on the editions that share per resource", () => {
  it("renders the list and a people-only grant control where no team can be granted", () => {
    renderPeople("cloud", "agent");
    expect(screen.getByText(/0 with access/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add people" })).toBeTruthy();
    expect(screen.queryByText(/individual people/i)).toBeNull();
  });

  it("offers people or teams where the share flow says a team can be granted", () => {
    share.canShareWithTeams = true;
    renderPeople("enterprise", "agent");
    expect(screen.getByRole("button", { name: "+ Add people or teams" })).toBeTruthy();
  });

  it("renders a team row as a team and removes it as the team's members", () => {
    share.accessList = [
      create(PrincipalAccessSchema, {
        principal: { kind: "team", id: "tm_sre", relation: "member", name: "Site Reliability" },
        roles: [{ role: { code: "viewer", name: "Viewer" } }],
      }),
    ];
    renderPeople("enterprise", "agent");

    expect(screen.getByText("Site Reliability")).toBeTruthy();
    expect(screen.getByText("Team")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Site Reliability's access" }));
    expect(share.revoke).toHaveBeenCalledWith(teamGrantee("tm_sre"));
  });

  it("offers no remove control on a row it cannot name as a grantee", () => {
    share.accessList = [
      create(PrincipalAccessSchema, {
        // A team row from a server that drops the qualifier: removing it
        // would revoke nothing, so the row offers no control.
        principal: { kind: "team", id: "tm_sre", relation: "", name: "Site Reliability" },
        roles: [{ role: { code: "viewer", name: "Viewer" } }],
      }),
    ];
    renderPeople("enterprise", "agent");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
