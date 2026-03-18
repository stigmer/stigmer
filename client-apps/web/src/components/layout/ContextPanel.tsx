"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useContextPanelOpen,
  useContextPanelSlotContent,
} from "./use-layout-state";

export const CONTEXT_PANEL_WIDTH = 320;

export function ContextPanel() {
  const panel = useContextPanelOpen();
  const slotContent = useContextPanelSlotContent();

  if (!panel.isOpen) return null;

  return (
    <aside
      id="context-panel"
      role="complementary"
      aria-label="Execution details"
      className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-l"
    >
      <div className="border-sidebar-border flex flex-none items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Details</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={panel.close}
          aria-label="Close details panel"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">{slotContent}</div>
      </ScrollArea>
    </aside>
  );
}
