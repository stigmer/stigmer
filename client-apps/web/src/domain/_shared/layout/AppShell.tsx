"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { Button } from "@/domain/_shared/ui/button";
import { useSessionNavigation } from "@/domain/session/session-navigation";
import { SessionLauncher } from "@/domain/session/SessionLauncher";
import { SessionPageInner } from "@/domain/session/SessionPage";
import { DesktopAppBanner, useDesktopBannerState } from "./DesktopAppBanner";
import { ManagementSidebar } from "./ManagementSidebar";
import { Sidebar } from "./Sidebar";
import { LG_BREAKPOINT, useSidebarOpen } from "./use-layout-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebar = useSidebarOpen();
  const pathname = usePathname();
  const { activeSessionId, isSessionZone } = useSessionNavigation();
  const desktopBanner = useDesktopBannerState();

  const isManagementZone = pathname.startsWith("/settings");
  const isPublicZone =
    pathname.startsWith("/invite/") || pathname.startsWith("/login");

  // Close the sidebar overlay when the route changes on mobile viewports.
  // Desktop keeps the sidebar open across navigations.
  useEffect(() => {
    if (sidebar.isOpen && window.innerWidth < LG_BREAKPOINT) {
      sidebar.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on pathname only; including sidebar would re-fire on every open/close
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && sidebar.isOpen && window.innerWidth < LG_BREAKPOINT) {
        sidebar.close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebar]);

  if (isPublicZone) {
    return (
      // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- app shell wraps both sidebar and main content
      <div className="bg-background text-foreground min-h-screen">
        <main>{children}</main>
      </div>
    );
  }

  return (
    // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- app shell wraps both sidebar and main content
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
          ) : isSessionZone ? (
            <SessionZoneContent activeSessionId={activeSessionId} />
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
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
