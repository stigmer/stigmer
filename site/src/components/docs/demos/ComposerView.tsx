"use client";

import { MessageThread, SessionComposer } from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { Bot } from "lucide-react";

const noop = () => {};

interface ComposerViewProps {
  agentName: string;
  /** When provided, renders the conversation via MessageThread. */
  execution?: AgentExecution;
}

/**
 * Session composer view for the guided-tour demo.
 *
 * Composes an agent header bar with real `@stigmer/react` components:
 * `MessageThread` for conversation steps and `SessionComposer` for the
 * empty "ready" state. No live backend required — the composer's
 * `onSubmit` is a no-op and all features that trigger RPCs are disabled.
 */
export function ComposerView({ agentName, execution }: ComposerViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
          <Bot className="h-3 w-3 text-muted-foreground" />
        </div>
        <span className="text-xs font-medium text-foreground">
          {agentName}
        </span>
      </div>

      <div className="flex-1 overflow-hidden">
        {execution ? (
          <MessageThread
            executions={[execution]}
            className="h-full max-h-[240px] px-4 py-3"
          />
        ) : (
          <div className="flex h-full flex-col justify-end p-3">
            <SessionComposer
              onSubmit={noop}
              placeholder="Describe your skill..."
              showModelSelector={false}
              enableAttachments={false}
              initialRows={2}
              autoFocus={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
