/**
 * Pins validate-service-tier.ts against Go's validate_service_tier_test.go
 * case-for-case: fail-closed create-time validation of the service tier a
 * turn resolved (#357; each case runs ResolveRunConfig first, as the chain
 * does, over a new conversation with no agent, on Cursor unless a case
 * names native) against the BUNDLED registry, on the engine the
 * conversation runs
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

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/invocation_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import type { Store } from "../../../store/interface.js";
import { newResolveRunConfigStep } from "../resolve-run-config.js";
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
  config: MessageInitShape<typeof RunConfigSchema> | undefined,
  harness: Harness,
): RequestContext<typeof AgentRunSchema> {
  return new RequestContext(
    AgentRunSchema,
    create(AgentRunSchema, {
      spec: {
        message: "hello",
        target: { case: "sessionSpec", value: { harness } },
        ...(config === undefined ? {} : { runConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_run,
  );
}

/**
 * Resolves and judges a new conversation's turn on `harness` (Cursor by
 * default: the bundled registry prices fast variants under Cursor).
 */
async function run(
  config: MessageInitShape<typeof RunConfigSchema> | undefined,
  harness: Harness = Harness.CURSOR,
): Promise<void> {
  const ctx = contextFor(config, harness);
  await newResolveRunConfigStep({
    store: {} as Store,
    runLanes: undefined,
    scheduleProfile: undefined,
  }).execute(ctx);
  await step.execute(ctx);
}

async function refusal(
  config: MessageInitShape<typeof RunConfigSchema>,
  harness: Harness = Harness.CURSOR,
): Promise<ConnectError> {
  try {
    await run(config, harness);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a fail-closed refusal, step passed");
}

describe("ValidateServiceTier (#357, bundled registry)", () => {
  it("no run_config passes", async () => {
    await expect(run(undefined)).resolves.toBeUndefined();
  });

  it("explicit STANDARD passes without a model", async () => {
    await expect(run({ serviceTier: ServiceTier.STANDARD })).resolves.toBeUndefined();
  });

  it("FAST with a fast-priced model passes", async () => {
    await expect(run({
          modelName: "composer-2.5",
          serviceTier: ServiceTier.FAST,
        })).resolves.toBeUndefined();
  });

  it("FAST without model_name fails closed (no FAST-on-Auto)", async () => {
    const err = await refusal({ serviceTier: ServiceTier.FAST });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires a model_name");
    // Fast-capable suggestions ride along.
    expect(err.rawMessage).toContain("composer-2.5");
  });

  it("FAST on a native model with no fast variant fails closed", async () => {
    const err = await refusal({
      modelName: "claude-sonnet-4.6",
      serviceTier: ServiceTier.FAST,
    });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no fast variant");
    expect(err.rawMessage).toContain("claude-sonnet-4.6");
  });

  it("FAST on an unknown model fails closed", async () => {
    const err = await refusal({
      modelName: "not-a-model",
      serviceTier: ServiceTier.FAST,
    });
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("FAST on a model priced fast only on the other engine fails closed, naming the engine", async () => {
    // composer-2.5's fast price is listed under Cursor only: on a native
    // conversation the tier would select a variant the turn never applies.
    const err = await refusal(
      { modelName: "composer-2.5", serviceTier: ServiceTier.FAST },
      Harness.NATIVE,
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("on the native harness");
  });
});
