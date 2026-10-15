/**
 * ScoringRule controller: AI grading switched on for one agent, served on
 * both editions.
 *
 * A scoring rule is a child of its agent (kind_meta: scope PARENT through
 * spec.agent_id): whoever may edit the agent creates, changes and deletes
 * its scoring rule, and whoever may view the agent reads it. It has no owner
 * of its own. The agent's delete removes it (cascade.ts), and an
 * organization's purge removes them all (purge.ts).
 *
 * No apply RPC: grading is configured in the console, never authored as a
 * manifest. Not search-indexed: a scoring rule is a setting reached through
 * its agent, so no IndexSearch or DeleteSearchIndex step appears here.
 *
 * Proven by temporal/grading/__tests__/judge-composed.test.ts, the steps'
 * faults in __tests__/steps.test.ts, and scoring-rule.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { ScoringRuleCommandController } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/command_pb";
import { ScoringRuleQueryController } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/query_pb";
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import type { ScoringRule } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { ScoringRuleIdSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/io_pb";
import type {
  ScoringRuleId,
  GetScoringRuleByAgentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { UpdateScoringRuleInput } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupGrantsStep,
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
import { newClaimNameStep, newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { updateContext } from "../../pipeline/steps/update-input.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import { chainResult } from "../score/controller.js";
import {
  SCORING_RULE_RESULT_KEY,
  newCheckScoringRuleUniqueStep,
  newGetScoringRuleByAgentStep,
  newLoadEvaluatedAgentStep,
  newPersistScoringRuleSettingsStep,
  newResolveScoringRuleDefaultsStep,
  newValidateScoringRuleUpdateStep,
  resolveScoringRuleCreateTargets,
} from "./steps.js";

export interface ScoringRuleControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam: the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * The composed credential binding: the persist and rename backstops
   * refuse a credential that does not reach the row's organization
   * (pipeline/steps/refuse-bound-elsewhere.ts).
   */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver; undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Registers both scoring rule services on the router (routes stage). */
export function registerScoringRuleServices(
  router: ConnectRouter,
  deps: ScoringRuleControllerDeps,
): void {
  router.service(ScoringRuleCommandController, {
    create: (scoringRule, ctx) => createScoringRule(deps, scoringRule, ctx),
    update: (input, ctx) => updateScoringRule(deps, input, ctx),
    delete: (id, ctx) => deleteScoringRule(deps, id, ctx),
  });
  router.service(ScoringRuleQueryController, {
    get: (id, ctx) => getScoringRule(deps, id, ctx),
    getByAgent: (req, ctx) => getByAgent(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: AuthorizeResolvedTarget asks can_edit on the agent before it is
 * read; then the agent's organization, then one per agent (steps.ts). The
 * tuple step writes the scoring rule's link to its agent, through which every
 * later question about it is answered.
 */
async function createScoringRule(
  deps: ScoringRuleControllerDeps,
  scoringRule: ScoringRule,
  ctx: HandlerContext,
): Promise<ScoringRule> {
  const reqCtx = new RequestContext(
    ScoringRuleSchema,
    scoringRule,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoringRuleSchema>("scoring-rule-create", deps.logger)
    .addStep(
      newAuthorizeStep(ScoringRuleCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveScoringRuleCreateTargets,
      ),
    )
    .addStep(newLoadEvaluatedAgentStep(deps.store))
    .addStep(newResolveScoringRuleDefaultsStep())
    .addStep(newCheckScoringRuleUniqueStep(deps.store, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.scoring_rule))
    .addStep(newPersistStep(deps.store, deps.credentialBinding))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/**
 * Update: can_edit on the scoring rule (its agent's). The agent is fixed, and
 * the write keeps the live row's spend and counts (steps.ts).
 */
async function updateScoringRule(
  deps: ScoringRuleControllerDeps,
  input: UpdateScoringRuleInput,
  ctx: HandlerContext,
): Promise<ScoringRule> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      ScoringRuleSchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof ScoringRuleSchema>("scoring-rule-update", deps.logger)
      .addStep(
        newAuthorizeStep(ScoringRuleCommandController.method.update, deps.authorizer,
        input,
      ),
      )
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newValidateScoringRuleUpdateStep())
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newPersistScoringRuleSettingsStep(deps.store, deps.credentialBinding))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
}

/** Delete: can_delete on the scoring rule (can_edit on its agent). Scores already recorded stay. */
async function deleteScoringRule(
  deps: ScoringRuleControllerDeps,
  id: ScoringRuleId,
  ctx: HandlerContext,
): Promise<ScoringRule> {
  const reqCtx = new RequestContext(
    ScoringRuleIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoringRuleIdSchema>("scoring-rule-delete", deps.logger)
    .addStep(
      newAuthorizeStep(ScoringRuleCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ScoringRuleSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.scoring_rule))
    .addStep(
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  return chainResult<ScoringRule>(
    reqCtx.get(EXISTING_RESOURCE_KEY),
    "deleted scoring rule",
  );
}

/** Get: can_view on the scoring rule, which is can_view on its agent. */
async function getScoringRule(
  deps: ScoringRuleControllerDeps,
  id: ScoringRuleId,
  ctx: HandlerContext,
): Promise<ScoringRule> {
  const reqCtx = new RequestContext(
    ScoringRuleIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoringRuleIdSchema>("scoring-rule-get", deps.logger)
    .addStep(
      newAuthorizeStep(ScoringRuleQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, ScoringRuleSchema))
    .build()
    .execute(reqCtx);

  return chainResult<ScoringRule>(
    reqCtx.get(TARGET_RESOURCE_KEY),
    "target scoring rule",
  );
}

/** GetByAgent: the agent's scoring rule; Authorize asks can_view on the agent. */
async function getByAgent(
  deps: ScoringRuleControllerDeps,
  req: GetScoringRuleByAgentRequest,
  ctx: HandlerContext,
): Promise<ScoringRule> {
  const input = ScoringRuleQueryController.method.getByAgent.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("scoring-rule-get-by-agent", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScoringRuleQueryController.method.getByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newGetScoringRuleByAgentStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<ScoringRule>(
    reqCtx.get(SCORING_RULE_RESULT_KEY),
    "scoring rule",
  );
}
