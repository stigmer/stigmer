"use client";

import { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, LayoutDashboard, Library, MessageSquare, Workflow, PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { useRecentActivity, groupRecentActivityByTime } from "@stigmer/react";
import type { RecentActivityGroup, RecentActivityEntry } from "@stigmer/react";
import { Button } from "@/domain/_shared/ui/button";
import { ScrollArea } from "@/domain/_shared/ui/scroll-area";
import { Separator } from "@/domain/_shared/ui/separator";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/domain/_shared/ui/tooltip";
import { OrgSwitcher } from "@stigmer/react";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

/** Allow modifier-clicks (Cmd/Ctrl, middle-click) to open in a new tab. */
function isPlainClick(e: MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

export function Sidebar() {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const { entries, isLoading, error, refetch, prependOptimistic } = useRecentActivity();
  const { activeSessionId, isSessionZone, navigateToSession, navigateToHome } =
    useSessionNavigation();

  const activeExecutionId = pathname.startsWith("/executions/")
    ? pathname.split("/")[2] ?? null
    : null;

  const isDashboardActive = !isSessionZone && pathname.startsWith("/dashboard");
  const isLibraryActive = !isSessionZone && pathname.startsWith("/library");

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  useEffect(() => {
    if (activeExecutionId && !entriesRef.current.some((e) => e.id === activeExecutionId)) {
      prependOptimistic({
        id: activeExecutionId,
        type: "workflow_execution",
        subject: "Loading\u2026",
      });
    }

    refetch();

    const activeId = activeSessionId ?? activeExecutionId;
    if (!activeId) return;

    // LLM subject generation runs async after session creation and
    // typically completes within 5-15 seconds. Two staggered refetches
    // cover the common case and the slow-LLM tail without polling.
    const t1 = setTimeout(refetch, 8_000);
    const t2 = setTimeout(refetch, 18_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeSessionId, activeExecutionId, refetch, prependOptimistic]);

  const groups = useMemo(
    () => groupRecentActivityByTime(entries),
    [entries],
  );

  const handleNewSession = useCallback(
    (e: MouseEvent) => {
      if (isPlainClick(e)) {
        e.preventDefault();
        navigateToHome();
      }
    },
    [navigateToHome],
  );

  return (
    <nav
      id="sidebar"
      aria-label="Main navigation"
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={sidebar.close}
          aria-expanded={sidebar.isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
        >
          <PanelLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher />
        </div>
      </div>

      {/* New Session */}
      <div className="flex-none px-3 py-1">
        <Link
          href="/"
          onClick={handleNewSession}
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors"
        >
          <Plus className="size-4 shrink-0" />
          New Session
        </Link>
      </div>

      {/* Dashboard */}
      <div className="flex-none px-3 py-1">
        <Link
          href="/dashboard"
          aria-current={isDashboardActive ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isDashboardActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <LayoutDashboard className="size-4 shrink-0" />
          Dashboard
        </Link>
      </div>

      {/* Library */}
      <div className="flex-none px-3 py-1">
        <Link
          href="/library"
          aria-current={isLibraryActive ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isLibraryActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Library className="size-4 shrink-0" />
          Library
        </Link>
      </div>

      <div className="px-3 py-1">
        <Separator className="bg-sidebar-border" />
      </div>

      {/* Scrollable recents */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <p className="text-sidebar-muted-foreground mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
            Recents
          </p>
          {isLoading ? (
            <RecentsSkeletons />
          ) : error ? (
            <RecentsError message={error.message} />
          ) : groups.length === 0 ? (
            <RecentsEmptyState />
          ) : (
            <ActivityGroupList
              groups={groups}
              activeSessionId={activeSessionId}
              activePath={pathname}
              onNavigateSession={navigateToSession}
            />
          )}
        </div>
      </ScrollArea>

      {/* Bottom: user menu */}
      <div className="border-sidebar-border flex-none border-t px-3 py-2">
        <UserMenu />
      </div>
    </nav>
  );
}

function ActivityGroupList({
  groups,
  activeSessionId,
  activePath,
  onNavigateSession,
}: {
  groups: readonly RecentActivityGroup[];
  activeSessionId: string | null;
  activePath: string;
  onNavigateSession: (id: string) => void;
}) {
  return (
    <TooltipProvider>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-sidebar-muted-foreground mb-1 px-2 text-[10px] font-medium tracking-wider uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5" role="list">
              {group.entries.map((entry) => (
                <ActivityEntry
                  key={entry.id}
                  entry={entry}
                  activeSessionId={activeSessionId}
                  activePath={activePath}
                  onNavigateSession={onNavigateSession}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

const ActivityEntry = memo(function ActivityEntry({
  entry,
  activeSessionId,
  activePath,
  onNavigateSession,
}: {
  entry: RecentActivityEntry;
  activeSessionId: string | null;
  activePath: string;
  onNavigateSession: (id: string) => void;
}) {
  const isSession = entry.type === "session";
  const isActive = isSession
    ? entry.id === activeSessionId
    : activePath === `/executions/${entry.id}`;
  const href = isSession ? `/sessions/${entry.id}` : `/executions/${entry.id}`;
  const TypeIcon = isSession ? MessageSquare : Workflow;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={href}
              onClick={(e: MouseEvent) => {
                if (isPlainClick(e)) {
                  e.preventDefault();
                  if (isSession) {
                    onNavigateSession(entry.id);
                  } else {
                    window.location.href = href;
                  }
                }
              }}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            />
          }
        >
          <TypeIcon className="mt-0.5 size-3 shrink-0 opacity-50" aria-hidden="true" />
          <span className="line-clamp-2">{entry.subject}</span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          {entry.subject}
        </TooltipContent>
      </Tooltip>
    </li>
  );
});

function RecentsSkeletons() {
  return (
    <div className="space-y-2 px-2" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="bg-sidebar-muted h-5 animate-pulse rounded"
          style={{ width: `${70 + Math.sin(i * 1.5) * 20}%` }}
        />
      ))}
    </div>
  );
}

function RecentsError({ message }: { message: string }) {
  return (
    <>
      <p className="text-destructive mb-4 px-2 text-xs" role="alert">
        {message}
      </p>
      <RecentsEmptyState />
    </>
  );
}

function RecentsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MessageSquare className="text-sidebar-muted-foreground size-8" />
      <p className="text-sidebar-muted-foreground text-xs">No recent activity</p>
    </div>
  );
}
