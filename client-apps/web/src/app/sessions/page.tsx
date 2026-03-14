"use client";

import { History, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { SessionCard } from "@/components/session/SessionCard";
import { useSessions } from "@/hooks/useSessions";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const { sessions, isLoading, error, hasMore, isLoadingMore, loadMore } =
    useSessions();

  return (
    <>
      <TopBar
        title="Sessions"
        description="Recent conversations — continue where you left off"
      />

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-muted/50"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-16">
          <History className="size-10 text-muted-foreground/40" />
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              No sessions yet
            </p>
            <p className="text-sm text-muted-foreground/60">
              Run an agent to start your first conversation
            </p>
          </div>
          <Link
            href="/run"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        </div>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionCard key={session.metadata?.id} session={session} />
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading…
                </>
              ) : (
                "Load more"
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}
