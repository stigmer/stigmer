/**
 * Pins MembersSection's edition posture (20260913.01 slice 5, Q-S5-6):
 * the Members page renders the members panel in EVERY edition —
 * `iam_policy` is an open-source kind since the row half moved into
 * @stigmer/server — and says how people join on an edition that serves
 * no invitations. The cloud (invitations served) shows no such sentence.
 * The panel itself is proven by its own tests; it is stubbed here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: { metadata: { id: "org_acme", slug: "acme", name: "Acme" } },
  }),
}));
vi.mock("../../identity-provider/useIdentityProviderList.js", () => ({
  useIdentityProviderList: () => ({ identityProviders: [] }),
}));
vi.mock("../../iam-policy/OrgMembersPanel.js", () => ({
  OrgMembersPanel: ({ orgId }: { orgId: string }) => (
    <div data-testid="members-panel">panel for {orgId}</div>
  ),
}));

import { MembersSection } from "../MembersSection";

function renderSection(mode: DeploymentMode) {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <MembersSection />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(cleanup);

describe("MembersSection across editions", () => {
  it("renders the members panel on the open-source edition — no cloud notice", () => {
    renderSection("local");
    expect(screen.getByTestId("members-panel").textContent).toContain("org_acme");
    expect(screen.queryByText(/not available in local mode/i)).toBeNull();
    expect(screen.queryByText(/require Stigmer Cloud/i)).toBeNull();
  });

  it("says how people join where the edition serves no invitations", () => {
    renderSection("local");
    expect(
      screen.getByText(/people join this organization the first time they sign in/i),
    ).toBeTruthy();
  });

  it("renders the panel and no join sentence on the cloud, where invitations are the door", () => {
    renderSection("cloud");
    expect(screen.getByTestId("members-panel")).toBeTruthy();
    expect(screen.queryByText(/the first time they sign in/i)).toBeNull();
  });
});
