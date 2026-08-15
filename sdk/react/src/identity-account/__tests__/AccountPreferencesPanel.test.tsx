import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountInput } from "@stigmer/sdk";
import type { DeploymentMode } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { AccountPreferencesPanel } from "../AccountPreferencesPanel";

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ia-1", name: "Ada Lovelace", slug: "ada", org: "acme" },
  spec: {
    idpId: "auth0|abc",
    email: "ada@acme.example",
    preferences: { standingContext: "Keep answers terse." },
  },
});

function createMockStigmer(overrides?: {
  whoAmI?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    identityAccount: {
      whoAmI: overrides?.whoAmI ?? vi.fn(async () => ACCOUNT),
      update: overrides?.update ?? vi.fn(async () => ACCOUNT),
    },
  } as never;
}

function renderPanel(client: unknown, mode: DeploymentMode = "cloud") {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value={mode}>
        <AccountPreferencesPanel />
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

describe("AccountPreferencesPanel", () => {
  it("renders the cloud notice in local mode without issuing any RPCs", () => {
    const whoAmI = vi.fn(async () => ACCOUNT);
    renderPanel(createMockStigmer({ whoAmI }), "local");

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByLabelText("Standing context")).toBeNull();
    // The inner form must not mount — no doomed whoAmI against a local server.
    expect(whoAmI).not.toHaveBeenCalled();
  });

  it("loads and displays the caller's declared standing context", async () => {
    renderPanel(createMockStigmer());

    await findSyncedField("Keep answers terse.");
  });

  it("saves the full mapped input — identity fields survive (wipe-bug guard)", async () => {
    const update = vi.fn(async (_input: IdentityAccountInput) => ACCOUNT);
    renderPanel(createMockStigmer({ update }));

    const field = await findSyncedField("Keep answers terse.");
    fireEvent.change(field, { target: { value: "Prefer bullet points." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    expect(input.preferences).toEqual({
      standingContext: "Prefer bullet points.",
    });
    // Fields this form never renders must round-trip untouched.
    expect(input.idpId).toBe("auth0|abc");
    expect(input.email).toBe("ada@acme.example");
    // The update pipeline addresses the resource by org + slug.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("ada");
  });

  it("refetches the account after a successful save", async () => {
    const whoAmI = vi.fn(async () => ACCOUNT);
    renderPanel(createMockStigmer({ whoAmI }));

    const field = await findSyncedField("Keep answers terse.");
    fireEvent.change(field, { target: { value: "New context" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // Initial load + post-save refetch.
    await waitFor(() => expect(whoAmI).toHaveBeenCalledTimes(2));
  });

  it("shows the fetch error with a retry action when whoAmI fails", async () => {
    const whoAmI = vi.fn(async () => {
      throw new Error("boom");
    });
    renderPanel(createMockStigmer({ whoAmI }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
