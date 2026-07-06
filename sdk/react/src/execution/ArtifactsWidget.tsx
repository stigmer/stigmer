"use client";

import { useCallback, useMemo, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import {
  useSessionArtifacts,
  artifactKey,
  type SessionArtifactEntry,
} from "../session/useSessionArtifacts.js";
import { ArtifactRow } from "./ArtifactRow.js";
import { ArtifactPreviewModal } from "./ArtifactPreviewModal.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

/** Props for {@link ArtifactsWidget}. */
export interface ArtifactsWidgetProps {
  /**
   * All executions for the current session — both completed and
   * actively streaming. The widget aggregates artifacts across every
   * execution, deduplicates by `sandbox_path` (latest wins), and
   * sorts alphabetically by name.
   *
   * Renders nothing when the list is empty or no execution has
   * artifacts.
   */
  readonly executions: readonly AgentExecution[];
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
 * Right-sidebar widget that surfaces all artifacts produced during a
 * session as a unified, alphabetically-sorted file listing.
 *
 * Artifacts from multiple executions are aggregated and deduplicated
 * by `sandbox_path` (latest execution wins), presenting the user with
 * a file-explorer-like view of the conversation's output — no
 * execution/turn concepts are exposed.
 *
 * The panel-less counterpart of the session panel's Artifacts facet: it
 * renders the same dense {@link ArtifactRow} list, but — having no editor pane
 * to open document tabs into — a click opens the {@link ArtifactPreviewModal}
 * (the review-before-apply popup, and the sole home of the Apply/Push CTA).
 * This is the embeddable path a platform builder drops into their own sidebar.
 *
 * Returns `null` when the executions list is empty or no execution
 * has artifacts, matching the conditional-render pattern of
 * {@link ExecutionProgress} and {@link UsageWidget}.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 *
 * <ArtifactsWidget
 *   executions={[
 *     ...conv.completedExecutions,
 *     ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 *   ]}
 *   org={activeOrg}
 *   onApplied={(result) => toast(`${result.kind} applied`)}
 * />
 * ```
 *
 * @see {@link ArtifactRow} — the dense row rendered per artifact
 * @see {@link ArtifactPreviewModal} — full preview with Apply/Push CTA
 * @see {@link useSessionArtifacts} — headless session-level artifact aggregation hook
 * @see {@link useExecutionArtifacts} — headless single-execution artifact extraction hook
 */
export function ArtifactsWidget({
  executions,
  org,
  onApplied,
  className,
}: ArtifactsWidgetProps) {
  const { artifacts, hasArtifacts, artifactCount } =
    useSessionArtifacts(executions);

  // Store the artifact identity (not a snapshot of the full entry). The entry is
  // re-derived from the live artifacts list on every render, so the modal always
  // reflects the latest artifact version — even when a newer execution publishes
  // an updated artifact for the same path while the modal is open.
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const previewEntry = useMemo<SessionArtifactEntry | null>(
    () =>
      previewKey !== null
        ? artifacts.find((e) => artifactKey(e.artifact) === previewKey) ?? null
        : null,
    [previewKey, artifacts],
  );

  const handleOpen = useCallback(
    (entry: SessionArtifactEntry) => setPreviewKey(artifactKey(entry.artifact)),
    [],
  );

  if (!hasArtifacts) return null;

  return (
    <section aria-label="Artifacts" className={cn(className)}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Artifacts</h3>
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {artifactCount}
        </span>
      </div>

      <ul role="list" className="flex flex-col">
        {artifacts.map((entry) => (
          <ArtifactRow
            key={artifactKey(entry.artifact)}
            artifact={entry.artifact}
            executionId={entry.executionId}
            hasNameCollision={entry.hasNameCollision}
            onOpen={() => handleOpen(entry)}
          />
        ))}
      </ul>

      {previewEntry && (
        <ArtifactPreviewModal
          artifact={previewEntry.artifact}
          executionId={previewEntry.executionId}
          org={org}
          isTerminal={previewEntry.isTerminal}
          open
          onClose={() => setPreviewKey(null)}
          onApplied={onApplied}
        />
      )}
    </section>
  );
}
