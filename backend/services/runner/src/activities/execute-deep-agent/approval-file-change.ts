/**
 * Pre-execution file-change capture for the HITL approval gate (native harness).
 *
 * The sibling of {@link FileChangeCoordinator}, which captures the *post*-edit
 * before/after at the file-mutation point. This module captures the *proposed*
 * change at the moment the graph pauses for approval — before the tool runs — so
 * the gate can render a real diff instead of a bare args preview.
 *
 * This module owns only the native-specific seam: correlating a gated
 * `tool_call_id` to its arguments from graph state (the authoritative
 * single source of truth at the interrupt, since the streamed input cache is
 * empty and the interrupt value carries only four fields). The actual capture —
 * shape detection, the workspace before-read, and the CREATE/MODIFY/HUNK
 * decision — lives in the harness-agnostic {@link buildGateFileChange}, shared
 * with the Cursor gate so the two harnesses cannot drift. The graph is genuinely
 * paused at the interrupt, so the shared before-read observes the true pre-edit
 * content race-free.
 *
 * @since First-Class Diff Review (#186), approval-gate phase;
 *        cross-harness gate unification (HITL diff)
 */

import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { buildGateFileChange } from "../../shared/gate-file-change.js";
import { synthesizeHunkDiff } from "../../shared/hunk-diff.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { sanitizeArgsPreview } from "./status-builder-shared.js";

// Re-exported so existing importers (and tests) of the native module keep their
// path; the implementation now lives in the harness-agnostic shared/hunk-diff.
export { synthesizeHunkDiff };

/** What the gate capture contributes to a `WAITING_APPROVAL` `ToolCall`. */
export interface ApprovalCaptureResult {
  /** Sanitized JSON args preview, omitted when there are no args to show. */
  readonly argsPreview?: string;
  /** The proposed file change, omitted for non-file tools or a missing path. */
  readonly fileChange?: FileChange;
}

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
 * Build the proposed `FileChange` for a gated native (deepagents) tool call.
 *
 * Thin wrapper over the shared {@link buildGateFileChange} that pins the native
 * path convention (`virtualRoot: true` — a leading "/" denotes the workspace
 * root). All capture logic — shape detection, the workspace before-read, and the
 * CREATE/MODIFY/HUNK decision — lives in the one shared builder both harnesses
 * use, so the two can never drift. Output is unchanged from the prior native-only
 * implementation (the field set is a superset; native args are a subset).
 */
export function buildApprovalFileChange(
  toolName: string,
  args: Record<string, unknown>,
  workspaceBackend: WorkspaceBackend,
): Promise<FileChange | undefined> {
  return buildGateFileChange(toolName, args, workspaceBackend, { virtualRoot: true });
}

/**
 * Capture both gate artifacts — the sanitized args preview and the proposed file
 * change — from a single correlation lookup, keeping the call site thin.
 *
 * Returns an empty result when the tool call cannot be correlated or took no
 * arguments, so the gate falls back to today's behavior for that interrupt.
 */
export async function captureApprovalArtifacts(opts: {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly messages: readonly unknown[];
  readonly workspaceBackend: WorkspaceBackend;
}): Promise<ApprovalCaptureResult> {
  const args = findAiMessageToolCallArgs(opts.messages, opts.toolCallId);
  if (!args || Object.keys(args).length === 0) return {};

  const argsPreview = sanitizeArgsPreview(args) || undefined;
  const fileChange = await buildApprovalFileChange(opts.toolName, args, opts.workspaceBackend);
  return { argsPreview, fileChange };
}
