/**
 * Plugin eval domain steps: who may run a plugin's evals, the plugin and
 * the version an eval runs, the suite it plans and the limits it is held
 * to, the workflow create starts, and the cancel and delete that follow.
 *
 * The create chain asks its question before it reads anything, in the
 * evaluator's anti-probing order (domain/evaluator/steps.ts): can_edit on
 * the plugin named in spec.plugin_id, then the plugin is read, so a caller
 * who cannot edit it learns nothing about whether it exists.
 *
 * Status has one writer once create returns: the eval's workflow
 * (temporal/evals/). Create writes the pending row; a start that fails
 * marks it failed, and a cancel that finds no workflow marks it partial
 * "cancelled". Both of those writes go through the store's atomic
 * read-modify-write and change a row only while it is still pending or
 * running, so they never overwrite what the workflow wrote.
 *
 * Proven by __tests__/steps.test.ts (each step's arms) and
 * __tests__/plugin-eval.test.ts (the composed lanes).
 */
import { ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampMs, timestampNow } from "@bufbuild/protobuf/wkt";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type {
  ListPluginEvalsByPluginRequestSchema,
  PluginEvalIdSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import { PluginEvalListSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import {
  harnessName,
  unknownModelPinRefusal,
} from "../../modelcatalog/pin-validation.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { assignServerId, generateId } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { resolveVersionHash } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { stigmerAllowTools } from "./allow-tools.js";
import {
  PLUGIN_EVAL_CREATE_DENIED_MESSAGE,
  PLUGIN_EVAL_MAX_CASES,
  PLUGIN_EVAL_MAX_TRIES,
  PLUGIN_EVAL_NO_ENGINE_MESSAGE,
  PLUGIN_EVAL_WORKFLOW_ENDED_ERROR,
  pluginEvalActiveDeleteMessage,
  pluginEvalNoCasesMessage,
  pluginEvalNotStartedMessage,
  pluginEvalOrgMismatchMessage,
  pluginEvalOtherPluginToolMessage,
  pluginEvalCaseGlobMessage,
  pluginEvalNotCurrentVersionMessage,
  pluginEvalTooLargeMessage,
} from "./constants.js";
import { caseGlobError, evalModelCatalogOf, planMatrix } from "./matrix.js";
import { listPluginEvals } from "./queries.js";
import type { EvalSuiteSource } from "./suite.js";
import { loadEvalSuite, pluginVersionedBinding } from "./suite.js";
import { deletePluginEvalTries } from "./tries.js";
import type { TrySessionDeleter } from "./tries.js";
import {
  PLUGIN_EVAL_EXECUTION_TIMEOUT_MS,
  PluginEvalEngineUnavailableError,
} from "./workflows.js";
import type { PluginEvalWorkflows } from "./workflows.js";

/** Context key for the plugin a create evaluates, stashed by LoadEvaluatedPlugin. */
export const EVALUATED_PLUGIN_KEY = "evaluatedPlugin";

/** Context key for cancel's and listByPlugin's answers. */
export const PLUGIN_EVAL_RESULT_KEY = "pluginEvalResult";

/** Whether an eval may still start tries: pending or running. */
export function isActivePluginEval(pluginEval: PluginEval): boolean {
  const phase = pluginEval.status?.phase ?? PluginEvalPhase.unspecified;
  return phase === PluginEvalPhase.pending || phase === PluginEvalPhase.running;
}

/**
 * How long past its workflow's execution timeout an eval may still show
 * running: the workflow starts just after the row is written, and may be
 * writing its end at the timeout itself.
 */
const WORKFLOW_ENDED_MARGIN_MS = 60 * 60 * 1000;

/**
 * Whether a pending or running eval's workflow has necessarily closed
 * without writing its end: the workflow starts at create, and its
 * execution timeout (workflows.ts PLUGIN_EVAL_EXECUTION_TIMEOUT_MS), with
 * a margin, has passed since the row was created (or, with no creation
 * stamp, since the eval started running). Answered from the row alone, so
 * a read needs no engine.
 */
export function pluginEvalOutlivedItsWorkflow(pluginEval: PluginEval, nowMs: number): boolean {
  if (!isActivePluginEval(pluginEval)) {
    return false;
  }
  const since = pluginEval.status?.audit?.specAudit?.createdAt ?? pluginEval.status?.startedAt;
  if (since === undefined) {
    return false;
  }
  return timestampMs(since) + PLUGIN_EVAL_EXECUTION_TIMEOUT_MS + WORKFLOW_ENDED_MARGIN_MS < nowMs;
}

/**
 * The eval as it should be answered: one that outlived its workflow is
 * stored failed, "the eval's workflow ended without finishing", through
 * the atomic write that changes only a pending or running row, so a get
 * never shows it running for ever. Any other eval, or a row gone or a
 * store fault meanwhile, is answered as read.
 */
export async function settleEndedPluginEval(store: Store, pluginEval: PluginEval): Promise<PluginEval> {
  if (!pluginEvalOutlivedItsWorkflow(pluginEval, Date.now())) {
    return pluginEval;
  }
  try {
    return await settleUnlessFinished(store, pluginEval.metadata?.id ?? "", failWorkflowEnded);
  } catch {
    return pluginEval;
  }
}

/** Marks a status failed because its workflow ended without finishing. */
function failWorkflowEnded(status: NonNullable<PluginEval["status"]>): void {
  status.phase = PluginEvalPhase.failed;
  status.error = PLUGIN_EVAL_WORKFLOW_ENDED_ERROR;
  status.finishedAt = timestampNow();
}

/**
 * SettleEndedPluginEval: get's answer, after the target is loaded: an eval
 * that outlived its workflow is stored and answered failed
 * (settleEndedPluginEval).
 */
export function newSettleEndedPluginEvalStep(
  store: Store,
): PipelineStep<typeof PluginEvalIdSchema> {
  return {
    name: "SettleEndedPluginEval",
    async execute(ctx: RequestContext<typeof PluginEvalIdSchema>): Promise<void> {
      const target = ctx.get(TARGET_RESOURCE_KEY) as PluginEval | undefined;
      if (target !== undefined) {
        ctx.set(TARGET_RESOURCE_KEY, await settleEndedPluginEval(store, target));
      }
    },
  };
}

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * BEFORE the plugin is read: can_edit on the plugin named in
 * spec.plugin_id. The RPC is is_skip_authorization because the target is
 * that plugin, not the request's own id (command.proto). A server-composed
 * request asks nothing: the entry-point request already passed.
 */
export function resolvePluginEvalCreateTargets(
  ctx: RequestContext<typeof PluginEvalSchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.plugin,
      resourceId: ctx.newState.spec?.pluginId ?? "",
      deniedMessage: PLUGIN_EVAL_CREATE_DENIED_MESSAGE,
    },
  ];
}

