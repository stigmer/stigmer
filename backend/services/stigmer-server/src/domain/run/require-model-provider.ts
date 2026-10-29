/**
 * RequireModelProvider — a turn whose model provider is known to be missing
 * is refused at create, before anything starts, in every edition.
 *
 * Such a turn could only start a runner that fails at its first model
 * call ("check that your API key is valid", on a machine that has none).
 * Which provider the turn needs is the one rule (modelcatalog/
 * provider-need.ts), read over the engine and model ResolveRunConfig
 * placed the turn on; whether it is there is the composed
 * provider-availability point (extensions/provider-availability.ts), the
 * answer getModelReadiness reports too, so a client that was told a model
 * can run is never refused here, and one told it cannot is.
 *
 * Only a provider reported missing is refused. Unknown passes: a server
 * that cannot see its runners must not refuse a run they may well serve,
 * and the runner's own error answers for it. So do the turns the rule
 * judges nothing for, and a turn that runs no model (`reconcile_file_review`,
 * a file review's Undo). The runner, and the cloud's metered proxy, stay
 * the backstop for what create cannot see: a subagent on another provider,
 * a key removed mid-run, a save to the agent between the turn's two reads
 * (the slot's documented race, extensions/gate-slots.ts).
 *
 * Placement: right after the pre-side-effect gate slot's steps, the place
 * the cloud's own key step held, so every edition's own gates (agent hours,
 * scope, limits) refuse first, and a refusal here orphans nothing.
 *
 * The refusal is FAILED_PRECONDITION, worded for who reads it:
 *   - a member, a routine's fire, an in-process creation: copy naming the
 *     provider, the model and where it is fixed, with ErrorInfo reason
 *     PROVIDER_KEY_REQUIRED and metadata org, provider and model (empty
 *     when the turn names none), which the console renders as a notice
 *     linking Models & providers;
 *   - a visitor (VisitorClassifier): copy that names no key and no
 *     organization detail, and no ErrorInfo, because the visitor error
 *     boundary passes a FAILED_PRECONDITION through as thrown. An edition
 *     with per-channel visitor copy refuses visitors on its own slot step,
 *     which runs first.
 * An availability that cannot be read is UNAVAILABLE: the provider may be
 * there.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Run, RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type {
  ProviderAvailabilityProvider,
  ProviderAvailabilityReport,
} from "../../extensions/provider-availability.js";
import type { VisitorClassifier } from "../../extensions/visitor-classifier.js";
import {
  MODEL_PROVIDER_LABELS,
  providerNeededBy,
  type ModelProvider,
  type ProviderNeed,
  type ProviderNeedCatalog,
} from "../../modelcatalog/provider-need.js";
import { failedPreconditionError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { runConfigPlacementOf } from "./resolve-run-config.js";

/** The ErrorInfo reason of the refusal a member reads. */
export const PROVIDER_KEY_REQUIRED = "PROVIDER_KEY_REQUIRED";

/** The copy when the organization holds no key for the provider. */
export function organizationProviderMissingCopy(need: ProviderNeed): string {
  const forModel = need.model === "" ? "" : ` for model '${need.model}'`;
  return (
    `This organization has no ${MODEL_PROVIDER_LABELS[need.provider]} key${forModel}, ` +
    "so the run was not started. An admin can add one in Models & providers."
  );
}

/**
 * How a person gives their own machine's runner each provider's key:
 * `stigmer setup` saves Anthropic's, and the runner takes OpenAI's from the
 * shell `stigmer up` runs in. Keyed by every provider, so one added is a
 * compile error here until it says how.
 */
const RUNNER_KEY_FIX: Readonly<Record<ModelProvider, string>> = {
  anthropic: "run `stigmer setup`",
  openai: "set OPENAI_API_KEY in the shell you start Stigmer from",
};

/** The copy when this server's runners do not reach the provider. */
export function runnersProviderMissingCopy(need: ProviderNeed): string {
  const forModel = need.model === "" ? "" : ` for model '${need.model}'`;
  return (
    `This server's runners have no ${MODEL_PROVIDER_LABELS[need.provider]} key${forModel}, ` +
    `so the run was not started. On your own machine, ${RUNNER_KEY_FIX[need.provider]}, then \`stigmer down && stigmer up\`.`
  );
}

/** The copy a visitor reads: nothing about the organization's keys. */
export const VISITOR_PROVIDER_MISSING_COPY =
  "This agent is not set up to answer yet. Please try again later.";

/** The copy when the availability could not be read. */
export const PROVIDER_AVAILABILITY_UNAVAILABLE_COPY =
  "Which model providers serve this organization could not be read, so the run was not started. Please try again.";

/**
 * The provider the run being created needs, or undefined when it needs none
 * this rule judges: a turn that runs no model, a chain without a placement
 * (a step driven on its own), or a Stigmer-harness model whose provider no key
 * serves. Exported so an edition's own gate on the create slot judges a run
 * exactly as this step does.
 */
export function runProviderNeed<M extends DescMessage>(
  ctx: RequestContext<M>,
  catalog: ProviderNeedCatalog,
): ProviderNeed | undefined {
  const execution = ctx.newState as unknown as Run;
  if (execution.spec?.reconcileFileReview === true) {
    return undefined;
  }
  const placement = runConfigPlacementOf(ctx);
  if (placement === undefined) {
    return undefined;
  }
  return providerNeededBy(placement.engine, execution.status?.runConfig?.modelName ?? "", catalog);
}

export interface RequireModelProviderDeps {
  readonly catalog: ProviderNeedCatalog;
  readonly availability: ProviderAvailabilityProvider;
  readonly visitorClassifier: VisitorClassifier | undefined;
  readonly logger: Logger;
}

export function newRequireModelProviderStep(
  deps: RequireModelProviderDeps,
): PipelineStep<typeof RunSchema> {
  return {
    name: "RequireModelProvider",
    async execute(ctx) {
      const execution = ctx.newState;
      const org = execution.metadata?.org ?? "";
      if (org === "") {
        return;
      }
      const need = runProviderNeed(ctx, deps.catalog);
      if (need === undefined) {
        return;
      }
      let report: ProviderAvailabilityReport;
      try {
        report = await deps.availability.availability(org, need.provider);
      } catch (err) {
        deps.logger.warn("Run admission could not read model provider availability", {
          org,
          provider: need.provider,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ConnectError(PROVIDER_AVAILABILITY_UNAVAILABLE_COPY, Code.Unavailable);
      }
      if (report.state !== "missing") {
        return;
      }
      deps.logger.info("Run refused: no model provider serves it", {
        org,
        provider: need.provider,
        model: need.model,
        scope: report.scope,
        callerClass: ctx.callerIdentity.callerClass,
      });
      if (deps.visitorClassifier?.isVisitor(ctx.callerIdentity) === true) {
        throw failedPreconditionError(VISITOR_PROVIDER_MISSING_COPY);
      }
      throw failedPreconditionError(
        report.scope === "organization" ? organizationProviderMissingCopy(need) : runnersProviderMissingCopy(need),
        {
          reason: PROVIDER_KEY_REQUIRED,
          metadata: { org, provider: need.provider, model: need.model },
        },
      );
    },
  };
}
