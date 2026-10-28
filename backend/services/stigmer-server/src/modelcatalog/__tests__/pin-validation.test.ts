/**
 * Pin-validation tests — pin the Go pin_validation.go behavior: the
 * harness-name mapping (unset → native, the edition-honest posture), the
 * write-time existence rule's refusal copy with did-you-mean
 * (oss#774), the any-harness arm for surfaces without a serving harness,
 * the degrade-to-no-op postures, the explicit `<provider>:<name>` form an
 * organization's own endpoint serves, and the suggestion ranking (distance cap
 * 5, top 3, name-ascending ties).
 */
import { describe, expect, it } from "vitest";

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { createLogger } from "../../boot/logger.js";
import { ModelRegistryStore } from "../model-registry-store.js";
import {
  HARNESS_NAME_CLAUDE,
  HARNESS_NAME_NATIVE,
  harnessName,
  suggestSimilarModels,
  unknownModelPinRefusal,
} from "../pin-validation.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

function makeStore(document: object): ModelRegistryStore {
  return new ModelRegistryStore({
    bundledDocument: JSON.stringify(document),
    upstreamOrigin: "http://upstream.test",
    refreshEnabled: false,
    logger: silentLogger,
  });
}

const STORE = makeStore({
  models: [
    { id: "anthropic/claude-4", harness: "native" },
    { id: "anthropic/claude-4-mini", harness: "native" },
    { id: "anthropic/claude-opus-9", harness: "claude" },
  ],
});

const NATIVE_ONLY = makeStore({ models: [{ id: "anthropic/claude-4", harness: "native" }] });

describe("harnessName", () => {
  it("maps each engine to its own section, unspecified to native", () => {
    expect(harnessName(Harness.CLAUDE)).toBe(HARNESS_NAME_CLAUDE);
    expect(harnessName(Harness.NATIVE)).toBe(HARNESS_NAME_NATIVE);
    expect(harnessName(Harness.UNSPECIFIED)).toBe(HARNESS_NAME_NATIVE);
  });

  it("gives a number no engine owns a word no section has, never native's", () => {
    expect(harnessName(7 as Harness)).toBe("harness-7");
  });

  it("judges a pin on an engine with no section yet as unverifiable", () => {
    expect(unknownModelPinRefusal(NATIVE_ONLY, "f", harnessName(Harness.CLAUDE), "claude-sonnet-4-6")).toBe("");
  });
});

describe("unknownModelPinRefusal", () => {
  it("accepts valid pins, blank pins, and unknown-harness pins (unverifiable)", () => {
    expect(unknownModelPinRefusal(STORE, "f", "native", "anthropic/claude-4")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "native", "  ")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "cli", "whatever")).toBe("");
  });

  it("refuses a typo'd pin with the pinned copy and did-you-mean", () => {
    // claude-4-mini sits at edit distance 6 from claude-5 — beyond the cap
    // of 5 — so only claude-4 is suggested.
    expect(
      unknownModelPinRefusal(STORE, "spec.model_name", "native", "anthropic/claude-5"),
    ).toBe(
      "spec.model_name: model 'anthropic/claude-5' is not in the model registry " +
        "(native harness); did you mean 'anthropic/claude-4'?",
    );
    // Both candidates within the cap: distance-ascending order.
    expect(
      unknownModelPinRefusal(STORE, "f", "native", "anthropic/claude-4x"),
    ).toBe(
      "f: model 'anthropic/claude-4x' is not in the model registry " +
        "(native harness); did you mean 'anthropic/claude-4', 'anthropic/claude-4-mini'?",
    );
  });

  it("validates against every harness when the surface has no serving harness", () => {
    expect(unknownModelPinRefusal(STORE, "f", "", "anthropic/claude-opus-9")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "", "anthropic/claude-opus-0")).toBe(
      "f: model 'anthropic/claude-opus-0' is not in the model registry (any harness); " +
        "did you mean 'anthropic/claude-opus-9'?",
    );
  });

  it("accepts an explicit openai: or anthropic: model on the native harness and any harness", () => {
    expect(unknownModelPinRefusal(STORE, "f", "native", "openai:llama-3.3-70b")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "native", "Anthropic:my-claude")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "", "openai:llama-3.3-70b")).toBe("");
  });

  it("judges the explicit form like any name on the claude harness, and refuses a bare or unknown prefix", () => {
    expect(unknownModelPinRefusal(STORE, "f", "claude", "anthropic:claude-opus-9")).toBe(
      "f: model 'anthropic:claude-opus-9' is not in the model registry (claude harness); " +
        "did you mean 'anthropic/claude-opus-9'?",
    );
    expect(unknownModelPinRefusal(STORE, "f", "native", "openai:")).not.toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "native", "ollama:llama3")).not.toBe("");
  });

  it("omits the suggestion tail when nothing is within the distance cap", () => {
    expect(
      unknownModelPinRefusal(STORE, "f", "native", "totally/unrelated-thing"),
    ).toBe(
      "f: model 'totally/unrelated-thing' is not in the model registry (native harness)",
    );
  });
});

describe("suggestSimilarModels", () => {
  it("ranks by distance then name, caps at three, drops far candidates", () => {
    const candidates = ["aaaa", "aaab", "aaac", "aab", "zzzzzzzzzzzz"];
    expect(suggestSimilarModels("aaaa", candidates)).toEqual([
      "aaaa",
      "aaab",
      "aaac",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(suggestSimilarModels("CLAUDE", ["claude"])).toEqual(["claude"]);
  });
});
