"use client";

import { useId, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrgSwitcher } from "../organization/OrgSwitcher.js";
import { useSingleOrg } from "../server-info.js";
import { BETA_LINE, BETA_URL, BETA_WORD } from "../internal/beta.js";
import { tagClasses } from "../internal/surface/Tag.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

// ---------------------------------------------------------------------------
// Shared sidebar chrome — the pieces WorkspaceSidebar and SettingsSidebar
// have in common: the nav container, the top row (collapse toggle, org
// switcher, the Beta mark), the hairline separator, the footer band, and the
// shared class recipes (nav rows, section labels). Internal to the sidebar
// domain; not exported from the SDK.
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
   * because every host wires those systems differently.
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
  const singleOrg = useSingleOrg();
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
          {/* A server that holds one organization never shows it; the
              switcher waits for the server's answer rather than flash. */}
          {singleOrg === false && <OrgSwitcher onOrgChanged={onOrgChanged} />}
        </div>
        <BetaMark />
      </div>

      {children}

      {/* Bottom: user menu */}
      <div className="stg:border-sidebar-border stg:flex-none stg:border-t stg:px-3 stg:py-2">
        {footer}
      </div>
    </nav>
  );
}

/**
 * Stigmer's "Beta" mark, at the end of the top row in every edition: the
 * neutral label as a link to the page that says what Beta means, opening
 * beside the console as the help row does. Its accessible name and the
 * house tooltip are the whole line, since the row has room for the word
 * alone. The chrome is the console's (the web console, the desktop app, the
 * documentation tours), never a developer's product, so the mark never
 * reaches one.
 */
function BetaMark() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={BETA_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={BETA_LINE}
            className={cn(
              tagClasses(),
              "stg:no-underline stg:transition-colors stg:motion-reduce:transition-none stg:hover:bg-sidebar-accent",
              "stg:focus-visible:ring-sidebar-ring stg:focus-visible:ring-2 stg:focus-visible:outline-none",
            )}
          >
            {BETA_WORD}
          </a>
        }
      />
      <TooltipContent side="bottom">{BETA_LINE}</TooltipContent>
    </Tooltip>
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
 * The one nav-row class recipe both sidebars share: 14px/20px regular
 * labels, 16px icons (sized by callers), 8px/6px padding — 32px rows
 * (stigmer#3037: at 24px a full column of rows read cramped). The explicit
 * `leading-5` is load-bearing: the row's height is its line plus its
 * padding, so an inherited line-height would change every row at once.
 * 32px is above the WCAG 2.5.8 minimum pointer-target size (24px).
 *
 * Resting rows are muted so the navigation recedes and the content leads;
 * the active row carries the accent fill, hover brightens to the accent
 * foreground. Font weight is constant across states — state is expressed
 * through color and fill only, so activating a row never shifts its text
 * width. The muted-on-sidebar pairing is held to WCAG AA by the theme's
 * contrast contract (sdk/theme/src/contract/pairs.ts) in every preset.
 */
export function navRowClassName(active: boolean): string {
  return cn(
    "stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-sm stg:leading-5 stg:transition-colors",
    active
      ? "stg:bg-sidebar-accent stg:text-sidebar-accent-foreground"
      : "stg:text-sidebar-muted-foreground stg:hover:bg-sidebar-accent stg:hover:text-sidebar-accent-foreground",
  );
}

/**
 * The section-label recipe both sidebars share (settings group labels,
 * the Recents heading): 11px/16px medium uppercase in the muted sidebar
 * tone. Spacing around a label stays with the caller — it is a layout
 * concern; this recipe owns only the typography, so the two sidebars
 * cannot drift.
 */
export function sectionLabelClassName(): string {
  return "stg:text-sidebar-muted-foreground stg:px-2 stg:text-2xs stg:leading-4 stg:font-medium stg:tracking-wide stg:uppercase";
}
