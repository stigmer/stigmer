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
import { ModelRegistryContext, type ModelRegistryState } from "../../models/ModelRegistryContext";
import { parseRegistryJson } from "../../models/registry";
import { AccountPreferencesPanel } from "../AccountPreferencesPanel";

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ia-1", name: "Ada Lovelace", slug: "ada", org: "acme" },
  spec: {
    idpId: "auth0|abc",
    email: "ada@acme.example",
    preferences: { standingContext: "Keep answers terse." },
  },
});

const TEST_MODELS = parseRegistryJson({
  models: [
    { id: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", shortDescription: "", speedTier: "fast", provider: "anthropic", harness: "native", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 } },
    { id: "default", displayName: "Cursor Auto", shortDescription: "", speedTier: "fast", provider: "cursor", harness: "cursor", costTier: "standard", featured: true, pricing: { inputPricePerMillion: 1.25, outputPricePerMillion: 6, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 } },
  ],
});

const REGISTRY_STATE: ModelRegistryState = {
  models: TEST_MODELS,
  isLoading: false,
  error: null,
  refetch: () => {},
};

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
        <ModelRegistryContext.Provider value={REGISTRY_STATE}>
          <AccountPreferencesPanel />
        </ModelRegistryContext.Provider>
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
    // The update pipeline addresses id-first — the id is REQUIRED here:
    // identity accounts are org-less, so the org+slug fallback can never
    // match one (the save-path bug this pin guards against).
    expect(input.id).toBe("ia-1");
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

  describe("memory consent (oss#293 Phase 2 Stage 3)", () => {
    it("memory toggle applies instantly with the full mapped input (wipe-safe)", async () => {
      const update = vi.fn(async (_input: IdentityAccountInput) => ACCOUNT);
      renderPanel(createMockStigmer({ update }));
      await findSyncedField("Keep answers terse.");

      // No Save click: consent applies the moment it is flipped (the
      // UX-checkpoint decision).
      fireEvent.click(screen.getByRole("switch", { name: "Memory" }));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const input = update.mock.calls[0]![0];
      expect(input.preferences?.memoryEnabled).toBe(true);
      // The double spread: the flip preserves every sibling preference…
      expect(input.preferences?.standingContext).toBe("Keep answers terse.");
      // …and the identity fields the row never renders.
      expect(input.id).toBe("ia-1");
      expect(input.email).toBe("ada@acme.example");
    });

    it("saving the form preserves memory_enabled (the wipe-hazard regression)", async () => {
      const accountWithMemoryOn = create(IdentityAccountSchema, {
        metadata: { id: "ia-1", name: "Ada Lovelace", slug: "ada", org: "acme" },
        spec: {
          idpId: "auth0|abc",
          email: "ada@acme.example",
          preferences: {
            standingContext: "Keep answers terse.",
            memoryEnabled: true,
          },
        },
      });
      const update = vi.fn(async (_input: IdentityAccountInput) => accountWithMemoryOn);
      renderPanel(
        createMockStigmer({ whoAmI: vi.fn(async () => accountWithMemoryOn), update }),
      );

      const field = await findSyncedField("Keep answers terse.");
      fireEvent.change(field, { target: { value: "Terser still." } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      // Update is a full-spec replace: without the nested preferences
      // spread, this save would silently revoke the memory consent.
      expect(update.mock.calls[0]![0].preferences?.memoryEnabled).toBe(true);
    });

    it("reflects the stored flag as the switch state", async () => {
      const accountWithMemoryOn = create(IdentityAccountSchema, {
        metadata: { id: "ia-1", name: "Ada", slug: "ada", org: "acme" },
        spec: {
          idpId: "auth0|abc",
          preferences: { memoryEnabled: true },
        },
      });
      renderPanel(createMockStigmer({ whoAmI: vi.fn(async () => accountWithMemoryOn) }));
      await findSyncedField("");

      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Memory" }).getAttribute("aria-checked"),
        ).toBe("true"),
      );
    });
  });

  describe("execution defaults (oss#293 Phase 1.5)", () => {
    const ACCOUNT_WITH_DEFAULTS: IdentityAccount = create(IdentityAccountSchema, {
      metadata: { id: "ia-1", name: "Ada Lovelace", slug: "ada", org: "acme" },
      spec: {
        idpId: "auth0|abc",
        email: "ada@acme.example",
        preferences: {
          standingContext: "Keep answers terse.",
          defaultHarness: "cursor",
          defaultNativeModel: "claude-sonnet-4.6",
          defaultCursorModel: "default",
        },
      },
    });

    it("renders the harness option rows and registry-fed model selects", async () => {
      renderPanel(createMockStigmer());
      await findSyncedField("Keep answers terse.");

      expect(screen.getByRole("radio", { name: "Platform default" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Stigmer" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Cursor" })).toBeTruthy();
      expect(screen.getByLabelText("Default model — Stigmer")).toBeTruthy();
      expect(screen.getByLabelText("Default model — Cursor")).toBeTruthy();
    });

    it("pairs each harness row with its description (the row IS the context)", async () => {
      renderPanel(createMockStigmer());
      await findSyncedField("Keep answers terse.");

      // Row subtitles come from HARNESS_META — the single source of harness
      // display copy — plus the platform-default explainer.
      expect(screen.getByText("Stigmer picks the harness for new sessions.")).toBeTruthy();
      expect(screen.getByText("Stigmer's native agent runtime")).toBeTruthy();
      expect(screen.getByText("Cursor IDE agent with codebase indexing")).toBeTruthy();
      // The radios' accessible descriptions are wired via aria-describedby.
      expect(
        screen.getByRole("radio", { name: "Stigmer" }).getAttribute("aria-describedby"),
      ).toBeTruthy();
    });

    it("keeps the non-selected harness's model select editable (per-harness models are independent of the default harness)", async () => {
      renderPanel(createMockStigmer({ whoAmI: vi.fn(async () => ACCOUNT_WITH_DEFAULTS) }));
      await findSyncedField("Keep answers terse.");

      // Default harness is cursor, yet the Stigmer model stays settable:
      // the launcher applies the model of the session's ACTIVE harness, so
      // hiding or disabling it would remove a real capability.
      await waitFor(() => {
        expect(screen.getByRole("radio", { name: "Cursor" })).toHaveProperty("checked", true);
      });
      const nativeSelect = screen.getByLabelText("Default model — Stigmer") as HTMLSelectElement;
      expect(nativeSelect.disabled).toBe(false);
      fireEvent.change(nativeSelect, { target: { value: "claude-sonnet-4.6" } });
      expect(nativeSelect.value).toBe("claude-sonnet-4.6");
    });

    it("reflects the saved defaults in the form", async () => {
      renderPanel(createMockStigmer({ whoAmI: vi.fn(async () => ACCOUNT_WITH_DEFAULTS) }));
      await findSyncedField("Keep answers terse.");

      await waitFor(() => {
        expect(screen.getByRole("radio", { name: "Cursor" })).toHaveProperty("checked", true);
        expect(screen.getByLabelText("Default model — Stigmer")).toHaveProperty("value", "claude-sonnet-4.6");
        expect(screen.getByLabelText("Default model — Cursor")).toHaveProperty("value", "default");
      });
    });

    it("saves the complete preferences object — all default fields in one write", async () => {
      const update = vi.fn(async (_input: IdentityAccountInput) => ACCOUNT);
      renderPanel(createMockStigmer({ update }));
      await findSyncedField("Keep answers terse.");

      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      fireEvent.change(screen.getByLabelText("Default model — Stigmer"), {
        target: { value: "claude-sonnet-4.6" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0]![0].preferences).toEqual({
        standingContext: "Keep answers terse.",
        defaultHarness: "cursor",
        defaultNativeModel: "claude-sonnet-4.6",
        defaultCursorModel: undefined,
      });
    });

    it("editing only standing context preserves the structured defaults (nested wipe-bug guard)", async () => {
      const update = vi.fn(async (_input: IdentityAccountInput) => ACCOUNT_WITH_DEFAULTS);
      renderPanel(
        createMockStigmer({ whoAmI: vi.fn(async () => ACCOUNT_WITH_DEFAULTS), update }),
      );

      const field = await findSyncedField("Keep answers terse.");
      fireEvent.change(field, { target: { value: "Terser still." } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0]![0].preferences).toEqual({
        standingContext: "Terser still.",
        defaultHarness: "cursor",
        defaultNativeModel: "claude-sonnet-4.6",
        defaultCursorModel: "default",
      });
    });

    it("keeps a stale saved model legible as an unavailable option", async () => {
      const stale = create(IdentityAccountSchema, {
        metadata: { id: "ia-1", name: "Ada", slug: "ada", org: "acme" },
        spec: {
          idpId: "auth0|abc",
          preferences: { defaultNativeModel: "retired-model" },
        },
      });
      renderPanel(createMockStigmer({ whoAmI: vi.fn(async () => stale) }));
      await findSyncedField("");

      await waitFor(() => {
        const select = screen.getByLabelText("Default model — Stigmer") as HTMLSelectElement;
        expect(select.value).toBe("retired-model");
        expect(
          Array.from(select.options).some((o) => o.text === "retired-model (unavailable)"),
        ).toBe(true);
      });
    });
  });
});
