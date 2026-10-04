/**
 * Pins IdentityProvidersSection's edition posture and what it offers a
 * caller by the server's verdicts. Identity providers are administrative:
 * an organization's admins and each provider's creator manage them, and the
 * list holds only the providers the caller may view, so the section must
 * neither offer what the server refuses nor call an empty list "nothing
 * configured" to someone who simply may not see it.
 *
 *   - where the edition does not serve identity providers (open source)
 *     the section says so and never asks for a list;
 *   - "New identity provider" is offered only with `can_create_idp` on the
 *     organization, checked on the organization's id;
 *   - an empty list reads "No identity providers configured." to a caller
 *     who may create one, and names the organization's admins to a caller
 *     the server has refused;
 *   - a provider row offers edit only with `can_edit` and delete only with
 *     `can_delete` on that provider;
 *   - an SSO provider's sign-in link names the organization by its
 *     permanent id, never its slug: a slug can be released and taken by
 *     another organization, which would then receive every old copy.
 *
 * The data hooks and the permission check are stubbed; the panels are real.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityProviderSchema,
  type IdentityProvider,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const stubs = vi.hoisted(() => ({
  listedOrg: undefined as string | null | undefined,
  providers: [] as IdentityProvider[],
  allowed: new Set<string>(),
  checked: [] as Array<[string, string, string]>,
}));

function verdict(kind: string, id: string, relation: string): boolean {
  stubs.checked.push([kind, id, relation]);
  return stubs.allowed.has(relation);
}

vi.mock("../../organization/OrgProvider.js", () => ({
  useOrg: () => ({
    activeOrg: { metadata: { id: "org_acme", slug: "acme", name: "Acme" } },
  }),
}));
vi.mock("../../identity-provider/useIdentityProviderList.js", () => ({
  useIdentityProviderList: (org: string | null) => {
    stubs.listedOrg = org;
    return {
      identityProviders: stubs.providers,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
  },
}));
vi.mock("../../identity-provider/useDeleteIdentityProvider.js", () => ({
  useDeleteIdentityProvider: () => ({
    deleteProvider: async () => {},
    isDeleting: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../../identity-provider/useUpdateIdentityProvider.js", () => ({
  useUpdateIdentityProvider: () => ({
    update: async () => {
      throw new Error("not under test");
    },
    isUpdating: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../../iam-policy/useCheckPermission.js", () => ({
  useCheckPermission: (
    resource: { kind: string; id: string } | null,
    relation: string,
  ) => ({
    allowed: resource === null ? true : verdict(resource.kind, resource.id, relation),
    isLoading: false,
    error: null,
  }),
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
  }) => (verdict(resource.kind, resource.id, relation) ? <>{children}</> : null),
}));

import { IdentityProvidersSection } from "../IdentityProvidersSection";

const OKTA = create(IdentityProviderSchema, {
  metadata: { id: "idp_okta", name: "Acme Okta", slug: "acme-okta", org: "acme" },
  spec: { displayName: "Acme Okta" },
});

const OKTA_SSO = create(IdentityProviderSchema, {
  metadata: { id: "idp_sso", name: "Acme SSO", slug: "acme-sso", org: "org_acme" },
  spec: { displayName: "Acme SSO", isSsoProvider: true, oidcClientId: "client-1" },
});

function renderSection(mode: DeploymentMode, ssoLoginBaseUrl?: string) {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <IdentityProvidersSection ssoLoginBaseUrl={ssoLoginBaseUrl} />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  stubs.listedOrg = undefined;
  stubs.providers = [];
  stubs.allowed = new Set();
  stubs.checked = [];
});

describe("IdentityProvidersSection", () => {
  it("says identity providers are not served on the open-source edition and lists nothing", () => {
    renderSection("local");
    expect(screen.getByText(/Identity providers are not available in local mode/)).toBeTruthy();
    // The list panel is never mounted, so the list hook is never called.
    expect(stubs.listedOrg).toBeUndefined();
    expect(screen.queryByRole("button", { name: /New identity provider/ })).toBeNull();
  });

  it("offers New identity provider only with can_create_idp on the organization", () => {
    renderSection("cloud");
    expect(screen.queryByRole("button", { name: /New identity provider/ })).toBeNull();
    expect(stubs.checked).toContainEqual(["organization", "org_acme", "can_create_idp"]);

    cleanup();
    stubs.allowed = new Set(["can_create_idp"]);
    renderSection("cloud");
    expect(screen.getByRole("button", { name: /New identity provider/ })).toBeTruthy();
  });

  it("names the organization's admins, not an empty configuration, to a caller who may not create providers", () => {
    renderSection("cloud");
    expect(stubs.listedOrg).toBe("org_acme");
    expect(
      screen.getByText("Identity providers are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("No identity providers configured.")).toBeNull();

    cleanup();
    stubs.allowed = new Set(["can_create_idp"]);
    renderSection("cloud");
    expect(screen.getByText("No identity providers configured.")).toBeTruthy();
  });

  it("offers edit and delete on a provider row only with can_edit and can_delete on it", () => {
    stubs.providers = [OKTA];
    renderSection("cloud");
    expect(screen.getByText("acme-okta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Acme Okta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Acme Okta" })).toBeNull();
    expect(stubs.checked).toContainEqual(["identity_provider", "idp_okta", "can_edit"]);
    expect(stubs.checked).toContainEqual(["identity_provider", "idp_okta", "can_delete"]);

    cleanup();
    stubs.allowed = new Set(["can_edit", "can_delete"]);
    renderSection("cloud");
    expect(screen.getByRole("button", { name: "Edit Acme Okta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Acme Okta" })).toBeTruthy();
  });

  it("builds an SSO provider's sign-in link from the organization's id, not its slug", () => {
    stubs.providers = [OKTA_SSO];
    stubs.allowed = new Set(["can_edit"]);
    renderSection("cloud", "https://console.example.com");

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme SSO" }));

    expect(screen.getByText("SSO login URL")).toBeTruthy();
    expect(
      screen.getByText("https://console.example.com/login?org=org_acme"),
    ).toBeTruthy();
    expect(screen.queryByText(/login\?org=acme\b/)).toBeNull();
  });
});
