"use client";

import { History, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionCard } from "@/components/session/SessionCard";
import { useAgentSessions } from "@/hooks/useAgentSessions";

interface AgentSessionHistoryProps {
  agentId: string;
}

export function AgentSessionHistory({ agentId }: AgentSessionHistoryProps) {
  const { sessions, isLoading, error, hasMore, isLoadingMore, loadMore } =
    useAgentSessions(agentId, { pageSize: 5 });

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Recent Sessions
      </h3>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && sessions.length === 0 && !error && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[52px] animate-pulse rounded-xl bg-muted/50"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sessions.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <History className="mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">No sessions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run this agent to create your first session.
          </p>
        </div>
      )}

      {/* Session list */}
      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionCard key={session.metadata?.id} session={session} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore && (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            )}
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
