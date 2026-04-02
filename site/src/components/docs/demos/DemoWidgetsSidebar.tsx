"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ArtifactsWidget,
  ExecutionProgress,
  UsageWidget,
  WriteBacksWidget,
} from "@stigmer/react";

interface DemoWidgetsSidebarProps {
  /** Active or most recent execution (for phase badge / todos). */
  readonly execution: AgentExecution | null;
  /** All session executions (for aggregate widgets). */
  readonly executions: readonly AgentExecution[];
  readonly org: string;
}

/**
 * Compact widget sidebar for the guided-tour demo.
 *
 * Mirrors the Console's `SessionPageInner` aside layout using real
 * `@stigmer/react` widgets. Widgets that have no data to display
 * (e.g. `UsageWidget` without `llm_metrics`) return `null`
 * automatically, so the sidebar adapts to what the fixture provides.
 */
export function DemoWidgetsSidebar({
  execution,
  executions,
  org,
}: DemoWidgetsSidebarProps) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="rounded-lg border border-border bg-card p-2">
        <ExecutionProgress execution={execution} />
      </div>

      <UsageWidget executions={executions} />
      <WriteBacksWidget executions={executions} />
      <ArtifactsWidget executions={executions} org={org} />
    </div>
  );
}
