/**
 * Pin-validation tests — pin the Go pin_validation.go behavior: the
 * harness-name mapping (unset → native, the DD-015 edition-honest
 * posture), the write-time existence rule's refusal copy with did-you-mean
 * (oss#774), the any-harness arm for surfaces without a serving harness,
 * the degrade-to-no-op postures, and the suggestion ranking (distance cap
 * 5, top 3, name-ascending ties).
 */
import { describe, expect, it } from "vitest";

import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import { ModelRegistryStore } from "../model-registry-store.js";
import {
  HARNESS_NAME_CURSOR,
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
    { id: "openai/gpt-6", harness: "cursor" },
  ],
});

describe("harnessName", () => {
  it("maps cursor to its section and everything else to native", () => {
    expect(harnessName(Harness.CURSOR)).toBe(HARNESS_NAME_CURSOR);
    expect(harnessName(Harness.NATIVE)).toBe(HARNESS_NAME_NATIVE);
    expect(harnessName(Harness.UNSPECIFIED)).toBe(HARNESS_NAME_NATIVE);
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
    expect(unknownModelPinRefusal(STORE, "f", "", "openai/gpt-6")).toBe("");
    expect(unknownModelPinRefusal(STORE, "f", "", "openai/gpt-7")).toBe(
      "f: model 'openai/gpt-7' is not in the model registry (any harness); " +
        "did you mean 'openai/gpt-6'?",
    );
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
