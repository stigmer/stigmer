"use client";

import { AppHeader, HEADER_HEIGHT } from "./AppHeader";
import { Sidebar, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./Sidebar";
import { useSidebarCollapse } from "./useSidebarCollapse";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggle } = useSidebarCollapse();
  const sidebarWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <AppHeader />
      <Sidebar isCollapsed={isCollapsed} onToggle={toggle} />
      <main
        style={{ marginLeft: sidebarWidth, marginTop: HEADER_HEIGHT }}
        className="overflow-auto px-8 py-6 transition-[margin-left] duration-200 ease-in-out"
      >
        {children}
      </main>
    </div>
  );
}
