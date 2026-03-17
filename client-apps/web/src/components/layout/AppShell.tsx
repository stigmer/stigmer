"use client";

import { useEffect } from "react";
import { cn } from "@stigmer/theme";
import { AppHeader, HEADER_HEIGHT } from "./AppHeader";
import { Sidebar, SIDEBAR_WIDTH } from "./Sidebar";
import { ContextPanel, CONTEXT_PANEL_WIDTH } from "./ContextPanel";
import { useSidebarOpen, useContextPanelOpen } from "./use-layout-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebar = useSidebarOpen();
  const contextPanel = useContextPanelOpen();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && sidebar.isOpen && window.innerWidth < 1024) {
        sidebar.close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebar]);

  return (
    <div
      className="bg-background text-foreground grid h-screen"
      style={{ gridTemplateRows: `${HEADER_HEIGHT}px 1fr` }}
    >
      <AppHeader />

      <div className="flex min-h-0 overflow-hidden">
        {/* Backdrop — only renders on mobile (< lg) when sidebar is open */}
        {sidebar.isOpen && (
          <div
            className="bg-background/80 fixed inset-0 z-40 backdrop-blur-sm lg:hidden"
            style={{ top: HEADER_HEIGHT }}
            onClick={sidebar.close}
            aria-hidden="true"
          />
        )}

        {/*
         * Sidebar wrapper: inline flex child on desktop, fixed overlay on mobile.
         * `top` in the style prop is inert when position is static (desktop)
         * and only takes effect when max-lg:fixed activates (mobile).
         */}
        <div
          className={cn(
            "shrink-0 overflow-hidden",
            "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
            "max-lg:fixed max-lg:bottom-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-lg",
          )}
          style={{ width: sidebar.isOpen ? SIDEBAR_WIDTH : 0, top: HEADER_HEIGHT }}
        >
          <div style={{ width: SIDEBAR_WIDTH }} className="h-full">
            <Sidebar />
          </div>
        </div>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Context panel — hidden below lg breakpoint */}
        <div
          className={cn(
            "shrink-0 overflow-hidden",
            "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
            "max-lg:hidden",
          )}
          style={{ width: contextPanel.isOpen ? CONTEXT_PANEL_WIDTH : 0 }}
        >
          <div style={{ width: CONTEXT_PANEL_WIDTH }} className="h-full">
            <ContextPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
