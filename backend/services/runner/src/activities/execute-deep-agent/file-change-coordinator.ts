/**
 * Drains captured file mutations and attaches them to their owning `ToolCall`.
 *
 * Sibling to `InlinePublisher` / `WriteBackCoordinator`: it holds the
 * `ExecutionStatusWriter` and reacts to file-modifying tool completions. Unlike
 * those (which do file IO / git), the before/after were already captured at the
 * mutation point by `CapturingFilesystemBackend`, so `attach` is synchronous —
 * the file changes land in the same persist as the tool-finish, with no lag.
 *
 * @since First-Class Diff Review (#186)
 */

import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { buildFileChange, resolveWorkspacePath } from "../../shared/file-change.js";
import type { ExecutionStatusWriter } from "./execution-status-writer.js";
import type { FileChangeCaptureBuffer } from "./file-change-buffer.js";

export class FileChangeCoordinator {
  private readonly statusWriter: ExecutionStatusWriter;
  private readonly buffer: FileChangeCaptureBuffer;
  private readonly rootDir: string;

  constructor(opts: {
    statusWriter: ExecutionStatusWriter;
    buffer: FileChangeCaptureBuffer;
    workspaceBackend: WorkspaceBackend;
  }) {
    this.statusWriter = opts.statusWriter;
    this.buffer = opts.buffer;
    this.rootDir = opts.workspaceBackend.rootDir;
  }

  /**
   * Attach the file change captured for `path` to the tool call identified by
   * `toolCallId`. A no-op when nothing was captured for the path (e.g. a file
   * mutation performed via shell rather than the backend's edit/write).
   */
  attach(toolCallId: string, path: string): void {
    const capture = this.buffer.popOldest(path);
    if (!capture) return;

    const { path: relPath, absolutePath } = resolveWorkspacePath(
      capture.path,
      this.rootDir,
      /* virtualRoot */ true,
    );

    const change = buildFileChange({
      path: relPath,
      absolutePath,
      changeType: capture.changeType,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      // CREATE has no before; the buffer leaves it undefined so it is omitted.
      before: capture.changeType === FileChangeType.CREATE ? undefined : capture.before,
      after: capture.after,
    });

    this.statusWriter.attachFileChanges(toolCallId, [change]);
  }
}
