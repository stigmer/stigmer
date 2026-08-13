"use client";

import { useId, type ReactNode } from "react";
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
 * The nav id exists solely for the collapse toggle's `aria-controls`
 * association; it is minted per mount like every SDK DOM id.
 */
export function SidebarChrome({
  ariaLabel,
  isOpen = true,
  onCollapse,
  onOrgChanged,
  footer,
  children,
}: SidebarChromeProps) {
  const navId = useId();
  return (
    <nav
      id={navId}
      aria-label={ariaLabel}
      className="stg:bg-sidebar stg:text-sidebar-foreground stg:flex stg:h-full stg:flex-col"
    >
      {/* Top row: collapse toggle + org context */}
      <div className="stg:flex stg:flex-none stg:items-center stg:gap-1 stg:px-2 stg:py-2">
        <button
          type="button"
          onClick={onCollapse}
          aria-expanded={isOpen}
          aria-controls={navId}
          aria-label="Collapse sidebar"
          className={cn(
            "stg:inline-flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md",
            "stg:text-sidebar-foreground stg:transition-colors stg:motion-reduce:transition-none",
            "stg:hover:bg-sidebar-accent stg:hover:text-sidebar-accent-foreground",
            "stg:aria-expanded:bg-sidebar-accent stg:aria-expanded:text-sidebar-accent-foreground",
            "stg:focus-visible:ring-sidebar-ring stg:focus-visible:ring-2 stg:focus-visible:outline-none",
          )}
        >
          <PanelLeft className="stg:size-4" />
        </button>
        <div className="stg:min-w-0 stg:flex-1">
          <OrgSwitcher onOrgChanged={onOrgChanged} />
        </div>
      </div>

      {children}

      {/* Bottom: user menu */}
      <div className="stg:border-sidebar-border stg:flex-none stg:border-t stg:px-3 stg:py-2">
        {footer}
      </div>
    </nav>
  );
}

/** Hairline separator between sidebar sections. */
export function SidebarSeparator() {
  return (
    <div className="stg:px-3 stg:py-1">
      <div className="stg:bg-sidebar-border stg:h-px" />
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
    "stg:flex stg:items-center stg:gap-2 stg:rounded-lg stg:px-2 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
    active
      ? "stg:bg-sidebar-accent stg:text-sidebar-accent-foreground"
      : cn(
          muted ? "stg:text-sidebar-muted-foreground" : "stg:text-sidebar-foreground",
          "stg:hover:bg-sidebar-accent stg:hover:text-sidebar-accent-foreground",
        ),
  );
}
