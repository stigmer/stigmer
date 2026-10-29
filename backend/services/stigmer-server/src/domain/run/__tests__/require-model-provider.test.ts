/**
 * RequireModelProvider (require-model-provider.ts) over each arm: a
 * provider reported missing from the organization or from the runners is
 * refused FailedPrecondition with copy for that scope and ErrorInfo
 * PROVIDER_KEY_REQUIRED naming org, provider and model; a visitor is refused
 * with copy that names no key and carries no ErrorInfo; served and unknown
 * pass, as do a model-less turn, a chain with no placement and a
 * Stigmer-harness model whose provider no key serves; an availability that
 * cannot be read is Unavailable. The provider is a fake, so each arm reads
 * one answer.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import { createLogger } from "../../../boot/logger.js";
import type {
  ProviderAvailabilityProvider,
  ProviderAvailabilityReport,
} from "../../../extensions/provider-availability.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { ProviderNeedCatalog } from "../../../modelcatalog/provider-need.js";
import {
  newRequireModelProviderStep,
  PROVIDER_AVAILABILITY_UNAVAILABLE_COPY,
  PROVIDER_KEY_REQUIRED,
  VISITOR_PROVIDER_MISSING_COPY,
} from "../require-model-provider.js";
import { RUN_CONFIG_PLACEMENT_KEY, type RunConfigPlacement } from "../resolve-run-config.js";

const catalog: ProviderNeedCatalog = {
  providerOf: (_harness, model) => ({ "claude-sonnet-4.6": "anthropic", "gpt-5.2": "openai", "gemini-3-pro": "google" })[model],
  defaultModel: () => "claude-sonnet-4.6",
};

/** The catalog with no default model on any engine, so a turn naming none names none in its refusal. */
const catalogWithoutDefaults: ProviderNeedCatalog = { ...catalog, defaultModel: () => undefined };

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

function stepAnswering(
  report: ProviderAvailabilityReport | Error,
  visitor = false,
  stepCatalog: ProviderNeedCatalog = catalog,
): ReturnType<typeof newRequireModelProviderStep> {
  const availability: ProviderAvailabilityProvider = {
    availability: () => (report instanceof Error ? Promise.reject(report) : Promise.resolve(report)),
  };
  return newRequireModelProviderStep({
    catalog: stepCatalog,
    availability,
    visitorClassifier: { isVisitor: () => visitor },
    logger,
  });
}

function turn(opts: {
  readonly engine?: Harness;
  readonly model?: string;
  readonly reconcile?: boolean;
}): RequestContext<typeof RunSchema> {
  const run = create(RunSchema, {
    metadata: { org: "org-acme" },
    spec: { reconcileFileReview: opts.reconcile ?? false },
    status: { runConfig: { modelName: opts.model ?? "" } },
  });
  const ctx = new RequestContext(RunSchema, run, testCallerIdentity(), ApiResourceKind.run);
  if (opts.engine !== undefined) {
    ctx.set(RUN_CONFIG_PLACEMENT_KEY, { engine: opts.engine } as Partial<RunConfigPlacement>);
  }
  return ctx;
}

