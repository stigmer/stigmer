/**
 * SessionCommandController.grantPermission: a person allows a tool use
 * that waits, and every call of its class for the rest of the turn. The
 * chain is Authorize (can_edit on the session), ValidateProto, then the
 * answer core (answer.ts) asked for a grant: the call's confirmation, the
 * stigmer.permission.grant, and a confirmation for every other call of the
 * class that waits, in one write. A call with no class is allowed alone
 * and the reply carries no grant.
 *
 * Proven by __tests__/methods.test.ts, and end to end by the run-approval
 * conformance suite.
 */
import { create } from "@bufbuild/protobuf";

import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import {
  GrantPermissionResponseSchema,
  type GrantPermissionInput,
  type GrantPermissionResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { answerOutcomeOf, answerSteps } from "./answer.js";
import type { SessionAnswerDeps } from "./confirm-tool-use.js";

type GrantPermissionDesc = typeof SessionCommandController.method.grantPermission.input;

export async function grantPermission(
  deps: SessionAnswerDeps,
  input: GrantPermissionInput,
  identity: CallerIdentity,
): Promise<GrantPermissionResponse> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.grantPermission.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  const builder = newPipeline<GrantPermissionDesc>("session-grant-permission", deps.logger)
    .addStep(newAuthorizeStep(SessionCommandController.method.grantPermission, deps.authorizer))
    .addStep(newValidateProtoStep());
  for (const step of answerSteps<GrantPermissionDesc>(deps, (ctx) => ({
    sessionId: ctx.input.sessionId,
    toolUseId: ctx.input.toolUseId,
    result: "allow",
    denyMessage: "",
    grant: true,
  }))) {
    builder.addStep(step);
  }
  await builder.build().execute(reqCtx);
  const outcome = answerOutcomeOf(reqCtx);
  return create(GrantPermissionResponseSchema, {
    ...(outcome.grant === undefined ? {} : { grant: outcome.grant }),
    confirmations: [...outcome.confirmations],
  });
}
