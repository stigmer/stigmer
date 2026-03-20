"use client";

import { useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useExecutionArtifacts } from "./useExecutionArtifacts";
import { isTerminalPhase } from "./execution-phases";
import { ArtifactCard } from "./ArtifactCard";
import { ArtifactPreviewModal } from "./ArtifactPreviewModal";
import type { ApplyResourceResult } from "../library/useApplyResource";

export interface ArtifactsWidgetProps {
  /**
   * The execution to display artifacts for. Renders nothing when `null`
   * or when the execution has no artifacts.
   */
  readonly execution: AgentExecution | null;
  /** Organization slug for the "Apply to [org]" CTA in the preview modal. */
  readonly org: string;
  /**
   * Called after a resource is successfully applied or a skill package
   * is pushed from the preview modal. The consumer can use this for
   * post-apply behavior such as showing a toast or navigating to the
   * Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Right-sidebar widget that surfaces execution artifacts as a compact
 * card list with automatic Stigmer resource detection.
 *
 * Composes {@link ArtifactCard} (summary + detection badges) with
 * {@link ArtifactPreviewModal} (full content review + Apply/Push CTA).
 * The card's "Preview" action opens the modal; the modal is the sole
 * location for Apply/Push actions (review-before-apply pattern).
 *
 * Derives all data from the `execution` prop:
 *
 * - **Artifacts**: extracted via {@link useExecutionArtifacts}
 * - **Terminal phase**: derived via {@link isTerminalPhase} — controls
 *   whether the Apply CTA in the modal is enabled
 * - **Execution ID**: read from `execution.metadata.id`
 *
 * Returns `null` when the execution is `null` or has no artifacts,
 * matching the conditional-render pattern of {@link ExecutionProgress}
 * and {@link ExecutionCostSummary}.
 *
 * Renders without card chrome — each {@link ArtifactCard} provides its
 * own border and padding. The consumer controls the container styling
 * (or places the widget directly in a flex/grid layout).
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <ArtifactsWidget
 *   execution={stream.execution}
 *   org={activeOrg}
 *   onApplied={(result) => toast(`${result.kind} applied`)}
 * />
 * ```
 *
 * @see {@link ArtifactCard} — compact summary card per artifact
 * @see {@link ArtifactPreviewModal} — full preview with Apply/Push CTA
 * @see {@link useExecutionArtifacts} — headless artifact extraction hook
 */
export function ArtifactsWidget({
  execution,
  org,
  onApplied,
  className,
}: ArtifactsWidgetProps) {
  const { artifacts, hasArtifacts, artifactCount } =
    useExecutionArtifacts(execution);

  const [previewArtifact, setPreviewArtifact] =
    useState<ExecutionArtifact | null>(null);

  if (!hasArtifacts) return null;

  const phase =
    execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const isTerminal = isTerminalPhase(phase);
  const executionId = execution?.metadata?.id ?? "";

  return (
    <section aria-label="Execution artifacts" className={cn(className)}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Artifacts</h3>
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {artifactCount}
        </span>
      </div>

      <div role="list" className="space-y-2">
        {artifacts.map((artifact) => (
          <div key={artifact.storageKey} role="listitem">
            <ArtifactCard
              artifact={artifact}
              executionId={executionId}
              org={org}
              onPreview={setPreviewArtifact}
            />
          </div>
        ))}
      </div>

      {previewArtifact && (
        <ArtifactPreviewModal
          artifact={previewArtifact}
          executionId={executionId}
          org={org}
          isTerminal={isTerminal}
          open
          onClose={() => setPreviewArtifact(null)}
          onApplied={onApplied}
        />
      )}
    </section>
  );
}
