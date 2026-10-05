/**
 * Pins the sign-in settings the create form sends:
 *
 *   - a delegation provider sends what the admin set: account creation,
 *     the sign-in role and the tenant claim;
 *   - turning SSO on creates accounts with viewer and drops a tenant claim
 *     typed before it, because only a delegation provider names
 *     platform-managed organizations; the form will not create an SSO
 *     provider whose sign-in role is None.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityProviderSchema,
  type IdentityProvider,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { IdentityProviderInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { CreateIdentityProviderForm } from "../CreateIdentityProviderForm";

const CREATED: IdentityProvider = create(IdentityProviderSchema, {
  metadata: { id: "idp-1", name: "Acme", slug: "acme", org: "acme" },
});

function renderForm(createIdp: ReturnType<typeof vi.fn>) {
  const client = { identityProvider: { create: createIdp } } as never;
  render(
    <StigmerContext.Provider value={client}>
      <CreateIdentityProviderForm org="acme" />
    </StigmerContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("JWKS URI"), {
    target: { value: "https://auth.acme.test/jwks" },
  });
  fireEvent.change(screen.getByLabelText("Allowed issuers"), {
    target: { value: "https://auth.acme.test/" },
  });
  fireEvent.change(screen.getByLabelText("Expected audience"), {
    target: { value: "https://api.acme.test/stigmer" },
  });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Create identity provider",
  }) as HTMLButtonElement;
}

afterEach(cleanup);

describe("CreateIdentityProviderForm sign-in settings", () => {
  it("sends a delegation provider's account creation, role and tenant claim", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderForm(createIdp);

    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    fireEvent.change(screen.getByLabelText("Sign-in role"), {
      target: { value: String(IamRole.member) },
    });
    fireEvent.change(screen.getByLabelText("Tenant org claim"), {
      target: { value: "org_id" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.isSsoProvider).toBeUndefined();
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.member);
    expect(input.tenantOrgClaim).toBe("org_id");
  });

  it("sends none of the SSO defaults once SSO is switched back off", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderForm(createIdp);

    // The SSO switch is the form's first.
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.click(submitButton());

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.isSsoProvider).toBeUndefined();
    expect(input.createAccountsOnSignIn).toBeUndefined();
    expect(input.signInRole).toBeUndefined();
  });

  it("creates an SSO provider with viewer, no tenant claim, and never with None", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderForm(createIdp);

    fireEvent.change(screen.getByLabelText("Tenant org claim"), {
      target: { value: "org_id" },
    });
    // The SSO switch is the form's first.
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.change(screen.getByLabelText("OIDC client ID"), {
      target: { value: "client-1" },
    });

    expect(screen.queryByLabelText("Tenant org claim")).toBeNull();
    const role = screen.getByLabelText("Sign-in role") as HTMLSelectElement;
    expect(role.value).toBe(String(IamRole.viewer));

    fireEvent.change(role, {
      target: { value: String(IamRole.iam_role_unspecified) },
    });
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(role, { target: { value: String(IamRole.viewer) } });
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.isSsoProvider).toBe(true);
    expect(input.oidcClientId).toBe("client-1");
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.viewer);
    expect(input.tenantOrgClaim).toBeUndefined();
  });
});
