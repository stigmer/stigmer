"use client";

/**
 * The widget sidebar the inline docs demos show beside a conversation: the
 * real `RunProgress` (the latest run's phase and its turn's to-dos), usage,
 * write-backs and artifacts, as the console's session aside lays them out.
 */

import type { ReactNode } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Todo } from "@stigmer/sdk";
import {
  ArtifactsWidget,
  RunProgress,
  UsageWidget,
  WriteBacksWidget,
} from "@stigmer/react";
import { DEMO_ORG, type DemoConversation } from "../fixtures";
import { DEMO_SIDEBAR_ZOOM } from "../shared/tokens";

interface WidgetsSidebarProps {
  /** Active or most recent run (for the phase badge). */
  readonly execution: Run | null;
  /** That run's turn's to-do list, from the session's fold. */
  readonly todos?: readonly Todo[];
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
  todos,
  executions,
  org,
}: WidgetsSidebarProps) {
  return (
    <div className="flex flex-col gap-2 p-2" style={{ zoom: DEMO_SIDEBAR_ZOOM }}>
      <div className="rounded-lg border border-border bg-card p-2">
        <RunProgress run={execution} todos={todos} />
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
 * demo props for a depicted conversation: its latest run and that turn's
 * to-dos.
 */
export function renderWidgetsSidebar(conversation: DemoConversation): ReactNode {
  return (
    <WidgetsSidebar
      execution={conversation.runs.at(-1) ?? null}
      todos={conversation.turns.at(-1)?.todos}
      executions={conversation.runs}
      org={DEMO_ORG}
    />
  );
}
