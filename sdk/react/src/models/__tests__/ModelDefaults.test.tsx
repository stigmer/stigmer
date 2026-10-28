/**
 * Each engine's default model, in Models & providers. Pins that a row saves
 * the moment it changes, naming only its own preference path on the
 * account's id and etag (so the harness choice and every other preference
 * keep their stored values), that each row says whether its model can run
 * here ("Ready" or "Needs an Anthropic key", the platform default judged
 * when none is chosen), and that a saved model the registry no longer lists
 * stays legible as an unavailable option.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema, type IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ModelDefaults } from "../hub/ModelDefaults";
import type { ModelReadinessLookup } from "../readiness";
import { ACCOUNT, OPENAI_ONLY, fakeClient, readinessWrapper, server } from "./readiness-fixture";

afterEach(cleanup);

/** Anthropic missing, OpenAI served: the shape of `OPENAI_ONLY`. */
const readinessOf: ModelReadinessLookup = (harness, modelId) => {
  const judged = OPENAI_ONLY.models.find((model) => model.model === modelId);
  if (judged === undefined) return undefined;
  return {
    harness,
    modelId,
    provider: judged.provider,
    availability:
      judged.provider === "anthropic"
        ? { state: "missing", scope: "organization" }
        : { state: "served", source: "organization", parentOrg: "" },
  };
};

function renderDefaults(account: IdentityAccount = ACCOUNT) {
  const calls = fakeClient(server({ account }));
  render(<ModelDefaults readinessOf={readinessOf} />, { wrapper: readinessWrapper(calls.client) });
  return calls;
}

describe("ModelDefaults", () => {
  it("says each engine's default model can run or what it needs, judging the platform default when none is chosen", async () => {
    renderDefaults();

    const stigmer = await screen.findByRole("combobox", { name: "Stigmer" });
    await waitFor(() => expect(stigmer).toHaveProperty("disabled", false));
    expect(stigmer.getAttribute("aria-describedby")).toBeTruthy();
    // Both engines' platform defaults are Anthropic models here.
    expect(screen.getAllByText("Needs an Anthropic key")).toHaveLength(2);

    fireEvent.change(stigmer, { target: { value: "gpt-5" } });
    expect(await screen.findByText("Ready")).toBeTruthy();
  });

  it("saves a row the moment it changes, naming only that engine's path on the account's id and etag", async () => {
    const calls = renderDefaults();
    const claude = await screen.findByRole("combobox", { name: "Claude Agent" });
    await waitFor(() => expect(claude).toHaveProperty("disabled", false));

    fireEvent.change(claude, { target: { value: "claude-sonnet-5" } });

    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    const [resource, paths] = calls.update.mock.calls[0] as unknown as [IdentityAccount, string[]];
    expect(paths).toEqual(["spec.preferences.default_claude_model"]);
    expect(resource.metadata).toMatchObject({ id: "ia-1", etag: "e1" });
    expect(resource.spec?.preferences?.defaultClaudeModel).toBe("claude-sonnet-5");
  });

  it("keeps a saved model the registry no longer lists legible as an unavailable option", async () => {
    const stale = create(IdentityAccountSchema, {
      metadata: { id: "ia-1", etag: "e1" },
      spec: { preferences: { defaultNativeModel: "retired-model" } },
    });
    renderDefaults(stale);

    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: "Stigmer" }) as HTMLSelectElement;
      expect(select.value).toBe("retired-model");
      expect(Array.from(select.options).some((option) => option.text === "retired-model (unavailable)")).toBe(true);
    });
  });
});
