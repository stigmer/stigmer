"use client";

import Link from "next/link";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@stigmer/theme";
import { buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export const SIDEBAR_WIDTH = 280;

export function Sidebar() {
  return (
    <nav
      id="sidebar"
      aria-label="Sessions"
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      <div className="border-sidebar-border flex-none border-b p-3">
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "default", size: "default" }), "w-full")}
        >
          <Plus className="size-4" />
          New Session
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">
          <p className="text-sidebar-foreground/60 mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
            Recents
          </p>
          <RecentsEmptyState />
        </div>
      </ScrollArea>
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
