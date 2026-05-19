"use client";

import { memo, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { topologyFromTasks } from "./topologyFromTasks";
import { WorkflowTopologyGraph } from "./WorkflowTopologyGraph";

const COLLAPSED_HEIGHT = "24rem";
const EXPANDED_HEIGHT = "40rem";

/** Props for {@link WorkflowTopologyPreview}. */
export interface WorkflowTopologyPreviewProps {
  /** Tasks from the workflow spec. */
  readonly tasks: readonly WorkflowTask[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Read-only DAG preview of workflow tasks for the overview context.
 *
 * Wraps {@link WorkflowTopologyGraph} in a container with two height
 * states: a default 24rem view and an expanded 40rem view toggled
 * via a footer button. The graph supports mouse-wheel zoom,
 * drag-to-pan, and visible control buttons (zoom in/out, fit-to-view).
 *
 * Uses {@link topologyFromTasks} to build the topology directly
 * from proto objects without YAML serialization.
 *
 * Zero Console dependencies -- safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 */
export const WorkflowTopologyPreview = memo(function WorkflowTopologyPreview({
  tasks,
  className,
}: WorkflowTopologyPreviewProps) {
  const topology = useMemo(() => topologyFromTasks(tasks), [tasks]);
  const [expanded, setExpanded] = useState(false);

  if (tasks.length === 0) {
    return (
      <div className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No tasks defined
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className="rounded-sm bg-muted-subtle transition-[height] duration-200"
        style={{ height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }}
      >
        <WorkflowTopologyGraph
          topology={topology}
          className="h-full w-full"
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2">
        <span className="text-[11px] text-muted-foreground">
          Scroll to zoom &middot; Drag to pan
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors",
            "hover:text-primary-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded",
          )}
        >
          {expanded ? (
            <>
              <CollapseIcon />
              Collapse
            </>
          ) : (
            <>
              <ExpandIcon />
              Expand
            </>
          )}
        </button>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Icons — inline SVGs (no icon library dependency per DD-004)
// ---------------------------------------------------------------------------

function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v10M3 8l5 5 5-5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3M3 8l5-5 5 5" />
    </svg>
  );
}
