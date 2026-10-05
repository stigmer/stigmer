/**
 * What a hook's decision says, in the same words on both engines: the
 * refusal the model reads when a hook denies a call, the approval card's
 * message when a hook asks without a reason, the sentence a person's earlier
 * refusal answers a retried call with, and the heading a hook's feedback is
 * appended to a tool result under. The native gate
 * (`middleware/approval-gate.ts`) and the Cursor engine's hook server
 * (`execute-cursor/hook-server.ts`) both read them from here.
 */

/** The heading the hooks' feedback is appended to a tool result under. */
export const HOOK_FEEDBACK_HEADING = "Hook feedback:";

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
