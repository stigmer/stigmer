"use client";

import { Sidebar, SIDEBAR_WIDTH } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main
        style={{ marginLeft: SIDEBAR_WIDTH }}
        className="flex-1 overflow-auto px-8 py-6"
      >
        {children}
      </main>
    </div>
  );
}
