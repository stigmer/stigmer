/**
 * Eval run controller: one run of test cases on an agent, or on a plugin
 * on the built-in assistant, served on both editions.
 *
 * An eval run is organization-scoped with two optional parents, its
 * agent and its plugin, exactly one written (the spec's subject oneof):
 * the subject's editors start, cancel and delete its eval runs; the
 * subject's viewers in its own organization read them. It has no owner of
 * its own. The subject's delete removes its eval runs (cascade.ts), and an
 * organization's purge removes them all (purge.ts).
 *
 * No update and no apply: an eval run is one run of the cases with a fixed
 * spec, started from the console or the CLI. Not search-indexed: an eval
 * run is a result reached through its subject's Evals tab.
 *
 * Create persists the eval run pending, then starts its workflow
 * (workflows.ts), which writes every later status. Cancel asks the
 * workflow to stop; delete removes the tries' conversations through the
 * session domain's own delete, then the eval run.
 *
 * Proven by __tests__/eval-run.test.ts (the composed lanes) and
 * __tests__/steps.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/command_pb";
import { EvalRunIdSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import type {
  EvalRunId,
  EvalRunList,
  ListEvalRunsByAgentRequest,
  ListEvalRunsByPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import { EvalRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newAuthorizeResolvedTargetStep } from "../../pipeline/steps/authorize-resolved-target.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newClaimNameStep, newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import { chainResult } from "../score/controller.js";
import { newVaultAttachmentsStep } from "../vault/attachments.js";
import {
  EVAL_RUN_RESULT_KEY,
  newCancelEvalRunStep,
  newSettleEndedEvalRunStep,
  newDeleteEvalRunTriesStep,
  newEnsureEvalRunSubjectStillExistsStep,
  newListEvalRunsBySubjectStep,
  newLoadEvalRunSubjectStep,
  newPlanEvalRunStep,
  newRefuseActiveEvalRunDeleteStep,
  newResolveEvalRunDefaultsStep,
  newStartEvalRunWorkflowStep,
  newValidateEvalRunTargetsStep,
  resolveEvalRunCreateTargets,
} from "./steps.js";
import type { EvalSuiteSource } from "./suite.js";
import type { TrySessionDeleter } from "./tries.js";
import { EVAL_RUN_VAULT_ATTACHMENTS } from "./vault-attachments.js";
import type { EvalRunWorkflows } from "./workflows.js";

export interface EvalRunControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam: the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver; undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The model catalog the targets and the case models are judged against. */
  readonly modelCatalog: ModelCatalogProvider;
  /** Where a plugin version's files are read from (suite.ts). */
  readonly suites: EvalSuiteSource;
  /** The eval run's workflow, started by create and cancelled by cancel. */
  readonly workflows: EvalRunWorkflows;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
}

/** Registers both eval run services on the router (routes stage). */
export function registerEvalRunServices(
  router: ConnectRouter,
  deps: EvalRunControllerDeps,
): void {
  router.service(EvalRunCommandController, {
    create: (evalRun, ctx) => createEvalRun(deps, evalRun, ctx),
    cancel: (id, ctx) => cancelEvalRun(deps, id, ctx),
    delete: (id, ctx) => deleteEvalRun(deps, id, ctx),
  });
  router.service(EvalRunQueryController, {
    get: (id, ctx) => getEvalRun(deps, id, ctx),
    listByAgent: (req, ctx) => listByAgent(deps, req, ctx),
    listByPlugin: (req, ctx) => listByPlugin(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: AuthorizeResolvedTarget asks can_edit on the subject before it
 * is read; then the subject's organization and versions, the plugins its
 * tries load, the targets, the vaults (the reference rule, then who
 * attached each), the cases and their limits (steps.ts). The tuple step
 * writes the eval run's links to its organization and its subject, through
 * which every later question about it is answered; the subject is read
 * again, so an eval run whose subject was deleted meanwhile goes with it;
 * the workflow starts last.
 */
async function createEvalRun(
  deps: EvalRunControllerDeps,
  evalRun: EvalRun,
  ctx: HandlerContext,
): Promise<EvalRun> {
  const reqCtx = new RequestContext(
    EvalRunSchema,
    evalRun,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvalRunSchema>("eval-run-create", deps.logger)
    .addStep(
      newAuthorizeStep(EvalRunCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(
      newAuthorizeResolvedTargetStep(deps.authorizer, resolveEvalRunCreateTargets),
    )
    .addStep(newLoadEvalRunSubjectStep(deps.store))
    .addStep(newResolveEvalRunDefaultsStep(deps.store, deps.authorizer))
    .addStep(newValidateEvalRunTargetsStep(deps.modelCatalog))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(
      newVaultAttachmentsStep(deps.store, deps.authorizer, EVAL_RUN_VAULT_ATTACHMENTS),
    )
    .addStep(newPlanEvalRunStep(deps.suites, deps.modelCatalog))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.eval_run))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(
      newEnsureEvalRunSubjectStillExistsStep(deps.store, deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newStartEvalRunWorkflowStep(deps.store, deps.workflows, deps.logger))
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/** Cancel: can_edit on the eval run (its subject's). A finished eval run is answered unchanged. */
async function cancelEvalRun(
  deps: EvalRunControllerDeps,
  id: EvalRunId,
  ctx: HandlerContext,
): Promise<EvalRun> {
  const reqCtx = new RequestContext(
    EvalRunIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvalRunIdSchema>("eval-run-cancel", deps.logger)
    .addStep(
      newAuthorizeStep(EvalRunCommandController.method.cancel, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, EvalRunSchema))
    .addStep(newCancelEvalRunStep(deps.store, deps.workflows))
    .build()
    .execute(reqCtx);
  return chainResult<EvalRun>(reqCtx.get(EVAL_RUN_RESULT_KEY), "cancelled eval run");
}

/**
 * Delete: can_delete on the eval run (can_edit on its subject), refused
 * while it is pending or running; the tries' conversations go first, through the
 * session domain's delete, then the row and its access.
 */
async function deleteEvalRun(
  deps: EvalRunControllerDeps,
  id: EvalRunId,
  ctx: HandlerContext,
): Promise<EvalRun> {
  const reqCtx = new RequestContext(
    EvalRunIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvalRunIdSchema>("eval-run-delete", deps.logger)
    .addStep(
      newAuthorizeStep(EvalRunCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, EvalRunSchema))
    .addStep(newRefuseActiveEvalRunDeleteStep())
    .addStep(newDeleteEvalRunTriesStep(deps.store, deps.sessions, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.eval_run))
    .addStep(newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<EvalRun>(reqCtx.get(EXISTING_RESOURCE_KEY), "deleted eval run");
}

/**
 * Get: can_view on the eval run: the subject's viewers in its own
 * organization. An eval run that outlived its workflow is answered, and
 * stored, failed.
 */
async function getEvalRun(
  deps: EvalRunControllerDeps,
  id: EvalRunId,
  ctx: HandlerContext,
): Promise<EvalRun> {
  const reqCtx = new RequestContext(
    EvalRunIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvalRunIdSchema>("eval-run-get", deps.logger)
    .addStep(newAuthorizeStep(EvalRunQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, EvalRunSchema))
    .addStep(newSettleEndedEvalRunStep(deps.store))
    .build()
    .execute(reqCtx);
  return chainResult<EvalRun>(reqCtx.get(TARGET_RESOURCE_KEY), "target eval run");
}

/** ListByAgent: Authorize asks can_view on the agent; each eval run is then filtered by its own. */
async function listByAgent(
  deps: EvalRunControllerDeps,
  req: ListEvalRunsByAgentRequest,
  ctx: HandlerContext,
): Promise<EvalRunList> {
  const input = EvalRunQueryController.method.listByAgent.input;
  const reqCtx = new RequestContext(input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof input>("eval-run-list-by-agent", deps.logger)
    .addStep(newAuthorizeStep(EvalRunQueryController.method.listByAgent, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListEvalRunsBySubjectStep<typeof input>("agent", deps.store, deps.authorizer, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<EvalRunList>(reqCtx.get(EVAL_RUN_RESULT_KEY), "agent eval runs");
}

/** ListByPlugin: Authorize asks can_view on the plugin; each eval run is then filtered by its own. */
async function listByPlugin(
  deps: EvalRunControllerDeps,
  req: ListEvalRunsByPluginRequest,
  ctx: HandlerContext,
): Promise<EvalRunList> {
  const input = EvalRunQueryController.method.listByPlugin.input;
  const reqCtx = new RequestContext(input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof input>("eval-run-list-by-plugin", deps.logger)
    .addStep(newAuthorizeStep(EvalRunQueryController.method.listByPlugin, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListEvalRunsBySubjectStep<typeof input>("plugin", deps.store, deps.authorizer, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<EvalRunList>(reqCtx.get(EVAL_RUN_RESULT_KEY), "plugin eval runs");
}
