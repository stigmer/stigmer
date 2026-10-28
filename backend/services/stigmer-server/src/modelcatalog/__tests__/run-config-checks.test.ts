/**
 * Pins the save-time checks of a saved RunConfig's tier and thinking mode
 * (run-config-checks.ts) against the BUNDLED registry (and, for the fast
 * tier the bundle prices on no model, a one-row local registry), beyond
 * what the agent suites that call them pin:
 *
 *   - a refusal lists the models the engine offers in that dimension, and
 *     lists none when the engine offers none (an engine the registry does
 *     not know);
 *   - the adaptive thinking form counts as able to think (claude-sonnet-5's
 *     native entry), as at execution create;
 *   - the model-presence rule alone refuses a fast tier or thinking with no
 *     model, and passes either with one, or neither.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";

import { createLogger } from "../../boot/logger.js";
import { bundledModelRegistryDocument } from "../bundled.js";
import { ModelRegistryStore } from "../model-registry-store.js";
import {
  canThinkOn,
  savedChoiceWithoutModelRefusal,
  savedServiceTierRefusal,
  savedThinkingModeRefusal,
} from "../run-config-checks.js";

function storeOf(bundledDocument: string): ModelRegistryStore {
  return new ModelRegistryStore({
    bundledDocument,
    upstreamOrigin: "http://unused.test",
    refreshEnabled: false,
    logger: createLogger({ level: "error", pretty: false, write: () => {} }),
  });
}

const models = storeOf(bundledModelRegistryDocument());

/** One native model priced fast: the bundle prices no fast variant. */
const fastModels = storeOf(
  JSON.stringify({
    models: [
      { id: "claude-sonnet-4.6", harness: "native" },
      { id: "claude-opus-4.8", harness: "native", pricingVariants: { fast: { inputPricePerMillion: 30 } } },
    ],
  }),
);

const SITE = { fieldPath: "spec.run_config" };

describe("the saved tier and thinking checks", () => {
  it("list the engine's fast models, and none for an engine with none", () => {
    const fast = create(RunConfigSchema, { modelName: "claude-sonnet-4.6", serviceTier: ServiceTier.FAST });
    expect(savedServiceTierRefusal(fastModels, SITE, "native", fast)).toContain(
      "models with a fast tier on 'native': claude-opus-4.8",
    );
    const unknownEngine = savedServiceTierRefusal(fastModels, SITE, "no-such-engine", fast);
    expect(unknownEngine).toContain("no fast variant");
    expect(unknownEngine).not.toContain("models with a fast tier");
  });

  it("list the engine's thinking models, and none for an engine with none", () => {
    const thinking = create(RunConfigSchema, { modelName: "no-such-model", thinkingMode: ThinkingMode.ENABLED });
    expect(savedThinkingModeRefusal(models, SITE, "claude", thinking)).toContain(
      "models with a thinking mode on 'claude': claude-fable-5, claude-haiku-4.5",
    );
    const unknownEngine = savedThinkingModeRefusal(models, SITE, "no-such-engine", thinking);
    expect(unknownEngine).toContain("no thinking capability");
    expect(unknownEngine).not.toContain("models with a thinking mode");
  });

  it("count the adaptive thinking form as able to think", () => {
    expect(canThinkOn(models, "native", "claude-sonnet-5")).toBe(true);
    expect(
      savedThinkingModeRefusal(
        models,
        SITE,
        "native",
        create(RunConfigSchema, { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED }),
      ),
    ).toBe("");
  });

  it("the model-presence rule refuses a lone fast tier or thinking, and nothing else", () => {
    expect(savedChoiceWithoutModelRefusal(SITE, create(RunConfigSchema, { serviceTier: ServiceTier.FAST }))).toContain(
      "service_tier 'fast' requires spec.run_config.model_name",
    );
    expect(
      savedChoiceWithoutModelRefusal(SITE, create(RunConfigSchema, { thinkingMode: ThinkingMode.ENABLED })),
    ).toContain("thinking_mode 'enabled' requires spec.run_config.model_name");
    expect(
      savedChoiceWithoutModelRefusal(
        SITE,
        create(RunConfigSchema, { modelName: "claude-opus-4.8", serviceTier: ServiceTier.FAST }),
      ),
    ).toBe("");
    expect(savedChoiceWithoutModelRefusal(SITE, create(RunConfigSchema, { maxCostUsd: 1 }))).toBe("");
    expect(savedChoiceWithoutModelRefusal(SITE, undefined)).toBe("");
  });
});