/** LoadEvaluatedPlugin: reads the plugin named in spec.plugin_id into EVALUATED_PLUGIN_KEY. */
export function newLoadEvaluatedPluginStep(
  store: Store,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "LoadEvaluatedPlugin",
    async execute(ctx: RequestContext<typeof PluginEvalSchema>): Promise<void> {
      const pluginId = ctx.newState.spec?.pluginId ?? "";
      let plugin: Plugin;
      try {
        plugin = await store.getResource(ApiResourceKind.plugin, pluginId, PluginSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Plugin", pluginId);
        }
        throw internalError(error, "failed to load the plugin to evaluate");
      }
      ctx.set(EVALUATED_PLUGIN_KEY, plugin);
    },
  };
}

function evaluatedPluginOf(ctx: RequestContext<typeof PluginEvalSchema>): Plugin {
  const plugin = ctx.get(EVALUATED_PLUGIN_KEY) as Plugin | undefined;
  if (plugin === undefined) {
    throw internalError(
      new Error("evaluated plugin not found in context"),
      "evaluated plugin not found in context",
    );
  }
  return plugin;
}

/**
 * ResolvePluginEvalDefaults: metadata.org is required and must be the
 * plugin's organization (the request names it so the deleting-organization
 * interceptor covers the lane, and the organization that installed the
 * plugin is the one that pays); the id is minted here so an unnamed eval
 * is named by it; spec.plugin_digest is stamped with the plugin's current
 * version when empty, and refused (FAILED_PRECONDITION) when it names any
 * other: the with-plugin arm runs the plugin as installed now (arm.ts), so
 * an earlier version's suite would be graded against today's plugin;
 * spec.allow_tools is held in Stigmer's names (allow-tools.ts).
 */
