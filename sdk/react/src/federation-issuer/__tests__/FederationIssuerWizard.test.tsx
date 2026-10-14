import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { FederationIssuerInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FederationIssuerWizard } from "../FederationIssuerWizard";

/**
 * Pins the wizard's userinfo endpoint from preset to create payload: a
 * known preset fills the endpoint the provider's discovery document names,
 * the review step says when Stigmer reads it (only when it creates an
 * account from a token with no email claim, never on every sign-in), and
 * the create call carries it, so the save-time check that the endpoint is
 * the issuer's own passes for a preset left as filled.
 *
 * Also pins the sign-in settings the create call carries: neither account
 * creation nor a role unless chosen, and both once the admin chooses them.
 */

const CREATED: FederationIssuer = create(FederationIssuerSchema, {
  metadata: { id: "issuer-1", name: "Acme", slug: "acme", org: "acme" },
});

function renderWizard(createIssuer: ReturnType<typeof vi.fn>) {
  const client = { federationIssuer: { create: createIssuer } } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <FederationIssuerWizard org="acme" />
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

describe("FederationIssuerWizard sign-in settings", () => {
  it("a plain issuer sends no account creation and no role by default", async () => {
    const createIssuer = vi.fn(async (_input: FederationIssuerInput) => CREATED);
    renderWizard(createIssuer);
    await reachReview();

    fireEvent.click(
      screen.getByRole("button", { name: "Create federation issuer" }),
    );

    await waitFor(() => expect(createIssuer).toHaveBeenCalledTimes(1));
    const input = createIssuer.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBeUndefined();
    expect(input.signInRole).toBeUndefined();
    expect(input.externalIdClaim).toBeUndefined();
  });

  it("sends account creation and the role the admin chooses", async () => {
    const createIssuer = vi.fn(async (_input: FederationIssuerInput) => CREATED);
    renderWizard(createIssuer);
    await reachReview();

    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    fireEvent.change(screen.getByLabelText("Sign-in role"), {
      target: { value: String(IamRole.viewer) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create federation issuer" }),
    );

    await waitFor(() => expect(createIssuer).toHaveBeenCalledTimes(1));
    const input = createIssuer.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.viewer);
  });
});

describe("FederationIssuerWizard userinfo endpoint", () => {
  it("fills a preset's userinfo endpoint, says when it is read, and sends it on create", async () => {
    const createIssuer = vi.fn(async (_input: FederationIssuerInput) => CREATED);
    renderWizard(createIssuer);

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
      screen.getByRole("button", { name: "Create federation issuer" }),
    );

    await waitFor(() => expect(createIssuer).toHaveBeenCalledTimes(1));
    const input = createIssuer.mock.calls[0]![0];
    expect(input.userinfoEndpoint).toBe("https://acme.us.auth0.com/userinfo");
    expect(input.jwksUri).toBe("https://acme.us.auth0.com/.well-known/jwks.json");
  });
});
