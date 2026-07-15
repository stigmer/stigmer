"use client";

// Editor-area document rendering one child AgentExecution's full transcript.
// Domain: workflow (the AGENT_CALL counterpart of WorkflowArtifactDocument).

import { memo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import { useLiveAgentExecution } from "../execution/useLiveAgentExecution.js";
import { MessageThread } from "../execution/MessageThread.js";
import { ThreadSkeleton } from "../execution/ThreadSkeleton.js";
import { ExecutionPhaseBadge } from "../execution/ExecutionPhaseBadge.js";
import { isTerminalPhase } from "../execution/execution-phases.js";

/** Stable empty list so the thread's memoized rows keep identity (DD-010). */
const EMPTY_EXECUTIONS: readonly AgentExecution[] = [];

/** Props for {@link WorkflowAgentExecutionDocument}. */
export interface WorkflowAgentExecutionDocumentProps {
  /** ID of the child AgentExecution whose transcript to render. */
  readonly childExecutionId: string;
  /** The AGENT_CALL task that spawned the child — the document's title. */
  readonly taskName: string;
  /** Slug of the agent the task called, when known (subtitle context). */
  readonly agentSlug?: string;
  /**
   * Open the child execution as a standalone page — the pop-out escape hatch
   * preserved from the inspector's Agent tab. Host-routed (DD-004).
   */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The editor-pane rendering of a child AgentExecution's transcript — the
 * `SurfaceVirtualDocument` body the workflow execution panel mounts when an
 * AGENT_CALL task is opened in place (S4 of the UX-parity project). This is
 * the full session-grade experience — streaming `MessageThread` with tool
 * calls, sub-agents, and plan cards — replacing the inspector's cramped
 * `max-h-[50vh]` thumbnail.
 *
 * Deliberately READ-ONLY: no approval or file-review handlers are wired.
 * Child HITL is surfaced and submitted at the WORKFLOW level (the bottom
 * Approvals tab and the inspector's Approval tab route through the
 * workflow's SubmitApproval/SubmitFileDecision) — wiring the thread's
 * handlers to the child's own submit path would bypass that coordination.
 * A tool awaiting approval still shows its status inline, honestly.
 *
 * Lifecycle: the surface's editor area mounts only the ACTIVE virtual
 * document, so `useLiveAgentExecution` fetches/streams only while this tab
 * is foregrounded (DD-LIVE-006 — at most one child stream is ever live) and
 * a tab-return re-renders instantly from the DD-014 fetch cache.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export const WorkflowAgentExecutionDocument = memo(
  function WorkflowAgentExecutionDocument({
    childExecutionId,
    taskName,
    agentSlug,
    onNavigateToAgentExecution,
    className,
  }: WorkflowAgentExecutionDocumentProps) {
    const { execution, phase, isLoading, isStreaming, isReconnecting, error, reconnect } =
      useLiveAgentExecution(childExecutionId);

    return (
      <div
        role="article"
        aria-label={`Agent execution for task ${taskName}`}
        className={cn("flex h-full min-w-0 flex-col", className)}
      >
        {/* Slim identity header: task name (the DAG node this transcript
            belongs to), agent slug, live/phase state, and the standalone
            pop-out. Wraps on narrow panes rather than overflowing. */}
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-4 py-2">
          <span className="truncate text-sm font-medium text-foreground">
            {taskName}
          </span>
          {agentSlug && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {agentSlug}
            </span>
          )}

          <span className="shrink-0">
            {isStreaming ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                Live
              </span>
            ) : isReconnecting ? (
              <span className="text-xs text-muted-foreground">Reconnecting…</span>
            ) : isTerminalPhase(phase) ? (
              <ExecutionPhaseBadge phase={phase} />
            ) : null}
          </span>

          {onNavigateToAgentExecution && (
            <button
              type="button"
              onClick={() => onNavigateToAgentExecution(childExecutionId)}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              <PopOutIcon />
              Open standalone
            </button>
          )}
        </div>

        {/* The thread owns the scrolling (its auto-scroll machine + jump-to-
            latest need the scroll container); h-full keeps the surrounding
            editor-pane wrapper inert, so there is exactly one scrollbar. */}
        <div className="min-h-0 min-w-0 flex-1">
          {execution ? (
            <MessageThread
              executions={EMPTY_EXECUTIONS}
              activeStreamExecution={execution}
              className="h-full"
            />
          ) : isLoading ? (
            <ThreadSkeleton className="px-4 py-4" />
          ) : error ? (
            <div
              role="alert"
              className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-8 text-center"
            >
              <p className="text-xs text-destructive">{error.message}</p>
              <button
                type="button"
                onClick={reconnect}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          ) : (
            <div
              role="status"
              className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-4 py-8 text-center"
            >
              <p className="text-xs font-medium text-foreground">
                This agent execution is no longer available.
              </p>
              <p className="text-xs text-muted-foreground">
                It may have been removed, or the workflow run predates
                transcript retention.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function PopOutIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M10.5 4.5V1.5H7.5" />
      <path d="M10.5 1.5L6 6" />
      <path d="M8.5 7v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </svg>
  );
}
