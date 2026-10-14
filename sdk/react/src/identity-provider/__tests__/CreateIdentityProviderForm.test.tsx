/**
 * Pins the sign-in settings the create form sends: a delegation provider
 * sends what the admin set (account creation, the sign-in role and the
 * customer id claim), and nothing the admin left unset.
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
  it("sends a delegation provider's account creation, role and customer id claim", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderForm(createIdp);

    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    fireEvent.change(screen.getByLabelText("Sign-in role"), {
      target: { value: String(IamRole.member) },
    });
    fireEvent.change(screen.getByLabelText("Customer id claim"), {
      target: { value: "org_id" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.member);
    expect(input.externalIdClaim).toBe("org_id");
  });

  it("sends no account creation, role or customer id claim the admin left unset", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderForm(createIdp);

    fireEvent.click(submitButton());

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBeUndefined();
    expect(input.signInRole).toBeUndefined();
    expect(input.externalIdClaim).toBeUndefined();
  });
});
