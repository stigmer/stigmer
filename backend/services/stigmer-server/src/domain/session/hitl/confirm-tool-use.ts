/**
 * SessionCommandController.confirmToolUse: a person allows or denies a
 * tool use that waits for an answer. The chain is Authorize (can_edit on
 * the session, the posture of every answer a person gives a conversation),
 * ValidateProto (a deny_message only with deny), then the answer core
 * (answer.ts). The reply is the recorded user.tool_confirmation, the one
 * first recorded for a replay.
 *
 * Proven by __tests__/methods.test.ts, and end to end by the run-approval
 * conformance suite.
 */
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { ConfirmToolUseInput } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { answerOutcomeOf, answerSteps } from "./answer.js";
import type { AnswerDeps } from "./answer.js";

export interface SessionAnswerDeps extends AnswerDeps {
  /** The composed authorization seam: the chain's Authorize step calls it. */
  readonly authorizer: Authorizer;
}

type ConfirmToolUseDesc = typeof SessionCommandController.method.confirmToolUse.input;

export async function confirmToolUse(
  deps: SessionAnswerDeps,
  input: ConfirmToolUseInput,
  identity: CallerIdentity,
): Promise<SessionEvent> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.confirmToolUse.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  const builder = newPipeline<ConfirmToolUseDesc>("session-confirm-tool-use", deps.logger)
    .addStep(newAuthorizeStep(SessionCommandController.method.confirmToolUse, deps.authorizer))
    .addStep(newValidateProtoStep());
  for (const step of answerSteps<ConfirmToolUseDesc>(deps, (ctx) => ({
    sessionId: ctx.input.sessionId,
    toolUseId: ctx.input.toolUseId,
    // ValidateProto admits allow and deny only.
    result: ctx.input.result === "deny" ? "deny" : "allow",
    denyMessage: ctx.input.denyMessage,
    grant: false,
  }))) {
    builder.addStep(step);
  }
  await builder.build().execute(reqCtx);
  return answerOutcomeOf(reqCtx).confirmations[0]!;
}