export function newResolvePluginEvalDefaultsStep(
  store: Store,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "ResolvePluginEvalDefaults",
    async execute(ctx: RequestContext<typeof PluginEvalSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for a plugin eval");
      }
      const plugin = evaluatedPluginOf(ctx);
      const pluginOrg = plugin.metadata?.org ?? "";
      if (metadata.org !== pluginOrg) {
        throw failedPreconditionError(pluginEvalOrgMismatchMessage(pluginOrg));
      }
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for a plugin eval");
      }
      const current = pluginVersionedBinding.headHashOf(plugin);
      if (current === "") {
        throw failedPreconditionError(pluginEvalNoCasesMessage("evals"));
      }
      const digest = await resolveVersionHash(
        store,
        pluginVersionedBinding,
        plugin,
        spec.pluginDigest,
      );
      if (digest !== current) {
        throw failedPreconditionError(pluginEvalNotCurrentVersionMessage(current));
      }
      spec.pluginDigest = digest;
      const allowed = stigmerAllowTools(spec.allowTools, {
        name: plugin.metadata?.name ?? "",
        slug: plugin.metadata?.slug ?? "",
      });
      if (!allowed.ok) {
        throw invalidArgumentError(
          pluginEvalOtherPluginToolMessage(allowed.entry, allowed.plugin, plugin.metadata?.slug ?? ""),
        );
      }
      spec.allowTools = [...allowed.tools];
      assignServerId(ctx, generateId("pev"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }
    },
  };
}

/**
 * ValidatePluginEvalTargets: every target that names a model names one the
 * catalog runs on that engine, the write-time pin rule every saved model
 * choice follows (modelcatalog/pin-validation.ts), so a typo is refused
 * with a did-you-mean rather than planning tries that cannot start.
 */
export function newValidatePluginEvalTargetsStep(
  catalog: ModelCatalogProvider,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "ValidatePluginEvalTargets",
    execute(ctx: RequestContext<typeof PluginEvalSchema>): void {
      const targets = ctx.newState.spec?.targets ?? [];
      targets.forEach((target, index) => {
        const refusal = unknownModelPinRefusal(
          catalog,
          `spec.targets[${index}].model_name`,
          harnessName(target.harness),
          target.modelName,
        );
        if (refusal !== "") {
          throw invalidArgumentError(refusal);
        }
      });
    },
  };
}

/**
 * PlanPluginEval: refuses a case_glob that is not a glob (INVALID_ARGUMENT,
 * naming it), reads the suite from the archive at the stamped digest,
 * refuses a version with no cases and a suite larger than an eval may run
 * (with the computed counts), and writes the pending status: the planned
 * tries, and the comparison marked provisional while the with-arm runs on
 * the agent the plugin's install composed. Runs after BuildNewState and
 * VaultAttachments, which own the rest of the status.
 */
export function newPlanPluginEvalStep(
  source: EvalSuiteSource,
  catalog: ModelCatalogProvider,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "PlanPluginEval",
    async execute(ctx: RequestContext<typeof PluginEvalSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for a plugin eval");
      }
      const globError = caseGlobError(spec.caseGlob);
      if (globError !== undefined) {
        throw invalidArgumentError(pluginEvalCaseGlobMessage(spec.caseGlob, globError));
      }
      let loaded;
      try {
        loaded = await loadEvalSuite(source, spec.pluginId, spec.pluginDigest);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error;
        }
        throw internalError(error, "failed to read the plugin's evals");
      }
      if (loaded.suite.cases.length === 0) {
        throw failedPreconditionError(pluginEvalNoCasesMessage(loaded.suite.dir));
      }
      const matrix = planMatrix(loaded.suite, spec, evalModelCatalogOf(catalog));
      const tries = matrix.cells.length;
      if (matrix.cases.length > PLUGIN_EVAL_MAX_CASES || tries > PLUGIN_EVAL_MAX_TRIES) {
        throw failedPreconditionError(
          pluginEvalTooLargeMessage(matrix.cases.length, tries),
        );
      }
      if (matrix.cases.length === 0) {
        throw failedPreconditionError(
          "no eval case matches case_glob and case_tags",
        );
      }
      const status = (ctx.newState.status ??= create(PluginEvalStatusSchema));
      status.phase = PluginEvalPhase.pending;
      status.triesTotal = tries;
      status.provisionalDelta = true;
    },
  };
}

/**
 * EnsureEvaluatedPluginStillExists: after the eval and its access are
 * written, the plugin is read again. A plugin deleted meanwhile (its
 * delete listed its evals before this one was stored) takes the eval with
 * it: the row and its access are removed here and the create answers
 * NOT_FOUND for the plugin, so no eval outlives its plugin (the plugin's
 * delete sweeps the other order, cascade.ts SweepPluginEvalsAfterDelete).
 */
