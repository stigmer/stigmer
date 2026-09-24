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
 * Pins two things about the detail panel:
 *
 *   - the full-spec-replace wipe bug: before the generated-mapper migration,
 *     this panel hand-built its update input and NEVER sent
 *     `rate_limit_budget`, so editing any field zeroed the provider's rate
 *     limit. The panel must spread `toIdentityProviderUpdateInput` and
 *     override only what it edits;
 *   - the Edit button is offered only to a caller the server says holds
 *     `can_edit` on the provider, so a member who may view a provider is
 *     never handed a form the server would refuse.
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
    rateLimitBudget: 120,
    isSsoProvider: false,
    autoProvisionAccounts: true,
    autoGrantOnOrg: true,
    autoGrantRole: IamRole.admin,
    tenantOrgClaim: "org_slug",
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
  it("round-trips rate_limit_budget on a display-name edit (the wipe bug)", async () => {
    const update = vi.fn(async (_input: IdentityProviderInput) => IDP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const displayName = await screen.findByLabelText("Display name");
    fireEvent.change(displayName, { target: { value: "Acme Okta (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The wipe-bug guard: the form does not render the rate limit, yet it
    // must survive the save.
    expect(input.rateLimitBudget).toBe(120);
    // The edited field.
    expect(input.displayName).toBe("Acme Okta (renamed)");
    // JIT settings round-trip from the edit state.
    expect(input.autoGrantRole).toBe(IamRole.admin);
    expect(input.tenantOrgClaim).toBe("org_slug");
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
