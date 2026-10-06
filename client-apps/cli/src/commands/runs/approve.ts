// `stigmer runs approve <run-id>` — submit an approval decision for a tool
// call: --tool-call (required) + --action, with optional --comment.
// Thin handler: validate required flags, delegate to resources/run-approve.ts.
// Mirrors Go's execution_approve.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";

interface ApproveFlags {
  comment?: string;
  toolCall?: string;
  action?: string;
}

export function registerRunsApprove(runs: Command): void {
  runs
    .command("approve <run-id>")
    .description("submit approval for a waiting run")
    .option("--comment <comment>", "approval comment")
    .option("--tool-call <id>", "tool call ID to approve")
    .option("--action <action>", "approval action: approve or deny", "approve")
    .action((runId: string, options: ApproveFlags) => runApprove(runId, options));
}

async function runApprove(runId: string, options: ApproveFlags): Promise<void> {
  // Check the required flag before any network call so a bad invocation fails fast.
  if (options.toolCall === undefined || options.toolCall === "") {
    throw new UsageError("--tool-call is required");
  }

  const [{ connectBackend }, approve, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-approve.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const action = options.action ?? "approve";
  await approve.approveAgentToolCall(client.stigmer, {
    runId,
    toolCallId: options.toolCall,
    action,
    comment: options.comment ?? "",
  });
  renderResult(CommandResult.success(`Approval submitted: tool-call=${options.toolCall} action=${action}`), "human");
}
