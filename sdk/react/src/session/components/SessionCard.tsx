"use client";

import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { MessageSquare, ChevronRight } from "lucide-react";
import { cn } from "@stigmer/theme";

export interface SessionCardProps {
  session: Session;
  onNavigate?: (sessionId: string) => void;
  className?: string;
}

export function SessionCard({ session, onNavigate, className }: SessionCardProps) {
  const id = session.metadata?.id ?? "";
  const displayName =
    session.spec?.subject || session.metadata?.name || "Untitled session";

  const createdAt = session.status?.audit?.specAudit?.createdAt;
  const updatedAt = session.status?.audit?.specAudit?.updatedAt;

  const interactive = !!onNavigate;

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onNavigate(id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate(id);
              }
            }
          : undefined
      }
      className={cn(
        "stgm-session-card",
        "bg-card text-card-foreground ring-foreground/10 flex flex-col gap-3 overflow-hidden rounded-xl py-3 text-sm ring-1",
        interactive && "cursor-pointer hover:bg-accent/50 transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      <div className="grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1 px-3">
        <div className="flex items-center gap-2 text-sm font-medium leading-snug">
          <MessageSquare className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{displayName}</span>
        </div>

        {interactive && (
          <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <ChevronRight className="text-muted-foreground size-4" />
          </div>
        )}

        <div className="text-muted-foreground col-start-1 text-sm">
          <span className="flex items-center gap-3">
            {createdAt && (
              <time dateTime={toISOString(createdAt)}>
                {formatRelativeTime(createdAt)}
              </time>
            )}
            {updatedAt && createdAt && (
              <span className="text-muted-foreground/60">
                updated {formatRelativeTime(updatedAt)}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function toDate(ts: Timestamp | undefined): Date | null {
  if (!ts) return null;
  const seconds = Number(ts.seconds);
  if (!seconds && seconds !== 0) return null;
  return new Date(seconds * 1000 + Math.floor(ts.nanos / 1_000_000));
}

function toISOString(ts: Timestamp | undefined): string {
  return toDate(ts)?.toISOString() ?? "";
}

function formatRelativeTime(ts: Timestamp | undefined): string {
  const date = toDate(ts);
  if (!date) return "";

  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
