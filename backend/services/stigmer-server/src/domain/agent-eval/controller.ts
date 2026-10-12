/**
 * Agent eval controller: one run of the eval cases of the plugins an agent
 * attaches, on the agent itself, served on both editions.
 *
 * An eval is a child of its agent (kind_meta: scope PARENT through
 * spec.agent_id): the agent's editors start, cancel and delete its evals;
 * the agent's viewers in its own organization read them. It has no owner
 * of its own. The agent's delete removes its evals (cascade.ts), and an
 * organization's purge removes them all (purge.ts).
 *
 * No update and no apply, and not search-indexed, as a plugin eval. Create
 * persists the eval pending with the agent version and every plugin version
 * stamped, then starts its workflow, which writes every later status;
 * cancel asks the workflow to stop; delete removes the tries'
 * conversations through the session domain's own delete, then the eval.
 *
 * Proven by __tests__/agent-eval.test.ts (the composed lanes) and
 * __tests__/steps.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentEvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/command_pb";
import { AgentEvalIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import type {
  AgentEvalId,
  AgentEvalList,
  ListAgentEvalsByAgentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { AgentEvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/query_pb";
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
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import {
  newClaimNameStep,
  newReleaseNamesStep,
  releaseNameOnFailure,
} from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newNormalizeReferencesStep, newValidateReferencesStep } from "../../pipeline/steps/references.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import type { EvalSuiteSource } from "../plugin-eval/suite.js";
import type { TrySessionDeleter } from "../plugin-eval/tries.js";
import type { PluginEvalWorkflows } from "../plugin-eval/workflows.js";
import { chainResult } from "../score/controller.js";
import { newVaultAttachmentsStep } from "../vault/attachments.js";
import {
  AGENT_EVAL_RESULT_KEY,
  newCancelAgentEvalStep,
  newDeleteAgentEvalTriesStep,
  newEnsureEvaluatedAgentStillExistsStep,
  newListAgentEvalsByAgentStep,
  newLoadEvaluatedAgentStep,
  newPlanAgentEvalStep,
  newRefuseActiveAgentEvalDeleteStep,
  newResolveAgentEvalDefaultsStep,
  newSettleEndedAgentEvalStep,
  newStartAgentEvalWorkflowStep,
  newValidateAgentEvalTargetsStep,
  resolveAgentEvalCreateTargets,
} from "./steps.js";
import { AGENT_EVAL_VAULT_ATTACHMENTS } from "./vault-attachments.js";

export interface AgentEvalControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly modelCatalog: ModelCatalogProvider;
  /** Where a plugin version's files are read from (domain/plugin-eval/suite.ts). */
  readonly suites: EvalSuiteSource;
  /** The eval's workflow, started by create and cancelled by cancel. */
  readonly workflows: PluginEvalWorkflows;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
}

