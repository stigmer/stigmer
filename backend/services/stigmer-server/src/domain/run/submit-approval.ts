/**
 * SubmitApproval: the run-scoped answer to a waiting tool call, kept for
 * the clients that still send it, an adapter onto the session's answer
 * core (domain/session/hitl/answer.ts) since approvals became session
 * events. Its wire and its authorization (can_edit on the run) stay.
 *
 * Chain: Authorize (can_edit on the run) → ValidateProto → LoadExisting
 * (NOT_FOUND for an unknown run) → FindToolCall (FAILED_PRECONDITION for
 * a run that is neither waiting nor in progress, then INVALID_ARGUMENT for
 * a call the run does not hold, both as before) → the answer core, on the
 * tool use the call wrote (its id derived the runner's way,
 * domain/session/events/ids.ts).
 *
 * The words map onto the session's: APPROVE is allow; SKIP and REJECT are
 * deny, the comment its deny_message (the agent reads it); APPROVE_ALL is
 * a grant of the call's class for the rest of the turn. The reply is the
 * run after the answer, as before.
 */
import { enumToJson } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import {
  ApprovalAction,
  ApprovalActionSchema,
  RunPhase,
  RunPhaseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { ResourceNotFoundError } from "../../store/interface.js";

import { answerOutcomeOf, answerSteps } from "../session/hitl/answer.js";
import type { AnswerDeps, AnswerRequest } from "../session/hitl/answer.js";
import { toolUseEventId } from "../session/events/ids.js";
import { sessionIdOfRun } from "../session/events/transitions.js";

export interface SubmitApprovalDeps extends AnswerDeps {
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
}

type SubmitApprovalDesc =
  typeof RunCommandController.method.submitApproval.input;

const TARGET_RESOURCE_KEY = "targetResource";

export async function submitApproval(
  deps: SubmitApprovalDeps,
  input: SubmitApprovalInput,
  identity: CallerIdentity,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunCommandController.method.submitApproval.input,
    input,
    identity,
    ApiResourceKind.run,
  );
  const builder = newPipeline<SubmitApprovalDesc>(
    "agent-execution-submit-approval",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.submitApproval,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "LoadExisting",
      async execute(ctx) {
        // ValidateProto has already refused an empty run_id (min_len).
        const executionId = ctx.input.runId;
        let execution: Run;
        try {
          execution = await deps.store.getResource(
            ApiResourceKind.run,
            executionId,
            RunSchema,
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("Run", executionId);
          }
          throw internalError(error, "failed to load agent execution");
        }
        ctx.set(TARGET_RESOURCE_KEY, execution);
      },
    })
    .addStep({
      name: "FindToolCall",
      execute(ctx) {
        const execution = ctx.get(TARGET_RESOURCE_KEY) as Run;
        const phase = execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        if (phase !== RunPhase.RUN_WAITING_FOR_APPROVAL && phase !== RunPhase.RUN_IN_PROGRESS) {
          throw failedPreconditionError(
            `execution ${ctx.input.runId} is in phase ${enumToJson(RunPhaseSchema, phase) as string}, approval requires RUN_WAITING_FOR_APPROVAL or RUN_IN_PROGRESS`,
          );
        }
        if (findToolCallInExecution(execution, ctx.input.toolCallId) === undefined) {
          throw invalidArgumentError(
            `tool_call_id ${ctx.input.toolCallId} not found in messages for execution ${ctx.input.runId}`,
          );
        }
      },
    });
  for (const step of answerSteps<SubmitApprovalDesc>(deps, (ctx) =>
    answerRequestOf(ctx.get(TARGET_RESOURCE_KEY) as Run, ctx.input),
  )) {
    builder.addStep(step);
  }
  await builder.build().execute(reqCtx);
  return answerOutcomeOf(reqCtx).run;
}

/** The session answer an approval decision is. */
function answerRequestOf(run: Run, input: SubmitApprovalInput): AnswerRequest {
  const toolUseId = toolUseEventId(input.runId, input.toolCallId);
  const sessionId = sessionIdOfRun(run);
  switch (input.action) {
    case ApprovalAction.APPROVE:
      return { sessionId, toolUseId, result: "allow", denyMessage: "", grant: false };
    case ApprovalAction.APPROVE_ALL:
      return { sessionId, toolUseId, result: "allow", denyMessage: "", grant: true };
    case ApprovalAction.SKIP:
    case ApprovalAction.REJECT:
      return { sessionId, toolUseId, result: "deny", denyMessage: input.comment, grant: false };
    /* v8 ignore next 4 -- @preserve: ValidateProto admits only the four defined actions */
    default:
      throw invalidArgumentError(
        `action ${enumToJson(ApprovalActionSchema, input.action) as string} is not an answer`,
      );
  }
}

/**
 * Searches for a ToolCall by ID in messages (root and sub-agent). Tool
 * calls live exclusively in messages[].tool_calls.
 */
export function findToolCallInExecution(
  execution: Run,
  toolCallId: string,
): ToolCall | undefined {
  for (const msg of execution.status?.messages ?? []) {
    for (const tc of msg.toolCalls) {
      if (tc.id === toolCallId) {
        return tc;
      }
    }
  }
  for (const sa of execution.status?.subAgentRuns ?? []) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.id === toolCallId) {
          return tc;
        }
      }
    }
  }
  return undefined;
}
