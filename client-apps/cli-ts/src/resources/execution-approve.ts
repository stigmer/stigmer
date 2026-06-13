// `execution approve` — submit an approval decision for a waiting execution.
//
// Mirrors Go's execution.ApproveWorkflow / ApproveAgent (approve.go), with two
// deliberate corrections over the Go behavior:
//
//   - D-EX-1 (fixed here): the agent `--comment` is carried onto
//     SubmitApprovalInput.comment. The field exists on the proto; Go accepted the
//     flag then dropped it. We thread it through.
//   - D-EX-2 (match Go, backend follow-up): the workflow `reviewer` field is left
//     unset by the client. Reviewer is an audit identity and must be attributed
//     server-side from the authenticated principal — a client-supplied identity
//     is spoofable. The backend follow-up is to populate it from the token.

import { readFile } from "node:fs/promises";
import { type JsonObject } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SubmitWorkflowTaskApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";

export interface ApproveWorkflowOptions {
  readonly executionId: string;
  readonly taskName: string;
  readonly outcome: string;
  readonly comment: string;
  readonly formData?: JsonObject;
}

/** Submit a workflow task approval. `reviewer` stays unset (server-attributed). */
export async function approveWorkflowTask(client: Stigmer, opts: ApproveWorkflowOptions): Promise<void> {
  await client.workflowExecution.submitWorkflowTaskApproval(
    create(SubmitWorkflowTaskApprovalInputSchema, {
      executionId: opts.executionId,
      taskName: opts.taskName,
      outcome: opts.outcome,
      comment: opts.comment,
      ...(opts.formData ? { formData: opts.formData } : {}),
    }),
  );
}

export interface ApproveAgentOptions {
  readonly executionId: string;
  readonly toolCallId: string;
  readonly action: string;
  readonly comment: string;
}

/** Submit an agent tool-call approval. `--comment` is carried through (D-EX-1). */
export async function approveAgentToolCall(client: Stigmer, opts: ApproveAgentOptions): Promise<void> {
  await client.agentExecution.submitApproval(
    create(SubmitApprovalInputSchema, {
      agentExecutionId: opts.executionId,
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

/**
 * Read and parse a `--data-file` JSON object for workflow form data. A missing
 * path returns undefined; an unreadable file or non-object/invalid JSON is a
 * usage error (bad input), mirroring Go's os.ReadFile + json.Unmarshal guards.
 */
export async function readFormData(path: string | undefined): Promise<JsonObject | undefined> {
  if (path === undefined || path === "") return undefined;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new UsageError(`failed to read data file '${path}': ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`failed to parse JSON in '${path}': ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`data file '${path}' must contain a JSON object`);
  }
  return parsed as JsonObject;
}
