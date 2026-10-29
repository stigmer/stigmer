/**
 * Pins ValidateAgentRunConfig (validate-run-config.ts) against the BUNDLED
 * registry, and against a small local one where the bundle has no example
 * (it prices no model fast, lists the same models on both engines, and
 * every model in it can think): an agent's run defaults are judged on the
 * engine they name.
 *
 *   - no defaults, bounds alone, and an engine with no model pass;
 *   - a model with no engine is refused, naming spec.harness;
 *   - a model the engine does not list is refused with a did-you-mean, even
 *     when the other engine lists it (the local claude-sonnet-4.6 is
 *     Stigmer-only);
 *   - FAST needs a model the engine prices fast (the local claude-opus-4.8
 *     on claude), and is refused without a model or on one the engine
 *     prices no fast variant for;
 *   - ENABLED needs a model the engine marks able to think, in either form
 *     (claude-sonnet-5's Stigmer entry is adaptive), and is refused without
 *     a model or on one that cannot think there (the local claude-plain);
 *   - DISABLED is refused on a model whose entry always thinks
 *     (claude-fable-5 on Stigmer), since every turn would be refused.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../../modelcatalog/bundled.js";
import { ModelRegistryStore } from "../../../modelcatalog/model-registry-store.js";
import { newValidateAgentRunConfigStep } from "../validate-run-config.js";

function registryOf(bundledDocument: string): ModelRegistryStore {
  return new ModelRegistryStore({
    bundledDocument,
    upstreamOrigin: "http://unused.test",
    refreshEnabled: false,
    logger: createLogger({ level: "error", pretty: false, write: () => {} }),
  });
}

const bundled = newValidateAgentRunConfigStep(registryOf(bundledModelRegistryDocument()));

/** What the bundle has no example of: a fast price, a one-engine model, a model that cannot think. */
const local = newValidateAgentRunConfigStep(
  registryOf(
    JSON.stringify({
      models: [
        { id: "claude-sonnet-4.6", harness: "stigmer", capabilities: { adaptiveThinking: true } },
        {
          id: "claude-opus-4.8",
          harness: "claude",
          pricingVariants: { fast: { inputPricePerMillion: 30 } },
          capabilities: { adaptiveThinking: true },
        },
        { id: "claude-plain", harness: "claude" },
        { id: "claude-sonnet-4.5", harness: "claude", capabilities: { thinking: true } },
      ],
    }),
  ),
);

type SpecInit = MessageInitShape<typeof AgentSpecSchema>;

function run(spec: SpecInit, step = bundled): void {
  step.execute(
    new RequestContext(
      AgentSchema,
      create(AgentSchema, {
        spec: { instructions: "Review pull requests carefully.", ...spec },
      }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    ),
  );
}

function refusal(spec: SpecInit, step = bundled): ConnectError {
  try {
    run(spec, step);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    return error as ConnectError;
  }
  throw new Error("expected a refusal, the step passed");
}

describe("ValidateAgentRunConfig: what passes", () => {
  it.each<[string, SpecInit]>([
    ["no run defaults", {}],
    ["bounds alone, no engine", { runConfig: { maxCostUsd: 2, maxToolRounds: 30 } }],
    ["an engine with no model", { harness: Harness.CLAUDE }],
    [
      "a Stigmer-harness model, thinking on in the adaptive form",
      {
        harness: Harness.STIGMER,
        runConfig: { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
      },
    ],
    [
      "explicit standard and disabled with no model",
      { runConfig: { serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED } },
    ],
  ])("%s", (_, spec) => {
    expect(() => run(spec)).not.toThrow();
  });

  it("a claude model priced fast", () => {
    expect(() =>
      run({ harness: Harness.CLAUDE, runConfig: { modelName: "claude-opus-4.8", serviceTier: ServiceTier.FAST } }, local),
    ).not.toThrow();
  });
});

describe("ValidateAgentRunConfig: what is refused", () => {
  it("a model with no engine named", () => {
    expect(refusal({ runConfig: { modelName: "claude-sonnet-5" } }).rawMessage).toContain(
      "spec.run_config.model_name requires spec.harness",
    );
  });

  it("a model the named engine does not list, with a did-you-mean, though the other engine lists it", () => {
    const err = refusal(
      {
        harness: Harness.CLAUDE,
        runConfig: { modelName: "claude-sonnet-4.6" },
      },
      local,
    );
    expect(err.rawMessage).toContain("spec.run_config.model_name");
    expect(err.rawMessage).toContain("claude harness");
    expect(err.rawMessage).toContain("did you mean 'claude-sonnet-4.5'");
  });

  it("FAST with no model", () => {
    expect(
      refusal({ harness: Harness.CLAUDE, runConfig: { serviceTier: ServiceTier.FAST } }).rawMessage,
    ).toContain("spec.run_config.service_tier 'fast' requires spec.run_config.model_name");
  });

  it("FAST on a model the engine prices no fast variant for", () => {
    expect(
      refusal({
        harness: Harness.STIGMER,
        runConfig: { modelName: "claude-sonnet-5", serviceTier: ServiceTier.FAST },
      }).rawMessage,
    ).toContain("no fast variant");
  });

  it("ENABLED with no model", () => {
    expect(
      refusal({ harness: Harness.STIGMER, runConfig: { thinkingMode: ThinkingMode.ENABLED } }).rawMessage,
    ).toContain("spec.run_config.thinking_mode 'enabled' requires spec.run_config.model_name");
  });

  it("ENABLED on a model that cannot think on the engine", () => {
    expect(
      refusal(
        {
          harness: Harness.CLAUDE,
          runConfig: { modelName: "claude-plain", thinkingMode: ThinkingMode.ENABLED },
        },
        local,
      ).rawMessage,
    ).toContain("no thinking capability");
  });

  it("thinking off on a model that always thinks on the engine", () => {
    expect(
      refusal({
        harness: Harness.STIGMER,
        runConfig: { modelName: "claude-fable-5", thinkingMode: ThinkingMode.DISABLED },
      }).rawMessage,
    ).toContain("always thinks");
  });
});
