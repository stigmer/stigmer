/**
 * Pre-execution file-change capture for the HITL approval gate (native harness).
 *
 * The sibling of {@link FileChangeCoordinator}, which captures the *post*-edit
 * before/after at the file-mutation point. This module captures the *proposed*
 * change at the moment the graph pauses for approval — before the tool runs — so
 * the gate can render a real diff instead of a bare args preview.
 *
 * Two facts shape the design (DD-002):
 *  - At the interrupt the tool has not executed, so the streamed input cache is
 *    empty and the interrupt value carries only four fields. The authoritative
 *    arguments are the AI-message tool call already sitting in graph state — the
 *    single source of truth we correlate against by `tool_call_id`.
 *  - The graph is genuinely paused, so reading the file now observes the true
 *    pre-edit content, race-free (unlike a stream-driven read).
 *
 * Capture is split by tool family. Write-family tools (`write`/`create`) carry
 * the whole file in their args, so we capture a WHOLE_FILE before/after. Edit-
 * family tools (`edit`/`str_replace_editor`) carry only an `old_string` /
 * `new_string` fragment, so we capture a HUNK_ONLY synthesized diff rather than
 * reconstruct the whole file — that reconstruction would make the runner a
 * second source of truth for the edit result. The whole-file ground truth still
 * lands post-execution via {@link FileChangeCoordinator}.
 *
 * @since First-Class Diff Review (#186), approval-gate phase
 */

import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { buildFileChange, resolveWorkspacePath } from "../../shared/file-change.js";
import {
  extractFilePath,
  extractWriteContent,
  isFileModifyingTool,
} from "../../shared/file-tools.js";
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
 * Build the proposed `FileChange` for a gated file-modifying tool call, or
 * `undefined` when the tool does not modify files or carries no usable path.
 *
 * Write-family: read `before` (CREATE when absent, MODIFY otherwise) and capture
 * WHOLE_FILE with `after` from the args. Edit-family: capture HUNK_ONLY from the
 * synthesized old/new diff (no IO). Oversized before/after bodies are offloaded
 * later at the persist chokepoint, exactly as for the post-exec capture.
 */
export async function buildApprovalFileChange(
  toolName: string,
  args: Record<string, unknown>,
  workspaceBackend: WorkspaceBackend,
): Promise<FileChange | undefined> {
  if (!isFileModifyingTool(toolName)) return undefined;

  const rawPath = extractFilePath(args);
  if (!rawPath) return undefined;

  const { path, absolutePath } = resolveWorkspacePath(
    rawPath,
    workspaceBackend.rootDir,
    /* virtualRoot */ true,
  );

  const content = extractWriteContent(args);
  if (content !== null) {
    // Read via the workspace-relative path so platform-dir / virtual-root
    // routing applies, matching how the backend resolves the eventual write.
    const before = await safeReadBefore(workspaceBackend, path);
    return buildFileChange({
      path,
      absolutePath,
      changeType: before === undefined ? FileChangeType.CREATE : FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before,
      after: content,
    });
  }

  const oldString = typeof args.old_string === "string" ? args.old_string : undefined;
  const newString = typeof args.new_string === "string" ? args.new_string : undefined;
  if (oldString === undefined || newString === undefined) return undefined;

  const { unifiedDiff, linesAdded, linesRemoved } = synthesizeHunkDiff(oldString, newString);
  return buildFileChange({
    path,
    absolutePath,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff,
    linesAdded,
    linesRemoved,
  });
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

/** Read a file's content, or `undefined` when it is absent or unreadable. */
async function safeReadBefore(
  backend: WorkspaceBackend,
  path: string,
): Promise<string | undefined> {
  try {
    if (!(await backend.exists(path))) return undefined;
    return await backend.readFile(path);
  } catch {
    return undefined;
  }
}
