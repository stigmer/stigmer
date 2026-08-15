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
import { IdentityProviderDetailPanel } from "../IdentityProviderDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: before the
 * generated-mapper migration, this panel hand-built its update input and
 * NEVER sent `rate_limit_budget` — editing any IdP field zeroed the
 * provider's rate limit. The panel must spread
 * `toIdentityProviderUpdateInput` and override only what it edits.
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

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    identityProvider: { update },
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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
