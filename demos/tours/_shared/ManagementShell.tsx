import { useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import { SETTINGS_NAV_GROUPS, SettingsSidebar, UserMenu } from "@stigmer/react";
import type { RenderSidebarLink } from "@stigmer/react";
// The console's typeface (see fonts/fonts.css). Kept here as well as in
// stigmer-preview so the shell never renders in a fallback face even if a
// consumer wires providers differently.
import "./fonts/fonts.css";
import { DEMO_USER } from "./fixtures";
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

/**
 * Management-zone layout — the org-settings counterpart to `AppShell`'s
 * workspace zone, rendered by the console's own `SettingsSidebar` from
 * `@stigmer/react` with the same `SETTINGS_NAV_GROUPS` nav model the real
 * sidebar consumes, so the depicted chrome cannot drift from the shipped
 * one (stigmer/stigmer#317).
 *
 * Demo-owned seams only: the 240px column, `data-cursor-target` markers on
 * every row (ids are the route basenames plus `back-to-sessions`), fixture
 * identity, and the content transition. The sidebar subtree is `inert` so
 * a paused embed's real menus never open under a reader's stray click.
 *
 * One scale factor per frame: no zoom anywhere — the shell lays out at
 * real size and the viewport boundary owns the scaling. The shell is the
 * browser page, not a card: it fills its container edge-to-edge.
 */
export function ManagementShell({
  activeNav,
  contentKey,
  slideDirection,
  children,
}: ManagementShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  const renderLink: RenderSidebarLink = useCallback(
    ({ id, className, children: rowContent, "aria-current": ariaCurrent }) => (
      <div
        data-cursor-target={id}
        aria-current={ariaCurrent}
        className={`${className} sx-mgmt__row`}
      >
        {rowContent}
      </div>
    ),
    [],
  );

  return (
    <div className="sx-mgmt">
      <div className="sx-mgmt__nav" inert>
        <SettingsSidebar
          groups={SETTINGS_NAV_GROUPS}
          activePath={activeNav ? `/settings/${activeNav}` : null}
          renderLink={renderLink}
          footer={<UserMenu user={DEMO_USER} />}
        />
      </div>

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
