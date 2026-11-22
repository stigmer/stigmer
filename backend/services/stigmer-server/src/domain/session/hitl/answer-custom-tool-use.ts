/**
 * SessionCommandController.answerCustomToolUse: the host app answers a call
 * the agent made to one of the host's own tools (SessionSpec.custom_tools).
 * The chain is Authorize (can_edit on the session, the posture of every
 * answer given to a conversation, so a host's server answers as the person
 * whose conversation it is), ValidateProto, ValidateContent (text blocks
 * only, at most MAX_CUSTOM_RESULT_CHARS in all), then the answer core
 * (answer.ts). The reply is the recorded user.custom_tool_result, the one
 * first recorded for a replay.
 *
 * Proven by __tests__/custom-tool-answers.test.ts, and end to end by the
 * custom-tools conformance suite.
 */
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { AnswerCustomToolUseInput } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { invalidArgumentError } from "../../../pipeline/errors.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { answerOutcomeOf, answerSteps, customToolResultProblem } from "./answer.js";
import type { SessionAnswerDeps } from "./confirm-tool-use.js";

type AnswerCustomToolUseDesc = typeof SessionCommandController.method.answerCustomToolUse.input;

export async function answerCustomToolUse(
  deps: SessionAnswerDeps,
  input: AnswerCustomToolUseInput,
  identity: CallerIdentity,
): Promise<SessionEvent> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.answerCustomToolUse.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  const builder = newPipeline<AnswerCustomToolUseDesc>("session-answer-custom-tool-use", deps.logger)
    .addStep(newAuthorizeStep(SessionCommandController.method.answerCustomToolUse, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep({
      name: "ValidateContent",
      execute(ctx) {
        const problem = customToolResultProblem(ctx.input.content);
        if (problem !== undefined) {
          throw invalidArgumentError(problem);
        }
      },
    });
  for (const step of answerSteps<AnswerCustomToolUseDesc>(deps, (ctx) => ({
    kind: "custom_tool_result",
    sessionId: ctx.input.sessionId,
    toolUseId: ctx.input.customToolUseId,
    content: ctx.input.content,
    isError: ctx.input.isError,
  }))) {
    builder.addStep(step);
  }
  await builder.build().execute(reqCtx);
  return answerOutcomeOf(reqCtx).confirmations[0]!;
}
