import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { OrgGate } from "../org/OrgGate";
import { ManagementSidebar } from "./ManagementSidebar";
import { Sidebar } from "./Sidebar";
import { useAppShortcuts } from "../hooks/useAppShortcuts";
import { useSidebarOpen } from "./use-layout-state";

function isSessionZonePath(p: string): boolean {
  return p === "/" || p.startsWith("/sessions/");
}

export function AppShell() {
  useAppShortcuts();
  const sidebar = useSidebarOpen();
  const { pathname } = useLocation();

  const isManagementZone = pathname.startsWith("/settings");

  const lastSessionZonePathRef = useRef<string | null>(null);
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (isSessionZonePath(prev) && !isSessionZonePath(pathname)) {
      lastSessionZonePathRef.current = prev;
    }
  }, [pathname]);

  return (
    <OrgGate>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {/* Reopen button — visible when sidebar is collapsed */}
        <button
          onClick={sidebar.open}
          aria-label="Open sidebar"
          className={cn(
            "fixed left-2 top-2 z-30 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            sidebar.isOpen && "hidden",
          )}
        >
          <PanelLeft className="size-4" />
        </button>

        {/* Sidebar — collapsible */}
        <div
          className={cn(
            "shrink-0 overflow-hidden",
            "border-r border-sidebar-border",
            "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
            sidebar.isOpen ? "w-[280px]" : "w-0",
          )}
        >
          <div className="h-full w-[280px]">
            <div
              key={isManagementZone ? "management" : "session"}
              className="h-full animate-in fade-in duration-150"
            >
              {isManagementZone ? (
                <ManagementSidebar lastSessionZonePath={lastSessionZonePathRef.current} />
              ) : (
                <Sidebar />
              )}
            </div>
          </div>
        </div>

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </OrgGate>
  );
}

