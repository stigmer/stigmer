"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { useResolveAgentExecutionSession } from "@stigmer/react";
import { Button } from "@/domain/_shared/ui/button";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { useExecutionNavigation } from "@/domain/workflow/execution-navigation";
import { SessionLauncher } from "@/domain/session/SessionLauncher";
import { SessionPageInner } from "@/domain/session/SessionPage";
import { WorkflowExecutionDetailPage } from "@/domain/workflow/WorkflowExecutionDetailPage";
import { DesktopAppBanner, useDesktopBannerState } from "./DesktopAppBanner";
import { ManagementSidebar } from "./ManagementSidebar";
import { Sidebar } from "./Sidebar";
import { LG_BREAKPOINT, useSidebarOpen } from "./use-layout-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const { activeSessionId, isSessionZone } = useSessionNavigation();
  const { activeExecutionId, isExecutionZone } = useExecutionNavigation();
  const desktopBanner = useDesktopBannerState();

  const isManagementZone = pathname.startsWith("/settings");
  const isPublicZone =
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/chat/");

  // Close the sidebar overlay when the route changes on mobile viewports.
  // Desktop keeps the sidebar open across navigations.
  useEffect(() => {
    if (sidebar.isOpen && window.innerWidth < LG_BREAKPOINT) {
      sidebar.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on pathname only; including sidebar would re-fire on every open/close
  }, [pathname]);

  const sidebarOpen = sidebar.isOpen;
  const closeSidebar = sidebar.close;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && sidebarOpen && window.innerWidth < LG_BREAKPOINT) {
        closeSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen, closeSidebar]);

  if (isPublicZone) {
    return (
      // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- app shell wraps both sidebar and main content
      <div className="bg-background text-foreground min-h-screen">
        <main>{children}</main>
      </div>
    );
  }

  // The fetch cache lives in Providers.tsx (above OrgProvider) so an org
  // switch clears it — see the provider composition doc there.
  return (
    <>
      {/* eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- app shell wraps both sidebar and main content */}
      <div className="bg-background text-foreground flex h-screen">
        {/* Mobile backdrop */}
        {sidebar.isOpen && (
          <div
            className="bg-backdrop fixed inset-0 z-40 backdrop-blur-sm lg:hidden"
            onClick={sidebar.close}
            aria-hidden="true"
          />
        )}

        {/* Reopen button — visible on all screen sizes when sidebar is collapsed */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={sidebar.open}
          aria-label="Open sidebar"
          className={cn(
            "fixed top-2 left-2 z-30",
            sidebar.isOpen && "hidden",
          )}
        >
          <PanelLeft className="size-4" />
        </Button>

        {/* Sidebar — collapsible on all screen sizes */}
        <div
          className={cn(
            "shrink-0 overflow-hidden",
            "border-sidebar-border border-r",
            "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
            sidebar.isOpen ? "w-70" : "w-0",
            "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-lg",
          )}
        >
          <div className="h-full w-70">
            <div
              key={isManagementZone ? "management" : "session"}
              className="h-full animate-in fade-in duration-150"
            >
              {isManagementZone ? <ManagementSidebar /> : <Sidebar />}
            </div>
          </div>
        </div>

        {/* Main content */}
        <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
          {desktopBanner.visible && (
            <DesktopAppBanner onDismiss={desktopBanner.dismiss} />
          )}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {isManagementZone ? (
              children
            ) : isExecutionZone && activeExecutionId ? (
              <ExecutionZoneContent
                executionId={activeExecutionId}
                key={activeExecutionId}
              />
            ) : isSessionZone ? (
              <SessionZoneContent activeSessionId={activeSessionId} />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </>
  );
}

/**
 * Renders the execution zone for a `/executions/<id>` path.
 *
 * Auto-detects the execution type from the id prefix:
 * - `wex_*` (workflow execution) → renders the workflow execution viewer.
 * - `aex_*` (agent execution) → resolves the parent session and hands off to
 *   the session zone via `navigateToSession`, rendering nothing meanwhile.
 *
 * The `/executions/[id]` route is a no-op placeholder (like `/sessions/[id]`)
 * that only exists so static export emits an nginx fallback for deep links and
 * hard reloads; this zone owns all execution rendering, so switching
 * executions via in-app navigation never reloads the page.
 */
function ExecutionZoneContent({ executionId }: { executionId: string }) {
  const { navigateToSession } = useSessionNavigation();

  const isAgentExecution = executionId.startsWith("aex_");
  const { sessionId } = useResolveAgentExecutionSession(
    isAgentExecution ? executionId : null,
  );

  useEffect(() => {
    if (sessionId) {
      navigateToSession(sessionId);
    }
  }, [sessionId, navigateToSession]);

  if (isAgentExecution) return null;

  return <WorkflowExecutionDetailPage executionId={executionId} />;
}

/**
 * Renders the session zone: either the new-session launcher or an
 * existing session view.
 *
 * The `SessionLauncher` stays mounted (but hidden) while a session is
 * active so that draft text typed in the composer survives round-trip
 * navigation — matching the ChatGPT pattern.
 */
function SessionZoneContent({
  activeSessionId,
}: {
  activeSessionId: string | null;
}) {
  return (
    <>
      <div
        className={cn("h-full", activeSessionId != null && "hidden")}
        aria-hidden={activeSessionId != null}
      >
        <SessionLauncher />
      </div>
      {activeSessionId != null && (
        <SessionPageInner id={activeSessionId} key={activeSessionId} />
      )}
    </>
  );
}
