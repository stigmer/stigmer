"use client";

import Link from "next/link";
import { Plus, MessageSquare, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserMenu } from "./UserMenu";
import { useSidebarOpen } from "./use-layout-state";

export function Sidebar() {
  const sidebar = useSidebarOpen();

  return (
    <nav
      id="sidebar"
      aria-label="Sessions"
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={sidebar.close}
          aria-expanded={sidebar.isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher />
        </div>
      </div>

      {/* New Session */}
      <div className="flex-none px-3 py-1">
        <Link
          href="/"
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors"
        >
          <Plus className="size-4 shrink-0" />
          New Session
        </Link>
      </div>

      <div className="px-3 py-1">
        <Separator className="bg-foreground/10" />
      </div>

      {/* Scrollable recents */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <p className="text-sidebar-foreground/60 mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
            Recents
          </p>
          <RecentsEmptyState />
        </div>
      </ScrollArea>

      {/* Bottom: user menu */}
      <div className="border-foreground/10 flex-none border-t px-3 py-2">
        <UserMenu />
      </div>
    </nav>
  );
}

function RecentsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MessageSquare className="text-sidebar-foreground/30 size-8" />
      <p className="text-sidebar-foreground/50 text-xs">No recent sessions</p>
    </div>
  );
}
