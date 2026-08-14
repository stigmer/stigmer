import { useCallback, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { PulseHighlight } from "@scenar/react";
import { UserMenu, WorkspaceSidebar } from "@stigmer/react";
import type { RenderSidebarLink, WorkspaceNavId } from "@stigmer/react";
// The console's typeface (see fonts/fonts.css). Kept here as well as in
// stigmer-preview so the shell never renders in a fallback face even if a
// consumer wires providers differently.
import "./fonts/fonts.css";
import { DEMO_NOW, DEMO_RECENT_ACTIVITY, DEMO_USER } from "./fixtures";
import "./AppShell.css";

/** Which primary nav item is selected. */
export type NavId = WorkspaceNavId;

interface AppShellProps {
  /** Which nav item is currently selected. */
  readonly activeNav?: NavId;
  /**
   * Which nav item pulses to draw attention (e.g. before the tour's cursor
   * "clicks" it). Nav rows carry `data-cursor-target` equal to their id, so
   * a step can pair this with a `set_cursor` interaction on the same id.
   */
  readonly highlightNav?: NavId;
  /**
   * Count for the sidebar's Conversations badge (the real
   * `WorkspaceSidebar` prop, forwarded verbatim) — conversations that
   * want a human right now. Fixture-supplied: a tour depicting the
   * conversations surface passes the count its inbox fixtures imply.
   */
  readonly conversationsBadgeCount?: number;
  /**
   * Stable key for the content area — changing it fades the new view in,
   * mirroring navigating between app screens.
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
 * Web-app layout framing a tour's real `@stigmer/react` components in the
 * console's workspace zone — rendered by the console's own
 * `WorkspaceSidebar`, so the depicted chrome cannot drift from the product
 * (stigmer/stigmer#317; the `SessionView` precedent applied to the shell).
 *
 * What stays demo-owned is exactly the Scenar seams: the 280px column the
 * console's app shell owns (`w-70`), the `data-cursor-target` markers and
 * `PulseHighlight` attached through the sidebar's `renderLink`, the frozen
 * `DEMO_NOW` clock, fixture recents/user, and the content transition. The
 * sidebar subtree is `inert` so a paused embed's real menus never open
 * under a reader's stray click.
 *
 * One scale factor per frame: the shell lays out at real application
 * metrics and only the viewport boundary scales it (scenar-cloud DD-008).
 * The shell is the browser page, not a card: it fills its container
 * edge-to-edge. Window chrome belongs to whatever frames the shell.
 */
export function AppShell({
  activeNav,
  highlightNav,
  conversationsBadgeCount,
  contentKey,
  slideDirection,
  children,
}: AppShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  // Honor prefers-reduced-motion by skipping the mount transition outright
  // (`initial={false}` renders the settled frame immediately). Two consumers
  // depend on it: readers who ask for reduced motion, and `scenar shoot` —
  // its capture context pins reduced-motion precisely so JS-driven mount
  // animations cannot race the screenshot (framer-motion runs on real rAF
  // time, which the shot walk does not virtualize; the 300ms slide caught
  // mid-flight was a real determinism failure on this tour's stills).
  const reduceMotion = useReducedMotion();

  // Inert rows in the sidebar's own styling; the id doubles as the cursor
  // target, and the highlighted row gets the attention pulse.
  const renderLink: RenderSidebarLink = useCallback(
    ({ id, className, children: rowContent, "aria-current": ariaCurrent }) => (
      <div
        data-cursor-target={id}
        aria-current={ariaCurrent}
        className={`${className} demo-shell__row`}
      >
        {rowContent}
        {highlightNav === id && <PulseHighlight />}
      </div>
    ),
    [highlightNav],
  );

  return (
    <div className="demo-shell">
      <div className="demo-shell__nav" inert>
        <WorkspaceSidebar
          activeNav={activeNav ?? null}
          renderLink={renderLink}
          recentActivity={{ entries: DEMO_RECENT_ACTIVITY }}
          conversationsBadgeCount={conversationsBadgeCount}
          footer={<UserMenu user={DEMO_USER} />}
          now={DEMO_NOW}
        />
      </div>

      <motion.div
        key={contentKey}
        className="demo-shell__content"
        initial={reduceMotion ? false : { opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
