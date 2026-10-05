import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityProviderSchema,
  type IdentityProvider,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { IdentityProviderInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { IdentityProviderWizard } from "../IdentityProviderWizard";

/**
 * Pins the wizard's userinfo endpoint from preset to create payload: a
 * known preset fills the endpoint the provider's discovery document names,
 * the review step says when Stigmer reads it (only when it creates an
 * account from a token with no email claim, never on every sign-in), and
 * the create call carries it, so the save-time check that the endpoint is
 * the issuer's own passes for a preset left as filled.
 *
 * Also pins the sign-in settings the create call carries: a plain provider
 * sends neither account creation nor a role unless chosen, and an SSO
 * provider sends both, starting from viewer.
 */

const CREATED: IdentityProvider = create(IdentityProviderSchema, {
  metadata: { id: "idp-1", name: "Acme", slug: "acme", org: "acme" },
});

function renderWizard(createIdp: ReturnType<typeof vi.fn>) {
  const client = { identityProvider: { create: createIdp } } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <IdentityProviderWizard org="acme" />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

/** Walks the wizard to its review step with the Auth0 preset. */
async function reachReview() {
  fireEvent.click(screen.getByRole("option", { name: /Auth0/ }));
  fireEvent.change(screen.getByLabelText("Tenant name"), {
    target: { value: "acme" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByLabelText("Expected audience"), {
    target: { value: "https://api.acme.test/stigmer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Userinfo endpoint");
}

describe("IdentityProviderWizard sign-in settings", () => {
  it("a plain provider sends no account creation and no role by default", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderWizard(createIdp);
    await reachReview();

    fireEvent.click(
      screen.getByRole("button", { name: "Create identity provider" }),
    );

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.isSsoProvider).toBeUndefined();
    expect(input.createAccountsOnSignIn).toBeUndefined();
    expect(input.signInRole).toBeUndefined();
    expect(input.tenantOrgClaim).toBeUndefined();
  });

  it("an SSO provider sends account creation and the viewer role", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderWizard(createIdp);
    await reachReview();

    // The SSO switch is the review step's first.
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.change(screen.getByLabelText("OIDC client ID"), {
      target: { value: "client-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create identity provider" }),
    );

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.isSsoProvider).toBe(true);
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.viewer);
  });
});

describe("IdentityProviderWizard userinfo endpoint", () => {
  it("fills a preset's userinfo endpoint, says when it is read, and sends it on create", async () => {
    const createIdp = vi.fn(async (_input: IdentityProviderInput) => CREATED);
    renderWizard(createIdp);

    fireEvent.click(screen.getByRole("option", { name: /Auth0/ }));
    fireEvent.change(screen.getByLabelText("Tenant name"), {
      target: { value: "acme" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Expected audience"), {
      target: { value: "https://api.acme.test/stigmer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const userinfo = (await screen.findByLabelText(
      "Userinfo endpoint",
    )) as HTMLInputElement;
    expect(userinfo.value).toBe("https://acme.us.auth0.com/userinfo");
    expect(
      screen.getByText(
        "Optional. Read only when Stigmer creates an account from a token with no email claim",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/token exchange/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Create identity provider" }),
    );

    await waitFor(() => expect(createIdp).toHaveBeenCalledTimes(1));
    const input = createIdp.mock.calls[0]![0];
    expect(input.userinfoEndpoint).toBe("https://acme.us.auth0.com/userinfo");
    expect(input.jwksUri).toBe("https://acme.us.auth0.com/.well-known/jwks.json");
  });
});
