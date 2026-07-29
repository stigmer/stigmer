"use client";

import * as React from "react";
import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// SDK-internal thin-scrollbar scroll container.
//
// NOT exported from @stigmer/react. Plain CSS (no primitive library): a thin
// token-colored scrollbar over native overflow, so long lists (sidebar
// recents) scroll like the console everywhere the SDK renders.
// ---------------------------------------------------------------------------

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "relative overflow-auto",
        "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
        "[&::-webkit-scrollbar]:w-2.5",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:rounded-full",
        "[&::-webkit-scrollbar-thumb]:bg-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { ScrollArea };
