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
 * The flow between the panels: opening an account shows its detail panel,
 * a rename keeps it open under its new name, and going back or deleting it
 * returns to the list and re-reads it; a create re-reads the list as soon as
 * the account exists, and its end (or a cancel) returns to the list.
 *
 * The panels are proven by their own tests and stubbed here, each exposing
 * its callbacks as buttons; the permission check and the server's answer are
 * stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UseServerInfoReturn } from "../../server-info";

let serverInfo: UseServerInfoReturn;

// How many times the section asked the list to re-read itself.
const list = vi.hoisted(() => ({ refetches: 0 }));

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
  ServiceAccountListPanel: ({
    org,
    onOpen,
    onRefetchRef,
  }: {
    org: string;
    onOpen?: (account: { metadata: { id: string; name: string } }) => void;
    onRefetchRef?: (refetch: () => void) => void;
  }) => {
    onRefetchRef?.(() => {
      list.refetches++;
    });
    return (
      <div data-testid="list-panel">
        service accounts of {org}
        {onOpen && (
          <button type="button" onClick={() => onOpen({ metadata: { id: "ida_sa_ci", name: "ci-deploy" } })}>
            open ci-deploy
          </button>
        )}
      </div>
    );
  },
}));
vi.mock("../../service-account/CreateServiceAccountForm.js", () => ({
  CreateServiceAccountForm: ({
    org,
    onCreated,
    onDone,
    onCancel,
  }: {
    org: string;
    onCreated?: () => void;
    onDone?: () => void;
    onCancel?: () => void;
  }) => (
    <div data-testid="create-form">
      create in {org}
      <button type="button" onClick={onCreated}>account created</button>
      <button type="button" onClick={onDone}>flow done</button>
      <button type="button" onClick={onCancel}>cancel create</button>
    </div>
  ),
}));
vi.mock("../../service-account/ServiceAccountDetailPanel.js", () => ({
  ServiceAccountDetailPanel: ({
    serviceAccount,
    onUpdated,
    onDeleted,
    onBack,
  }: {
    serviceAccount: { metadata?: { id?: string; name?: string } };
    onUpdated?: (account: { metadata: { id: string; name: string } }) => void;
    onDeleted?: () => void;
    onBack?: () => void;
  }) => (
    <div data-testid="detail-panel">
      managing {serviceAccount.metadata?.name}
      <button type="button" onClick={() => onUpdated?.({ metadata: { id: "ida_sa_ci", name: "ci-release" } })}>
        renamed
      </button>
      <button type="button" onClick={onDeleted}>deleted</button>
      <button type="button" onClick={onBack}>back</button>
    </div>
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
  list.refetches = 0;
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

describe("ServiceAccountsSection's flow", () => {
  it("opens an account, keeps it open under a new name, and returns to a re-read list on back", () => {
    serverInfo = answering(true);
    render(<ServiceAccountsSection />);
    fireEvent.click(screen.getByRole("button", { name: "open ci-deploy" }));
    expect(screen.getByTestId("detail-panel").textContent).toContain("managing ci-deploy");
    expect(screen.queryByRole("button", NEW_BUTTON)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "renamed" }));
    expect(screen.getByTestId("detail-panel").textContent).toContain("managing ci-release");

    const before = list.refetches;
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("list-panel")).toBeTruthy();
    expect(list.refetches).toBe(before + 1);
  });

  it("returns to a re-read list once an account is deleted", () => {
    serverInfo = answering(true);
    render(<ServiceAccountsSection />);
    fireEvent.click(screen.getByRole("button", { name: "open ci-deploy" }));
    const before = list.refetches;
    fireEvent.click(screen.getByRole("button", { name: "deleted" }));
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    expect(list.refetches).toBe(before + 1);
  });

  it("re-reads the list as soon as an account is created, and returns to it when the flow ends or is cancelled", () => {
    serverInfo = answering(true);
    render(<ServiceAccountsSection />);
    fireEvent.click(screen.getByRole("button", NEW_BUTTON));
    fireEvent.click(screen.getByRole("button", { name: "account created" }));
    expect(list.refetches).toBe(1);
    expect(screen.getByTestId("create-form")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "flow done" }));
    expect(screen.queryByTestId("create-form")).toBeNull();
    expect(list.refetches).toBe(2);

    fireEvent.click(screen.getByRole("button", NEW_BUTTON));
    fireEvent.click(screen.getByRole("button", { name: "cancel create" }));
    expect(screen.queryByTestId("create-form")).toBeNull();
  });
});
