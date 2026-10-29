/**
 * Pins validate-service-tier.ts against Go's validate_service_tier_test.go
 * case-for-case: fail-closed create-time validation of the service tier a
 * turn resolved (#357; each case runs ResolveRunConfig first, as the chain
 * does, over a new conversation with no agent, on Claude unless a case
 * names native) against the bundled registry plus one test-local fast
 * price, on the engine the conversation runs (claude-opus-4.8 prices a
 * fast variant on the claude harness only; claude-sonnet-4.6 prices none
 * anywhere). Both editions must refuse the same request with the same
 * message — the conformance tier suite asserts the codes on every target;
 * these tests additionally pin the message fragments.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../../modelcatalog/bundled.js";
import { ModelRegistryStore } from "../../../modelcatalog/model-registry-store.js";
import type { Store } from "../../../store/interface.js";
import { newResolveRunConfigStep } from "../resolve-run-config.js";
import { newValidateServiceTierStep } from "../validate-service-tier.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** The fast-priced model: its fast variant is listed under the claude harness only. */
const FAST_MODEL = "claude-opus-4.8";

/**
 * The bundled registry with a fast variant added to FAST_MODEL's claude
 * row: the bundle prices no fast tier, so the rule's passing and
 * other-engine cases need one of their own.
 */
function documentWithFastVariant(): string {
  const document = JSON.parse(bundledModelRegistryDocument()) as {
    models: Array<Record<string, unknown>>;
  };
  const row = document.models.find((model) => model["id"] === FAST_MODEL && model["harness"] === "claude");
  if (row === undefined) {
    throw new Error(`the bundled registry has no claude row for ${FAST_MODEL}`);
  }
  row["pricingVariants"] = {
    fast: {
      inputPricePerMillion: 30,
      outputPricePerMillion: 150,
      cacheWritePricePerMillion: 37.5,
      cacheReadPricePerMillion: 3,
      source: "test",
    },
  };
  return JSON.stringify(document);
}

const registry = new ModelRegistryStore({
  bundledDocument: documentWithFastVariant(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: silentLogger,
});

const step = newValidateServiceTierStep(registry);

function contextFor(
  config: MessageInitShape<typeof RunConfigSchema> | undefined,
  harness: Harness,
): RequestContext<typeof RunSchema> {
  return new RequestContext(
    RunSchema,
    create(RunSchema, {
      spec: {
        message: "hello",
        target: { case: "sessionSpec", value: { harness } },
        ...(config === undefined ? {} : { runConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.run,
  );
}

/**
 * Resolves and judges a new conversation's turn on `harness` (Claude by
 * default: the registry above prices its fast variant under Claude).
 */
async function run(
  config: MessageInitShape<typeof RunConfigSchema> | undefined,
  harness: Harness = Harness.CLAUDE,
): Promise<void> {
  const ctx = contextFor(config, harness);
  await newResolveRunConfigStep({
    store: {} as Store,
    runLanes: undefined,
    routineProfile: undefined,
  }).execute(ctx);
  await step.execute(ctx);
}

async function refusal(
  config: MessageInitShape<typeof RunConfigSchema>,
  harness: Harness = Harness.CLAUDE,
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
          modelName: FAST_MODEL,
          serviceTier: ServiceTier.FAST,
        })).resolves.toBeUndefined();
  });

  it("FAST without model_name fails closed (no FAST-on-Auto)", async () => {
    const err = await refusal({ serviceTier: ServiceTier.FAST });
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires a model_name");
    // Fast-capable suggestions ride along.
    expect(err.rawMessage).toContain(`models with a fast tier: ${FAST_MODEL}`);
  });

  it("FAST on a model with no fast variant fails closed", async () => {
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
    // FAST_MODEL's fast price is listed under Claude only: on a native
    // conversation the tier would select a variant the turn never applies.
    const err = await refusal(
      { modelName: FAST_MODEL, serviceTier: ServiceTier.FAST },
      Harness.STIGMER,
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("on the stigmer harness");
  });
});
