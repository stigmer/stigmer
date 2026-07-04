/**
 * The Build-from-plan prompt directive, shared by both harnesses.
 *
 * When the user approves a plan and clicks "Build from plan", the client
 * submits an execution with `spec.execution_config.build_from_plan` set and a
 * short human-readable message ("Build from plan") — it does NOT embed
 * implement instructions in the message text. The runner owns the agent-facing
 * instruction, injected from this module, so the chat thread can render the
 * turn as a compact chip while the model still receives the full contract.
 *
 * The directive has two variants, chosen by whether the approved plan document
 * actually materialized in the workspace:
 * - Attached (the normal case): the client uploaded the approved plan text
 *   (edited or not) and attached it, mounted at `.stigmer/inputs/plan.md`.
 *   The directive points the model at that file and names it authoritative —
 *   the user may have refined the document after the plan turn, so the
 *   conversation's version can be stale.
 * - Conversation-only (the client's upload failed): the directive falls back
 *   to the plan as proposed in the conversation.
 *
 * Like `PLAN_MODE_DIRECTIVE` (plan-mode-prompt.ts), this module is the single
 * source of truth for the words; each harness wraps them in its own prompt
 * framing (XML-tag section for Cursor, markdown heading for the native
 * harness).
 */

import { PLAN_ARTIFACT_NAME } from "./plan-artifact.js";

/**
 * Find the approved plan document among the workspace paths the harness
 * injected for this execution's attachments. Detection keys on the canonical
 * plan filename — the same convention the UI uses to detect the plan artifact.
 * Returns `undefined` when no plan attachment landed (upload failed, or the
 * attachment itself failed to inject), which selects the conversation-only
 * directive variant.
 */
export function findApprovedPlanPath(
  attachmentPaths: readonly string[],
): string | undefined {
  return attachmentPaths.find(
    (p) => p.split("/").pop() === PLAN_ARTIFACT_NAME,
  );
}

/**
 * Build the implement-plan directive body for a Build-from-plan execution.
 *
 * @param planPath - Workspace-relative path of the attached approved plan
 *   (from {@link findApprovedPlanPath}), or `undefined` when the plan exists
 *   only in the conversation.
 */
export function buildImplementPlanDirective(planPath?: string): string {
  if (planPath) {
    return [
      "IMPORTANT: This turn implements a plan the user has reviewed and " +
        "APPROVED.",
      "",
      `The approved plan document is attached at \`${planPath}\`. Read it ` +
        "FIRST, then implement it step by step.",
      "",
      "That document is the authoritative version of the plan — the user may " +
        "have edited it after it was proposed, so where it differs from the " +
        "conversation above, follow the document.",
    ].join("\n");
  }

  return [
    "IMPORTANT: This turn implements a plan the user has reviewed and " +
      "APPROVED.",
    "",
    "Implement the plan proposed in the conversation above, step by step.",
  ].join("\n");
}
