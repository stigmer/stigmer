"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard, Library, Settings } from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type NavId = (typeof NAV_ITEMS)[number]["id"];

interface DemoAppShellProps {
  /** Which nav item is currently selected. */
  activeNav?: NavId;
  /** Which nav item should pulse to draw attention. */
  highlightNav?: NavId;
  /**
   * Stable key for the content area — changing this key triggers
   * a fade transition between views.
   */
  contentKey: string;
  children: ReactNode;
}

/**
 * Schematic web app layout for the guided-tour demo.
 *
 * Renders a compact sidebar with nav items and a content area.
 * This is a docs illustration, not a replica of the real console —
 * it communicates the navigation flow without depending on any
 * internal Console components.
 */
export function DemoAppShell({
  activeNav,
  highlightNav,
  contentKey,
  children,
}: DemoAppShellProps) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border bg-card">
      {/* Sidebar */}
      <nav
        className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border bg-muted p-2"
        aria-label="Demo app navigation"
      >
        <div className="mb-3 px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Stigmer
        </div>

        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeNav === id;
          const isHighlighted = highlightNav === id;

          return (
            <div
              key={id}
              className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>

              {isHighlighted && (
                <motion.span
                  className="absolute inset-0 rounded-md border border-foreground"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.5, 0] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* Content area */}
      <motion.div
        key={contentKey}
        className="min-h-[280px] flex-1 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
