/**
 * SessionCommandController.reviewFileChanges: a person keeps or undoes a
 * turn's file changes, or one of its files, in a conversation with file
 * review on. The chain is Authorize (can_edit on the session, the posture
 * of every answer a person gives a conversation), ValidateProto, then
 * DecideFileChanges, which reads the input's words (words.ts) and decides
 * through the one core (decide.ts). The reply names
 * the reconcile turn an undo on an ended turn started, or "".
 *
 * Proven by __tests__/review-file-changes.test.ts, and end to end by the
 * run-file-review conformance suite.
 */
import { create } from "@bufbuild/protobuf";

import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import {
  ReviewFileChangesResponseSchema,
  type ReviewFileChangesInput,
  type ReviewFileChangesResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { invalidArgumentError } from "../../../pipeline/errors.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { decideFileChanges, runIdOfChangeSet } from "./decide.js";
import type { FileDecisionDeps, FileDecisionOutcome } from "./decide.js";
import { actionOfWord, scopeOfWord } from "./words.js";

export interface ReviewFileChangesDeps extends FileDecisionDeps {
  /** The composed authorization seam: the chain's Authorize step calls it. */
  readonly authorizer: Authorizer;
}

type ReviewFileChangesDesc =
  typeof SessionCommandController.method.reviewFileChanges.input;

const OUTCOME_KEY = "fileDecisionOutcome";

export async function reviewFileChanges(
  deps: ReviewFileChangesDeps,
  input: ReviewFileChangesInput,
  identity: CallerIdentity,
): Promise<ReviewFileChangesResponse> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.reviewFileChanges.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  await newPipeline<ReviewFileChangesDesc>(
    "session-review-file-changes",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        SessionCommandController.method.reviewFileChanges,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "DecideFileChanges",
      async execute(ctx) {
        // ValidateProto has refused any other word.
        const scope = scopeOfWord(ctx.input.scope);
        const action = actionOfWord(ctx.input.action);
        if (scope === undefined || action === undefined) {
          /* v8 ignore next -- @preserve: ValidateProto's `in` rules refuse every word words.ts does not map, so this only narrows the type */
          throw invalidArgumentError(
            "scope must be change_set or file, and action keep or undo",
          );
        }
        const outcome = await decideFileChanges(
          deps,
          {
            runId: runIdOfChangeSet(ctx.input.changeSetId),
            sessionId: ctx.input.sessionId,
          },
          {
            changeSetId: ctx.input.changeSetId,
            scope,
            fileChangeId: ctx.input.fileChangeId,
            action,
            expectedDigest: ctx.input.expectedDigest,
            reason: ctx.input.reason,
            acknowledgeUnreviewable: ctx.input.acknowledgeUnreviewable,
          },
          ctx.callerIdentity,
        );
        ctx.set(OUTCOME_KEY, outcome);
      },
    })
    .build()
    .execute(reqCtx);

  const outcome = reqCtx.get(OUTCOME_KEY) as FileDecisionOutcome;
  return create(ReviewFileChangesResponseSchema, {
    reconcileRunId: outcome.reconcileRunId,
  });
}
