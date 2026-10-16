/**
 * ScoringRule domain steps: who may switch grading on for an agent, the
 * agent a scoring rule belongs to, one scoring rule per agent, and the update
 * that changes settings without touching this month's budget.
 *
 * The create chain asks its question before it reads anything, in the
 * score's anti-probing order (domain/score/steps.ts): can_edit on the agent
 * named in spec.agent_id, then the agent is read, so a caller who cannot
 * edit an agent learns nothing from this lane about whether it exists.
 *
 * Status has one writer besides create and update's audit stamp: the
 * grading budget (budget.ts). An update therefore persists by
 * compare-and-swap on the row it read (PersistScoringRuleSettings), and a
 * grade that settles in between makes it run again from a fresh read
 * (pipeline/guarded-write.ts), so a person saving settings never loses
 * the grade's increment.
 *
 * Proven by __tests__/steps.test.ts (the faults),
 * temporal/grading/__tests__/judge-composed.test.ts and
 * scoring-rule.conformance.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import type { ScoringRule } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import type { GetScoringRuleByAgentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import {
  alreadyExistsWithReasonError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import { assignServerId, generateId } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { swapOntoLoadedRow } from "../../pipeline/steps/persist.js";
import type { OrganizationAdmission } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  SCORING_RULE_AGENT_IMMUTABLE_MESSAGE,
  SCORING_RULE_CREATE_DENIED_MESSAGE,
  SCORING_RULE_EXISTS_REASON,
  scoringRuleExistsMessage,
  scoringRuleOrgMismatchMessage,
  noScoringRuleMessage,
} from "./constants.js";
import { listAgentScoringRules } from "./queries.js";

/** Context key for the agent a create configures, stashed by LoadEvaluatedAgent. */
export const EVALUATED_AGENT_KEY = "evaluatedAgent";

/** Context key for getByAgent's answer. */
export const SCORING_RULE_RESULT_KEY = "scoringRuleResult";

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * BEFORE the agent is read: can_edit on the agent named in spec.agent_id.
 * The RPC is is_skip_authorization because the target is that agent, not
 * the request's own id (command.proto). A server-composed request asks
 * nothing: the entry-point request already passed.
 */
export function resolveScoringRuleCreateTargets(
  ctx: RequestContext<typeof ScoringRuleSchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.agent,
      resourceId: ctx.newState.spec?.agentId ?? "",
      deniedMessage: SCORING_RULE_CREATE_DENIED_MESSAGE,
    },
  ];
}

/** LoadEvaluatedAgent: reads the agent named in spec.agent_id into EVALUATED_AGENT_KEY. */
export function newLoadEvaluatedAgentStep(
  store: Store,
): PipelineStep<typeof ScoringRuleSchema> {
  return {
    name: "LoadEvaluatedAgent",
    async execute(ctx: RequestContext<typeof ScoringRuleSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentId ?? "";
      let agent: Agent;
      try {
        agent = await store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Agent", agentId);
        }
        throw internalError(error, "failed to load the agent to grade");
      }
      ctx.set(EVALUATED_AGENT_KEY, agent);
    },
  };
}

/**
 * ResolveScoringRuleDefaults: metadata.org is required and must be the
 * agent's organization (the request names it so the deleting-organization
 * interceptor covers the lane, and a scoring rule lives where its agent
 * does); the id is minted here so an unnamed scoring rule is named by it.
 */
export function newResolveScoringRuleDefaultsStep(): PipelineStep<
  typeof ScoringRuleSchema
> {
  return {
    name: "ResolveScoringRuleDefaults",
    execute(ctx: RequestContext<typeof ScoringRuleSchema>): void {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for a scoring rule");
      }
      const agent = ctx.get(EVALUATED_AGENT_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error("evaluated agent not found in context"),
          "evaluated agent not found in context",
        );
      }
      const agentOrg = agent.metadata?.org ?? "";
      if (metadata.org !== agentOrg) {
        throw failedPreconditionError(scoringRuleOrgMismatchMessage(agentOrg));
      }
      assignServerId(ctx, generateId("srl"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }
    },
  };
}

/**
 * CheckScoringRuleUnique: one scoring rule per agent, refused with
 * ALREADY_EXISTS carrying SCORING_RULE_EXISTS and the existing scoring rule's id,
 * so a client switches to update without parsing text. Read before the
 * write, as every slug in the platform is (duplicate.ts): a double click
 * can race it, which the console prevents by disabling the switch while a
 * write is in flight.
 */
export function newCheckScoringRuleUniqueStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof ScoringRuleSchema> {
  return {
    name: "CheckScoringRuleUnique",
    async execute(ctx: RequestContext<typeof ScoringRuleSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentId ?? "";
      let existing: ScoringRule[];
      try {
        existing = await listAgentScoringRules(store, logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to read the agent's scoring rule");
      }
      const first = existing[0];
      if (first !== undefined) {
        const id = first.metadata?.id ?? "";
        throw alreadyExistsWithReasonError(scoringRuleExistsMessage(id), {
          reason: SCORING_RULE_EXISTS_REASON,
          metadata: { scoring_rule_id: id },
        });
      }
    },
  };
}

/**
 * ValidateScoringRuleUpdate: the agent a scoring rule grades is fixed. Runs
 * after LoadExisting and BuildUpdateState, which keep the status.
 */
export function newValidateScoringRuleUpdateStep(): PipelineStep<
  typeof ScoringRuleSchema
> {
  return {
    name: "ValidateScoringRuleUpdate",
    execute(ctx: RequestContext<typeof ScoringRuleSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as ScoringRule | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing scoring rule not found in context"),
          "existing scoring rule not found in context",
        );
      }
      if (ctx.newState.spec?.agentId !== existing.spec?.agentId) {
        throw failedPreconditionError(SCORING_RULE_AGENT_IMMUTABLE_MESSAGE);
      }
    },
  };
}

/**
 * PersistScoringRuleSettings: the update's write. The settings, metadata and
 * audit come from the request, the month's spend and counts from the row
 * the chain read (BuildUpdateState), stored by compare-and-swap on that
 * row, so a budget write between the read and the write makes the chain
 * run again rather than be undone (module header).
 */
export function newPersistScoringRuleSettingsStep(
  store: Store,
  binding: OrganizationAdmission,
): PipelineStep<typeof ScoringRuleSchema> {
  return {
    name: "PersistScoringRuleSettings",
    async execute(ctx: RequestContext<typeof ScoringRuleSchema>): Promise<void> {
      await refuseBoundElsewhere(
        binding,
        ctx.callerIdentity,
        ctx.newState.metadata?.org ?? "",
      );
      await swapOntoLoadedRow(store, ctx, "failed to save the scoring rule");
    },
  };
}

/** GetScoringRuleByAgent: the agent's scoring rule, or NOT_FOUND when grading is off. */
export function newGetScoringRuleByAgentStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof GetScoringRuleByAgentRequestSchema> {
  return {
    name: "GetScoringRuleByAgent",
    async execute(
      ctx: RequestContext<typeof GetScoringRuleByAgentRequestSchema>,
    ): Promise<void> {
      const agentId = ctx.input.agentId;
      let scoringRules: ScoringRule[];
      try {
        scoringRules = await listAgentScoringRules(store, logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to read the agent's scoring rule");
      }
      const scoringRule = scoringRules[0];
      if (scoringRule === undefined) {
        throw new ConnectError(noScoringRuleMessage(agentId), Code.NotFound);
      }
      ctx.set(SCORING_RULE_RESULT_KEY, scoringRule);
    },
  };
}
