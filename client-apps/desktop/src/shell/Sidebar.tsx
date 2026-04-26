import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  Plus,
  Library,
  Settings,
  MessageSquare,
  ArrowUpCircle,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { cn } from "@stigmer/theme";
import {
  useSessionList,
  groupSessionsByTime,
  resolvedSubject,
} from "@stigmer/react";
import type { SessionGroup } from "@stigmer/react";
import { useAppUpdaterContext } from "../hooks/AppUpdaterContext";

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { status: updateStatus, availableVersion, checkForUpdate } =
    useAppUpdaterContext();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const activeSessionId = location.pathname.startsWith("/sessions/")
    ? params.id ?? null
    : null;

  const isSessionZone =
    location.pathname === "/" || location.pathname.startsWith("/sessions/");

  const { sessions, isLoading, error, refetch } = useSessionList();

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
    () => groupSessionsByTime(sessions),
    [sessions],
  );

  const isLibraryActive = !isSessionZone && location.pathname.startsWith("/library");
  const isSettingsActive = location.pathname.startsWith("/settings");

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center px-3">
        <span className="text-sm font-semibold tracking-tight">Stigmer</span>
      </div>

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

      <div className="px-3 py-1">
        <div className="h-px bg-sidebar-border" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-1">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground">
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
            onNavigate={(id) => navigate(`/sessions/${id}`)}
          />
        )}
      </div>

      <div className="flex-none border-t border-sidebar-border px-3 py-2">
        <NavLink
          to="/settings/runners"
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            isSettingsActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Settings className="size-4 shrink-0" />
          Settings
        </NavLink>

        <SidebarVersionFooter
          appVersion={appVersion}
          updateStatus={updateStatus}
          availableVersion={availableVersion}
          onCheckForUpdate={checkForUpdate}
        />
      </div>
    </aside>
  );
}

function SessionGroupList({
  groups,
  activeSessionId,
  onNavigate,
}: {
  groups: readonly SessionGroup[];
  activeSessionId: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted-foreground">
            {group.label}
          </p>
          <ul className="space-y-0.5" role="list">
            {group.sessions.map((session) => {
              const id = session.metadata?.id;
              if (!id) return null;
              const subject =
                resolvedSubject(session.spec?.subject) ?? "Untitled session";
              const isActive = id === activeSessionId;
              return (
                <li key={id}>
                  <button
                    onClick={() => onNavigate(id)}
                    aria-current={isActive ? "page" : undefined}
                    title={subject}
                    className={cn(
                      "w-full truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {subject}
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
      <p className="text-xs text-sidebar-muted-foreground">No recent sessions</p>
    </div>
  );
}

function SidebarVersionFooter({
  appVersion,
  updateStatus,
  availableVersion,
  onCheckForUpdate,
}: {
  appVersion: string | null;
  updateStatus: string;
  availableVersion: string | null;
  onCheckForUpdate: () => void;
}) {
  if (!appVersion) return null;

  const hasUpdate = updateStatus === "available" && availableVersion;

  return (
    <div className="mt-1 px-2">
      {hasUpdate ? (
        <button
          onClick={onCheckForUpdate}
          className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-1 text-[0.65rem] text-sidebar-primary transition-colors hover:text-sidebar-accent-foreground"
        >
          <ArrowUpCircle className="size-3 shrink-0" />
          <span>
            Update available: v{availableVersion}
          </span>
        </button>
      ) : (
        <span className="block py-1 text-[0.65rem] text-sidebar-muted-foreground">
          v{appVersion}
        </span>
      )}
    </div>
  );
}
