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
        "stg:relative stg:overflow-auto",
        "stg:[scrollbar-width:thin] stg:[scrollbar-color:var(--color-border)_transparent]",
        "stg:[&::-webkit-scrollbar]:w-2.5",
        "stg:[&::-webkit-scrollbar-track]:bg-transparent",
        "stg:[&::-webkit-scrollbar-thumb]:rounded-full",
        "stg:[&::-webkit-scrollbar-thumb]:bg-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { ScrollArea };
