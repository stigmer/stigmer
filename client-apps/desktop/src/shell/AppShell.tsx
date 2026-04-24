import { Outlet } from "react-router-dom";
import { OrgGate } from "../org/OrgGate";
import { Sidebar } from "./Sidebar";
import { useAppShortcuts } from "../hooks/useAppShortcuts";

/**
 * Root layout for the desktop app.
 *
 * OrgGate blocks rendering until the user has at least one organization
 * (handles loading, provisioning, error, and onboarding states).
 * Once an org is available, renders the sidebar + main content.
 */
export function AppShell() {
  useAppShortcuts();

  return (
    <OrgGate>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </OrgGate>
  );
}
