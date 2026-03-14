"use client";

import Link from "next/link";
import { History, Play, ArrowRight } from "lucide-react";
import { SessionCard } from "@/components/session/SessionCard";
import { useSessions } from "@/hooks/useSessions";

const DASHBOARD_SESSION_LIMIT = 5;

export function RecentSessions() {
  const { sessions, isLoading, error, hasMore } = useSessions({
    pageSize: DASHBOARD_SESSION_LIMIT,
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent Sessions</h2>
        {sessions.length > 0 && (
          <Link
            href="/sessions"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight className="size-3" />
          </Link>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl bg-muted/50"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10">
          <History className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No sessions yet</p>
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
            <Link
              href="/sessions"
              className="block py-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all sessions
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
