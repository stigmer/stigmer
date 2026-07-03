"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowVersionTimeline } from "./WorkflowVersionTimeline.js";
import { WorkflowVersionDiffViewer } from "./WorkflowVersionDiffViewer.js";
import { useWorkflowVersions } from "./useWorkflowVersions.js";

/** Props for {@link WorkflowVersionsTab}. */
export interface WorkflowVersionsTabProps {
  /** The current workflow resource. */
  readonly workflow: Workflow;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Tab content for the "Versions" panel in the workflow detail page.
 *
 * Renders a split layout: version timeline on the left, and a diff
 * viewer on the right when a version is selected (comparing that
 * version against the current version).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <WorkflowVersionsTab workflow={workflow} />
 * ```
 */
export function WorkflowVersionsTab({
  workflow,
  className,
}: WorkflowVersionsTabProps) {
  const [selectedVersionHash, setSelectedVersionHash] = useState<string | null>(
    null,
  );

  const org = workflow.metadata?.org ?? "";
  const slug = workflow.metadata?.slug ?? "";
  const workflowId = workflow.metadata?.id ?? "";

  const { versions } = useWorkflowVersions(org, slug);
  const currentVersionHash =
    versions.find((v) => v.isCurrent)?.id ?? versions[0]?.id ?? "";

  const showDiff =
    selectedVersionHash !== null && selectedVersionHash !== currentVersionHash;

  return (
    <div className={cn("flex min-h-[24rem] gap-4", className)}>
      {/* Timeline panel */}
      <div
        className={cn(
          "flex shrink-0 flex-col overflow-y-auto",
          showDiff ? "w-[280px]" : "w-full max-w-md",
        )}
      >
        <WorkflowVersionTimeline
          workflowId={workflowId}
          org={org}
          slug={slug}
          onSelectVersion={setSelectedVersionHash}
          selectedHash={selectedVersionHash ?? undefined}
        />
      </div>

      {/* Diff panel */}
      {showDiff && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Comparing{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {selectedVersionHash.slice(0, 8)}
              </code>{" "}
              with current
            </span>
          </div>
          <WorkflowVersionDiffViewer
            workflowId={workflowId}
            hashA={selectedVersionHash}
            hashB={currentVersionHash}
            className="flex-1"
          />
        </div>
      )}
    </div>
  );
}
