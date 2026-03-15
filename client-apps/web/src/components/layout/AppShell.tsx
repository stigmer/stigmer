"use client";

import { Sidebar, SIDEBAR_WIDTH } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-screen">
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
