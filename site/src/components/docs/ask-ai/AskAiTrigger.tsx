"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAskAi } from "./AskAiProvider";

interface AskAiTriggerProps {
  /**
   * Which chrome slot this instance sits in:
   * - `sidebar` — full-width row under the search box (desktop sidebar
   *   header), styled to read as search's sibling.
   * - `nav` — compact button for the mobile navbar cluster.
   */
  variant: "sidebar" | "nav";
  /**
   * Breakpoint gate (`max-md:hidden` / `md:hidden`). Both instances stay
   * mounted; CSS decides which one is visible — the same pattern Fumadocs
   * uses for its own search toggles.
   */
  className?: string;
}

/** Opens the shared Ask AI panel (see `AskAiProvider`). */
export function AskAiTrigger({ variant, className }: AskAiTriggerProps) {
  const { open, setOpen } = useAskAi();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(
        "inline-flex items-center text-sm text-fd-muted-foreground transition-colors",
        "hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
        variant === "sidebar" &&
          "w-full gap-2 rounded-lg border bg-fd-secondary/50 px-2.5 py-1.5 hover:bg-fd-accent",
        variant === "nav" && "gap-1.5 rounded-md p-2",
        className,
      )}
    >
      <Sparkles className="size-4 shrink-0" aria-hidden />
      Ask AI
    </button>
  );
}
