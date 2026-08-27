/**
 * Pins validate-thinking-mode.ts against Go's
 * validate_thinking_mode_test.go case-for-case: fail-closed create-time
 * validation of ExecutionConfig.thinking_mode (#772) against the BUNDLED
 * registry. Capability-gated and cursor-harness-scoped: claude-opus-4-6
 * declares capabilities.thinking on its cursor entry; composer-2.5's
 * cursor entry declares thinking=false; claude-sonnet-4.6 declares the
 * capability but only on its NATIVE entry, which has no thinking wire
 * mapping in v1 and must refuse.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import { newValidateThinkingModeStep } from "../validate-thinking-mode.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const registry = new ModelRegistryStore({
  bundledDocument: bundledModelRegistryDocument(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: silentLogger,
});

const step = newValidateThinkingModeStep(registry);

function contextFor(
  config: MessageInitShape<typeof ExecutionConfigSchema> | undefined,
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      spec: {
        message: "hello",
        ...(config === undefined ? {} : { executionConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_execution,
  );
}

function refusal(
  config: MessageInitShape<typeof ExecutionConfigSchema>,
): ConnectError {
  try {
    step.execute(contextFor(config));
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a fail-closed refusal, step passed");
}

describe("ValidateThinkingMode (#772, bundled registry)", () => {
  it("no execution_config passes", () => {
    expect(() => step.execute(contextFor(undefined))).not.toThrow();
  });

  it("explicit DISABLED passes without a model", () => {
    expect(() =>
      step.execute(contextFor({ thinkingMode: ThinkingMode.DISABLED })),
    ).not.toThrow();
  });

  it("ENABLED with a thinking-capable cursor model passes", () => {
    expect(() =>
      step.execute(
        contextFor({
          modelName: "claude-opus-4-6",
          thinkingMode: ThinkingMode.ENABLED,
        }),
      ),
    ).not.toThrow();
  });

  it("ENABLED combines freely with FAST — the combination bills as the fast variant", () => {
    expect(() =>
      step.execute(
        contextFor({
          modelName: "claude-opus-4-6",
          serviceTier: ServiceTier.FAST,
          thinkingMode: ThinkingMode.ENABLED,
        }),
      ),
    ).not.toThrow();
  });

  it("ENABLED without model_name fails closed (no thinking-on-Auto)", () => {
    const err = refusal({ thinkingMode: ThinkingMode.ENABLED });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires execution_config.model_name");
    // Thinking-capable suggestions ride along.
    expect(err.rawMessage).toContain("claude-opus-4-6");
  });

  it("ENABLED on a cursor model without the capability fails closed", () => {
    const err = refusal({
      modelName: "composer-2.5",
      thinkingMode: ThinkingMode.ENABLED,
    });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no thinking capability");
    expect(err.rawMessage).toContain("composer-2.5");
  });

  it("ENABLED on a native-only model fails closed (no native wire mapping in v1)", () => {
    const err = refusal({
      modelName: "claude-sonnet-4.6",
      thinkingMode: ThinkingMode.ENABLED,
    });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("cursor");
    expect(err.rawMessage).toContain("claude-sonnet-4.6");
  });

  it("ENABLED on an unknown model fails closed", () => {
    const err = refusal({
      modelName: "not-a-model",
      thinkingMode: ThinkingMode.ENABLED,
    });
    expect(err.code).toBe(Code.InvalidArgument);
  });
});
