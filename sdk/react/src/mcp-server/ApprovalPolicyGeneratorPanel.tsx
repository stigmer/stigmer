"use client";

import { useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useExecutionStream } from "../execution/useExecutionStream";
import { MessageThread } from "../execution/MessageThread";
import { ExecutionProgress } from "../execution/ExecutionProgress";
import { isTerminalPhase } from "../execution/execution-phases";

export interface ApprovalPolicyGeneratorPanelProps {
  /** The execution ID to stream. */
  readonly executionId: string;
  /** Called when the user clicks the close/dismiss button. */
  readonly onClose: () => void;
  /** Called once when the execution reaches a terminal phase. */
  readonly onComplete?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Inline panel that streams the approval policy generation execution.
 *
 * Composes {@link useExecutionStream}, {@link MessageThread}, and
 * {@link ExecutionProgress} to show real-time agent progress: thinking,
 * tool calls, generated YAML, and applied changes.
 *
 * When the execution reaches a terminal phase, the `onComplete`
 * callback fires once so the parent can refetch the MCP server to
 * display newly applied policies.
 *
 * @example
 * ```tsx
 * {result && (
 *   <ApprovalPolicyGeneratorPanel
 *     executionId={result.executionId}
 *     onClose={() => setResult(null)}
 *     onComplete={() => refetch()}
 *   />
 * )}
 * ```
 */
export function ApprovalPolicyGeneratorPanel({
  executionId,
  onClose,
  onComplete,
  className,
}: ApprovalPolicyGeneratorPanelProps) {
  const { execution, phase, isStreaming, error, reconnect } =
    useExecutionStream(executionId);

  const isComplete = isTerminalPhase(phase);

  const completeFiredRef = useRef(false);
  useEffect(() => {
    if (isComplete && onComplete && !completeFiredRef.current) {
      completeFiredRef.current = true;
      onComplete();
    }
  }, [isComplete, onComplete]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground">
            Generating Approval Policies
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {execution && (
            <ExecutionProgress execution={execution} className="text-xs" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Stream content */}
      <div className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-destructive">{error.message}</p>
            <button
              type="button"
              onClick={reconnect}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : (
          <MessageThread
            executions={[]}
            activeStreamExecution={execution}
          />
        )}
      </div>

      {/* Footer */}
      {isComplete && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {phase === ExecutionPhase.EXECUTION_COMPLETED
              ? "Approval policies have been generated and applied. The detail view will refresh to show the changes."
              : "Policy generation did not complete successfully. You can retry from the detail page."}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function SparklesIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

function CloseIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
