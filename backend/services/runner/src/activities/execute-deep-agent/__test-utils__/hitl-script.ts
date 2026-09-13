/**
 * The one gated opening every HITL arm shares, so their first-invocation
 * statuses are byte-identical and can match ONE golden file
 * (`__tests__/hermetic/goldens/gate.turn1.status.json`). Matching the same
 * file from the approve, skip, reject and sequential-gates arms is itself an
 * assertion: the pending decision is invisible to the first invocation.
 *
 * Why `execute`: under capture mode (on whenever a workspace dir and artifact
 * storage exist — every hermetic run) file writes FLOW into the CAS ledger
 * and are reviewed post hoc; shell is the built-in that still interrupts
 * (`middleware/approval-gate.ts`, `shared/tool-kind.ts` SHELL). `echo` is a
 * real subprocess with byte-stable output, the same tool
 * `__tests__/shell-execute-gate.test.ts` drives through the real gate.
 */

import type { ScriptedToolCall, ScriptedTurn } from "./scripted-model.js";

export const EXECUTE_CALL_A: ScriptedToolCall = {
  id: "call-hermetic-exec-0001",
  name: "execute",
  args: { command: "echo hermetic-a" },
};

export const EXECUTE_CALL_B: ScriptedToolCall = {
  id: "call-hermetic-exec-0002",
  name: "execute",
  args: { command: "echo hermetic-b" },
};

/** The gate's copy for a SHELL built-in (`CATEGORY_APPROVAL_MESSAGE.shell` over the args). */
export function executeApprovalMessage(call: ScriptedToolCall): string {
  return `Execute command: ${String(call.args.command)}`;
}

/** Round 0 of every gated arm: one text block and the gated `execute` A. */
export const GATED_OPENING_TURN: ScriptedTurn = {
  text: "I will run the command.",
  toolCalls: [EXECUTE_CALL_A],
  usage: { inputTokens: 1_400, outputTokens: 50 },
};

/** The closing text after the decision has been carried out (or declined). */
export const CLOSING_TURN: ScriptedTurn = {
  text: "Done with the command.",
  usage: { inputTokens: 1_600, outputTokens: 20 },
};

export const GATE_TURN1_GOLDEN = "./goldens/gate.turn1.status.json";
