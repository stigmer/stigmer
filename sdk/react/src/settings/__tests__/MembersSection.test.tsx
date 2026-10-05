/**
 * Pins MembersSection's edition posture:
 * the Members page renders the members panel in EVERY edition —
 * `iam_policy` is an open-source kind since the row half moved into
 * @stigmer/server — and says how people join on an edition that serves
 * no invitations. The cloud (invitations served) shows no such sentence.
 * The panel itself is proven by its own tests; it is stubbed here.
 *
 * Also pins the sign-in notice: it says people appear here on their first
 * sign-in only when a provider grants a sign-in role (an SSO provider
 * always does); a provider that creates accounts without a role adds no
 * one to the organization, so it shows no notice.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityProviderSchema,
  type IdentityProvider,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: { metadata: { id: "org_acme", slug: "acme", name: "Acme" } },
  }),
}));
const providers = vi.hoisted(() => ({ list: [] as IdentityProvider[] }));

vi.mock("../../identity-provider/useIdentityProviderList.js", () => ({
  useIdentityProviderList: () => ({ identityProviders: providers.list }),
}));
vi.mock("../../iam-policy/OrgMembersPanel.js", () => ({
  OrgMembersPanel: ({ org }: { org: string }) => (
    <div data-testid="members-panel">panel for {org}</div>
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

afterEach(() => {
  cleanup();
  providers.list = [];
});

const SIGN_IN_NOTICE = /People appear here the first time they sign in/;

function provider(spec: {
  isSsoProvider?: boolean;
  createAccountsOnSignIn?: boolean;
  signInRole?: IamRole;
}): IdentityProvider {
  return create(IdentityProviderSchema, {
    metadata: { id: "idp-1", name: "Acme", org: "org_acme" },
    spec,
  });
}

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

describe("MembersSection sign-in notice", () => {
  it("shows the notice when a provider grants a sign-in role", () => {
    providers.list = [
      provider({ createAccountsOnSignIn: true, signInRole: IamRole.member }),
    ];
    renderSection("cloud");
    expect(screen.getByText(SIGN_IN_NOTICE)).toBeTruthy();
  });

  it("shows the notice for an SSO provider", () => {
    providers.list = [provider({ isSsoProvider: true })];
    renderSection("cloud");
    expect(screen.getByText(SIGN_IN_NOTICE)).toBeTruthy();
  });

  it("shows no notice for a provider that creates accounts without a role", () => {
    providers.list = [provider({ createAccountsOnSignIn: true })];
    renderSection("cloud");
    expect(screen.queryByText(SIGN_IN_NOTICE)).toBeNull();
  });
});
