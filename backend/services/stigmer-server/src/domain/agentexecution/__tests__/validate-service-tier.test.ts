/**
 * Pins validate-service-tier.ts against Go's validate_service_tier_test.go
 * case-for-case: fail-closed create-time validation of
 * ExecutionConfig.service_tier (#357) against the BUNDLED registry
 * (composer-2.5 prices a fast variant; claude-sonnet-4.6 is native with
 * none). Both editions must refuse the same request with the same
 * message — the conformance tier suite asserts the codes on every target;
 * these tests additionally pin the message fragments.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import { newValidateServiceTierStep } from "../validate-service-tier.js";

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

const step = newValidateServiceTierStep(registry);

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

describe("ValidateServiceTier (#357, bundled registry)", () => {
  it("no execution_config passes", () => {
    expect(() => step.execute(contextFor(undefined))).not.toThrow();
  });

  it("explicit STANDARD passes without a model", () => {
    expect(() =>
      step.execute(contextFor({ serviceTier: ServiceTier.STANDARD })),
    ).not.toThrow();
  });

  it("FAST with a fast-priced model passes", () => {
    expect(() =>
      step.execute(
        contextFor({
          modelName: "composer-2.5",
          serviceTier: ServiceTier.FAST,
        }),
      ),
    ).not.toThrow();
  });

  it("FAST without model_name fails closed (no FAST-on-Auto)", () => {
    const err = refusal({ serviceTier: ServiceTier.FAST });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires execution_config.model_name");
    // Fast-capable suggestions ride along.
    expect(err.rawMessage).toContain("composer-2.5");
  });

  it("FAST on a native model with no fast variant fails closed", () => {
    const err = refusal({
      modelName: "claude-sonnet-4.6",
      serviceTier: ServiceTier.FAST,
    });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no fast variant");
    expect(err.rawMessage).toContain("claude-sonnet-4.6");
  });

  it("FAST on an unknown model fails closed", () => {
    const err = refusal({
      modelName: "not-a-model",
      serviceTier: ServiceTier.FAST,
    });
    expect(err.code).toBe(Code.InvalidArgument);
  });
});
