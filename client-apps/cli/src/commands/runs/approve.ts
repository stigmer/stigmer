// `stigmer runs approve <run-id>` — answer a tool call the run waits on:
// --tool-call (the tool use id; optional when the run waits on one) and
// --action, with --comment as a deny's reason. Thin handler: delegate to
// resources/run-approve.ts and report the answer.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import type { ApproveResult } from "../../resources/run-approve.js";
import { addResultFlags, resultFormat } from "../shared.js";

interface ApproveFlags extends OutputFlags {
  comment?: string;
  toolCall?: string;
  action?: string;
}

export function registerRunsApprove(runs: Command): void {
  const approve = runs
    .command("approve <run-id>")
    .description("answer a tool call a run waits on")
    .option("--comment <comment>", "the reason the agent reads with a deny")
    .option("--tool-call <id>", "the tool use to answer, as runs logs shows it; optional when the run waits on one")
    .option(
      "--action <action>",
      "allow, deny, or allow-all (allow it and every waiting call of its kind for the rest of the turn)",
      "allow",
    )
    .action((runId: string, options: ApproveFlags) => runApprove(runId, options));
  addResultFlags(approve);
}

// What the success line calls each answer.
const ANSWERED: Record<ApproveResult["answer"], string> = {
  allow: "allowed",
  deny: "denied",
  grant: "allowed for the rest of the turn",
};

async function runApprove(runId: string, options: ApproveFlags): Promise<void> {
  const format = resultFormat(options);
  const [{ connectBackend }, approve, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-approve.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await approve.approveAgentToolCall(client.stigmer, {
    runId,
    toolCallId: options.toolCall ?? "",
    action: options.action ?? "allow",
    comment: options.comment ?? "",
  });
  renderResult(
    CommandResult.success(`Tool call ${ANSWERED[result.answer]}: ${result.toolName} (${result.toolUseId})`).withData({
      runId,
      toolUseId: result.toolUseId,
      toolName: result.toolName,
      answer: result.answer,
    }),
    format,
  );
}
