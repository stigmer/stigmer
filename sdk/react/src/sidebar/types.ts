import type { ReactElement, ReactNode } from "react";
import type { RecentActivityEntry } from "../activity/types.js";

/**
 * Everything a sidebar hands to {@link RenderSidebarLink} to draw one
 * interactive row.
 *
 * The sidebar owns the row's look (`className`, `children`) and state
 * (`active`, `aria-current`); the consumer owns only the interactive
 * element wrapping them. That split is what keeps one component serving
 * three very different hosts: the web console returns `next/link`, the
 * desktop app returns a `react-router` link, and documentation embeds
 * return inert rows decorated with capture markers.
 */
export interface SidebarLinkRenderProps {
  /**
   * Stable row identifier, for consumers that vary behavior per row:
   * `"new-session"` / `"dashboard"` / `"library"` in the workspace
   * sidebar, `"back-to-sessions"` or the settings route basename (e.g.
   * `"api-keys"`) in the settings sidebar, and the entry id for recent
   * activity rows.
   */
  readonly id: string;
  /** Console route this row targets (e.g. `/library`, `/sessions/<id>`). */
  readonly href: string;
  /** Whether the row is the current location. */
  readonly active: boolean;
  /**
   * Fully-styled row classes computed by the sidebar. Apply verbatim —
   * the row's geometry and type scale are the product surface tours and
   * embeds depict, so consumers must not restyle them.
   */
  readonly className: string;
  /** `"page"` when active, for assistive tech. Spread onto the element. */
  readonly "aria-current": "page" | undefined;
  /** Row content (icon, label, timestamps). Render inside the element. */
  readonly children: ReactNode;
  /**
   * The recent-activity entry behind this row. Present only for recents
   * rows in the workspace sidebar — consumers use it to pick the right
   * navigation flow (session viewer vs. execution viewer) without
   * parsing `href`.
   */
  readonly entry?: RecentActivityEntry;
}

/**
 * Renders one sidebar row as the consumer's interactive element.
 *
 * Must return a single element that spreads unknown props onto its
 * underlying DOM node (all DOM elements, `next/link`, and `react-router`
 * links qualify): the sidebar composes tooltip triggers around recents
 * rows by cloning the returned element with merged event handlers.
 */
export type RenderSidebarLink = (props: SidebarLinkRenderProps) => ReactElement;
