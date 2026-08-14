/**
 * Pre-execution args capture for the HITL approval gate (native harness).
 *
 * When the graph pauses for approval — before the tool runs — this captures a
 * sanitized args preview so the gate can show the proposed change. It owns only
 * the native-specific seam: correlating a gated `tool_call_id` to its arguments
 * from graph state (the authoritative single source of truth at the interrupt,
 * since the streamed input cache is empty and the interrupt value carries only a
 * few fields). The approval card renders the proposed write/edit content from
 * these args; there is no separate captured `file_changes` (removed in Phase 5
 * Slice 4 — the args are the single source, and the Cursor deny-gate's
 * exact-apply reads the same args on resume; see execute-cursor/exact-apply.ts).
 *
 * @since First-Class Diff Review (#186), approval-gate phase
 */

/** What the gate capture contributes to a `WAITING_APPROVAL` `ToolCall`. */
export interface ApprovalCaptureResult {
  /** Sanitized JSON args preview, omitted when there are no args to show. */
  readonly argsPreview?: string;
  /**
   * The secret-redacted args object, for stamping `ToolCall.args` on the
   * interrupt-placeholder row. Without it the placeholder carried ONLY the
   * preview string, so every args-driven UI read — the row header's
   * filename-first path above all — rendered nothing for a pending gate
   * (issue #754). Redacted (never raw): the placeholder must not widen the
   * exposure the preview sanitizer bounds.
   */
  readonly args?: Record<string, unknown>;
}

import { sanitizeArgsPreview } from "./status-builder-shared.js";
import { redactSensitiveArgs } from "../../shared/args-preview.js";

/**
 * Correlate a gated `tool_call_id` to its arguments by scanning graph-state
 * messages for the AI-message tool call that emitted it.
 *
 * Matching keys on the presence of a `tool_calls` array, which is robust to
 * whether the message is a hydrated LangChain class instance or a plain
 * serialized object: a `ToolMessage` carries a singular `tool_call_id`, never a
 * `tool_calls` array, so it cannot be mistaken for the emitting AI message.
 *
 * Returns the args object (possibly empty when the tool call took no arguments),
 * or `undefined` when no message in scope emitted this id — e.g. a tool call
 * whose AI message lives only inside a nested sub-agent state, which this
 * parent-scope scan does not reach. That degrades the gate to an args-less
 * preview for that one interrupt, exactly as today.
 */
export function findAiMessageToolCallArgs(
  messages: readonly unknown[],
  toolCallId: string,
): Record<string, unknown> | undefined {
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const toolCalls = (msg as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(toolCalls)) continue;

    for (const tc of toolCalls) {
      if (!tc || typeof tc !== "object") continue;
      const entry = tc as { id?: unknown; args?: unknown };
      if (entry.id !== toolCallId) continue;

      return entry.args &&
        typeof entry.args === "object" &&
        !Array.isArray(entry.args)
        ? (entry.args as Record<string, unknown>)
        : {};
    }
  }
  return undefined;
}

/**
 * Capture the gate's args preview from a single correlation lookup, keeping the
 * call site thin.
 *
 * Returns an empty result when the tool call cannot be correlated or took no
 * arguments, so the gate falls back to today's behavior for that interrupt.
 */
export function captureApprovalArtifacts(opts: {
  readonly toolCallId: string;
  readonly messages: readonly unknown[];
}): ApprovalCaptureResult {
  const args = findAiMessageToolCallArgs(opts.messages, opts.toolCallId);
  if (!args || Object.keys(args).length === 0) return {};

  const argsPreview = sanitizeArgsPreview(args) || undefined;
  return { argsPreview, args: redactSensitiveArgs(args) };
}
