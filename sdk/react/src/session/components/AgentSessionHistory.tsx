"use client";

import { History, Loader2, AlertCircle, RotateCw } from "lucide-react";
import { cn } from "@stigmer/theme";
import { SessionCard } from "./SessionCard.js";
import { useAgentSessionList } from "../hooks/useAgentSessionList.js";

export interface AgentSessionHistoryProps {
  agentId: string;
  onSessionSelect?: (sessionId: string) => void;
  pageSize?: number;
  className?: string;
}

export function AgentSessionHistory({
  agentId,
  onSessionSelect,
  pageSize = 5,
  className,
}: AgentSessionHistoryProps) {
  const {
    sessions,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
    retry,
  } = useAgentSessionList(agentId, { pageSize });

  return (
    <section className={cn("stgm-agent-session-history", className)}>
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        Recent Sessions
      </h3>

      {error && (
        <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {error.message || "Something went wrong"}
          </span>
          <button
            type="button"
            onClick={retry}
            className="text-destructive hover:text-destructive/80 inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors"
          >
            <RotateCw className="size-3" />
            Retry
          </button>
        </div>
      )}

      {isLoading && sessions.length === 0 && !error && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/50 h-[52px] animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {!isLoading && sessions.length === 0 && !error && (
        <div className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <History className="text-muted-foreground/40 mb-3 size-10" />
          <p className="text-sm font-medium">No sessions yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Run this agent to create your first session.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionCard
              key={session.metadata?.id}
              session={session}
              onNavigate={onSessionSelect}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={isLoadingMore}
            className={cn(
              "border-border inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
              "bg-background hover:bg-accent hover:text-accent-foreground transition-colors",
              "disabled:pointer-events-none disabled:opacity-50",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            {isLoadingMore && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            Load more
          </button>
        </div>
      )}
    </section>
  );
}
