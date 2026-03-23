"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Library, MessageSquare, PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { useSessionList, groupSessionsByTime } from "@stigmer/react";
import type { SessionGroup } from "@stigmer/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

export function Sidebar() {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const { sessions, isLoading, error, refetch } = useSessionList();

  const activeSessionId =
    pathname.match(/^\/sessions\/(.+)/)?.[1] ?? null;
  const isLibraryActive = pathname.startsWith("/library");

  useEffect(() => {
    refetch();

    // LLM subject generation runs async after session creation.
    // A single delayed refetch picks up the updated subject without polling.
    if (!activeSessionId) return;
    const timer = setTimeout(refetch, 5_000);
    return () => clearTimeout(timer);
  }, [pathname, activeSessionId, refetch]);

  const groups = useMemo(
    () => groupSessionsByTime(sessions),
    [sessions],
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
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors"
        >
          <Plus className="size-4 shrink-0" />
          New Session
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
            <RecentsError message={error} />
          ) : groups.length === 0 ? (
            <RecentsEmptyState />
          ) : (
            <SessionGroupList
              groups={groups}
              activeSessionId={activeSessionId}
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

function SessionGroupList({
  groups,
  activeSessionId,
}: {
  groups: readonly SessionGroup[];
  activeSessionId: string | null;
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
              {group.sessions.map((session) => {
                const id = session.metadata?.id;
                if (!id) return null;
                const subject =
                  session.spec?.subject || "Untitled session";
                const isActive = id === activeSessionId;
                return (
                  <li key={id}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <a
                            href={`/sessions/${id}`}
                            aria-current={
                              isActive ? "page" : undefined
                            }
                            className={cn(
                              "line-clamp-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            )}
                          />
                        }
                      >
                        {subject}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={12}>
                        {subject}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

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
      <p className="text-sidebar-muted-foreground text-xs">No recent sessions</p>
    </div>
  );
}
