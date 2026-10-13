/**
 * Pins SsoRequirementSection, the owners' switch that makes an organization
 * require sign-in through its SSO provider:
 *
 *   - nothing renders for a provider that is not the SSO provider;
 *   - only someone holding `can_assign_roles` on the organization (its
 *     owners) is offered the switch, asked on the organization's id;
 *   - turning it on first shows who would stop counting (the members, what
 *     stops with them, the exempt owners), and only the confirmation saves
 *     the provider with the requirement on, keeping every other field;
 *   - turning it off saves it off after a confirmation;
 *   - on Cloud, a plan without SSO enforcement shows the plan notice in
 *     place of turning it on, and still lets an organization that requires
 *     it turn it off; Enterprise never reads a plan.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { IdentityProviderSchema, type IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import {
  SsoRequirementMemberSchema,
  SsoRequirementPreviewSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import type { DeploymentMode, IdentityProviderInput } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const stubs = vi.hoisted(() => ({
  allowed: new Set<string>(),
  checked: [] as Array<[string, string, string]>,
  planAllows: null as boolean | null,
  entitlementsEnabled: [] as Array<boolean | undefined>,
  saved: [] as IdentityProviderInput[],
  previewed: [] as Array<string | null>,
}));

vi.mock("../../billing/useEntitlements.js", () => ({
  useEntitlements: (_orgId: string | null, options?: { enabled?: boolean }) => {
    stubs.entitlementsEnabled.push(options?.enabled);
    return {
      entitlements: null,
      allows: () => (options?.enabled === false ? null : stubs.planAllows),
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
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
  }) => {
    stubs.checked.push([resource.kind, resource.id, relation]);
    return stubs.allowed.has(relation) ? <>{children}</> : null;
  },
}));
vi.mock("../useUpdateIdentityProvider.js", () => ({
  useUpdateIdentityProvider: () => ({
    update: (input: IdentityProviderInput) => {
      stubs.saved.push(input);
      return Promise.resolve(create(IdentityProviderSchema, { spec: { ssoRequired: input.ssoRequired ?? false } }));
    },
    isUpdating: false,
    error: null,
    clearError: () => {},
  }),
}));
vi.mock("../usePreviewSsoRequirement.js", () => ({
  usePreviewSsoRequirement: (org: string | null) => {
    stubs.previewed.push(org);
    return {
      preview: create(SsoRequirementPreviewSchema, {
        members: [
          create(SsoRequirementMemberSchema, {
            identityAccountId: "ida_raj",
            displayName: "Raj",
            email: "raj@gmail.test",
            automations: [{ kind: "schedule", id: "sch_1", slug: "nightly", name: "Nightly" }],
          }),
        ],
        exemptOwners: [create(SsoRequirementMemberSchema, { identityAccountId: "ida_ana", displayName: "Ana" })],
      }),
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));

import { SsoRequirementSection } from "../SsoRequirementSection";

function provider(fields: { sso?: boolean; required?: boolean } = {}): IdentityProvider {
  return create(IdentityProviderSchema, {
    metadata: { id: "idp_okta", org: "org_acme", slug: "acme-okta", name: "acme-okta" },
    spec: {
      displayName: "Acme Okta",
      jwksUri: "https://acme.okta.test/keys",
      allowedIssuers: ["https://acme.okta.test"],
      expectedAudience: "api://acme",
      isSsoProvider: fields.sso ?? true,
      oidcClientId: "client",
      ssoRequired: fields.required ?? false,
    },
  });
}

function renderSection(idp: IdentityProvider, mode: DeploymentMode = "enterprise") {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <SsoRequirementSection identityProvider={idp} />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  stubs.allowed = new Set();
  stubs.checked = [];
  stubs.planAllows = null;
  stubs.entitlementsEnabled = [];
  stubs.saved = [];
  stubs.previewed = [];
});

describe("SsoRequirementSection", () => {
  it("renders nothing for a provider that is not the SSO provider", () => {
    const { container } = renderSection(provider({ sso: false }));
    expect(container.textContent).toBe("");
  });

  it("offers the switch to the organization's owners only, asked on its id", () => {
    renderSection(provider());
    expect(screen.queryByRole("button", { name: /Require it/ })).toBeNull();
    expect(stubs.checked).toContainEqual(["organization", "org_acme", "can_assign_roles"]);
    cleanup();
    stubs.allowed = new Set(["can_assign_roles"]);
    renderSection(provider());
    expect(screen.getByRole("button", { name: /Require it/ })).toBeTruthy();
  });

  it("shows who would stop counting before turning it on, and saves only on confirmation, every other field kept", async () => {
    stubs.allowed = new Set(["can_assign_roles"]);
    renderSection(provider());
    fireEvent.click(screen.getByRole("button", { name: /Require it/ }));
    expect(stubs.previewed).toContain("org_acme");
    expect(screen.getByText(/One member has not signed in through Acme Okta yet/)).toBeTruthy();
    expect(screen.getByText(/Raj \(raj@gmail.test\) · 1 automation stops/)).toBeTruthy();
    expect(screen.getByText(/Owners keep their own sign-in: Ana/)).toBeTruthy();
    expect(stubs.saved).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Require it" }));
    await vi.waitFor(() => expect(stubs.saved).toHaveLength(1));
    expect(stubs.saved[0]).toMatchObject({
      ssoRequired: true,
      displayName: "Acme Okta",
      oidcClientId: "client",
      isSsoProvider: true,
    });
  });

  it("turns it off after a confirmation", async () => {
    stubs.allowed = new Set(["can_assign_roles"]);
    renderSection(provider({ required: true }));
    fireEvent.click(screen.getByRole("button", { name: /Stop requiring it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Stop requiring it" }));
    await vi.waitFor(() => expect(stubs.saved).toHaveLength(1));
    expect(stubs.saved[0]?.ssoRequired).toBe(false);
  });

  it("on Cloud, a plan without it shows the plan notice in place of turning it on, and still lets it be turned off", () => {
    stubs.allowed = new Set(["can_assign_roles"]);
    stubs.planAllows = false;
    renderSection(provider(), "cloud");
    expect(screen.queryByRole("button", { name: /Require it/ })).toBeNull();
    expect(screen.getByText("SSO enforcement is not included in this organization's plan.")).toBeTruthy();
    cleanup();
    renderSection(provider({ required: true }), "cloud");
    expect(screen.getByRole("button", { name: /Stop requiring it/ })).toBeTruthy();
  });

  it("never reads a plan on Enterprise", () => {
    renderSection(provider(), "enterprise");
    expect(stubs.entitlementsEnabled.every((enabled) => enabled === false)).toBe(true);
  });
});
