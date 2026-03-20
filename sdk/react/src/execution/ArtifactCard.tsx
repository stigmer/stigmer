"use client";

import { useCallback, useState } from "react";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useArtifactContent } from "./useArtifactContent";
import { isTextArtifact, formatArtifactSize } from "./artifact-utils";
import { useDetectStigmerResource } from "../library/useDetectStigmerResource";
import { useDetectSkillPackage } from "../library/useDetectSkillPackage";
import {
  useApplyResource,
  type ApplyResourceResult,
} from "../library/useApplyResource";

/**
 * Artifacts larger than this threshold skip the content fetch used for
 * resource detection. Stigmer resource YAML files are typically under
 * 10 KB — 256 KB is generous without risking large payloads for log
 * files or binary-adjacent text content.
 */
const MAX_DETECTION_SIZE = 256 * 1024;

export interface ArtifactCardProps {
  /** The execution artifact to render. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact. */
  readonly executionId: string;
  /** Organization slug for the "Apply to [org]" CTA. */
  readonly org: string;
  /**
   * Whether the execution is in a terminal phase (completed, failed,
   * cancelled, terminated). Controls Apply CTA prominence:
   *
   * - `true` — Apply renders as an enabled primary button
   * - `false` — Apply renders as a disabled secondary button,
   *   signaling the action will become available when the execution
   *   completes
   */
  readonly isTerminal: boolean;
  /**
   * Called when the user clicks "Preview". The consumer is responsible
   * for rendering a preview UI (e.g., {@link ArtifactPreviewModal}).
   *
   * When omitted, the Preview action is not rendered.
   */
  readonly onPreview?: (artifact: ExecutionArtifact) => void;
  /**
   * Called after a Stigmer resource is successfully applied or a skill
   * package is pushed. The consumer can use this for post-apply behavior
   * such as showing a toast notification or navigating to the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Renders a single execution artifact as a compact card with automatic
 * Stigmer resource detection, download action, and an "Apply to [org]"
 * CTA for detected resources.
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
 * Detection results are surfaced as a type badge. When a Stigmer resource
 * is detected, the card renders an "Apply to [org]" primary CTA that
 * calls the appropriate SDK method via {@link useApplyResource}.
 *
 * Non-Stigmer artifacts render with file info and a download link only —
 * no error messages or "not detected" indicators (detection is silent).
 *
 * @example
 * ```tsx
 * const { artifacts } = useExecutionArtifacts(execution);
 * const isTerminal = execution?.status?.phase
 *   ? isTerminalPhase(execution.status.phase)
 *   : false;
 *
 * {artifacts.map((artifact) => (
 *   <ArtifactCard
 *     key={artifact.storageKey}
 *     artifact={artifact}
 *     executionId={execution.id}
 *     org={activeOrg}
 *     isTerminal={isTerminal}
 *     onPreview={(a) => setPreviewArtifact(a)}
 *     onApplied={(result) => toast(`${result.kind} applied`)}
 *   />
 * ))}
 * ```
 *
 * @see {@link useExecutionArtifacts} — extracts artifact metadata from an execution
 * @see {@link useArtifactContent} — content-fetching hook (headless alternative)
 * @see {@link useDetectStigmerResource} — YAML resource detection (headless)
 * @see {@link useDetectSkillPackage} — skill package detection (headless)
 * @see {@link useApplyResource} — apply/push behavior hook (headless)
 */
export function ArtifactCard({
  artifact,
  executionId,
  org,
  isTerminal,
  onPreview,
  onApplied,
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

  // ---------------------------------------------------------------------------
  // Apply state
  // ---------------------------------------------------------------------------

  const {
    applyYamlResource,
    pushSkillPackage,
    isApplying,
    error: applyError,
    clearError,
  } = useApplyResource();

  const [applyResult, setApplyResult] = useState<ApplyResourceResult | null>(
    null,
  );

  const handleApply = useCallback(async () => {
    clearError();
    try {
      let result: ApplyResourceResult;
      if (yamlDetection.detected && content) {
        result = await applyYamlResource(content, org);
      } else if (skillDetection.detected) {
        result = await pushSkillPackage({
          org,
          executionId,
          storageKey: artifact.storageKey,
        });
      } else {
        return;
      }
      setApplyResult(result);
      onApplied?.(result);
    } catch {
      // error state is managed by useApplyResource
    }
  }, [
    yamlDetection.detected,
    skillDetection.detected,
    content,
    org,
    executionId,
    artifact.storageKey,
    applyYamlResource,
    pushSkillPackage,
    clearError,
    onApplied,
  ]);

  // ---------------------------------------------------------------------------
  // CTA label
  // ---------------------------------------------------------------------------

  let ctaLabel: string | null = null;
  if (yamlDetection.detected) {
    ctaLabel = `Apply to ${org}`;
  } else if (skillDetection.detected) {
    ctaLabel = `Push Skill to ${org}`;
  }

  const canPreview = !!onPreview && (isTextArtifact(artifact) || isDirectory);

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
        <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
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
              "text-xs font-medium text-primary transition-colors hover:text-primary/80",
              FOCUS_RING_CLASSES,
            )}
          >
            Preview
          </button>
        )}
        <a
          href={artifact.downloadUrl}
          download
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            FOCUS_RING_CLASSES,
          )}
        >
          <DownloadIcon />
          {isDirectory ? "Download ZIP" : "Download"}
        </a>
      </div>

      {/* Apply CTA / Applied / Error */}
      {isDetected && !applyResult && (
        <ApplyCtaArea
          label={ctaLabel!}
          isTerminal={isTerminal}
          isApplying={isApplying}
          error={applyError}
          onApply={handleApply}
        />
      )}
      {applyResult && (
        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckIcon />
          <span>Applied \u00B7 {applyResult.name || applyResult.kind}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// Apply CTA area (internal)
// ---------------------------------------------------------------------------

/**
 * Renders the Apply CTA with a three-state machine:
 *
 * 1. **Error** — error message + retry link (replaces button)
 * 2. **Applying** — disabled button with spinner
 * 3. **Idle** — enabled (terminal) or disabled (streaming) button
 */
function ApplyCtaArea({
  label,
  isTerminal,
  isApplying,
  error,
  onApply,
}: {
  readonly label: string;
  readonly isTerminal: boolean;
  readonly isApplying: boolean;
  readonly error: Error | null;
  readonly onApply: () => void;
}) {
  if (error) {
    return (
      <div className="mt-2" role="alert">
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertIcon />
          <div className="min-w-0 flex-1">
            <p>{error.message}</p>
            <button
              type="button"
              onClick={onApply}
              className={cn(
                "mt-0.5 font-medium underline transition-colors hover:text-destructive/80",
                FOCUS_RING_CLASSES,
              )}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canApply = isTerminal && !isApplying;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={canApply ? onApply : undefined}
        disabled={!canApply}
        aria-busy={isApplying}
        aria-label={label}
        className={cn(
          "w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed",
          canApply
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-muted text-muted-foreground",
        )}
      >
        {isApplying ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <SpinnerIcon />
            Applying\u2026
          </span>
        ) : (
          label
        )}
      </button>
    </div>
  );
}

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

function CheckIcon() {
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
      <path d="M2 6.5L4.5 9L10 3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
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
      className="mt-0.5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="5" />
      <path d="M6 4V6.5" />
      <circle cx="6" cy="8.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
