"use client";

import { type MouseEvent, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useActiveOrgId,
  useConversationsWantsHumanCount,
  useRecentActivity,
  WorkspaceSidebar,
} from "@stigmer/react";
import type { SidebarLinkRenderProps, WorkspaceNavId } from "@stigmer/react";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { useRunNavigation } from "@/domain/workflow/run-navigation";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

/** Allow modifier-clicks (Cmd/Ctrl, middle-click) to open in a new tab. */
function isPlainClick(e: MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

/**
 * Workspace-zone sidebar — a thin wrapper over the SDK's
 * {@link WorkspaceSidebar}: this file only bridges Next.js
 * routing and the app's navigation providers into the shared chrome.
 *
 * Rows keep real hrefs so modifier-clicks open new tabs, while plain
 * clicks route through the session/execution navigation providers
 * (static export cannot soft-navigate to un-prerendered dynamic routes).
 */
export function Sidebar() {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const router = useRouter();
  const recentActivity = useRecentActivity();
  const { refetch, prependOptimistic } = recentActivity;
  const org = useActiveOrgId();
  // The Conversations badge: conversations wanting a human right now.
  // Data as props — the SDK sidebar never fetches for itself.
  const { count: wantsHumanCount } = useConversationsWantsHumanCount(org || null);
  const { activeSessionId, isSessionZone, navigateToSession, navigateToHome } =
    useSessionNavigation();
  const { activeRunId, isExecutionZone, navigateToRun } =
    useRunNavigation();

  const isDashboardActive =
    !isSessionZone && !isExecutionZone && pathname.startsWith("/dashboard");
  const isConversationsActive =
    !isSessionZone && !isExecutionZone && pathname.startsWith("/conversations");
  const isLibraryActive =
    !isSessionZone && !isExecutionZone && pathname.startsWith("/library");
  const isMarketplaceActive =
    !isSessionZone && !isExecutionZone && pathname.startsWith("/marketplace");
  const activeNav: WorkspaceNavId | null = isDashboardActive
    ? "dashboard"
    : isConversationsActive
      ? "conversations"
      : isLibraryActive
        ? "library"
        : isMarketplaceActive
          ? "marketplace"
          : null;

  // Org switch is a full context change: whatever page is open belongs to
  // the previous org's view (detail pages are keyed on the URL org, not the
  // active org, so they would otherwise keep rendering stale content).
  // Dashboard is the org-neutral landing; the SDK's OrgProvider clears the
  // fetch cache. Mirrors desktop's handler.
  const handleOrgChanged = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  const entriesRef = useRef(recentActivity.entries);
  useEffect(() => {
    entriesRef.current = recentActivity.entries;
  });

  useEffect(() => {
    if (activeRunId && !entriesRef.current.some((e) => e.id === activeRunId)) {
      prependOptimistic({
        id: activeRunId,
        type: "workflow_run",
        subject: "Loading\u2026",
      });
    }

    refetch();

    const activeId = activeSessionId ?? activeRunId;
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
  }, [activeSessionId, activeRunId, refetch, prependOptimistic]);

  const renderLink = useCallback(
    ({
      id,
      href,
      className,
      children,
      entry,
      "aria-current": ariaCurrent,
    }: SidebarLinkRenderProps) => {
      // Recents rows: plain anchors whose plain clicks route through the
      // navigation providers (viewer swap without a page load).
      if (entry) {
        return (
          <a
            href={href}
            onClick={(e: MouseEvent) => {
              if (isPlainClick(e)) {
                e.preventDefault();
                if (entry.type === "session") {
                  navigateToSession(entry.id);
                } else {
                  navigateToRun(entry.id);
                }
              }
            }}
            aria-current={ariaCurrent}
            className={className}
          >
            {children}
          </a>
        );
      }

      if (id === "new-session") {
        return (
          <Link
            href="/"
            onClick={(e: MouseEvent) => {
              if (isPlainClick(e)) {
                e.preventDefault();
                navigateToHome();
              }
            }}
            className={className}
          >
            {children}
          </Link>
        );
      }

      return (
        <Link href={href} aria-current={ariaCurrent} className={className}>
          {children}
        </Link>
      );
    },
    [navigateToSession, navigateToRun, navigateToHome],
  );

  return (
    <WorkspaceSidebar
      activeNav={activeNav}
      renderLink={renderLink}
      recentActivity={recentActivity}
      activeSessionId={activeSessionId}
      activeRunId={activeRunId}
      conversationsBadgeCount={wantsHumanCount}
      footer={<UserMenu />}
      isOpen={sidebar.isOpen}
      onCollapse={sidebar.close}
      onOrgChanged={handleOrgChanged}
    />
  );
}