export function newEnsureEvaluatedPluginStillExistsStep(
  store: Store,
  authorizationLifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "EnsureEvaluatedPluginStillExists",
    async execute(ctx: RequestContext<typeof PluginEvalSchema>): Promise<void> {
      const pluginId = ctx.newState.spec?.pluginId ?? "";
      try {
        await store.getResource(ApiResourceKind.plugin, pluginId, PluginSchema);
        return;
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, "failed to read the plugin to evaluate again");
        }
      }
      const evalId = ctx.newState.metadata?.id ?? "";
      logger.warn("a plugin eval's plugin was deleted while it was created; removing the eval", {
        evalId,
        pluginId,
      });
      try {
        await store.deleteResource(ApiResourceKind.plugin_eval, evalId);
      } catch (error) {
        throw internalError(error, "failed to remove the plugin eval of a deleted plugin");
      }
      await cleanUpDeletedResource(authorizationLifecycle, logger, {
        kind: ApiResourceKind.plugin_eval,
        resourceId: evalId,
        orgId: ctx.newState.metadata?.org ?? "",
        caller: ctx.callerIdentity,
      });
      throw notFoundError("Plugin", pluginId);
    },
  };
}

/**
 * StartPluginEvalWorkflow: starts the eval's workflow under its
 * deterministic id, after the row and its access are written. A start
 * that fails (no engine yet, a refusal, the deadline) marks the eval
 * failed with its reason, and the create answers that row: the eval was
 * created, and says why it did not run.
 */
export function newStartPluginEvalWorkflowStep(
  store: Store,
  workflows: PluginEvalWorkflows,
  logger: Logger,
): PipelineStep<typeof PluginEvalSchema> {
  return {
    name: "StartPluginEvalWorkflow",
    async execute(ctx: RequestContext<typeof PluginEvalSchema>): Promise<void> {
      const evalId = ctx.newState.metadata?.id ?? "";
      try {
        await workflows.start(evalId);
        return;
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        logger.warn("a plugin eval's workflow could not start; marking it failed", {
          evalId,
          cause,
        });
        const failed = await settleUnlessFinished(store, evalId, (status) => {
          status.phase = PluginEvalPhase.failed;
          status.error = pluginEvalNotStartedMessage(cause);
          status.finishedAt = timestampNow();
        });
        ctx.setNewState(failed);
      }
    },
  };
}

/**
 * Writes `settle` onto an eval's status only while the eval is pending or
 * running, through the store's atomic read-modify-write; answers the row
 * as stored afterwards either way.
 */
async function settleUnlessFinished(
  store: Store,
  evalId: string,
  settle: (status: NonNullable<PluginEval["status"]>) => void,
): Promise<PluginEval> {
  try {
    return await store.updateResource(
      ApiResourceKind.plugin_eval,
      evalId,
      PluginEvalSchema,
      (live) => {
        if (!isActivePluginEval(live)) {
          return;
        }
        settle((live.status ??= create(PluginEvalStatusSchema)));
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("PluginEval", evalId);
    }
    throw internalError(error, "failed to save the plugin eval");
  }
}

/**
 * CancelPluginEval: a finished eval is answered unchanged, and one that
 * outlived its workflow is failed (settleEndedPluginEval) without asking
 * the engine. Otherwise the workflow is asked to cancel, which it answers
 * by stopping the tries in flight and ending partial "cancelled"; when no
 * workflow runs under the eval's id, a pending eval (its start never
 * happened) is marked partial "cancelled" here, and a running one, whose
 * workflow ran and closed without writing its end, failed "the eval's
 * workflow ended without finishing". No engine connection is UNAVAILABLE: whether a
 * workflow runs cannot be told.
 */
export function newCancelPluginEvalStep(
  store: Store,
  workflows: PluginEvalWorkflows,
): PipelineStep<typeof PluginEvalIdSchema> {
  return {
    name: "CancelPluginEval",
    async execute(ctx: RequestContext<typeof PluginEvalIdSchema>): Promise<void> {
      const target = ctx.get(TARGET_RESOURCE_KEY) as PluginEval | undefined;
      if (target === undefined) {
        throw internalError(
          new Error("plugin eval not found in context"),
          "plugin eval not found in context",
        );
      }
      const evalId = target.metadata?.id ?? "";
      if (!isActivePluginEval(target)) {
        ctx.set(PLUGIN_EVAL_RESULT_KEY, target);
        return;
      }
      if (pluginEvalOutlivedItsWorkflow(target, Date.now())) {
        ctx.set(PLUGIN_EVAL_RESULT_KEY, await settleUnlessFinished(store, evalId, failWorkflowEnded));
        return;
      }
      let outcome: "requested" | "not-found";
      try {
        outcome = await workflows.cancel(evalId);
      } catch (error) {
        if (error instanceof PluginEvalEngineUnavailableError) {
          throw unavailableError(PLUGIN_EVAL_NO_ENGINE_MESSAGE);
        }
        throw internalError(error, "failed to cancel the plugin eval");
      }
      if (outcome === "requested") {
        ctx.set(PLUGIN_EVAL_RESULT_KEY, target);
        return;
      }
      if (target.status?.phase === PluginEvalPhase.running) {
        // Only the workflow writes running: it ran, and closed without its end.
        ctx.set(PLUGIN_EVAL_RESULT_KEY, await settleUnlessFinished(store, evalId, failWorkflowEnded));
        return;
      }
      const cancelled = await settleUnlessFinished(store, evalId, (status) => {
        status.phase = PluginEvalPhase.partial;
        status.partialReason = PluginEvalPartialReason.cancelled;
        status.finishedAt = timestampNow();
      });
      ctx.set(PLUGIN_EVAL_RESULT_KEY, cancelled);
    },
  };
}

/**
 * RefuseActivePluginEvalDelete: a pending or running eval is refused,
 * naming cancel, because its tries' conversations may still hold an
 * active run, which a conversation's delete refuses.
 */
export function newRefuseActivePluginEvalDeleteStep(): PipelineStep<
  typeof PluginEvalIdSchema
> {
  return {
    name: "RefuseActivePluginEvalDelete",
    execute(ctx: RequestContext<typeof PluginEvalIdSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as PluginEval | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing plugin eval not found in context"),
          "existing plugin eval not found in context",
        );
      }
      if (isActivePluginEval(existing)) {
        throw failedPreconditionError(
          pluginEvalActiveDeleteMessage(existing.metadata?.id ?? ""),
        );
      }
    },
  };
}

