"use client";

import type { ReactNode } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ArtifactsWidget,
  ExecutionProgress,
  UsageWidget,
  WriteBacksWidget,
} from "@stigmer/react";
import { DEMO_ORG } from "../fixtures";
import { DEMO_SIDEBAR_ZOOM } from "../shared/tokens";

interface WidgetsSidebarProps {
  /** Active or most recent execution (for phase badge / todos). */
  readonly execution: AgentExecution | null;
  /** All session executions (for aggregate widgets). */
  readonly executions: readonly AgentExecution[];
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
        <ExecutionProgress execution={execution} />
      </div>

      <UsageWidget executions={executions} />
      <WriteBacksWidget executions={executions} />
      <div data-cursor-target="artifact-widget">
        <ArtifactsWidget executions={executions} org={org} />
      </div>
    </div>
  );
}

/**
 * Convenience wrapper that renders a `WidgetsSidebar` with standard
 * demo props for a single execution.
 */
export function renderWidgetsSidebar(execution: AgentExecution): ReactNode {
  return (
    <WidgetsSidebar
      execution={execution}
      executions={[execution]}
      org={DEMO_ORG}
    />
  );
}