/** Registers both agent eval services on the router (routes stage). */
export function registerAgentEvalServices(router: ConnectRouter, deps: AgentEvalControllerDeps): void {
  router.service(AgentEvalCommandController, {
    create: (agentEval, ctx) => createAgentEval(deps, agentEval, ctx),
    cancel: (id, ctx) => cancelAgentEval(deps, id, ctx),
    delete: (id, ctx) => deleteAgentEval(deps, id, ctx),
  });
  router.service(AgentEvalQueryController, {
    get: (id, ctx) => getAgentEval(deps, id, ctx),
    listByAgent: (req, ctx) => listByAgent(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: AuthorizeResolvedTarget asks can_edit on the agent before it is
 * read; then the agent's organization, version and plugins, the targets,
 * the vaults, the cases and their limits (steps.ts). The tuple step writes
 * the eval's link to its agent; the agent is read again, so an eval whose
 * agent was deleted meanwhile goes with it; the workflow starts last.
 */
async function createAgentEval(
  deps: AgentEvalControllerDeps,
  agentEval: AgentEval,
  ctx: HandlerContext,
): Promise<AgentEval> {
  const reqCtx = new RequestContext(AgentEvalSchema, agentEval, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof AgentEvalSchema>("agent-eval-create", deps.logger)
    .addStep(newAuthorizeStep(AgentEvalCommandController.method.create, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(newAuthorizeResolvedTargetStep(deps.authorizer, resolveAgentEvalCreateTargets))
    .addStep(newLoadEvaluatedAgentStep(deps.store))
    .addStep(newResolveAgentEvalDefaultsStep(deps.store))
    .addStep(newValidateAgentEvalTargetsStep(deps.modelCatalog))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newVaultAttachmentsStep(deps.store, deps.authorizer, AGENT_EVAL_VAULT_ATTACHMENTS))
    .addStep(newPlanAgentEvalStep(deps.suites, deps.modelCatalog))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.agent_eval))
    .addStep(newPersistStep(deps.store))
    .addStep(newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger))
    .addStep(newEnsureEvaluatedAgentStillExistsStep(deps.store, deps.authorizationLifecycle, deps.logger))
    .addStep(newStartAgentEvalWorkflowStep(deps.store, deps.workflows, deps.logger))
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/** Cancel: can_edit on the eval (its agent's). A finished eval is answered unchanged. */
async function cancelAgentEval(
  deps: AgentEvalControllerDeps,
  id: AgentEvalId,
  ctx: HandlerContext,
): Promise<AgentEval> {
  const reqCtx = new RequestContext(AgentEvalIdSchema, id, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof AgentEvalIdSchema>("agent-eval-cancel", deps.logger)
    .addStep(newAuthorizeStep(AgentEvalCommandController.method.cancel, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, AgentEvalSchema))
    .addStep(newCancelAgentEvalStep(deps.store, deps.workflows))
    .build()
    .execute(reqCtx);
  return chainResult<AgentEval>(reqCtx.get(AGENT_EVAL_RESULT_KEY), "cancelled agent eval");
}

/**
 * Delete: can_delete on the eval (can_edit on its agent), refused while it
 * is pending or running; the tries' conversations go first, then the row
 * and its access.
 */
async function deleteAgentEval(
  deps: AgentEvalControllerDeps,
  id: AgentEvalId,
  ctx: HandlerContext,
): Promise<AgentEval> {
  const reqCtx = new RequestContext(AgentEvalIdSchema, id, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof AgentEvalIdSchema>("agent-eval-delete", deps.logger)
    .addStep(newAuthorizeStep(AgentEvalCommandController.method.delete, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, AgentEvalSchema))
    .addStep(newRefuseActiveAgentEvalDeleteStep())
    .addStep(newDeleteAgentEvalTriesStep(deps.store, deps.sessions, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.agent_eval))
    .addStep(newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<AgentEval>(reqCtx.get(EXISTING_RESOURCE_KEY), "deleted agent eval");
}

/** Get: can_view on the eval. An eval that outlived its workflow is answered, and stored, failed. */
async function getAgentEval(
  deps: AgentEvalControllerDeps,
  id: AgentEvalId,
  ctx: HandlerContext,
): Promise<AgentEval> {
  const reqCtx = new RequestContext(AgentEvalIdSchema, id, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof AgentEvalIdSchema>("agent-eval-get", deps.logger)
    .addStep(newAuthorizeStep(AgentEvalQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, AgentEvalSchema))
    .addStep(newSettleEndedAgentEvalStep(deps.store))
    .build()
    .execute(reqCtx);
  return chainResult<AgentEval>(reqCtx.get(TARGET_RESOURCE_KEY), "target agent eval");
}

/** ListByAgent: Authorize asks can_view on the agent; each eval is then filtered by its own. */
async function listByAgent(
  deps: AgentEvalControllerDeps,
  req: ListAgentEvalsByAgentRequest,
  ctx: HandlerContext,
): Promise<AgentEvalList> {
  const input = AgentEvalQueryController.method.listByAgent.input;
  const reqCtx = new RequestContext(input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof input>("agent-eval-list-by-agent", deps.logger)
    .addStep(newAuthorizeStep(AgentEvalQueryController.method.listByAgent, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListAgentEvalsByAgentStep(deps.store, deps.authorizer, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<AgentEvalList>(reqCtx.get(AGENT_EVAL_RESULT_KEY), "agent evals");
}
