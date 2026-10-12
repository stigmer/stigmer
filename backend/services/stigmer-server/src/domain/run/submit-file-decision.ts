/**
 * SubmitFileDecision: the run's own method for a file-review decision,
 * kept for the clients that read review from the run, an adapter onto the
 * one decision core (domain/session/filereview/decide.ts), which
 * SessionCommandController.reviewFileChanges also decides through. Its
 * wire and authorization stay (can_edit on the run): APPROVE is keep,
 * REJECT is undo, and the answer is the run as committed, the decision
 * projected into file_change_sets.
 *
 * Chain: Authorize → ValidateProto → RecordFileDecision. The core owns the
 * load, the target checks (set and file exist, the keep completeness gate,
 * the digest gate), the conversation's window, the write with its
 * stigmer.file_review.decided event, and the reconcile turn an undo on an
 * ended run starts. A file decision resumes no workflow: no turn waits on
 * review (stigmer#1471).
 *
 * Idempotency: a decision the ledger already holds on the target is a
 * no-op answering the run as stored.
 */
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SubmitFileDecisionInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { decideFileChanges } from "../session/filereview/decide.js";
import type { FileDecisionDeps } from "../session/filereview/decide.js";

export interface SubmitFileDecisionDeps extends FileDecisionDeps {
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
}

type SubmitFileDecisionDesc =
  typeof RunCommandController.method.submitFileDecision.input;

// Go's key string, verbatim.
const TARGET_RESOURCE_KEY = "targetResource";

export async function submitFileDecision(
  deps: SubmitFileDecisionDeps,
  input: SubmitFileDecisionInput,
  identity: CallerIdentity,
): Promise<Run> {
  const reqCtx = new RequestContext(
    RunCommandController.method.submitFileDecision.input,
    input,
    identity,
    ApiResourceKind.run,
  );
  await newPipeline<SubmitFileDecisionDesc>(
    "agent-execution-submit-file-decision",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.submitFileDecision,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "RecordFileDecision",
      async execute(ctx) {
        // ValidateProto has already refused an empty run_id (min_len).
        const outcome = await decideFileChanges(
          deps,
          { runId: ctx.input.runId },
          {
            changeSetId: ctx.input.changeSetId,
            scope: ctx.input.scope,
            fileChangeId: ctx.input.fileChangeId,
            action: ctx.input.action,
            expectedDigest: ctx.input.expectedDigest,
            reason: ctx.input.reason,
            acknowledgeUnreviewable: ctx.input.acknowledgeUnreviewable,
          },
          ctx.callerIdentity,
        );
        ctx.set(TARGET_RESOURCE_KEY, outcome.run);
      },
    })
    .build()
    .execute(reqCtx);

  return reqCtx.get(TARGET_RESOURCE_KEY) as Run;
}
