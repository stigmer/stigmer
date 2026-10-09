/**
 * Evaluator domain steps: who may switch grading on for an agent, the
 * agent an evaluator belongs to, one evaluator per agent, and the update
 * that changes settings without touching this month's budget.
 *
 * The create chain asks its question before it reads anything, in the
 * score's anti-probing order (domain/score/steps.ts): can_edit on the agent
 * named in spec.agent_id, then the agent is read, so a caller who cannot
 * edit an agent learns nothing from this lane about whether it exists.
 *
 * Status has one writer besides create and update's audit stamp: the
 * grading budget (budget.ts). An update therefore persists through the
 * store's atomic read-modify-write and keeps the live row's spend and
 * counts (PersistEvaluatorSettings), so a person saving settings while a
 * grade settles never loses the grade's increment.
 *
 * Proven by __tests__/evaluator.test.ts and evaluator.conformance.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { clone, create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { GetEvaluatorByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/io_pb";
import { EvaluatorStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

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
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  EVALUATOR_AGENT_IMMUTABLE_MESSAGE,
  EVALUATOR_CREATE_DENIED_MESSAGE,
  EVALUATOR_EXISTS_REASON,
  evaluatorExistsMessage,
  evaluatorOrgMismatchMessage,
  noEvaluatorMessage,
} from "./constants.js";
import { listAgentEvaluators } from "./queries.js";

/** Context key for the agent a create configures, stashed by LoadEvaluatedAgent. */
export const EVALUATED_AGENT_KEY = "evaluatedAgent";

/** Context key for getByAgent's answer. */
export const EVALUATOR_RESULT_KEY = "evaluatorResult";

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * BEFORE the agent is read: can_edit on the agent named in spec.agent_id.
 * The RPC is is_skip_authorization because the target is that agent, not
 * the request's own id (command.proto). A server-composed request asks
 * nothing: the entry-point request already passed.
 */
export function resolveEvaluatorCreateTargets(
  ctx: RequestContext<typeof EvaluatorSchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.agent,
      resourceId: ctx.newState.spec?.agentId ?? "",
      deniedMessage: EVALUATOR_CREATE_DENIED_MESSAGE,
    },
  ];
}

/** LoadEvaluatedAgent: reads the agent named in spec.agent_id into EVALUATED_AGENT_KEY. */
export function newLoadEvaluatedAgentStep(
  store: Store,
): PipelineStep<typeof EvaluatorSchema> {
  return {
    name: "LoadEvaluatedAgent",
    async execute(ctx: RequestContext<typeof EvaluatorSchema>): Promise<void> {
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
 * ResolveEvaluatorDefaults: metadata.org is required and must be the
 * agent's organization (the request names it so the deleting-organization
 * interceptor covers the lane, and an evaluator lives where its agent
 * does); the id is minted here so an unnamed evaluator is named by it.
 */
export function newResolveEvaluatorDefaultsStep(): PipelineStep<
  typeof EvaluatorSchema
> {
  return {
    name: "ResolveEvaluatorDefaults",
    execute(ctx: RequestContext<typeof EvaluatorSchema>): void {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for an evaluator");
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
        throw failedPreconditionError(evaluatorOrgMismatchMessage(agentOrg));
      }
      assignServerId(ctx, generateId("evl"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }
    },
  };
}

/**
 * CheckEvaluatorUnique: one evaluator per agent, refused with
 * ALREADY_EXISTS carrying EVALUATOR_EXISTS and the existing evaluator's id,
 * so a client switches to update without parsing text. Read before the
 * write, as every slug in the platform is (duplicate.ts): a double click
 * can race it, which the console prevents by disabling the switch while a
 * write is in flight.
 */
export function newCheckEvaluatorUniqueStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof EvaluatorSchema> {
  return {
    name: "CheckEvaluatorUnique",
    async execute(ctx: RequestContext<typeof EvaluatorSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentId ?? "";
      let existing: Evaluator[];
      try {
        existing = await listAgentEvaluators(store, logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to read the agent's evaluator");
      }
      const first = existing[0];
      if (first !== undefined) {
        const id = first.metadata?.id ?? "";
        throw alreadyExistsWithReasonError(evaluatorExistsMessage(id), {
          reason: EVALUATOR_EXISTS_REASON,
          metadata: { evaluator_id: id },
        });
      }
    },
  };
}

/**
 * ValidateEvaluatorUpdate: the agent an evaluator grades is fixed. Runs
 * after LoadExisting and BuildUpdateState, which keep the status.
 */
export function newValidateEvaluatorUpdateStep(): PipelineStep<
  typeof EvaluatorSchema
> {
  return {
    name: "ValidateEvaluatorUpdate",
    execute(ctx: RequestContext<typeof EvaluatorSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Evaluator | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing evaluator not found in context"),
          "existing evaluator not found in context",
        );
      }
      if (ctx.newState.spec?.agentId !== existing.spec?.agentId) {
        throw failedPreconditionError(EVALUATOR_AGENT_IMMUTABLE_MESSAGE);
      }
    },
  };
}

/**
 * PersistEvaluatorSettings: the update's write, through the store's atomic
 * read-modify-write. The settings, metadata and audit come from the
 * request; the month's spend and counts from the live row, so a budget
 * write between this chain's read and its write is kept (module header).
 */
export function newPersistEvaluatorSettingsStep(
  store: Store,
): PipelineStep<typeof EvaluatorSchema> {
  return {
    name: "PersistEvaluatorSettings",
    async execute(ctx: RequestContext<typeof EvaluatorSchema>): Promise<void> {
      const next = ctx.newState;
      const id = next.metadata?.id ?? "";
      refuseBoundElsewhere(ctx.callerIdentity, next.metadata?.org ?? "");
      try {
        const saved = await store.updateResource(
          ApiResourceKind.evaluator,
          id,
          EvaluatorSchema,
          (live) => {
            const status = clone(
              EvaluatorStatusSchema,
              live.status ?? create(EvaluatorStatusSchema),
            );
            status.audit = next.status?.audit;
            live.metadata = next.metadata;
            live.spec = next.spec;
            live.status = status;
          },
        );
        ctx.setNewState(saved);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Evaluator", id);
        }
        throw internalError(error, "failed to save the evaluator");
      }
    },
  };
}

/** GetEvaluatorByAgent: the agent's evaluator, or NOT_FOUND when grading is off. */
export function newGetEvaluatorByAgentStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof GetEvaluatorByAgentRequestSchema> {
  return {
    name: "GetEvaluatorByAgent",
    async execute(
      ctx: RequestContext<typeof GetEvaluatorByAgentRequestSchema>,
    ): Promise<void> {
      const agentId = ctx.input.agentId;
      let evaluators: Evaluator[];
      try {
        evaluators = await listAgentEvaluators(store, logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to read the agent's evaluator");
      }
      const evaluator = evaluators[0];
      if (evaluator === undefined) {
        throw new ConnectError(noEvaluatorMessage(agentId), Code.NotFound);
      }
      ctx.set(EVALUATOR_RESULT_KEY, evaluator);
    },
  };
}
