import type { ReactNode } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ArtifactsWidget,
  ExecutionProgress,
  UsageWidget,
  WriteBacksWidget,
} from "@stigmer/react";
import { DEMO_ORG } from "./fixtures";
import "./WidgetsSidebar.css";

interface WidgetsSidebarProps {
  /** Active or most recent execution (for the phase badge / todos). */
  readonly execution: AgentExecution | null;
  /** All session executions (for the aggregate widgets). */
  readonly executions: readonly AgentExecution[];
  readonly org: string;
}

/**
 * Compact widget rail for tours, mirroring the console's session-page aside
 * with real `@stigmer/react` widgets. All widgets render purely from the
 * fixture executions passed as props — no RPCs. Widgets with nothing to show
 * (e.g. `UsageWidget` without `llm_metrics`) return `null`, so the rail
 * adapts to what the fixture provides.
 *
 * The `artifact-widget` cursor target wraps `ArtifactsWidget` so a step can
 * point the cursor at the artifact the tour is about to preview.
 */
export function WidgetsSidebar({ execution, executions, org }: WidgetsSidebarProps) {
  return (
    <div className="widgets-rail">
      <div className="widgets-rail__card">
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
 * Convenience wrapper rendering a `WidgetsSidebar` with standard demo props
 * for a single execution — the common case in a tour's `renderStep`.
 */
export function renderWidgetsSidebar(execution: AgentExecution): ReactNode {
  return (
    <WidgetsSidebar execution={execution} executions={[execution]} org={DEMO_ORG} />
  );
}
