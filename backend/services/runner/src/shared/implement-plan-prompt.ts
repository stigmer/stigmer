/**
 * The Build-from-plan prompt directive, shared by both harnesses.
 *
 * When the user approves a plan and clicks "Build from plan", the client
 * submits an execution with `spec.build_from_plan` set and a
 * short human-readable message ("Build from plan") — it does NOT embed
 * implement instructions in the message text. The runner owns the agent-facing
 * instruction, injected from this module, so the chat thread can render the
 * turn as a compact chip while the model still receives the full contract.
 *
 * The directive has two variants, chosen by whether the approved plan document
 * actually materialized in the workspace:
 * - Attached (the normal case): the client uploaded the approved plan text
 *   (edited or not) as a File and sent it with the message, mounted under
 *   `.stigmer/uploads/` as the plan's own file (`<slug>_<id>.plan.md`). The
 *   directive points the model at
 *   that file and names it authoritative —
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

import { isPlanFileName } from "./plan-file.js";

/**
 * Progress-tracking instruction shared by both directive variants (Tier 3 of
 * Plan mode — plan-driven build progress). The agent's own to-do tool is the
 * single writer of the turn's to-do list, so instructing it to derive the list from
 * the approved plan is the entire plan→progress linkage: the runner's todo
 * extraction and the clients' todo renderers light up unchanged.
 *
 * Deliberately tool-agnostic ("your to-do list"): the Cursor harness exposes
 * TodoWrite/updateTodos, the native harness write_todos, and each runtime
 * already teaches the model its own tool.
 *
 * Wording constraint: this block rides BOTH variants, and the conversation-only
 * variant is pinned by tests to never contain "plan.md" (it has no plan file
 * to reference) — so say "the plan", never name the file.
 */
const TRACK_PROGRESS_INSTRUCTION = [
  "Track your progress with your to-do list so the user can follow the " +
    "build:",
  "- Before you start, break the plan into a concrete, ordered to-do list — " +
    "roughly one item per implementation step.",
  "- As you work, keep it current: mark each item in progress when you " +
    "begin it and completed when it is done.",
].join("\n");

/** A File this turn's message carried: its own filename and where the agent reads it. */
export interface PlanCandidate {
  readonly filename: string;
  readonly relativePath: string;
}

/**
 * Find the approved plan document among the Files this turn's message
 * carried — never the conversation's earlier Files, where an older plan may
 * still sit — and answer its workspace path. Detection keys on the File's
 * own filename against the plan convention ({@link isPlanFileName} — the
 * legacy `plan.md` or any `*.plan.md`), the same convention the UI uses to
 * detect the plan File, never on the mount path: the server mounts a
 * second plan of the same name at `x.plan-2.md`, which no longer matches.
 * Returns `undefined` when the message carried no plan (the upload failed),
 * which selects the conversation-only directive variant.
 */
export function findApprovedPlanPath(
  messageFiles: readonly PlanCandidate[],
): string | undefined {
  return messageFiles.find((file) => isPlanFileName(file.filename))?.relativePath;
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
      "",
      TRACK_PROGRESS_INSTRUCTION,
    ].join("\n");
  }

  return [
    "IMPORTANT: This turn implements a plan the user has reviewed and " +
      "APPROVED.",
    "",
    "Implement the plan proposed in the conversation above, step by step.",
    "",
    TRACK_PROGRESS_INSTRUCTION,
  ].join("\n");
}
