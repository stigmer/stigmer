/**
 * Pins ServiceAccountsSection's two gates.
 *
 * The caller gate: managing service accounts needs
 * `can_create_identity_account` on the organization, checked on the active
 * organization's id. A caller who holds it gets the list and the create
 * button; a caller the server refuses is told the organization's admins
 * manage them and the list (which the server would refuse) is never mounted;
 * while the check is in flight neither shows.
 *
 * The posture gate: a server that trusts every request checks no API keys,
 * so the section explains that and offers no create; a server too old to say
 * is offered the button; while the server's answer loads no button shows.
 *
 * The panels are proven by their own tests and stubbed here; the permission
 * check and the server's answer are stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseServerInfoReturn } from "../../server-info";

let serverInfo: UseServerInfoReturn;

const permission = vi.hoisted(() => ({
  allowed: true,
  isLoading: false,
  checked: [] as Array<[string, string, string]>,
}));

vi.mock("../../server-info.js", () => ({
  useServerInfo: () => serverInfo,
}));
vi.mock("../../organization/OrgProvider.js", () => ({
  useActiveOrgId: () => "org_acme",
}));
vi.mock("../../iam-policy/useCheckPermission.js", () => ({
  useCheckPermission: (resource: { kind: string; id: string } | null, relation: string) => {
    if (resource !== null) permission.checked.push([resource.kind, resource.id, relation]);
    return { allowed: permission.allowed, isLoading: permission.isLoading, error: null };
  },
}));
vi.mock("../../service-account/ServiceAccountListPanel.js", () => ({
  ServiceAccountListPanel: ({ org }: { org: string }) => (
    <div data-testid="list-panel">service accounts of {org}</div>
  ),
}));
vi.mock("../../service-account/CreateServiceAccountForm.js", () => ({
  CreateServiceAccountForm: ({ org }: { org: string }) => (
    <div data-testid="create-form">create in {org}</div>
  ),
}));

import { ServiceAccountsSection } from "../ServiceAccountsSection";

function answering(authenticationRequired: boolean | undefined): UseServerInfoReturn {
  return {
    serverInfo: {
      deploymentMode: "local",
      edition: 1,
      version: "dev",
      authenticationRequired,
      singleOrg: undefined,
    },
    isLoading: false,
    error: null,
  };
}

const NEW_BUTTON = { name: /new service account/i };

afterEach(() => {
  cleanup();
  permission.allowed = true;
  permission.isLoading = false;
  permission.checked = [];
});

describe("ServiceAccountsSection's caller gate", () => {
  it("checks can_create_identity_account on the active organization's id", () => {
    serverInfo = answering(true);
    render(<ServiceAccountsSection />);
    expect(permission.checked).toContainEqual([
      "organization",
      "org_acme",
      "can_create_identity_account",
    ]);
  });

  it("gives an admin the list and the create flow", () => {
    serverInfo = answering(true);
    render(<ServiceAccountsSection />);
    expect(screen.getByTestId("list-panel").textContent).toContain("org_acme");
    fireEvent.click(screen.getByRole("button", NEW_BUTTON));
    expect(screen.getByTestId("create-form").textContent).toContain("org_acme");
  });

  it("tells a caller the server refuses who manages service accounts, and never mounts the list", () => {
    serverInfo = answering(true);
    permission.allowed = false;
    render(<ServiceAccountsSection />);
    expect(screen.getByText("Your organization's admins manage its service accounts.")).toBeTruthy();
    expect(screen.queryByTestId("list-panel")).toBeNull();
    expect(screen.queryByRole("button", NEW_BUTTON)).toBeNull();
  });

  it("shows neither while the check is in flight", () => {
    serverInfo = answering(true);
    permission.isLoading = true;
    permission.allowed = false;
    render(<ServiceAccountsSection />);
    expect(screen.queryByTestId("list-panel")).toBeNull();
    expect(screen.queryByText(/admins manage/)).toBeNull();
    expect(screen.queryByRole("button", NEW_BUTTON)).toBeNull();
  });
});

describe("ServiceAccountsSection's posture gate", () => {
  it("explains why and offers no create on a server that trusts every request", () => {
    serverInfo = answering(false);
    render(<ServiceAccountsSection />);
    expect(screen.getByText(/trusts every request/i)).toBeTruthy();
    expect(screen.getByText("STIGMER_OIDC_ISSUER")).toBeTruthy();
    expect(screen.queryByRole("button", NEW_BUTTON)).toBeNull();
    expect(screen.getByTestId("list-panel")).toBeTruthy();
  });

  it("offers the create button on a server too old to report its posture", () => {
    serverInfo = answering(undefined);
    render(<ServiceAccountsSection />);
    expect(screen.getByRole("button", NEW_BUTTON)).toBeTruthy();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
  });

  it("offers no create button while the server's answer loads", () => {
    serverInfo = { serverInfo: null, isLoading: true, error: null };
    render(<ServiceAccountsSection />);
    expect(screen.queryByRole("button", NEW_BUTTON)).toBeNull();
  });
});
