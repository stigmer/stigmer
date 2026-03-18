"use client";

import { useEffect } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./Sidebar";
import { ContextPanel, CONTEXT_PANEL_WIDTH } from "./ContextPanel";
import {
  useSidebarOpen,
  useContextPanelOpen,
  ContextPanelSlotProvider,
} from "./use-layout-state";

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
    <ContextPanelSlotProvider>
      <div className="bg-background text-foreground flex h-screen">
        {/* Mobile backdrop */}
        {sidebar.isOpen && (
          <div
            className="bg-background/80 fixed inset-0 z-40 backdrop-blur-sm lg:hidden"
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
    </ContextPanelSlotProvider>
  );
}
