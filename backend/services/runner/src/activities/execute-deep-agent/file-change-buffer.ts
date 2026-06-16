/**
 * Hand-off buffer between the file-mutation layer and the status layer for the
 * native (deepagents) harness.
 *
 * The `CapturingFilesystemBackend` records the true before/after of each
 * write/edit at the exact moment of mutation (the only race-free point — the
 * graph mutates files independently of, and ahead of, the event consumer). The
 * `FileChangeCoordinator` later drains these captures at `tool-finished` and
 * attaches them to the owning `ToolCall`.
 *
 * Captures are keyed by normalized path and consumed FIFO, so repeated edits of
 * the same file across one turn are attached to their tool calls in order. The
 * key normalization (strip leading slashes) matches both the path deepagents
 * passes to the backend and the path the streaming loop extracts from tool args.
 *
 * @since First-Class Diff Review (#186)
 */

import type { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** A single before/after capture recorded at a file mutation. */
export interface FileChangeCapture {
  /** Raw path as passed to the backend (virtual-root, may be "/"-prefixed). */
  readonly path: string;
  readonly changeType: FileChangeType;
  /** Pre-edit content; `undefined` when the file did not exist (CREATE). */
  readonly before?: string;
  /** Post-edit content; `undefined` when the file was removed. */
  readonly after?: string;
}

function normalizeKey(path: string): string {
  return path.replace(/^\/+/, "");
}

export class FileChangeCaptureBuffer {
  private readonly byPath = new Map<string, FileChangeCapture[]>();

  /** Record a capture, appending to the per-path FIFO queue. */
  push(capture: FileChangeCapture): void {
    const key = normalizeKey(capture.path);
    const queue = this.byPath.get(key);
    if (queue) {
      queue.push(capture);
    } else {
      this.byPath.set(key, [capture]);
    }
  }

  /**
   * Remove and return the oldest capture recorded for `rawPath`, or `undefined`
   * when none remain (e.g. a file mutation performed via shell rather than the
   * backend's edit/write, which this layer intentionally does not capture).
   */
  popOldest(rawPath: string): FileChangeCapture | undefined {
    const key = normalizeKey(rawPath);
    const queue = this.byPath.get(key);
    if (!queue || queue.length === 0) return undefined;
    const capture = queue.shift();
    if (queue.length === 0) this.byPath.delete(key);
    return capture;
  }
}
