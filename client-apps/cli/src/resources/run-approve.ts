// `runs approve` — submit an approval decision for a run waiting on a tool
// call.
//
// Mirrors Go's execution.ApproveAgent (approve.go), with one deliberate
// correction over the Go behavior: `--comment` is carried onto
// SubmitApprovalInput.comment. The field exists on the proto; Go accepted the
// flag then dropped it. We thread it through.

import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";

export interface ApproveAgentOptions {
  readonly runId: string;
  readonly toolCallId: string;
  readonly action: string;
  readonly comment: string;
}

/** Submit an agent tool-call approval. `--comment` is carried through. */
export async function approveAgentToolCall(client: Stigmer, opts: ApproveAgentOptions): Promise<void> {
  await client.agentRun.submitApproval(
    create(SubmitApprovalInputSchema, {
      agentRunId: opts.runId,
      toolCallId: opts.toolCallId,
      action: resolveApprovalAction(opts.action),
      comment: opts.comment,
    }),
  );
}

// Mirrors Go's mapping: "deny"/"reject" → REJECT, everything else → APPROVE.
function resolveApprovalAction(action: string): ApprovalAction {
  return action === "deny" || action === "reject" ? ApprovalAction.REJECT : ApprovalAction.APPROVE;
}
