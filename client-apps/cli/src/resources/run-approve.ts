// `runs approve` — answer a tool call a run waits on, through the run's
// session.
//
// The run's waiting asks are read from its events (the fold's `Turn.asks`);
// each is named by its tool use id, which `runs logs` shows on the
// stigmer.permission.asked line. `--tool-call` picks one; without it the run
// must wait on exactly one. The action answers it:
//
//   approve ...... confirmToolUse, allow
//   deny/reject .. confirmToolUse, deny, with `--comment` as the reason the
//                  agent reads
//   approve-all .. grantPermission: this call and every waiting call of its
//                  class run for the rest of the turn
//
// A comment rides only a deny (the contract refuses it on an allow), so a
// comment with any other action is refused before anything is sent.

import { foldSession, turnOf, type Stigmer, type ToolUse } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { listSessionEvents, sessionOfRun } from "./session.js";
import { submitAnswer, type AskAnswer } from "./stream/answer.js";

export interface ApproveAgentOptions {
  readonly runId: string;
  /** The tool use to answer; "" when the run waits on exactly one. */
  readonly toolCallId: string;
  readonly action: string;
  readonly comment: string;
}

/** The ask that was answered, and how. */
export interface ApproveResult {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly answer: AskAnswer["kind"];
}

/** Answer one of the run's waiting tool calls. */
export async function approveAgentToolCall(client: Stigmer, opts: ApproveAgentOptions): Promise<ApproveResult> {
  const answer = answerOf(opts.action, opts.comment);
  const run = await client.run.get(opts.runId);
  const sessionId = sessionOfRun(run);
  const turn = turnOf(foldSession(await listSessionEvents(client, sessionId, opts.runId)), opts.runId);
  const ask = pickAsk(opts.runId, turn?.asks ?? [], opts.toolCallId);
  await submitAnswer(client, sessionId, ask.id, answer);
  return { toolUseId: ask.id, toolName: ask.name, answer: answer.kind };
}

function answerOf(action: string, comment: string): AskAnswer {
  switch (action) {
    case "deny":
    case "reject":
      return { kind: "deny", reason: comment };
    case "approve":
    case "approve-all":
      if (comment !== "") {
        throw new UsageError("--comment is the reason given with a deny; an approval carries none");
      }
      return action === "approve" ? { kind: "allow" } : { kind: "grant" };
    default:
      throw new UsageError(`invalid --action "${action}": must be one of: approve, deny, approve-all`);
  }
}

function pickAsk(runId: string, asks: readonly ToolUse[], toolCallId: string): ToolUse {
  if (asks.length === 0) {
    throw new UsageError(`run ${runId} has no tool call waiting for an answer`);
  }
  if (toolCallId !== "") {
    const ask = asks.find((candidate) => candidate.id === toolCallId);
    if (ask === undefined) {
      throw new UsageError(`tool call ${toolCallId} does not wait for an answer in run ${runId}; waiting:\n${listAsks(asks)}`);
    }
    return ask;
  }
  if (asks.length > 1) {
    throw new UsageError(`run ${runId} waits on ${asks.length} tool calls; name one with --tool-call:\n${listAsks(asks)}`);
  }
  return asks[0];
}

function listAsks(asks: readonly ToolUse[]): string {
  return asks.map((ask) => `  ${ask.id}  ${ask.name}`).join("\n");
}
