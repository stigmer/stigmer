/**
 * A `FilesystemBackend` that records the true before/after of every file
 * mutation for first-class diff review.
 *
 * Why a backend wrapper rather than reading at the `tool-started` event: the
 * runner consumes a queued LangGraph stream while the graph mutates files
 * independently of — and ahead of — the consumer, so a "before" read driven by
 * the event stream races the edit and can capture post-edit content. The runner
 * already constructs the `FilesystemBackend` it hands to deepagents, so wrapping
 * `write`/`edit` captures before/after at the exact mutation point, race-free.
 *
 * deepagents mutates only via `write` (create) and `edit` (modify) — there is no
 * delete/rename — so this records CREATE and MODIFY. Captures are dropped into a
 * `FileChangeCaptureBuffer`; the `FileChangeCoordinator` drains them at
 * `tool-finished` and attaches them to the owning `ToolCall`.
 *
 * @since First-Class Diff Review (#186)
 */

import { FilesystemBackend } from "deepagents";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { FileChangeCaptureBuffer } from "./file-change-buffer.js";

type FilesystemBackendOptions = NonNullable<
  ConstructorParameters<typeof FilesystemBackend>[0]
>;

export class CapturingFilesystemBackend extends FilesystemBackend {
  private readonly buffer: FileChangeCaptureBuffer;
  private readonly reader: WorkspaceBackend;

  constructor(
    options: FilesystemBackendOptions,
    deps: { buffer: FileChangeCaptureBuffer; reader: WorkspaceBackend },
  ) {
    super(options);
    this.buffer = deps.buffer;
    this.reader = deps.reader;
  }

  override async write(filePath: string, content: string) {
    // Read before the mutation so an overwrite (should deepagents ever permit
    // one) is still captured faithfully; today write is create-only, so before
    // is undefined and the change is a CREATE.
    const before = await this.safeRead(filePath);
    const result = await super.write(filePath, content);
    // deepagents reports failure as a value (error set, path undefined), not a
    // throw — only record an actual mutation.
    if (!result.error) {
      this.buffer.push({
        path: filePath,
        changeType: before === undefined ? FileChangeType.CREATE : FileChangeType.MODIFY,
        before,
        after: content,
      });
    }
    return result;
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) {
    const before = await this.safeRead(filePath);
    const result = await super.edit(filePath, oldString, newString, replaceAll);
    // A failed edit (e.g. oldString not found) returns an error result and
    // leaves the file untouched — recording then would emit a spurious no-op
    // MODIFY (before === after), so capture only a real mutation.
    if (!result.error) {
      const after = await this.safeRead(filePath);
      this.buffer.push({
        path: filePath,
        changeType: FileChangeType.MODIFY,
        before: before ?? "",
        after: after ?? "",
      });
    }
    return result;
  }

  /**
   * Read a file's full content, or `undefined` when it does not exist. Tries the
   * path as given first, then with leading slashes stripped: deepagents may
   * address files either as real paths or as virtual-root ("/"-prefixed) paths,
   * and the runner's `WorkspaceBackend` resolves a real path as-is and a relative
   * one under the workspace root.
   */
  private async safeRead(filePath: string): Promise<string | undefined> {
    const stripped = filePath.replace(/^\/+/, "");
    const candidates = stripped === filePath ? [filePath] : [filePath, stripped];
    for (const candidate of candidates) {
      try {
        if (await this.reader.exists(candidate)) {
          return await this.reader.readFile(candidate);
        }
      } catch {
        // Try the next candidate; a read failure is non-fatal for capture.
      }
    }
    return undefined;
  }
}
