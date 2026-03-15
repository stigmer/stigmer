"use client";

import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

export const HEADER_HEIGHT = 56;

export function AppHeader() {
  return (
    <header
      style={{ height: HEADER_HEIGHT }}
      className="border-border bg-background fixed inset-x-0 top-0 z-40 flex items-center border-b px-4"
    >
      <div className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">Stigmer</span>
      </div>

      <div className="border-border mx-4 h-6 border-l" />

      <OrgSwitcher />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
