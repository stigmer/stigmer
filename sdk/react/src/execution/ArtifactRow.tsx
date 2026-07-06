"use client";

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { FileTypeIcon, FolderTypeIcon } from "../internal/file-icons/index.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { formatArtifactSize } from "./artifact-utils.js";

/** Props for {@link ArtifactRow}. */
export interface ArtifactRowProps {
  /** The execution artifact to render. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact — used to mint its download URL. */
  readonly executionId: string;
  /**
   * When `true`, another artifact in the list shares this artifact's display
   * `name` but has a different `sandbox_path`; the row renders the parent
   * directory as a muted subtitle to disambiguate. Typically supplied from
   * {@link SessionArtifactEntry.hasNameCollision}.
   */
  readonly hasNameCollision?: boolean;
  /** Single click / Enter / Space: open the artifact (a preview tab, or a modal). */
  readonly onOpen: () => void;
  /**
   * Double click: promote the artifact to a persistent (pinned) tab. Mirrors the
   * file tree's `onOpenFile` (preview) / `onActivateFile` (pin) split — the
   * leading single click of the double click has already opened the preview, so
   * this promotes it. Omit in panel-less hosts (e.g. the modal-only widget):
   * with no handler the row binds no `onDoubleClick`, so a double click is just
   * two harmless single clicks, exactly as `FileTreeNode` behaves.
   */
  readonly onActivate?: () => void;
  /** Additional CSS classes for the row's `<li>`. */
  readonly className?: string;
}

/**
 * One dense, VS Code-style artifact row: a full-width open button (shared
 * file-type icon + name + optional collision subtitle + size) with a sibling,
 * hover/focus-revealed Download button.
 *
 * The open target and the Download control are SIBLINGS, never nested — a
 * `<button>` inside a `<button>` is an axe `nested-interactive` (WCAG 4.1.2)
 * violation. This mirrors `ExplorerRoot`'s header + remove-control pattern.
 *
 * Deliberately execution-pure and presentational: it takes only the artifact,
 * its `executionId`, and open/activate closures — no session-domain types and
 * no content fetch (resource detection and Apply/Push live in the opened
 * document/modal, not the list). The two hosts — the session panel's
 * {@link ArtifactsTab} facet and the panel-less {@link ArtifactsWidget} — map
 * their entries onto these props and own the behavior wiring.
 *
 * @see ArtifactsTab — session-panel facet (rows open editor-pane document tabs)
 * @see ArtifactsWidget — panel-less embeddable (rows open the preview modal)
 */
export function ArtifactRow({
  artifact,
  executionId,
  hasNameCollision = false,
  onOpen,
  onActivate,
  className,
}: ArtifactRowProps) {
  const isDirectory = artifact.kind === ExecutionArtifactKind.DIRECTORY;
  const { download, isDownloading } = useArtifactDownload(executionId);

  const parentDir =
    hasNameCollision && artifact.sandboxPath
      ? parentDirectory(artifact.sandboxPath)
      : null;

  return (
    <li className={cn("group flex items-stretch", className)}>
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={onActivate}
        title={artifact.sandboxPath || artifact.name}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <span className="shrink-0 text-muted-foreground">
          {isDirectory ? (
            <FolderTypeIcon open={false} />
          ) : (
            <FileTypeIcon fileName={artifact.name} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {artifact.name}
          {isDirectory && "/"}
          {parentDir && (
            <span className="ml-1.5 text-[0.65rem] text-muted-foreground">
              {parentDir}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-[0.65rem] text-muted-foreground-faint">
          {formatArtifactSize(artifact.sizeBytes)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => download(artifact.storageKey, artifact.name)}
        disabled={isDownloading}
        aria-label={
          isDownloading
            ? `Preparing ${artifact.name}`
            : `Download ${artifact.name}`
        }
        title={isDirectory ? "Download ZIP" : "Download"}
        className={cn(
          "flex shrink-0 items-center px-2 text-muted-foreground opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-visible:opacity-100",
          "hover:text-foreground disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <DownloadIcon />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a human-readable parent directory label from a sandbox path.
 * Given `/workspace/configs/agent.yaml` returns `configs/`.
 * Returns `null` when the path has no meaningful parent segment.
 */
function parentDirectory(sandboxPath: string): string | null {
  const lastSlash = sandboxPath.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  const parent = sandboxPath.slice(0, lastSlash);
  const segment = parent.slice(parent.lastIndexOf("/") + 1);
  return segment ? `${segment}/` : null;
}

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}
