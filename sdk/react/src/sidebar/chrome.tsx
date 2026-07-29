"use client";

import type { ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrgSwitcher } from "../organization/OrgSwitcher.js";

// ---------------------------------------------------------------------------
// Shared sidebar chrome — the pieces WorkspaceSidebar and SettingsSidebar
// have in common: the nav container, the top row (collapse toggle + org
// switcher), the hairline separator, the footer band, and the one nav-row
// class recipe. Internal to the sidebar domain; not exported from the SDK.
//
// Every class here is transcribed from the console's sidebars — this file
// IS the console's chrome now, so a change here changes the console, the
// desktop app, and every documentation tour in one place.
// ---------------------------------------------------------------------------

/** Props shared by both sidebar variants' outer chrome. */
export interface SidebarChromeProps {
  /** Accessible name for the `<nav>` landmark. */
  readonly ariaLabel: string;
  /**
   * Whether the sidebar is currently expanded, reflected as
   * `aria-expanded` on the collapse toggle. @default true
   */
  readonly isOpen?: boolean;
  /**
   * Called when the collapse toggle is pressed. The sidebar renders the
   * toggle either way (it is part of the depicted chrome); hosts that
   * cannot collapse (fixed embeds) simply omit the handler.
   */
  readonly onCollapse?: () => void;
  /** Passed through to {@link OrgSwitcher}. */
  readonly onOrgChanged?: (org: Organization) => void;
  /**
   * Footer content — typically the host app's `UserMenu` wrapper, which
   * bridges auth, theming, and routing. A slot rather than a built-in
   * because every host wires those systems differently (DD-004).
   */
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

/**
 * Outer sidebar frame: `<nav>` container, top row, content, footer band.
 *
 * The `id="sidebar"` / `aria-controls` pairing matches the console's DOM
 * contract (the app shell's floating "Open sidebar" button targets it);
 * only one sidebar renders at a time, so the id cannot collide.
 */
export function SidebarChrome({
  ariaLabel,
  isOpen = true,
  onCollapse,
  onOrgChanged,
  footer,
  children,
}: SidebarChromeProps) {
  return (
    <nav
      id="sidebar"
      aria-label={ariaLabel}
      className="bg-sidebar text-sidebar-foreground flex h-full flex-col"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="flex flex-none items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={onCollapse}
          aria-expanded={isOpen}
          aria-controls="sidebar"
          aria-label="Collapse sidebar"
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
            "text-sidebar-foreground transition-colors motion-reduce:transition-none",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
            "focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <OrgSwitcher onOrgChanged={onOrgChanged} />
        </div>
      </div>

      {children}

      {/* Bottom: user menu */}
      <div className="border-sidebar-border flex-none border-t px-3 py-2">
        {footer}
      </div>
    </nav>
  );
}

/** Hairline separator between sidebar sections. */
export function SidebarSeparator() {
  return (
    <div className="px-3 py-1">
      <div className="bg-sidebar-border h-px" />
    </div>
  );
}

/**
 * The one nav-row class recipe both sidebars share: 14px medium labels,
 * 16px icons (sized by callers), 8px/6px padding, rounded row highlight.
 *
 * `muted` renders the resting label in the muted sidebar tone — used by
 * "Back to Sessions", which is an exit, not a destination.
 */
export function navRowClassName(
  active: boolean,
  { muted = false }: { muted?: boolean } = {},
): string {
  return cn(
    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : cn(
          muted ? "text-sidebar-muted-foreground" : "text-sidebar-foreground",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        ),
  );
}
