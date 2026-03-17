"use client";

import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

export const HEADER_HEIGHT = 48;

export function AppHeader() {
  const sidebar = useSidebarOpen();

  return (
    <header
      style={{ height: HEADER_HEIGHT }}
      className="border-border bg-background z-40 flex items-center border-b px-3"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={sidebar.toggle}
        aria-expanded={sidebar.isOpen}
        aria-controls="sidebar"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-4" />
      </Button>

      <div className="ml-2 flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md text-[10px] font-bold">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">Stigmer</span>
      </div>

      <Separator orientation="vertical" className="mx-3 !h-5" />

      <OrgSwitcher />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
