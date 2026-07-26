import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Building2, PanelLeft } from "lucide-react";
import { SETTINGS_NAV_GROUPS } from "@stigmer/react";
// The console's typeface (see fonts/fonts.css). Kept here as well as in
// stigmer-preview so the shell never renders in a fallback face even if a
// consumer wires providers differently.
import "./fonts/fonts.css";
import "./ManagementShell.css";

/**
 * Nav ids are the settings routes' basenames (`/settings/api-keys` →
 * `api-keys`), so a tour's `activeNav` reads like the URL the depicted
 * page lives at.
 */
export type ManagementNavId =
  | "org-profile"
  | "members"
  | "invitations"
  | "identity-providers"
  | "api-keys"
  | "platform-clients"
  | "environments"
  | "oauth-apps"
  | "channel-apps"
  | "billing"
  | "usage";

interface ManagementShellProps {
  /** Which nav item is currently selected. */
  readonly activeNav?: ManagementNavId;
  /**
   * Stable key for the content area — changing it fades the new view in,
   * mirroring navigating between management pages.
   */
  readonly contentKey: string;
  /**
   * Direction of the transition when `contentKey` changes:
   * `"forward"` slides in from the right (navigating deeper),
   * `"backward"` from the left (going back), unset fades in place.
   */
  readonly slideDirection?: "forward" | "backward";
  readonly children: ReactNode;
}

/** Route basename, used as the nav id and cursor target. */
function navId(href: string): string {
  return href.split("/").pop() ?? href;
}

/**
 * Schematic management-zone layout — the org-settings counterpart to
 * `AppShell`'s workspace zone, at the console's own metrics (280px sidebar,
 * 14px/500 rows, 16px icons — transcribed from the real
 * `ManagementSidebar`, which shares the workspace sidebar's geometry). The
 * grouped navigation comes straight from the SDK's `SETTINGS_NAV_GROUPS`,
 * the same constant the real sidebar renders, so the depicted nav can never
 * drift from the shipped one.
 *
 * One scale factor per frame: no zoom anywhere — the shell lays out at real
 * size and the viewport boundary owns the scaling. Colored with the
 * `--stgm-sidebar-*` tokens (the real sidebar's palette); consumers must
 * have the compiled `@stigmer/react` stylesheet in their graph — every
 * console-depicting tour wires `createStigmerPreview`, which provides it.
 *
 * The shell is the browser page, not a card: it fills its container
 * edge-to-edge. Window chrome belongs to whatever frames it.
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
    <div className="sx-mgmt">
      <nav className="sx-mgmt__nav" aria-label="Demo management navigation">
        {/* Top row: collapse affordance + org switcher, as in the console. */}
        <div className="sx-mgmt__top">
          <span className="sx-mgmt__collapse" aria-hidden>
            <PanelLeft size={16} />
          </span>
          <div className="sx-mgmt__org">
            <Building2 size={16} className="sx-mgmt__org-icon" />
            <span className="sx-mgmt__org-label">
              <span className="sx-mgmt__org-name">Acme Corp</span>
              <span className="sx-mgmt__org-slug">acme</span>
            </span>
          </div>
        </div>

        {/* Back to Sessions */}
        <div className="sx-mgmt__nav-item">
          <div className="sx-mgmt__back" data-cursor-target="back-to-sessions">
            <ArrowLeft size={16} aria-hidden />
            <span>Back to Sessions</span>
          </div>
        </div>

        <div className="sx-mgmt__divider" />

        {/* Grouped navigation — the SDK's own settings nav model. */}
        <div className="sx-mgmt__groups">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.label} className="sx-mgmt__group">
              <span className="sx-mgmt__group-heading">{group.label}</span>
              {group.items.map((item) => {
                const id = navId(item.href);
                return (
                  <div
                    key={item.href}
                    data-cursor-target={id}
                    className={
                      activeNav === id
                        ? "sx-mgmt__item sx-mgmt__item--active"
                        : "sx-mgmt__item"
                    }
                  >
                    {/* The nav model types icons on className only; the
                        16px real size comes from the stylesheet. */}
                    <item.icon className="sx-mgmt__item-icon" />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sx-mgmt__spacer" />

        {/* User footer */}
        <div className="sx-mgmt__user">
          <span className="sx-mgmt__avatar">Y</span>
          <span className="sx-mgmt__user-label">
            <span className="sx-mgmt__user-name">You</span>
            <span className="sx-mgmt__user-email">you@acme.com</span>
          </span>
        </div>
      </nav>

      {/* Content area */}
      <motion.div
        key={contentKey}
        className="sx-mgmt__content"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
