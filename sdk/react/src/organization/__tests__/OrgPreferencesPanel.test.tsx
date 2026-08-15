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
import { OrgPreferencesPanel } from "../OrgPreferencesPanel";

const ORG: Organization = create(OrganizationSchema, {
  metadata: { id: "acme", name: "Acme Corp", slug: "acme", org: "acme" },
  spec: {
    description: "We make everything.",
    logoUrl: "https://acme.example/logo.png",
    preferences: { standingContext: "We deploy to us-east-1." },
  },
});

function createMockStigmer(overrides?: {
  update?: ReturnType<typeof vi.fn>;
  canEdit?: boolean;
}) {
  return {
    organization: {
      get: vi.fn(async () => ORG),
      update: overrides?.update ?? vi.fn(async () => ORG),
    },
    iamPolicy: {
      checkMyPermission: vi.fn(async () => ({
        isAuthorized: overrides?.canEdit ?? true,
      })),
    },
  } as never;
}

function renderPanel(client: unknown) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value="local">
        <OrgPreferencesPanel orgId="acme" />
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

/**
 * Waits until the form has synced from server data (the panel copies the
 * fetched value into local state in a passive effect, one flush after the
 * field first renders) — interacting earlier races the sync.
 */
async function findSyncedField(value: string) {
  const field = await screen.findByLabelText("Standing context");
  await waitFor(() => expect(field).toHaveProperty("value", value));
  return field;
}

describe("OrgPreferencesPanel", () => {
  it("loads and displays the declared standing context", async () => {
    renderPanel(createMockStigmer());

    await findSyncedField("We deploy to us-east-1.");
  });

  it("saves the full mapped input — unedited profile fields survive (wipe-bug guard)", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    renderPanel(createMockStigmer({ update }));

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "Prefer terse answers." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    expect(input.preferences).toEqual({
      standingContext: "Prefer terse answers.",
    });
    // Fields this form never renders must round-trip untouched.
    expect(input.name).toBe("Acme Corp");
    expect(input.description).toBe("We make everything.");
    expect(input.logoUrl).toBe("https://acme.example/logo.png");
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("acme");
  });

  it("clears the standing context when the text is emptied", async () => {
    const update = vi.fn(async (_input: OrganizationInput) => ORG);
    renderPanel(createMockStigmer({ update }));

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].preferences).toEqual({
      standingContext: undefined,
    });
  });

  it("discard resets the field to the server value", async () => {
    renderPanel(createMockStigmer());

    const field = await findSyncedField("We deploy to us-east-1.");
    fireEvent.change(field, { target: { value: "Edited but regretted" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(field).toHaveProperty("value", "We deploy to us-east-1.");
  });

  it("renders read-only with an explanation when the caller lacks can_edit", async () => {
    renderPanel(createMockStigmer({ canEdit: false }));

    const field = await screen.findByLabelText("Standing context");
    await waitFor(() =>
      expect(field).toHaveProperty("readOnly", true),
    );
    expect(
      screen.getByText("Only organization admins can edit these preferences."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("shows the fetch error with a retry action when loading fails", async () => {
    const client = {
      organization: {
        get: vi.fn(async () => {
          throw new Error("boom");
        }),
        update: vi.fn(),
      },
      iamPolicy: {
        checkMyPermission: vi.fn(async () => ({ isAuthorized: true })),
      },
    } as never;
    renderPanel(client);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
