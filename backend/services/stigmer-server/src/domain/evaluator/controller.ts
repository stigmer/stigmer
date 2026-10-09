/**
 * Evaluator controller: AI grading switched on for one agent, served on
 * both editions.
 *
 * An evaluator is a child of its agent (kind_meta: scope PARENT through
 * spec.agent_id): whoever may edit the agent creates, changes and deletes
 * its evaluator, and whoever may view the agent reads it. It has no owner
 * of its own. The agent's delete removes it (cascade.ts), and an
 * organization's purge removes them all (purge.ts).
 *
 * No apply RPC: grading is configured in the console, never authored as a
 * manifest. Not search-indexed: an evaluator is a setting reached through
 * its agent, so no IndexSearch or DeleteSearchIndex step appears here.
 *
 * Proven by __tests__/evaluator.test.ts and evaluator.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { EvaluatorCommandController } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/command_pb";
import { EvaluatorQueryController } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/query_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { EvaluatorIdSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/io_pb";
import type {
  EvaluatorId,
  GetEvaluatorByAgentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/io_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
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
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import { chainResult } from "../score/controller.js";
import {
  EVALUATOR_RESULT_KEY,
  newCheckEvaluatorUniqueStep,
  newGetEvaluatorByAgentStep,
  newLoadEvaluatedAgentStep,
  newPersistEvaluatorSettingsStep,
  newResolveEvaluatorDefaultsStep,
  newValidateEvaluatorUpdateStep,
  resolveEvaluatorCreateTargets,
} from "./steps.js";

export interface EvaluatorControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam: the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver; undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Registers both evaluator services on the router (routes stage). */
export function registerEvaluatorServices(
  router: ConnectRouter,
  deps: EvaluatorControllerDeps,
): void {
  router.service(EvaluatorCommandController, {
    create: (evaluator, ctx) => createEvaluator(deps, evaluator, ctx),
    update: (evaluator, ctx) => updateEvaluator(deps, evaluator, ctx),
    delete: (id, ctx) => deleteEvaluator(deps, id, ctx),
  });
  router.service(EvaluatorQueryController, {
    get: (id, ctx) => getEvaluator(deps, id, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: AuthorizeResolvedTarget asks can_edit on the agent before it is
 * read; then the agent's organization, then one per agent (steps.ts). The
 * tuple step writes the evaluator's link to its agent, through which every
 * later question about it is answered.
 */
async function createEvaluator(
  deps: EvaluatorControllerDeps,
  evaluator: Evaluator,
  ctx: HandlerContext,
): Promise<Evaluator> {
  const reqCtx = new RequestContext(
    EvaluatorSchema,
    evaluator,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvaluatorSchema>("evaluator-create", deps.logger)
    .addStep(
      newAuthorizeStep(EvaluatorCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveEvaluatorCreateTargets,
      ),
    )
    .addStep(newLoadEvaluatedAgentStep(deps.store))
    .addStep(newResolveEvaluatorDefaultsStep())
    .addStep(newCheckEvaluatorUniqueStep(deps.store, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update: can_edit on the evaluator (its agent's). The agent is fixed, and
 * the write keeps the live row's spend and counts (steps.ts).
 */
async function updateEvaluator(
  deps: EvaluatorControllerDeps,
  evaluator: Evaluator,
  ctx: HandlerContext,
): Promise<Evaluator> {
  const reqCtx = new RequestContext(
    EvaluatorSchema,
    evaluator,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvaluatorSchema>("evaluator-update", deps.logger)
    .addStep(
      newAuthorizeStep(EvaluatorCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newValidateEvaluatorUpdateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPersistEvaluatorSettingsStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/** Delete: can_delete on the evaluator (can_edit on its agent). Scores already recorded stay. */
async function deleteEvaluator(
  deps: EvaluatorControllerDeps,
  id: EvaluatorId,
  ctx: HandlerContext,
): Promise<Evaluator> {
  const reqCtx = new RequestContext(
    EvaluatorIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvaluatorIdSchema>("evaluator-delete", deps.logger)
    .addStep(
      newAuthorizeStep(EvaluatorCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, EvaluatorSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  return chainResult<Evaluator>(
    reqCtx.get(EXISTING_RESOURCE_KEY),
    "deleted evaluator",
  );
}

/** Get: can_view on the evaluator, which is can_view on its agent. */
async function getEvaluator(
  deps: EvaluatorControllerDeps,
  id: EvaluatorId,
  ctx: HandlerContext,
): Promise<Evaluator> {
  const reqCtx = new RequestContext(
    EvaluatorIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EvaluatorIdSchema>("evaluator-get", deps.logger)
    .addStep(
      newAuthorizeStep(EvaluatorQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, EvaluatorSchema))
    .build()
    .execute(reqCtx);

  return chainResult<Evaluator>(
    reqCtx.get(TARGET_RESOURCE_KEY),
    "target evaluator",
  );
}

/** GetByAgent: the agent's evaluator; Authorize asks can_view on the agent. */
async function getByAgent(
  deps: EvaluatorControllerDeps,
  req: GetEvaluatorByAgentRequest,
  ctx: HandlerContext,
): Promise<Evaluator> {
  const input = EvaluatorQueryController.method.getByAgent.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("evaluator-get-by-agent", deps.logger)
    .addStep(
      newAuthorizeStep(
        EvaluatorQueryController.method.getByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newGetEvaluatorByAgentStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<Evaluator>(
    reqCtx.get(EVALUATOR_RESULT_KEY),
    "evaluator",
  );
}
