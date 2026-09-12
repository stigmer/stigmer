/**
 * The module-boundary double for `shared/model-client.ts` — how a
 * `ScriptedModel` reaches the REAL `performSetup`.
 *
 * `buildChatModel` is the runner's single construction point for LangChain
 * chat models, and `performSetup` reaches it three ways: the primary model
 * (`setup.ts` step 9), every sub-agent's `modelFactory` (step 11b), and the
 * structured-output extractor. `performSetup(deps)` takes no model, so the
 * one seam a hermetic run has is this module — the native analog of the Cursor
 * driver's `vi.mock("@cursor/sdk")`: the vendor engine doubled where the
 * runner imports it, and nothing else (S3 M0 ruling Q-M0-1, amending
 * Q-S3-11).
 *
 * `vi.mock` is hoisted and must live in the test file; the factory can
 * `await import()` this module:
 *
 * ```ts
 * vi.mock("../../../../shared/model-client.js", async () =>
 *   (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
 * );
 * ```
 *
 * Every build the activity requests is recorded (`builds`) so a scenario can
 * assert WHAT production asked for — the registry id, the service tier, the
 * proxy posture — while the model handed back is the scenario's script. The
 * provider is inferred from the requested name exactly as the real module
 * does, so a golden's provider-labelled copy reads as in production.
 */

import type { BuildChatModelOptions, BuiltChatModel } from "../../../shared/model-client.js";
import { stripProviderPrefix, tryInferProvider } from "../../../shared/llm-proxy.js";
import type { ScriptedModel } from "./scripted-model.js";

let boundModel: ScriptedModel | undefined;
const builds: BuildChatModelOptions[] = [];

/**
 * Bind the model every `buildChatModel` call hands back for the current
 * scenario, and forget the previous scenario's build log. Called by the
 * driver at `beginDeepAgentScenario`, before the activity factory runs.
 */
export function bindScriptedModel(model: ScriptedModel): void {
  boundModel = model;
  builds.length = 0;
}

/** The `buildChatModel` requests the activity made in this scenario, in order. */
export function recordedModelBuilds(): readonly BuildChatModelOptions[] {
  return builds;
}

/** The factory a test passes to `vi.mock(".../shared/model-client.js", ...)`. */
export function scriptedModelClientModule(): {
  buildChatModel: (opts: BuildChatModelOptions) => Promise<BuiltChatModel>;
} {
  return {
    buildChatModel: async (opts) => {
      if (!boundModel) {
        throw new Error(
          "scripted-model-module: no ScriptedModel bound — call bindScriptedModel(model) " +
            "before constructing the activities",
        );
      }
      builds.push(opts);
      return {
        model: boundModel,
        provider: tryInferProvider(opts.modelName) ?? "anthropic",
        apiModelId: stripProviderPrefix(opts.modelName),
      };
    },
  };
}
