// `stigmer runs approve <run-id>` — submit an approval decision.
//
// Workflow runs (wex_) approve a task: --task (required) + --outcome, with
// optional --comment and --data-file (form data). Agent runs (aex_) approve a
// tool call: --tool-call (required) + --action, with optional --comment.
// Thin handler: validate required flags, delegate to resources/run-approve.ts.
// Mirrors Go's execution_approve.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { resolveRunType } from "../../resources/runs.js";

interface ApproveFlags {
  task?: string;
  outcome?: string;
  comment?: string;
  dataFile?: string;
  toolCall?: string;
  action?: string;
}

export function registerRunsApprove(runs: Command): void {
  runs
    .command("approve <run-id>")
    .description("submit approval for a waiting run")
    .option("--task <name>", "task name to approve (workflow runs)")
    .option("--outcome <outcome>", "approval outcome (workflow runs)", "approve")
    .option("--comment <comment>", "approval comment")
    .option("--data-file <path>", "JSON file with form data (workflow runs)")
    .option("--tool-call <id>", "tool call ID to approve (agent runs)")
    .option("--action <action>", "approval action: approve or deny (agent runs)", "approve")
    .action((runId: string, options: ApproveFlags) => runApprove(runId, options));
}

async function runApprove(runId: string, options: ApproveFlags): Promise<void> {
  // Resolve type before any network call so a bad ID fails fast with guidance.
  const type = resolveRunType(runId);

  const [{ connectBackend }, approve, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-approve.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  if (type === "workflow") {
    if (options.task === undefined || options.task === "") {
      throw new UsageError("--task is required for workflow run approvals");
    }
    const outcome = options.outcome ?? "approve";
    await approve.approveWorkflowTask(client.stigmer, {
      runId,
      taskName: options.task,
      outcome,
      comment: options.comment ?? "",
      formData: await approve.readFormData(options.dataFile),
    });
    renderResult(CommandResult.success(`Approval submitted: task=${options.task} outcome=${outcome}`), "human");
    return;
  }

  if (options.toolCall === undefined || options.toolCall === "") {
    throw new UsageError("--tool-call is required for agent run approvals");
  }
  const action = options.action ?? "approve";
  await approve.approveAgentToolCall(client.stigmer, {
    runId,
    toolCallId: options.toolCall,
    action,
    comment: options.comment ?? "",
  });
  renderResult(CommandResult.success(`Approval submitted: tool-call=${options.toolCall} action=${action}`), "human");
}
