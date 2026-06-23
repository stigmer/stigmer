"use client";

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useArtifactContent } from "./useArtifactContent";
import { useArtifactDownload } from "./useArtifactDownload";
import { isTextArtifact, formatArtifactSize } from "./artifact-utils";
import { useDetectStigmerResource } from "../library/useDetectStigmerResource";
import { useDetectSkillPackage } from "../library/useDetectSkillPackage";

/**
 * Artifacts larger than this threshold skip the content fetch used for
 * resource detection. Stigmer resource YAML files are typically under
 * 10 KB — 256 KB is generous without risking large payloads for log
 * files or binary-adjacent text content.
 */
const MAX_DETECTION_SIZE = 256 * 1024;

/** Props for {@link ArtifactCard}. */
export interface ArtifactCardProps {
  /** The execution artifact to render. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact — used for content fetching. */
  readonly executionId: string;
  /**
   * Organization slug — used for skill package detection which fetches
   * `SKILL.md` frontmatter via the artifact content RPC.
   */
  readonly org: string;
  /**
   * Called when the user clicks "Preview". The consumer is responsible
   * for rendering a preview UI (e.g., {@link ArtifactPreviewModal}).
   *
   * When omitted, the Preview action is not rendered.
   */
  readonly onPreview?: (artifact: ExecutionArtifact) => void;
  /**
   * When `true`, another artifact in the list shares the same display
   * `name` but has a different `sandbox_path`. The card renders the
   * parent directory from `sandbox_path` as a muted subtitle for
   * disambiguation.
   *
   * Set by {@link ArtifactsWidget} via {@link useSessionArtifacts}.
   * Defaults to `false`.
   */
  readonly hasNameCollision?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Renders a single execution artifact as a compact summary card with
 * automatic Stigmer resource detection and a download link.
 *
 * The card's role is **signal and navigate**: it tells the user what
 * the artifact is (file/directory, size, detected resource type) and
 * provides two actions — Preview and Download. The Apply/Push CTA
 * lives exclusively in {@link ArtifactPreviewModal} so the user must
 * review content before acting (review-before-apply pattern).
 *
 * Internally orchestrates the detection pipeline:
 *
 * - **FILE artifacts**: Fetches text content via {@link useArtifactContent},
 *   then detects Agent/McpServer YAML via {@link useDetectStigmerResource}.
 *   Only text files under 256 KB are fetched for detection.
 *
 * - **DIRECTORY artifacts**: Detects skill packages via
 *   {@link useDetectSkillPackage} (checks for `SKILL.md` in the ZIP
 *   archive entries).
 *
 * Detection results are surfaced as a type badge ("Agent detected",
 * "Skill · N files"). Non-Stigmer artifacts render with file info
 * and a download link only — no error messages or "not detected"
 * indicators (detection is silent).
 *
 * @example
 * ```tsx
 * const { artifacts } = useExecutionArtifacts(execution);
 *
 * {artifacts.map((artifact) => (
 *   <ArtifactCard
 *     key={artifact.storageKey}
 *     artifact={artifact}
 *     executionId={execution.metadata!.id}
 *     org={activeOrg}
 *     onPreview={(a) => setPreviewArtifact(a)}
 *   />
 * ))}
 * ```
 *
 * @see {@link ArtifactPreviewModal} — full preview with Apply/Push CTA
 * @see {@link ArtifactsWidget} — container that composes cards + modal
 * @see {@link useExecutionArtifacts} — extracts artifact metadata from an execution
 * @see {@link useArtifactContent} — content-fetching hook (headless alternative)
 * @see {@link useDetectStigmerResource} — YAML resource detection (headless)
 * @see {@link useDetectSkillPackage} — skill package detection (headless)
 */
export function ArtifactCard({
  artifact,
  executionId,
  org,
  onPreview,
  hasNameCollision = false,
  className,
}: ArtifactCardProps) {
  // ---------------------------------------------------------------------------
  // Detection orchestration
  // ---------------------------------------------------------------------------

  const isDirectory = artifact.kind === ExecutionArtifactKind.DIRECTORY;
  const canDetectYaml =
    !isDirectory &&
    isTextArtifact(artifact) &&
    Number(artifact.sizeBytes) < MAX_DETECTION_SIZE;

  const { content, isLoading: isContentLoading } = useArtifactContent(
    canDetectYaml ? executionId : null,
    canDetectYaml ? artifact.storageKey : null,
    undefined,
    artifact.contentHash || undefined,
  );

  const yamlDetection = useDetectStigmerResource(
    canDetectYaml ? content : null,
  );

  const { detection: skillDetection, isLoading: isSkillLoading } =
    useDetectSkillPackage(
      isDirectory ? artifact : null,
      isDirectory ? executionId : null,
    );

  // ---------------------------------------------------------------------------
  // Derived detection state
  // ---------------------------------------------------------------------------

  const isDetected = yamlDetection.detected || skillDetection.detected;
  const isDetecting =
    (canDetectYaml && isContentLoading) || (isDirectory && isSkillLoading);

  let detectionLabel: string | null = null;
  if (yamlDetection.detected) {
    detectionLabel = `${yamlDetection.displayName} detected`;
  } else if (skillDetection.detected) {
    const count = skillDetection.fileCount;
    detectionLabel = `Skill \u00B7 ${count} ${count === 1 ? "file" : "files"}`;
  }

  const canPreview = !!onPreview && (isTextArtifact(artifact) || isDirectory);

  const { download, isDownloading } = useArtifactDownload(executionId);

  const parentDir =
    hasNameCollision && artifact.sandboxPath
      ? parentDirectory(artifact.sandboxPath)
      : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      role="article"
      aria-label={artifact.name}
      className={cn("rounded-md border border-border p-3", className)}
    >
      {/* Header: icon + name + size */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {isDirectory ? <FolderIcon /> : <FileIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {artifact.name}
            {isDirectory && "/"}
          </div>
          {parentDir && (
            <div className="truncate text-xs text-muted-foreground">
              {parentDir}
            </div>
          )}
          <div className="text-xs tabular-nums text-muted-foreground">
            {formatArtifactSize(artifact.sizeBytes)}
          </div>
        </div>
      </div>

      {/* Detection badge */}
      {isDetecting && !isDetected && (
        <div
          className="mt-1.5 h-5 w-28 animate-pulse rounded-full bg-muted"
          aria-hidden="true"
        />
      )}
      {detectionLabel && (
        <span className="mt-1.5 inline-flex items-center rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
          {detectionLabel}
        </span>
      )}

      {/* Secondary actions: Preview + Download */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {canPreview && (
          <button
            type="button"
            onClick={() => onPreview!(artifact)}
            className={cn(
              "text-xs font-medium text-primary transition-colors hover:text-primary-muted",
              FOCUS_RING_CLASSES,
            )}
          >
            Preview
          </button>
        )}
        <button
          type="button"
          onClick={() => download(artifact.storageKey, artifact.name)}
          disabled={isDownloading}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
            FOCUS_RING_CLASSES,
          )}
        >
          <DownloadIcon />
          {isDownloading ? "Preparing…" : isDirectory ? "Download ZIP" : "Download"}
        </button>
      </div>

    </div>
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

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 11C13 11.55 12.55 12 12 12H2C1.45 12 1 11.55 1 11V3C1 2.45 1.45 2 2 2H5L7 4H12C12.55 4 13 4.45 13 5V11Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="10"
      height="10"
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

