/**
 * The module-boundary double for `shared/model-client.ts` — how a
 * `ScriptedModel` reaches the REAL native engine build.
 *
 * `buildChatModel` is the runner's single construction point for LangChain
 * chat models, and a native turn reaches it three ways: the primary model
 * (`turn-setup.ts` `buildEngine`), every sub-agent's `modelFactory` (the same
 * `buildModelFor`), and the runtime's tier-2 structured-output extractor
 * (`shared/extract-structured-output.ts`). None of them takes a model as an
 * argument, so the one seam a hermetic run has is this module — the native analog of the Cursor
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
 *
 * A scenario binds ONE model (every build of every execution gets it) or a
 * RESOLVER over the build's options: production scopes every build to its
 * execution through `headerScope.executionId` (the proxy's attribution
 * header), so a test that runs several executions at once — the harness
 * contract kit's concurrency invariant — routes each build to that
 * execution's own engine through the id production already sends, and
 * through nothing added for the test (S3 M3).
 */

import type { BuildChatModelOptions, BuiltChatModel } from "../../../shared/model-client.js";
import { stripProviderPrefix, tryInferProvider } from "../../../shared/llm-proxy.js";
import type { ScriptedModel } from "./scripted-model.js";

/** Which `ScriptedModel` answers one `buildChatModel` call. */
export type ScriptedModelResolver = (opts: BuildChatModelOptions) => ScriptedModel;

let resolve: ScriptedModelResolver | undefined;
const builds: BuildChatModelOptions[] = [];

/**
 * Bind the model every `buildChatModel` call hands back for the current
 * scenario — or a resolver that picks one per call — and forget the previous
 * scenario's build log. Called by the driver at `beginDeepAgentScenario`,
 * before the activity factory runs.
 */
export function bindScriptedModel(model: ScriptedModel | ScriptedModelResolver): void {
  resolve = typeof model === "function" ? model : () => model;
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
      if (!resolve) {
        throw new Error(
          "scripted-model-module: no ScriptedModel bound — call bindScriptedModel(model) " +
            "before constructing the activities",
        );
      }
      builds.push(opts);
      return {
        model: resolve(opts),
        provider: tryInferProvider(opts.modelName) ?? "anthropic",
        apiModelId: stripProviderPrefix(opts.modelName),
      };
    },
  };
}
