"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container.js";

// ---------------------------------------------------------------------------
// SDK-internal styled Tooltip primitives over @base-ui/react.
//
// Like ./menu.tsx, these are NOT exported from @stigmer/react. They give SDK
// styled components (WorkspaceSidebar recents rows, and any future hover
// hints) one source of truth for tooltip styling, portaled into the Stigmer
// theme scope so tokens resolve in embeds.
//
// Portaled content uses popover-* / main-area tokens per DD-005; the ring
// follows the menu popup's established `ring-foreground/10` hairline.
// ---------------------------------------------------------------------------

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger {...props} />;
}

function TooltipContent({
  side = "right",
  sideOffset = 8,
  className,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset">) {
  const portalContainer = useStigmerPortalContainer();

  return (
    // Raw pass-through, no coalescing: the hook's three-state return
    // (undefined / null / element) maps exactly onto Base UI's
    // `container` semantics — see `useStigmerPortalContainer`.
    <TooltipPrimitive.Portal container={portalContainer}>
      <TooltipPrimitive.Positioner
        className="isolate z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 z-50 max-w-64 rounded-lg px-2.5 py-1.5 text-sm shadow-md ring-1",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "duration-100",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent };
