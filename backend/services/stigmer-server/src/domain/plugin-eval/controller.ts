/**
 * Plugin eval controller: one run of a plugin's own evals/ cases, served
 * on both editions.
 *
 * An eval is a child of its plugin (kind_meta: scope PARENT through
 * spec.plugin_id): the plugin's editors start, cancel and delete its
 * evals; the plugin's viewers in its own organization read them. It has no
 * owner of its own. The plugin's delete removes its evals (cascade.ts),
 * and an organization's purge removes them all (purge.ts).
 *
 * No update and no apply: an eval is one suite run with a fixed spec,
 * started from the console or the CLI. Not search-indexed: an eval is a
 * result reached through its plugin's Evals tab.
 *
 * Create persists the eval pending, then starts its workflow
 * (workflows.ts), which writes every later status. Cancel asks the
 * workflow to stop; delete removes the tries' conversations through the
 * session domain's own delete, then the eval.
 *
 * Proven by __tests__/plugin-eval.test.ts (the composed lanes) and
 * __tests__/steps.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/command_pb";
import { PluginEvalIdSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import type {
  ListPluginEvalsByPluginRequest,
  PluginEvalId,
  PluginEvalList,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import { PluginEvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/query_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
  PLUGIN_EVAL_RESULT_KEY,
  newCancelPluginEvalStep,
  newDeletePluginEvalTriesStep,
  newListPluginEvalsByPluginStep,
  newLoadEvaluatedPluginStep,
  newPlanPluginEvalStep,
  newRefuseActivePluginEvalDeleteStep,
  newResolvePluginEvalDefaultsStep,
  newStartPluginEvalWorkflowStep,
  newValidatePluginEvalTargetsStep,
  resolvePluginEvalCreateTargets,
} from "./steps.js";
import type { EvalSuiteSource } from "./suite.js";
import type { TrySessionDeleter } from "./tries.js";
import { PLUGIN_EVAL_VAULT_ATTACHMENTS } from "./vault-attachments.js";
import type { PluginEvalWorkflows } from "./workflows.js";

export interface PluginEvalControllerDeps {
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
  /** The eval's workflow, started by create and cancelled by cancel. */
  readonly workflows: PluginEvalWorkflows;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
}

/** Registers both plugin eval services on the router (routes stage). */
export function registerPluginEvalServices(
  router: ConnectRouter,
  deps: PluginEvalControllerDeps,
): void {
  router.service(PluginEvalCommandController, {
    create: (pluginEval, ctx) => createPluginEval(deps, pluginEval, ctx),
    cancel: (id, ctx) => cancelPluginEval(deps, id, ctx),
    delete: (id, ctx) => deletePluginEval(deps, id, ctx),
  });
  router.service(PluginEvalQueryController, {
    get: (id, ctx) => getPluginEval(deps, id, ctx),
    listByPlugin: (req, ctx) => listByPlugin(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: AuthorizeResolvedTarget asks can_edit on the plugin before it is
 * read; then the plugin's organization and version, the targets, the
 * vaults (the reference rule, then who attached each), the suite and its
 * limits (steps.ts). The tuple step writes the eval's link to its plugin,
 * through which every later question about it is answered; the workflow
 * starts last.
 */
async function createPluginEval(
  deps: PluginEvalControllerDeps,
  pluginEval: PluginEval,
  ctx: HandlerContext,
): Promise<PluginEval> {
  const reqCtx = new RequestContext(
    PluginEvalSchema,
    pluginEval,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginEvalSchema>("plugin-eval-create", deps.logger)
    .addStep(
      newAuthorizeStep(PluginEvalCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newAuthorizeResolvedTargetStep(deps.authorizer, resolvePluginEvalCreateTargets),
    )
    .addStep(newLoadEvaluatedPluginStep(deps.store))
    .addStep(newResolvePluginEvalDefaultsStep(deps.store))
    .addStep(newValidatePluginEvalTargetsStep(deps.modelCatalog))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(
      newVaultAttachmentsStep(deps.store, deps.authorizer, PLUGIN_EVAL_VAULT_ATTACHMENTS),
    )
    .addStep(newPlanPluginEvalStep(deps.suites, deps.modelCatalog))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newStartPluginEvalWorkflowStep(deps.store, deps.workflows, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Cancel: can_edit on the eval (its plugin's). A finished eval is answered unchanged. */
async function cancelPluginEval(
  deps: PluginEvalControllerDeps,
  id: PluginEvalId,
  ctx: HandlerContext,
): Promise<PluginEval> {
  const reqCtx = new RequestContext(
    PluginEvalIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginEvalIdSchema>("plugin-eval-cancel", deps.logger)
    .addStep(
      newAuthorizeStep(PluginEvalCommandController.method.cancel, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, PluginEvalSchema))
    .addStep(newCancelPluginEvalStep(deps.store, deps.workflows))
    .build()
    .execute(reqCtx);
  return chainResult<PluginEval>(reqCtx.get(PLUGIN_EVAL_RESULT_KEY), "cancelled plugin eval");
}

/**
 * Delete: can_delete on the eval (can_edit on its plugin), refused while it
 * is pending or running; the tries' conversations go first, through the
 * session domain's delete, then the row and its access.
 */
async function deletePluginEval(
  deps: PluginEvalControllerDeps,
  id: PluginEvalId,
  ctx: HandlerContext,
): Promise<PluginEval> {
  const reqCtx = new RequestContext(
    PluginEvalIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginEvalIdSchema>("plugin-eval-delete", deps.logger)
    .addStep(
      newAuthorizeStep(PluginEvalCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, PluginEvalSchema))
    .addStep(newRefuseActivePluginEvalDeleteStep())
    .addStep(newDeletePluginEvalTriesStep(deps.store, deps.sessions, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<PluginEval>(reqCtx.get(EXISTING_RESOURCE_KEY), "deleted plugin eval");
}

/** Get: can_view on the eval: the plugin's viewers in its own organization. */
async function getPluginEval(
  deps: PluginEvalControllerDeps,
  id: PluginEvalId,
  ctx: HandlerContext,
): Promise<PluginEval> {
  const reqCtx = new RequestContext(
    PluginEvalIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginEvalIdSchema>("plugin-eval-get", deps.logger)
    .addStep(newAuthorizeStep(PluginEvalQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, PluginEvalSchema))
    .build()
    .execute(reqCtx);
  return chainResult<PluginEval>(reqCtx.get(TARGET_RESOURCE_KEY), "target plugin eval");
}

/** ListByPlugin: Authorize asks can_view on the plugin; each eval is then filtered by its own. */
async function listByPlugin(
  deps: PluginEvalControllerDeps,
  req: ListPluginEvalsByPluginRequest,
  ctx: HandlerContext,
): Promise<PluginEvalList> {
  const input = PluginEvalQueryController.method.listByPlugin.input;
  const reqCtx = new RequestContext(input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof input>("plugin-eval-list-by-plugin", deps.logger)
    .addStep(
      newAuthorizeStep(PluginEvalQueryController.method.listByPlugin, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListPluginEvalsByPluginStep(deps.store, deps.authorizer, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<PluginEvalList>(reqCtx.get(PLUGIN_EVAL_RESULT_KEY), "plugin evals");
}
