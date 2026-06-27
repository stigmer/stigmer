/**
 * Shared, harness-agnostic file-change capture for the HITL approval gate.
 *
 * This is the ONE place both harnesses build the proposed `FileChange` shown at
 * the approval gate — before the tool runs — so the user reviews a real diff
 * rather than a bare args box. It supersedes the per-harness gate builders the
 * native (deepagents) and Cursor paths used to keep separately.
 *
 * The capture is decided by the INPUT SHAPE, not the tool's classified kind:
 *  - a whole-file body (`content`/`contents`/…) → a WHOLE_FILE before/after,
 *    reading the current file from the workspace so an overwrite of an existing
 *    file renders a true before→after diff (CREATE when the file is absent);
 *  - an edit fragment (`old_string`/`new_string`) → a HUNK_ONLY synthesized
 *    `-old/+new` diff, with no IO (locating the fragment in the file would make
 *    the runner a second source of truth for the edit result).
 *
 * Why shape, not kind: the Cursor SDK can stream a whole-file *rewrite* under the
 * `edit` name (classified FILE_EDIT) while its captured `tool_input` carries
 * whole `contents` and no old/new strings. A kind-driven builder bailed on that
 * case, leaving the gate with empty `file_changes` (the "Content [N chars]" args
 * fallback). Deciding on the args present is correct for every taxonomy.
 *
 * GATE-ONLY by contract. This reads the file's pre-edit `before` content, which
 * is only correct when the tool has NOT yet run — i.e. at the gate, where the
 * native harness is paused at the interrupt and the Cursor hook DENIED the call.
 * The streaming/post-exec capture paths must NOT use this (the file already holds
 * the post-edit content); they have their own no-IO builders.
 *
 * @since cross-harness gate unification (HITL diff)
 */

import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { buildFileChange, resolveWorkspacePath } from "./file-change.js";
import {
  extractEditNewString,
  extractEditOldString,
  extractFilePath,
  extractWriteContent,
  isFileModifyingTool,
} from "./file-tools.js";
import { synthesizeHunkDiff } from "./hunk-diff.js";
import type { WorkspaceBackend } from "./workspace/types.js";

/** Options that vary by harness path-convention. */
export interface GateFileChangeOptions {
  /**
   * The deepagents harness addresses files against a virtual root where a
   * leading "/" denotes the workspace root; the Cursor harness passes real
   * filesystem paths. Defaults to `false` (Cursor / real paths).
   */
  readonly virtualRoot?: boolean;
}

/**
 * Build the proposed `FileChange` for a gated file-modifying tool call, or
 * `undefined` when the tool does not modify files, carries no usable path, or is
 * an edit missing its replacement strings.
 *
 * `backend` is the workspace the gated file lives in (local machine for OSS, the
 * sandbox in cloud — the runner is co-located with it). When omitted, the
 * before-read is skipped and a whole-file change degrades to a CREATE (the
 * pre-IO behavior), so callers without a backend still produce a usable preview.
 */
export async function buildGateFileChange(
  toolName: string,
  args: Record<string, unknown>,
  backend: WorkspaceBackend | undefined,
  options: GateFileChangeOptions = {},
): Promise<FileChange | undefined> {
  if (!isFileModifyingTool(toolName)) return undefined;

  const rawPath = extractFilePath(args);
  if (!rawPath) return undefined;

  const rootDir = backend?.rootDir ?? "";
  const { path, absolutePath } = rootDir
    ? resolveWorkspacePath(rawPath, rootDir, options.virtualRoot ?? false)
    : { path: rawPath, absolutePath: rawPath };

  // Whole-file write/rewrite: read the current file so an overwrite renders a
  // true before→after diff. A missing file is a CREATE (no before).
  const content = extractWriteContent(args);
  if (content !== null) {
    const before = backend ? await safeReadBefore(backend, path) : undefined;
    return buildFileChange({
      path,
      absolutePath,
      changeType: before === undefined ? FileChangeType.CREATE : FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before,
      after: content,
    });
  }

  // Edit family: synthesize the hunk from the replacement strings (no IO).
  const oldString = extractEditOldString(args);
  const newString = extractEditNewString(args);
  if (oldString === null || newString === null) return undefined;

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
