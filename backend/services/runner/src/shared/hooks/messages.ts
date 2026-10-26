/**
 * What a hook's decision says, in the same words on every engine: the
 * refusal the model reads when a hook denies a call, the approval card's
 * message when a hook asks without a reason, the refusal of an ask that
 * also rewrote the call, the sentence a person's earlier refusal answers a
 * retried call with, and the section a hook's feedback is appended to a
 * tool result under. The native gate (`middleware/approval-gate.ts`), the
 * Cursor engine's hook server (`execute-cursor/hook-server.ts`) and the
 * Claude engine's gate (`execute-claude/gate.ts`) read them from here.
 */

/** The heading the hooks' feedback is appended to a tool result under. */
export const HOOK_FEEDBACK_HEADING = "Hook feedback:";

/** The hooks' feedback as one section of a tool result: the heading, then each piece, in order. */
export function hookFeedbackSection(feedback: readonly string[]): string {
  return `${HOOK_FEEDBACK_HEADING}\n${feedback.join("\n\n")}`;
}

/** A hook as a sentence names it. */
export function hookLabel(hook: string): string {
  return hook === "" ? "The agent's hook" : `The ${hook} plugin's hook`;
}

/** What the model reads when a hook refused its call. */
export function hookRefusalMessage(hook: string, reason: string): string {
  return `${hookLabel(hook)} refused this call${reason ? `: ${reason}` : "."}`;
}

/** The card's message when an asking hook gave no reason. */
export function hookAskMessage(hook: string, toolName: string): string {
  return hook === "" ? `The agent's hooks ask before ${toolName}` : `The ${hook} plugin asks before ${toolName}`;
}

/**
 * Why a hook's ask with a rewrite is refused, on an engine whose approval
 * card shows the model's own call (Cursor, Claude): the agent reads it.
 */
export function askWithRewriteMessage(hook: string): string {
  return `${hookLabel(hook)} asked for approval of this call and rewrote it too. An approval here would show the call as written, not as rewritten, so the call was refused.`;
}

/** What the model reads when a call a person skipped or rejected is tried again. */
export function personDecisionSentence(toolName: string, action: "skip" | "reject", comment: string): string {
  return action === "skip"
    ? comment
      ? `Tool '${toolName}' was skipped by user: ${comment}. Please proceed without this operation.`
      : `Tool '${toolName}' was skipped by user. Please proceed without this operation.`
    : comment
      ? `Tool '${toolName}' was rejected by the user: ${comment}. Do not retry it; proceed by taking their objection into account.`
      : `Tool '${toolName}' was rejected by the user. Do not retry it; proceed by taking their objection into account.`;
}
