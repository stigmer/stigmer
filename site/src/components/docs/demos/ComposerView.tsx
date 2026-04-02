"use client";

import { MessageThread } from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { Bot, SendHorizontal } from "lucide-react";

interface ComposerViewProps {
  agentName: string;
  /** When provided, renders the conversation via MessageThread. */
  execution?: AgentExecution;
}

/**
 * Simplified session composer view for the guided-tour demo.
 *
 * Shows an agent header bar and — when an execution is provided —
 * renders the conversation using the real `MessageThread` component
 * from `@stigmer/react`. For the "ready" state (no execution), it
 * shows the empty composer with a placeholder input.
 */
export function ComposerView({ agentName, execution }: ComposerViewProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Agent header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
          <Bot className="h-3 w-3 text-muted-foreground" />
        </div>
        <span className="text-xs font-medium text-foreground">
          {agentName}
        </span>
      </div>

      {/* Conversation or empty state */}
      <div className="flex-1 overflow-hidden">
        {execution ? (
          <MessageThread
            executions={[execution]}
            className="h-full max-h-[240px] px-4 py-3"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
            <p className="text-[11px] text-muted-foreground">
              Ask the Skill Creator to build a skill from your domain knowledge.
            </p>
            <div className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
              <span className="flex-1 text-[11px] text-muted-foreground">
                Describe your skill...
              </span>
              <SendHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
