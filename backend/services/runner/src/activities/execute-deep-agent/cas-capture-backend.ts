/**
 * A capture-mode `FilesystemBackend` that records the pre-turn bytes of
 * gitignored paths so the turn boundary can compose them into a CAS change set
 * (design docs 08/11/12; the `.gitignored` half of apply-then-review).
 *
 * WHY A BACKEND WRAPPER, NOT THE APPROVAL GATE
 * --------------------------------------------
 * Capture is a property of the TURN, not of authorization — exactly like the git
 * substrate, which snapshots the working tree at the turn boundary regardless of
 * how or whether a tool was gated. File review opens even under the global bypass
 * (`spec.auto_approve_all`), where the approval gate is not installed at all, so
 * sourcing the before-bytes from the gate would let gitignored edits silently
 * escape review under auto-approve-all. Observing at the backend keeps CAS
 * capture gate-independent, so it is symmetric with the git-tracked path.
 *
 * WHAT IT CAPTURES
 * ----------------
 * Only the BEFORE (pre-turn) bytes of gitignored paths, recorded at the exact
 * mutation point (before `super.write`/`super.edit`) — the sole race-free moment,
 * since the graph mutates files ahead of the event consumer. The AFTER bytes are
 * re-read from disk at the turn boundary (the authoritative net result of the
 * turn), so multiple edits to one path collapse naturally to one before/after.
 * Git-tracked paths are left to the turn-boundary git diff and are never recorded
 * here, so memory is bounded to the CAS scope (gitignored paths only).
 *
 * deepagents mutates only via `write` (create/overwrite) and `edit` (modify);
 * there is no backend delete/rename, so this records CREATE and MODIFY. A
 * gitignored delete can only arrive via shell, which stays on the approval gate.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS deep-agent wiring)
 */

import { readFile } from "node:fs/promises";
import { FilesystemBackend } from "deepagents";
import { resolveWorkspacePath } from "../../shared/file-change.js";

type FilesystemBackendOptions = NonNullable<
  ConstructorParameters<typeof FilesystemBackend>[0]
>;

/**
 * Pre-turn bytes of each first-touched gitignored path, keyed by workspace-root-
 * relative path. `null` means the path did not exist before the turn (an ADD).
 * The turn boundary reads this to build the CAS `before` side.
 */
export type CasBeforeMap = Map<string, Uint8Array | null>;

export class CasCaptureFilesystemBackend extends FilesystemBackend {
  private readonly rootDir: string;
  private readonly collector: CasBeforeMap;
  private readonly isIgnored: (relPath: string) => Promise<boolean>;
  /** Paths whose before-read is in flight — the synchronous first-touch lock. */
  private readonly reserving = new Set<string>();

  constructor(
    options: FilesystemBackendOptions,
    deps: {
      collector: CasBeforeMap;
      /** True when the workspace-relative path is gitignored (CAS-owned). */
      isIgnored: (relPath: string) => Promise<boolean>;
    },
  ) {
    super(options);
    this.rootDir = options.rootDir;
    this.collector = deps.collector;
    this.isIgnored = deps.isIgnored;
  }

  override async write(filePath: string, content: string) {
    await this.recordBefore(filePath);
    return super.write(filePath, content);
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) {
    await this.recordBefore(filePath);
    return super.edit(filePath, oldString, newString, replaceAll);
  }

  /**
   * Record the pre-turn bytes of `rawPath` when it is a first-touched gitignored
   * path. First-touch-wins: the slot is reserved SYNCHRONOUSLY (before the first
   * `await`) so two concurrent mutations of the same path cannot both read a
   * post-write "before". Non-gitignored paths (git-tracked) are ignored here —
   * the turn-boundary git diff captures them.
   */
  private async recordBefore(rawPath: string): Promise<void> {
    const { path: relPath, absolutePath } = resolveWorkspacePath(rawPath, this.rootDir, true);
    if (this.collector.has(relPath) || this.reserving.has(relPath)) return;
    this.reserving.add(relPath);
    try {
      if (!(await this.isIgnored(relPath))) return;
      // Re-check after the await: a concurrent call may have won the slot.
      if (this.collector.has(relPath)) return;
      this.collector.set(relPath, await this.readBytesOrNull(absolutePath));
    } finally {
      this.reserving.delete(relPath);
    }
  }

  /** Raw bytes of a file, or `null` when it does not exist (an ADD). */
  private async readBytesOrNull(absolutePath: string): Promise<Uint8Array | null> {
    try {
      return await readFile(absolutePath);
    } catch {
      return null;
    }
  }
}
