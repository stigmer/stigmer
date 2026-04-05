"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Box, Building2, KeyRound, User, Users } from "lucide-react";
import { DEMO_SHELL_HEIGHT } from "../shared/tokens";

export type ManagementNavId = "members" | "api-keys" | "environments";

interface NavItem {
  readonly id: ManagementNavId;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "members", label: "Members", icon: Users },
  { id: "api-keys", label: "API Keys", icon: KeyRound },
  { id: "environments", label: "Environments", icon: Box },
];

interface ManagementShellProps {
  /** Which management nav item is currently selected. */
  activeNav?: ManagementNavId;
  /**
   * Stable key for the content area — changing this key triggers
   * a fade transition between views.
   */
  contentKey: string;
  /**
   * Direction of the slide transition when `contentKey` changes.
   *
   * - `"forward"` — slides in from the right (navigating deeper)
   * - `"backward"` — slides in from the left (going back)
   * - `undefined` — fades in without sliding
   */
  slideDirection?: "forward" | "backward";
  children: ReactNode;
}

/**
 * Schematic management zone layout for demo scenarios.
 *
 * Mirrors the Console's management sidebar: org indicator,
 * "Back to Sessions", Members / API Keys / Environments nav,
 * and user profile. This is a docs illustration — it
 * communicates the management zone navigation without
 * depending on any internal Console components.
 */
export function ManagementShell({
  activeNav,
  contentKey,
  slideDirection,
  children,
}: ManagementShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div
      className="flex overflow-hidden rounded-lg border border-border bg-card"
      style={{ height: `var(--demo-shell-height, ${DEMO_SHELL_HEIGHT}px)` }}
    >
      {/* Management sidebar */}
      <nav
        className="flex w-28 shrink-0 flex-col border-r border-border bg-muted"
        aria-label="Demo management navigation"
      >
        {/* Org indicator */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-[10px] font-semibold text-foreground">
            Acme Corp
          </span>
        </div>

        {/* Back to Sessions */}
        <div className="px-2">
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-muted-foreground">
            <ArrowLeft className="h-3 w-3 shrink-0" />
            <span>Back to Sessions</span>
          </div>
        </div>

        {/* Separator */}
        <div className="mx-3 my-1.5 border-t border-border" />

        {/* Management nav */}
        <div className="flex flex-col gap-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] transition-colors ${
                activeNav === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-3 w-3 shrink-0" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User profile */}
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
          <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20">
            <User className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
          <span className="truncate text-[9px] text-muted-foreground">You</span>
        </div>
      </nav>

      {/* Content area */}
      <motion.div
        key={contentKey}
        className="min-w-0 flex-1 overflow-hidden bg-background"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
