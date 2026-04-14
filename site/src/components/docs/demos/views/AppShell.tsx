"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  Library,
  LogOut,
  Monitor,
  Plus,
  Settings,
  User,
} from "lucide-react";
import { PulseHighlight } from "../shared/PulseHighlight";
import {
  DEMO_SHELL_HEIGHT,
  DEMO_SHELL_HEIGHT_MIN,
} from "../shared/tokens";

export type NavId = "new-session" | "library";

const RECENT_SESSIONS = [
  "Draft email copy",
  "Q2 report analysis",
  "Summarize meeting notes",
];

interface AppShellProps {
  /** Which nav item is currently selected. */
  activeNav?: NavId;
  /** Which nav item should pulse to draw attention. */
  highlightNav?: NavId;
  /** When true, the user profile row pulses to draw attention. */
  highlightUserProfile?: boolean;
  /** When true, a popup menu appears above the user profile row. */
  showUserMenu?: boolean;
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
  /** Optional right sidebar (e.g. execution widgets). */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * Schematic web app layout for demo scenarios.
 *
 * Mirrors the Console's sidebar layout: org indicator, New Session,
 * Library, recent sessions, and user profile. This is a docs
 * illustration — it communicates the navigation flow without
 * depending on any internal Console components.
 */
export function AppShell({
  activeNav,
  highlightNav,
  highlightUserProfile,
  showUserMenu,
  contentKey,
  slideDirection,
  aside,
  children,
}: AppShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;
  return (
    <div
      className="stgm flex overflow-hidden rounded-lg border border-border bg-card"
      style={{
        height: `var(--demo-shell-height, clamp(${DEMO_SHELL_HEIGHT_MIN}px, 55vh, ${DEMO_SHELL_HEIGHT}px))`,
      }}
    >
      {/* Nav sidebar */}
      <nav
        className="flex w-28 shrink-0 flex-col border-r border-border bg-muted"
        aria-label="Demo app navigation"
      >
        {/* Org indicator */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-[10px] font-semibold text-foreground">
            Acme Corp
          </span>
        </div>

        {/* Primary nav */}
        <div className="flex flex-col gap-0.5 px-2">
          <NavRow
            id="new-session"
            label="New Session"
            icon={Plus}
            isActive={activeNav === "new-session"}
            isHighlighted={highlightNav === "new-session"}
          />
          <NavRow
            id="library"
            label="Library"
            icon={Library}
            isActive={activeNav === "library"}
            isHighlighted={highlightNav === "library"}
          />
        </div>

        {/* Separator */}
        <div className="mx-3 my-1.5 border-t border-border" />

        {/* Recents */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <p className="mb-1 text-[8px] font-semibold tracking-wider text-muted-foreground uppercase">
            Recents
          </p>
          <ul className="flex flex-col gap-0.5">
            {RECENT_SESSIONS.map((title) => (
              <li
                key={title}
                className="truncate rounded-sm px-1.5 py-0.5 text-[9px] text-muted-foreground"
              >
                {title}
              </li>
            ))}
          </ul>
        </div>

        {/* User profile */}
        <div className="relative">
          <AnimatePresence>
            {showUserMenu && <UserMenu />}
          </AnimatePresence>

          <div
            data-cursor-target="user-profile"
            className="relative flex items-center gap-1.5 border-t border-border px-3 py-2"
          >
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20">
              <User className="h-2.5 w-2.5 text-muted-foreground" />
            </div>
            <span className="truncate text-[9px] text-muted-foreground">You</span>

            {highlightUserProfile && <PulseHighlight />}
          </div>
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

      {/* Widget sidebar */}
      {aside && (
        <aside
          className="w-48 shrink-0 overflow-y-auto border-l border-border"
          aria-label="Execution details"
        >
          {aside}
        </aside>
      )}
    </div>
  );
}

function NavRow({
  id,
  label,
  icon: Icon,
  isActive,
  isHighlighted,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  isHighlighted: boolean;
}) {
  return (
    <div
      data-cursor-target={id}
      className={`relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] transition-colors ${
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground"
      }`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>

      {isHighlighted && <PulseHighlight />}
    </div>
  );
}

/**
 * Popup menu that appears above the user profile row.
 * Mirrors the Console's user menu: Settings, Appearance, Sign out.
 */
function UserMenu() {
  return (
    <motion.div
      className="absolute bottom-full left-1 right-1 mb-1 rounded-md border border-border bg-card py-1 shadow-lg"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div
        data-cursor-target="settings-menu-item"
        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent"
      >
        <Settings className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span>Settings</span>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent">
        <Monitor className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span>Appearance</span>
      </div>
      <div className="mx-2 my-0.5 border-t border-border" />
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent">
        <LogOut className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span>Sign out</span>
      </div>
    </motion.div>
  );
}
