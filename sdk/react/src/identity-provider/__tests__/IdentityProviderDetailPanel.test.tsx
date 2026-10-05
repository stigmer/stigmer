import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityProviderSchema,
  type IdentityProvider,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { IdentityProviderInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { IdentityProviderDetailPanel } from "../IdentityProviderDetailPanel";

/**
 * Pins three things about the detail panel:
 *
 *   - the save sends the whole spec: before the generated-mapper migration,
 *     this panel hand-built its update input, so a field it did not list
 *     was zeroed by every edit. The panel spreads
 *     `toIdentityProviderUpdateInput` and overrides only what it edits;
 *   - the Edit button is offered only to a caller the server says holds
 *     `can_edit` on the provider, so a member who may view a provider is
 *     never handed a form the server would refuse;
 *   - an SSO provider always creates accounts and grants a role: turning
 *     SSO on locks account creation on and fills an unset sign-in role
 *     with viewer, and the form will not save an SSO provider whose role
 *     is None.
 */

const IDP: IdentityProvider = create(IdentityProviderSchema, {
  metadata: {
    id: "idp-1",
    name: "Acme Okta",
    slug: "acme-okta",
    org: "acme",
  },
  spec: {
    displayName: "Acme Okta",
    jwksUri: "https://acme.okta.example/jwks",
    allowedIssuers: ["https://acme.okta.example"],
    expectedAudience: "stigmer",
    isSsoProvider: false,
    createAccountsOnSignIn: true,
    signInRole: IamRole.admin,
    externalIdClaim: "org_slug",
  },
});

function renderPanel(
  update: ReturnType<typeof vi.fn>,
  checkMyPermission: ReturnType<typeof vi.fn> = vi.fn(async () => ({
    isAuthorized: true,
  })),
) {
  const client = {
    identityProvider: { update },
    iamPolicy: { checkMyPermission },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <IdentityProviderDetailPanel identityProvider={IDP} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("IdentityProviderDetailPanel save payload", () => {
  it("sends the whole spec on a display-name edit, not only the edited field", async () => {
    const update = vi.fn(async (_input: IdentityProviderInput) => IDP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const displayName = await screen.findByLabelText("Display name");
    fireEvent.change(displayName, { target: { value: "Acme Okta (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The edited field.
    expect(input.displayName).toBe("Acme Okta (renamed)");
    // Fields the edit leaves alone travel with it.
    expect(input.jwksUri).toBe("https://acme.okta.example/jwks");
    expect(input.allowedIssuers).toEqual(["https://acme.okta.example"]);
    expect(input.expectedAudience).toBe("stigmer");
    // Sign-in settings round-trip from the edit state.
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.admin);
    expect(input.externalIdClaim).toBe("org_slug");
    // Addressing fields.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("acme-okta");
  });
});

describe("IdentityProviderDetailPanel edit gate", () => {
  it("offers Edit only with can_edit on the provider", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(vi.fn(), checkMyPermission);

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalledTimes(1));
    const asked = checkMyPermission.mock.calls[0]![0];
    expect(asked.resource?.kind).toBe("identity_provider");
    expect(asked.resource?.id).toBe("idp-1");
    expect(asked.relation).toBe("can_edit");
    // The configuration stays readable; only the edit affordance is withheld.
    expect(screen.getByRole("heading", { name: "Acme Okta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("IdentityProviderDetailPanel SSO sign-in settings", () => {
  const PLAIN: IdentityProvider = create(IdentityProviderSchema, {
    metadata: { id: "idp-2", name: "Acme Auth", slug: "acme-auth", org: "acme" },
    spec: {
      displayName: "Acme Auth",
      jwksUri: "https://auth.acme.example/jwks",
      allowedIssuers: ["https://auth.acme.example"],
      expectedAudience: "stigmer",
    },
  });

  function renderPlain(update: ReturnType<typeof vi.fn>) {
    const client = {
      identityProvider: { update },
      iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    } as never;
    return render(
      <StigmerContext.Provider value={client}>
        <IdentityProviderDetailPanel identityProvider={PLAIN} />
      </StigmerContext.Provider>,
    );
  }

  it("turning SSO on creates accounts with viewer, and None refuses to save", async () => {
    const update = vi.fn(async (_input: IdentityProviderInput) => PLAIN);
    renderPlain(update);

    expect(screen.getByText("None")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const createAccounts = screen.getByRole("switch", {
      name: "Create accounts on sign-in",
    });
    const role = screen.getByLabelText("Sign-in role") as HTMLSelectElement;
    expect(createAccounts.getAttribute("aria-checked")).toBe("false");
    expect(role.value).toBe(String(IamRole.iam_role_unspecified));

    // The SSO switch is the form's first.
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.change(screen.getByLabelText("OIDC client ID"), {
      target: { value: "client-1" },
    });

    expect(createAccounts.getAttribute("aria-checked")).toBe("true");
    expect((createAccounts as HTMLButtonElement).disabled).toBe(true);
    expect(role.value).toBe(String(IamRole.viewer));

    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    fireEvent.change(role, { target: { value: String(IamRole.iam_role_unspecified) } });
    expect(save.disabled).toBe(true);

    fireEvent.change(role, { target: { value: String(IamRole.viewer) } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];
    expect(input.isSsoProvider).toBe(true);
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.viewer);
  });
});
