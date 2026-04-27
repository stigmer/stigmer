import * as React from "react";
import { cn } from "@stigmer/theme";

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="scroll-area"
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
