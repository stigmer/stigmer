import { useCallback, useEffect, useMemo } from "react";
import { NavLink, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  Plus,
  LayoutDashboard,
  Library,
  Server,
  MessageSquare,
  Workflow,
  PanelLeft,
} from "lucide-react";
import { cn } from "@stigmer/theme";
import {
  OrgSwitcher,
  useRecentActivity,
  groupRecentActivityByTime,
} from "@stigmer/react";
import type { RecentActivityGroup } from "@stigmer/react";
import { ScrollArea } from "../ui/scroll-area";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

export function Sidebar() {
  const sidebar = useSidebarOpen();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();

  const activeSessionId = location.pathname.startsWith("/sessions/")
    ? params.id ?? null
    : null;

  const isSessionZone =
    location.pathname === "/" || location.pathname.startsWith("/sessions/");

  const { entries, isLoading, error, refetch } = useRecentActivity();

  useEffect(() => {
    refetch();
    if (!activeSessionId) return;

    const t1 = setTimeout(refetch, 8_000);
    const t2 = setTimeout(refetch, 18_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeSessionId, refetch]);

  const groups = useMemo(
    () => groupRecentActivityByTime(entries),
    [entries],
  );

  const handleOrgChanged = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const isDashboardActive = !isSessionZone && location.pathname.startsWith("/dashboard");
  const isLibraryActive = !isSessionZone && location.pathname.startsWith("/library");
  const isRunnersActive = !isSessionZone && location.pathname.startsWith("/runners");

  return (
    <nav
      id="sidebar"
      aria-label="Main navigation"
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <button
          onClick={sidebar.close}
          aria-expanded={sidebar.isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher onOrgChanged={handleOrgChanged} />
        </div>
      </div>

      {/* New Session */}
      <div className="flex-none px-3 py-1">
        <button
          onClick={() => navigate("/")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            location.pathname === "/"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Plus className="size-4 shrink-0" />
          New Session
        </button>
      </div>

      {/* Dashboard */}
      <div className="flex-none px-3 py-1">
        <NavLink
          to="/dashboard"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isDashboardActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <LayoutDashboard className="size-4 shrink-0" />
          Dashboard
        </NavLink>
      </div>

      {/* Library */}
      <div className="flex-none px-3 py-1">
        <NavLink
          to="/library"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isLibraryActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Library className="size-4 shrink-0" />
          Library
        </NavLink>
      </div>

      {/* Runners */}
      <div className="flex-none px-3 py-1">
        <NavLink
          to="/runners"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isRunnersActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Server className="size-4 shrink-0" />
          Runners
        </NavLink>
      </div>

      <div className="px-3 py-1">
        <div className="h-px bg-sidebar-border" />
      </div>

      {/* Scrollable recents */}
      <ScrollArea className="flex-1 px-3 py-1">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground">
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
            activePath={location.pathname}
            onNavigate={navigate}
          />
        )}
      </ScrollArea>

      {/* Bottom: user menu */}
      <div className="flex-none border-t border-sidebar-border px-3 py-2">
        <UserMenu />
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Session recents
// ---------------------------------------------------------------------------

function ActivityGroupList({
  groups,
  activeSessionId,
  activePath,
  onNavigate,
}: {
  groups: readonly RecentActivityGroup[];
  activeSessionId: string | null;
  activePath: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted-foreground">
            {group.label}
          </p>
          <ul className="space-y-0.5" role="list">
            {group.entries.map((entry) => {
              const isSession = entry.type === "session";
              const isActive = isSession
                ? entry.id === activeSessionId
                : activePath === `/executions/${entry.id}`;
              const targetPath = isSession
                ? `/sessions/${entry.id}`
                : `/executions/${entry.id}`;
              const TypeIcon = isSession ? MessageSquare : Workflow;

              return (
                <li key={entry.id}>
                  <button
                    onClick={() => onNavigate(targetPath)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <TypeIcon className="mt-0.5 size-3 shrink-0 opacity-50" aria-hidden="true" />
                    <span className="line-clamp-2">{entry.subject}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RecentsSkeletons() {
  return (
    <div className="space-y-2 px-2" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="h-5 animate-pulse rounded bg-sidebar-muted"
          style={{ width: `${70 + Math.sin(i * 1.5) * 20}%` }}
        />
      ))}
    </div>
  );
}

function RecentsError({ message }: { message: string }) {
  return (
    <>
      <p className="mb-4 px-2 text-xs text-destructive" role="alert">
        {message}
      </p>
      <RecentsEmptyState />
    </>
  );
}

function RecentsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MessageSquare className="size-8 text-sidebar-muted-foreground" />
      <p className="text-xs text-sidebar-muted-foreground">No recent activity</p>
    </div>
  );
}

