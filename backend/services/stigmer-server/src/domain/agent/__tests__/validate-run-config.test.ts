/**
 * Pins ValidateAgentRunConfig (validate-run-config.ts) against the BUNDLED
 * registry: an agent's run defaults are judged on the engine they name.
 *
 *   - no defaults, bounds alone, and an engine with no model pass;
 *   - a model with no engine is refused, naming spec.harness;
 *   - a model the engine does not list is refused with a did-you-mean, even
 *     when the other engine lists it (claude-sonnet-4.6 is native-only);
 *   - FAST needs a model the engine prices fast (composer-2.5 on cursor),
 *     and is refused without a model or on one the engine prices no fast
 *     variant for;
 *   - ENABLED needs a model the engine marks able to think, in either form
 *     (claude-sonnet-5's native entry is adaptive), and is refused without
 *     a model or on one that cannot think there (composer-2.5);
 *   - DISABLED is refused on a model whose entry always thinks
 *     (claude-fable-5 on native), since every turn would be refused.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import { newValidateAgentRunConfigStep } from "../validate-run-config.js";

const registry = new ModelRegistryStore({
  bundledDocument: bundledModelRegistryDocument(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: createLogger({ level: "error", pretty: false, write: () => {} }),
});

const step = newValidateAgentRunConfigStep(registry);

type SpecInit = MessageInitShape<typeof AgentSpecSchema>;

function run(spec: SpecInit): void {
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

function refusal(spec: SpecInit): ConnectError {
  try {
    run(spec);
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
    ["an engine with no model", { harness: Harness.CURSOR }],
    [
      "a native model, thinking on in the adaptive form",
      {
        harness: Harness.NATIVE,
        runConfig: { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
      },
    ],
    [
      "a cursor model priced fast",
      { harness: Harness.CURSOR, runConfig: { modelName: "composer-2.5", serviceTier: ServiceTier.FAST } },
    ],
    [
      "explicit standard and disabled with no model",
      { runConfig: { serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED } },
    ],
  ])("%s", (_, spec) => {
    expect(() => run(spec)).not.toThrow();
  });
});

describe("ValidateAgentRunConfig: what is refused", () => {
  it("a model with no engine named", () => {
    expect(refusal({ runConfig: { modelName: "claude-sonnet-5" } }).rawMessage).toContain(
      "spec.run_config.model_name requires spec.harness",
    );
  });

  it("a model the named engine does not list, with a did-you-mean", () => {
    const err = refusal({
      harness: Harness.CURSOR,
      runConfig: { modelName: "claude-sonnet-4.6" },
    });
    expect(err.rawMessage).toContain("spec.run_config.model_name");
    expect(err.rawMessage).toContain("cursor harness");
  });

  it("FAST with no model", () => {
    expect(
      refusal({ harness: Harness.CURSOR, runConfig: { serviceTier: ServiceTier.FAST } }).rawMessage,
    ).toContain("spec.run_config.service_tier 'fast' requires spec.run_config.model_name");
  });

  it("FAST on a model the engine prices no fast variant for", () => {
    expect(
      refusal({
        harness: Harness.NATIVE,
        runConfig: { modelName: "claude-sonnet-5", serviceTier: ServiceTier.FAST },
      }).rawMessage,
    ).toContain("no fast variant");
  });

  it("ENABLED with no model", () => {
    expect(
      refusal({ harness: Harness.NATIVE, runConfig: { thinkingMode: ThinkingMode.ENABLED } }).rawMessage,
    ).toContain("spec.run_config.thinking_mode 'enabled' requires spec.run_config.model_name");
  });

  it("ENABLED on a model that cannot think on the engine", () => {
    expect(
      refusal({
        harness: Harness.CURSOR,
        runConfig: { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
      }).rawMessage,
    ).toContain("no thinking capability");
  });

  it("thinking off on a model that always thinks on the engine", () => {
    expect(
      refusal({
        harness: Harness.NATIVE,
        runConfig: { modelName: "claude-fable-5", thinkingMode: ThinkingMode.DISABLED },
      }).rawMessage,
    ).toContain("always thinks");
  });
});
