// `stigmer execution approve <execution-id>` — submit an approval decision.
//
// Workflow executions (wex_) approve a task: --task (required) + --outcome, with
// optional --comment and --data-file (form data). Agent executions (aex_) approve
// a tool call: --tool-call (required) + --action, with optional --comment.
// Thin handler: validate required flags, delegate to resources/execution-approve.ts.
// Mirrors Go's execution_approve.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { resolveExecutionType } from "../../resources/execution.js";

interface ApproveFlags {
  task?: string;
  outcome?: string;
  comment?: string;
  dataFile?: string;
  toolCall?: string;
  action?: string;
}

export function registerExecutionApprove(execution: Command): void {
  execution
    .command("approve <execution-id>")
    .description("submit approval for a waiting execution")
    .option("--task <name>", "task name to approve (workflow executions)")
    .option("--outcome <outcome>", "approval outcome (workflow executions)", "approve")
    .option("--comment <comment>", "approval comment")
    .option("--data-file <path>", "JSON file with form data (workflow executions)")
    .option("--tool-call <id>", "tool call ID to approve (agent executions)")
    .option("--action <action>", "approval action: approve or deny (agent executions)", "approve")
    .action((executionId: string, options: ApproveFlags) => runApprove(executionId, options));
}

async function runApprove(executionId: string, options: ApproveFlags): Promise<void> {
  // Resolve type before any network call so a bad ID fails fast with guidance.
  const type = resolveExecutionType(executionId);

  const [{ connectBackend }, approve, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/execution-approve.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  if (type === "workflow") {
    if (options.task === undefined || options.task === "") {
      throw new UsageError("--task is required for workflow execution approvals");
    }
    const outcome = options.outcome ?? "approve";
    await approve.approveWorkflowTask(client.stigmer, {
      executionId,
      taskName: options.task,
      outcome,
      comment: options.comment ?? "",
      formData: await approve.readFormData(options.dataFile),
    });
    renderResult(CommandResult.success(`Approval submitted: task=${options.task} outcome=${outcome}`), "human");
    return;
  }

  if (options.toolCall === undefined || options.toolCall === "") {
    throw new UsageError("--tool-call is required for agent execution approvals");
  }
  const action = options.action ?? "approve";
  await approve.approveAgentToolCall(client.stigmer, {
    executionId,
    toolCallId: options.toolCall,
    action,
    comment: options.comment ?? "",
  });
  renderResult(CommandResult.success(`Approval submitted: tool-call=${options.toolCall} action=${action}`), "human");
}
