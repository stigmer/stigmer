"use client";

import type { ReactNode } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ArtifactsWidget,
  RunProgress,
  UsageWidget,
  WriteBacksWidget,
} from "@stigmer/react";
import { DEMO_ORG } from "../fixtures";
import { DEMO_SIDEBAR_ZOOM } from "../shared/tokens";

interface WidgetsSidebarProps {
  /** Active or most recent run (for phase badge / todos). */
  readonly execution: Run | null;
  /** All session runs (for aggregate widgets). */
  readonly executions: readonly Run[];
  readonly org: string;
}

/**
 * Compact widget sidebar for demo scenarios.
 *
 * Mirrors the Console's `SessionPageInner` aside layout using real
 * `@stigmer/react` widgets. Widgets that have no data to display
 * (e.g. `UsageWidget` without `llm_metrics`) return `null`
 * automatically, so the sidebar adapts to what the fixture provides.
 */
export function WidgetsSidebar({
  execution,
  executions,
  org,
}: WidgetsSidebarProps) {
  return (
    <div className="flex flex-col gap-2 p-2" style={{ zoom: DEMO_SIDEBAR_ZOOM }}>
      <div className="rounded-lg border border-border bg-card p-2">
        <RunProgress run={execution} />
      </div>

      <UsageWidget runs={executions} />
      <WriteBacksWidget runs={executions} />
      <div data-cursor-target="artifact-widget">
        <ArtifactsWidget runs={executions} org={org} />
      </div>
    </div>
  );
}

/**
 * Convenience wrapper that renders a `WidgetsSidebar` with standard
 * demo props for a single run.
 */
export function renderWidgetsSidebar(execution: Run): ReactNode {
  return (
    <WidgetsSidebar
      execution={execution}
      executions={[execution]}
      org={DEMO_ORG}
    />
  );
}
