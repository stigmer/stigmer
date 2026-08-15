import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { OrganizationInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { OrgProfilePanel } from "../OrgProfilePanel";

/**
 * Regression suite for the full-spec-replace wipe bug (oss#293 Phase 1):
 * `organization.update()` wholesale replaces the stored spec, so a profile
 * save that sends only the edited fields silently wipes every other mutable
 * spec field — most visibly `spec.preferences.standing_context` set via the
 * CLI or the preferences page. The panel must spread the complete mapped
 * input and override only what it edits.
 */

const ORG: Organization = create(OrganizationSchema, {
  metadata: {
    id: "acme",
    name: "Acme Corp",
    slug: "acme",
    org: "acme",
  },
  spec: {
    description: "We make everything.",
    logoUrl: "https://acme.example/logo.png",
    preferences: { standingContext: "We deploy to us-east-1." },
  },
});

function createMockStigmer(overrides?: {
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    organization: {
      get: vi.fn(async () => ORG),
      update: overrides?.update ?? vi.fn(async () => ORG),
    },
  } as never;
}

// Deployment mode "local" keeps the IdentityProvidersSummary sub-panel
// inert (identity_provider is cloud-only), so no extra client stubs are
// needed — the suite tests the form, not the summary.
function renderPanel(client: unknown) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value="local">
        <OrgProfilePanel orgId="acme" />
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("OrgProfilePanel save payload", () => {
  it("round-trips unedited spec fields — preferences survive a profile save", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    const client = createMockStigmer({ update });
    renderPanel(client);

    // Wait for the server-sync effect to fill the form before editing —
    // interacting on first appearance races the sync.
    const description = await screen.findByLabelText("Description");
    await waitFor(() =>
      expect(description).toHaveProperty("value", "We make everything."),
    );
    fireEvent.change(description, { target: { value: "New description" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The edited field.
    expect(input.description).toBe("New description");
    // The unedited fields the form does not render — the wipe-bug guard.
    expect(input.preferences).toEqual({
      standingContext: "We deploy to us-east-1.",
    });
    expect(input.logoUrl).toBe("https://acme.example/logo.png");
    // Addressing fields for the update pipeline's org+slug lookup.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("acme");
    expect(input.name).toBe("Acme Corp");
  });

  it("sends the edited name and keeps discard/dirty semantics intact", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    renderPanel(createMockStigmer({ update }));

    const name = await screen.findByLabelText("Name");
    await waitFor(() => expect(name).toHaveProperty("value", "Acme Corp"));
    fireEvent.change(name, { target: { value: "Acme Corporation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].name).toBe("Acme Corporation");
    expect(update.mock.calls[0]![0].preferences).toEqual({
      standingContext: "We deploy to us-east-1.",
    });
  });
});
