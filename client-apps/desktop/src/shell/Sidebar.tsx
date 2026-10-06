import { useCallback, useEffect, useMemo } from "react";
import { NavLink, useNavigate, useParams, useLocation } from "react-router-dom";
import { cn } from "@stigmer/theme";
import {
  useConversationsWantsHumanCount,
  useRecentActivity,
  WorkspaceSidebar,
  useActiveOrgId,
} from "@stigmer/react";
import type {
  RecentActivityEntry,
  SidebarLinkRenderProps,
  WorkspaceNavId,
} from "@stigmer/react";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";
import { useRunner } from "../hooks/EmbeddedRunnerContext";

/**
 * Workspace-zone sidebar — a thin wrapper over the SDK's
 * {@link WorkspaceSidebar}: this file only bridges React Router
 * and the embedded runner's background-run indicator into the shared
 * chrome.
 */
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

  const recentActivity = useRecentActivity();
  const { refetch } = recentActivity;
  const org = useActiveOrgId();
  // The Conversations badge: conversations wanting a human right now. Data as
  // props — the SDK sidebar never fetches for itself. Mirrors web.
  const { count: wantsHumanCount } = useConversationsWantsHumanCount(org || null);

  // Sessions whose runner worker is still alive but which are NOT the one being
  // viewed: with the deferred-teardown invariant in the runner, a worker stays
  // up only while a run is in flight, so this set is "running in the
  // background". Drives the pulse indicator in the recents list.
  const { activeSessions } = useRunner();
  const backgroundSessionIds = useMemo(
    () => new Set(activeSessions.filter((id) => id !== activeSessionId)),
    [activeSessions, activeSessionId],
  );

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

  const isDashboardActive =
    !isSessionZone && location.pathname.startsWith("/dashboard");
  const isConversationsActive =
    !isSessionZone && location.pathname.startsWith("/conversations");
  const isLibraryActive =
    !isSessionZone && location.pathname.startsWith("/library");
  const isMarketplaceActive =
    !isSessionZone && location.pathname.startsWith("/marketplace");
  const activeNav: WorkspaceNavId | null =
    location.pathname === "/"
      ? "new-session"
      : isDashboardActive
        ? "dashboard"
        : isConversationsActive
          ? "conversations"
          : isLibraryActive
            ? "library"
            : isMarketplaceActive
              ? "marketplace"
              : null;

  const renderLink = useCallback(
    ({
      id,
      href,
      className,
      children,
      entry,
      "aria-current": ariaCurrent,
    }: SidebarLinkRenderProps) => {
      // Recents rows and New Session navigate imperatively (buttons):
      // the desktop shell has no meaning for "open in a new tab".
      if (entry || id === "new-session") {
        return (
          <button
            onClick={() => navigate(entry ? href : "/")}
            aria-current={ariaCurrent}
            className={cn("w-full text-left", className)}
          >
            {children}
          </button>
        );
      }

      return (
        <NavLink to={href} aria-current={ariaCurrent} className={className}>
          {children}
        </NavLink>
      );
    },
    [navigate],
  );

  // Stable callbacks so the sidebar's memoized recents rows only re-render
  // when the background set actually changes.
  const renderEntryAccessory = useCallback(
    (entry: RecentActivityEntry) =>
      backgroundSessionIds.has(entry.id) ? (
        <BackgroundRunDot />
      ) : null,
    [backgroundSessionIds],
  );
  // Org switch is a full context change: navigate to the org-neutral
  // Dashboard (matching web). The SDK's OrgProvider clears the fetch
  // cache. Landing on "/dashboard" (not "/") also overwrites the persisted
  // stigmer:lastRoute — the route persister skips "/" — so the previous
  // org's deep link can't be restored on next launch.
  const handleOrgChanged = useCallback(() => navigate("/dashboard"), [navigate]);

  return (
    <WorkspaceSidebar
      activeNav={activeNav}
      renderLink={renderLink}
      recentActivity={recentActivity}
      activeSessionId={activeSessionId}
      renderEntryAccessory={renderEntryAccessory}
      conversationsBadgeCount={wantsHumanCount}
      footer={<UserMenu />}
      isOpen={sidebar.isOpen}
      onCollapse={sidebar.close}
      onOrgChanged={handleOrgChanged}
    />
  );
}

/**
 * Pulsing dot shown on a recents row whose run is still running in the
 * background (its session worker is kept alive by an in-flight activity even
 * though the user navigated away).
 *
 * No `title` here: the accessory renders inside the SDK sidebar's recents
 * rows, whose row-level house tooltip already owns hover — a native title on
 * the dot would fight it with a second, OS-styled popup. The `aria-label`
 * carries the name for screen readers.
 */
function BackgroundRunDot() {
  return (
    <span
      role="status"
      aria-label="Running in background"
      className="relative mt-1 flex size-2 shrink-0"
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
}