async function refusal(step: ReturnType<typeof newRequireModelProviderStep>, ctx: RequestContext<typeof RunSchema>): Promise<ConnectError> {
  try {
    await step.execute(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("the step did not refuse");
}

describe("RequireModelProvider", () => {
  it("refuses a provider missing from the organization, naming the place an admin adds one", async () => {
    const refused = await refusal(
      stepAnswering({ state: "missing", scope: "organization" }),
      turn({ engine: Harness.STIGMER, model: "claude-sonnet-4.6" }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "This organization has no Anthropic key for model 'claude-sonnet-4.6', so the run was not started. An admin can add one in Models & providers.",
    );
    const info = refused.findDetails(ErrorInfoSchema)[0];
    expect(info?.reason).toBe(PROVIDER_KEY_REQUIRED);
    expect(info?.metadata).toEqual({ org: "org-acme", provider: "anthropic", model: "claude-sonnet-4.6" });
  });

  it("refuses a provider missing from the runners, naming stigmer setup and the restart", async () => {
    const refused = await refusal(
      stepAnswering({ state: "missing", scope: "runners" }, false, catalogWithoutDefaults),
      turn({ engine: Harness.CLAUDE }),
    );
    expect(refused.rawMessage).toBe(
      "This server's runners have no Anthropic key, so the run was not started. On your own machine, run `stigmer setup`, then `stigmer down && stigmer up`.",
    );
    expect(refused.findDetails(ErrorInfoSchema)[0]?.metadata).toEqual({ org: "org-acme", provider: "anthropic", model: "" });
  });

  it("tells a laptop to set OPENAI_API_KEY for OpenAI, which stigmer setup does not save", async () => {
    const refused = await refusal(
      stepAnswering({ state: "missing", scope: "runners" }),
      turn({ engine: Harness.STIGMER, model: "gpt-5.2" }),
    );
    expect(refused.rawMessage).toBe(
      "This server's runners have no OpenAI key for model 'gpt-5.2', so the run was not started. On your own machine, set OPENAI_API_KEY in the shell you start Stigmer from, then `stigmer down && stigmer up`.",
    );
  });

  it("names no model in either copy when the turn names none, and the model when it does", async () => {
    const organization = await refusal(
      stepAnswering({ state: "missing", scope: "organization" }, false, catalogWithoutDefaults),
      turn({ engine: Harness.CLAUDE }),
    );
    expect(organization.rawMessage).toBe(
      "This organization has no Anthropic key, so the run was not started. An admin can add one in Models & providers.",
    );
    const runners = await refusal(
      stepAnswering({ state: "missing", scope: "runners" }),
      turn({ engine: Harness.STIGMER, model: "claude-sonnet-4.6" }),
    );
    expect(runners.rawMessage).toBe(
      "This server's runners have no Anthropic key for model 'claude-sonnet-4.6', so the run was not started. On your own machine, run `stigmer setup`, then `stigmer down && stigmer up`.",
    );
  });

  it("passes a run that names no organization, and is named for the chain", async () => {
    const step = stepAnswering({ state: "missing", scope: "organization" });
    expect(step.name).toBe("RequireModelProvider");
    const run = create(RunSchema, { status: { runConfig: { modelName: "claude-sonnet-4.6" } } });
    const ctx = new RequestContext(RunSchema, run, testCallerIdentity(), ApiResourceKind.run);
    ctx.set(RUN_CONFIG_PLACEMENT_KEY, { engine: Harness.STIGMER } as Partial<RunConfigPlacement>);
    await expect(step.execute(ctx)).resolves.toBeUndefined();
  });

  it("refuses a visitor with copy that names no key, and no ErrorInfo", async () => {
    const refused = await refusal(
      stepAnswering({ state: "missing", scope: "organization" }, true),
      turn({ engine: Harness.CLAUDE }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(VISITOR_PROVIDER_MISSING_COPY);
    expect(refused.findDetails(ErrorInfoSchema)).toEqual([]);
  });

  it("passes a provider that is served or unknown", async () => {
    for (const report of [
      { state: "served", source: "organization" },
      { state: "served", source: "parent", parentOrg: "acme-holdings" },
      { state: "served", source: "runners" },
      { state: "unknown" },
    ] as const) {
      await expect(stepAnswering(report).execute(turn({ engine: Harness.STIGMER }))).resolves.toBeUndefined();
    }
  });

  it("passes what it judges nothing for: a model-less turn, no placement, a provider no key serves", async () => {
    const step = stepAnswering({ state: "missing", scope: "organization" });
    await expect(step.execute(turn({ engine: Harness.CLAUDE, reconcile: true }))).resolves.toBeUndefined();
    await expect(step.execute(turn({}))).resolves.toBeUndefined();
    await expect(step.execute(turn({ engine: Harness.STIGMER, model: "gemini-3-pro" }))).resolves.toBeUndefined();
  });

  it("answers Unavailable when the availability cannot be read", async () => {
    const refused = await refusal(stepAnswering(new Error("store down")), turn({ engine: Harness.STIGMER }));
    expect(refused.code).toBe(Code.Unavailable);
    expect(refused.rawMessage).toBe(PROVIDER_AVAILABILITY_UNAVAILABLE_COPY);
  });
});
