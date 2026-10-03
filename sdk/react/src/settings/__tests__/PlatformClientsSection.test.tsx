/**
 * Pins PlatformClientsSection's posture gate: every edition serves platform
 * clients, but only a server that authenticates its callers mints their
 * tokens. On such a server the section offers the create button and no
 * notice; on a server that says it trusts every request it explains why no
 * client can be created there and offers no create button; on a server too
 * old to report its posture it offers the button and no notice, because a
 * console that ships ahead of its server must not claim a limitation the
 * server never reported; while the server's answer is still loading it
 * offers neither, so no button flashes and disappears.
 *
 * And its caller gate (stigmer/stigmer#1302): the button also needs
 * `can_create_platform_client` on the organization, checked on the
 * organization's id and never offered while the check is in flight; a
 * caller the server refuses is told the organization's admins manage
 * platform clients, in place of the list's own empty state. The list panel
 * is proven by its own tests and stubbed here; the permission check is
 * stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  useActiveOrgSlug: () => "acme",
  useActiveOrgId: () => "org_acme",
}));
vi.mock("../../iam-policy/useCheckPermission.js", () => ({
  useCheckPermission: (
    resource: { kind: string; id: string } | null,
    relation: string,
  ) => {
    if (resource !== null) {
      permission.checked.push([resource.kind, resource.id, relation]);
    }
    return {
      allowed: permission.allowed,
      isLoading: permission.isLoading,
      error: null,
    };
  },
}));
vi.mock("../../platform-client/PlatformClientListPanel.js", () => ({
  PlatformClientListPanel: ({
    org,
    emptyState,
  }: {
    org: string;
    emptyState?: string;
  }) => (
    <div data-testid="list-panel">
      clients of {org}
      {emptyState !== undefined && <p data-testid="empty-state">{emptyState}</p>}
    </div>
  ),
}));

import { PlatformClientsSection } from "../PlatformClientsSection";

/** A server that has answered; `undefined` is a server that predates the posture field. */
function answering(
  authenticationRequired: boolean | undefined,
): UseServerInfoReturn {
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

const LOADING: UseServerInfoReturn = {
  serverInfo: null,
  isLoading: true,
  error: null,
};

afterEach(() => {
  cleanup();
  permission.allowed = true;
  permission.isLoading = false;
  permission.checked = [];
});

describe("PlatformClientsSection's posture gate", () => {
  it("offers the create button and no notice on a server that authenticates its callers", () => {
    serverInfo = answering(true);
    render(<PlatformClientsSection />);
    expect(
      screen.getByRole("button", { name: /new platform client/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
    expect(screen.getByTestId("list-panel").textContent).toContain("acme");
  });

  it("explains the missing identity provider and offers no create button on a server that trusts every request", () => {
    serverInfo = answering(false);
    render(<PlatformClientsSection />);
    expect(screen.getByText(/trusts every request/i)).toBeTruthy();
    expect(screen.getByText("STIGMER_OIDC_ISSUER")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(
      screen.getByTestId("list-panel"),
      "existing clients stay listed",
    ).toBeTruthy();
  });

  it("offers the create button and no notice on a server too old to report its posture", () => {
    serverInfo = answering(undefined);
    render(<PlatformClientsSection />);
    expect(
      screen.getByRole("button", { name: /new platform client/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
  });

  it("offers neither while the server's answer is loading", () => {
    serverInfo = LOADING;
    render(<PlatformClientsSection />);
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
  });
});

describe("PlatformClientsSection's caller gate", () => {
  it("checks can_create_platform_client on the active organization's id", () => {
    serverInfo = answering(true);
    render(<PlatformClientsSection />);
    expect(permission.checked).toContainEqual([
      "organization",
      "org_acme",
      "can_create_platform_client",
    ]);
  });

  it("offers the create button to a caller who may create, and keeps the list's own empty state", () => {
    serverInfo = answering(true);
    render(<PlatformClientsSection />);
    expect(
      screen.getByRole("button", { name: /new platform client/i }),
    ).toBeTruthy();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("offers no create button to a caller the server refuses, and says who manages platform clients", () => {
    serverInfo = answering(true);
    permission.allowed = false;
    render(<PlatformClientsSection />);
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(screen.getByTestId("empty-state").textContent).toBe(
      "Platform clients are managed by your organization's admins.",
    );
  });

  it("offers nothing and claims nothing while the check is in flight", () => {
    serverInfo = answering(true);
    permission.isLoading = true;
    permission.allowed = false;
    render(<PlatformClientsSection />);
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});
