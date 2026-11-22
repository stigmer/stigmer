// `runs approve` — answer a tool call a run waits on, through the run's
// session.
//
// The run's waiting asks are read from its events (the fold's `Turn.asks`);
// each is named by its tool use id, which `runs logs` shows on the
// stigmer.permission.asked line. `--tool-call` picks one; without it the run
// must wait on exactly one. The action answers it:
//
//   allow ...... confirmToolUse, allow
//   deny ....... confirmToolUse, deny, with `--comment` as the reason the
//                agent reads
//   allow-all .. grantPermission: this call and every waiting call of its
//                class run for the rest of the turn
//
// A comment rides only a deny (the contract refuses it on an allow), so a
// comment with any other action is refused before anything is sent.
//
// A call of one of the host app's own tools (the fold's
// `Turn.customToolUses`) waits for that app's answer, which only the app
// gives (the session's answerCustomToolUse), so it is never approved here:
// naming one, or a run that waits on such calls alone, is refused with that
// reason before anything is sent.

import { foldSession, turnOf, type Stigmer, type ToolUse } from "@stigmer/client";
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
  const hostCalls = turn?.customToolUses ?? [];
  const hostCall = hostCalls.find((call) => call.id === opts.toolCallId);
  if (hostCall !== undefined) throw new UsageError(hostCallMessage(hostCall));
  if ((turn?.asks ?? []).length === 0 && hostCalls.length > 0) {
    throw new UsageError(`run ${opts.runId} waits only on its host app's own tools, which that app answers, not an approval:\n${listAsks(hostCalls)}`);
  }
  const ask = pickAsk(opts.runId, turn?.asks ?? [], opts.toolCallId);
  await submitAnswer(client, sessionId, ask.id, answer);
  return { toolUseId: ask.id, toolName: ask.name, answer: answer.kind };
}

function answerOf(action: string, comment: string): AskAnswer {
  switch (action) {
    case "deny":
      return { kind: "deny", reason: comment };
    case "allow":
    case "allow-all":
      if (comment !== "") {
        throw new UsageError("--comment is the reason given with a deny; an allow carries none");
      }
      return action === "allow" ? { kind: "allow" } : { kind: "grant" };
  }
  throw new UsageError(`invalid --action "${action}": must be one of: allow, deny, allow-all`);
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

/** Why a call of one of the host app's own tools is not approved here. */
export function hostCallMessage(call: ToolUse): string {
  return `tool call ${call.id} is a call of ${call.name}, one of the host app's own tools: that app answers it (answerCustomToolUse), never an approval`;
}

function listAsks(asks: readonly ToolUse[]): string {
  return asks.map((ask) => `  ${ask.id}  ${ask.name}`).join("\n");
}