/**
 * DeletePluginEvalTries: each try's conversation goes through the session
 * domain's own delete, which removes its runs and their scores. Runs
 * before the eval's row, so a delete that fails partway is retried from a
 * row that still finds what is left.
 */
export function newDeletePluginEvalTriesStep(
  store: Store,
  sessions: () => TrySessionDeleter,
  logger: Logger,
): PipelineStep<typeof PluginEvalIdSchema> {
  return {
    name: "DeletePluginEvalTries",
    async execute(ctx: RequestContext<typeof PluginEvalIdSchema>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as PluginEval | undefined;
      await deletePluginEvalTries(
        store,
        sessions(),
        logger,
        existing?.metadata?.id ?? ctx.input.value,
      );
    },
  };
}

/**
 * ListPluginEvalsByPlugin: the plugin's evals, newest first, each kept
 * only when the caller may view it. The RPC asked can_view on the plugin;
 * an eval's own can_view is narrower (the plugin's viewers in its own
 * organization), so a child organization's viewer gets an empty list
 * rather than a refusal. Each eval is answered without its tries (every
 * arm's list emptied; its scores, aggregates, per-target results and
 * notes kept), so a list stays small however many tries its evals ran.
 */
export function newListPluginEvalsByPluginStep(
  store: Store,
  authorizer: Authorizer,
  logger: Logger,
): PipelineStep<typeof ListPluginEvalsByPluginRequestSchema> {
  return {
    name: "ListPluginEvalsByPlugin",
    async execute(
      ctx: RequestContext<typeof ListPluginEvalsByPluginRequestSchema>,
    ): Promise<void> {
      let evals: PluginEval[];
      try {
        evals = await listPluginEvals(store, logger, ctx.input.pluginId);
      } catch (error) {
        throw internalError(error, "failed to list the plugin's evals");
      }
      const visible: PluginEval[] = [];
      for (const pluginEval of evals) {
        if (isServerComposedRequest(ctx.callerIdentity)) {
          visible.push(pluginEval);
          continue;
        }
        const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
          permission: IamPermission.can_view,
          resourceKind: ApiResourceKind.plugin_eval,
          resourceId: pluginEval.metadata?.id ?? "",
        });
        if (decision.kind === "unavailable") {
          throw internalError(decision.cause, "failed to authorize the plugin's evals");
        }
        if (decision.kind === "allow") {
          visible.push(pluginEval);
        }
      }
      const answered: PluginEval[] = [];
      for (const pluginEval of visible) {
        const settled = await settleEndedPluginEval(store, pluginEval);
        withoutTries(settled);
        answered.push(settled);
      }
      ctx.set(
        PLUGIN_EVAL_RESULT_KEY,
        create(PluginEvalListSchema, { totalCount: answered.length, items: answered }),
      );
    },
  };
}

/** Empties every arm's tries of `pluginEval`, in place; every summary is kept. */
function withoutTries(pluginEval: PluginEval): void {
  for (const evalCase of pluginEval.status?.cases ?? []) {
    for (const target of evalCase.targets) {
      for (const arm of [target.withPlugin, target.withoutPlugin]) {
        if (arm !== undefined) {
          arm.tries = [];
        }
      }
    }
  }
}
