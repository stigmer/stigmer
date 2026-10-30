/**
 * Pins FederationIssuersSection's edition posture and what it offers a
 * caller by the server's verdicts. Federation issuers are administrative:
 * an organization's admins and each provider's creator manage them, and the
 * list holds only the providers the caller may view, so the section must
 * neither offer what the server refuses nor call an empty list "nothing
 * configured" to someone who simply may not see it.
 *
 *   - where the edition does not serve federation issuers (open source)
 *     the section says so and never asks for a list;
 *   - "New federation issuer" is offered only with `can_create_federation_issuer` on the
 *     organization, checked on the organization's id;
 *   - an empty list reads "No federation issuers configured." to a caller
 *     who may create one, and names the organization's admins to a caller
 *     the server has refused;
 *   - a provider row offers edit only with `can_edit` and delete only with
 *     `can_delete` on that provider, and its Edit opens that issuer's
 *     detail in place of the list.
 *
 * The data hooks and the permission check are stubbed; the panels are real.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import type { DeploymentMode } from "@stigmer/client";
import { DeploymentModeContext } from "@stigmer/react-core";

const stubs = vi.hoisted(() => ({
  listedOrg: undefined as string | null | undefined,
  providers: [] as FederationIssuer[],
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
vi.mock("../../federation-issuer/useFederationIssuerList.js", () => ({
  useFederationIssuerList: (org: string | null) => {
    stubs.listedOrg = org;
    return {
      federationIssuers: stubs.providers,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
  },
}));
vi.mock("../../federation-issuer/useDeleteFederationIssuer.js", () => ({
  useDeleteFederationIssuer: () => ({
    deleteProvider: async () => {},
    isDeleting: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../../federation-issuer/useUpdateFederationIssuer.js", () => ({
  useUpdateFederationIssuer: () => ({
    update: async () => {
      throw new Error("not under test");
    },
    isUpdating: false,
    error: null,
    clearError: () => {},
  }),
}));
// The detail panel's slug field renames through the client; not under test here.
vi.mock("../../resource-detail/useRenameResource.js", () => ({
  useRenameResource: () => ({
    rename: async () => {
      throw new Error("not under test");
    },
    isRenaming: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../../grant/useCheckPermission.js", () => ({
  useCheckPermission: (
    resource: { kind: string; id: string } | null,
    relation: string,
  ) => ({
    allowed: resource === null ? true : verdict(resource.kind, resource.id, relation),
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../grant/PermissionGate.js", () => ({
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

import { FederationIssuersSection } from "../FederationIssuersSection";

const OKTA = create(FederationIssuerSchema, {
  metadata: { id: "fis_okta", name: "Acme Okta", slug: "acme-okta", org: "acme" },
  spec: { displayName: "Acme Okta" },
});

function renderSection(mode: DeploymentMode) {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <FederationIssuersSection />
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

describe("FederationIssuersSection", () => {
  it("says federation issuers are not served on the open-source edition and lists nothing", () => {
    renderSection("local");
    expect(screen.getByText(/Federation issuers are not available in local mode/)).toBeTruthy();
    // The list panel is never mounted, so the list hook is never called.
    expect(stubs.listedOrg).toBeUndefined();
    expect(screen.queryByRole("button", { name: /New federation issuer/ })).toBeNull();
  });

  it("offers New federation issuer only with can_create_federation_issuer on the organization", () => {
    renderSection("cloud");
    expect(screen.queryByRole("button", { name: /New federation issuer/ })).toBeNull();
    expect(stubs.checked).toContainEqual(["organization", "org_acme", "can_create_federation_issuer"]);

    cleanup();
    stubs.allowed = new Set(["can_create_federation_issuer"]);
    renderSection("cloud");
    expect(screen.getByRole("button", { name: /New federation issuer/ })).toBeTruthy();
  });

  it("names the organization's admins, not an empty configuration, to a caller who may not create providers", () => {
    renderSection("cloud");
    expect(stubs.listedOrg).toBe("org_acme");
    expect(
      screen.getByText("Federation issuers are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("No federation issuers configured.")).toBeNull();

    cleanup();
    stubs.allowed = new Set(["can_create_federation_issuer"]);
    renderSection("cloud");
    expect(screen.getByText("No federation issuers configured.")).toBeTruthy();
  });

  it("offers edit and delete on a provider row only with can_edit and can_delete on it", () => {
    stubs.providers = [OKTA];
    renderSection("cloud");
    expect(screen.getByText("acme-okta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Acme Okta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Acme Okta" })).toBeNull();
    expect(stubs.checked).toContainEqual(["federation_issuer", "fis_okta", "can_edit"]);
    expect(stubs.checked).toContainEqual(["federation_issuer", "fis_okta", "can_delete"]);

    cleanup();
    stubs.allowed = new Set(["can_edit", "can_delete"]);
    renderSection("cloud");
    expect(screen.getByRole("button", { name: "Edit Acme Okta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Acme Okta" })).toBeTruthy();
  });

  it("opens the chosen issuer's detail in place of the list when its row's Edit is clicked", () => {
    stubs.providers = [OKTA];
    stubs.allowed = new Set(["can_edit"]);
    renderSection("cloud");

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Okta" }));

    expect(screen.getByRole("button", { name: /Back to list/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Acme Okta" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Federation issuers" })).toBeNull();
  });

});
