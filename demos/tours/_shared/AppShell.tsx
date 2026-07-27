import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  LayoutDashboard,
  Library,
  MessageSquare,
  PanelLeft,
  Plus,
} from "lucide-react";
import { PulseHighlight } from "@scenar/react";
import "./AppShell.css";

/** Which primary nav item is selected. */
export type NavId = "new-session" | "dashboard" | "library";

/**
 * Static recent-activity fixture, shaped like the real sidebar's
 * time-bucketed groups (subject + relative-time column). Times are displayed
 * literal text, not clock reads — the tour world has one frozen clock
 * (DD-006 / SAMPLE_INSTANT) and these strings never tick.
 */
const RECENT_ACTIVITY = [
  {
    label: "Today",
    entries: [
      { subject: "Draft email copy for the Q3 launch", time: "2h" },
      { subject: "Q2 report analysis", time: "4h" },
    ],
  },
  {
    label: "Yesterday",
    entries: [
      { subject: "Summarize meeting notes", time: "1d" },
      { subject: "Refund request for order #ORD-4821", time: "1d" },
    ],
  },
] as const;

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
 * Schematic web-app layout that frames a tour's real `@stigmer/react`
 * components, mirroring the console's workspace zone at the console's own
 * metrics: a 280px sidebar (`w-70`) with the real nav set (New Session /
 * Dashboard / Library), 14px nav labels, 16px icons, time-bucketed recents
 * with relative-time stamps, and a user footer. Every dimension is
 * transcribed from `client-apps/web/src/domain/_shared/layout/Sidebar.tsx`
 * — the "one scale factor" rule: the shell lays out at real-app size and
 * only the viewport boundary scales it (never per-element zoom).
 *
 * Colored with the Stigmer `--stgm-sidebar-*` tokens (the same tokens the
 * real sidebar consumes), so the chrome and the real components it wraps
 * read as one product surface and flip light/dark together under the single
 * `StigmerProvider` scope.
 *
 * The shell is the browser page, not a card: it fills its container
 * edge-to-edge with no border or radius. The window chrome (browser frame,
 * shadow, backdrop) belongs to whatever frames the shell.
 */
export function AppShell({
  activeNav,
  highlightNav,
  contentKey,
  slideDirection,
  children,
}: AppShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div className="demo-shell">
      <nav className="demo-shell__nav" aria-label="Demo app navigation">
        {/* Top row: collapse affordance + org switcher, as in the console. */}
        <div className="demo-shell__top">
          <span className="demo-shell__collapse" aria-hidden>
            <PanelLeft size={16} />
          </span>
          <div className="demo-shell__org">
            <Building2 size={16} className="demo-shell__org-icon" />
            <span className="demo-shell__org-label">
              <span className="demo-shell__org-name">Acme Corp</span>
              <span className="demo-shell__org-slug">acme</span>
            </span>
          </div>
        </div>

        <NavRow
          id="new-session"
          label="New Session"
          icon={Plus}
          active={activeNav === "new-session"}
          highlighted={highlightNav === "new-session"}
        />
        <NavRow
          id="dashboard"
          label="Dashboard"
          icon={LayoutDashboard}
          active={activeNav === "dashboard"}
          highlighted={highlightNav === "dashboard"}
        />
        <NavRow
          id="library"
          label="Library"
          icon={Library}
          active={activeNav === "library"}
          highlighted={highlightNav === "library"}
        />

        <div className="demo-shell__sep" />

        <div className="demo-shell__recents">
          <p className="demo-shell__recents-label">Recents</p>
          {RECENT_ACTIVITY.map((group) => (
            <div key={group.label} className="demo-shell__recents-group">
              <p className="demo-shell__recents-group-label">{group.label}</p>
              <ul className="demo-shell__recents-list">
                {group.entries.map((entry) => (
                  <li key={entry.subject} className="demo-shell__recent">
                    <MessageSquare size={12} className="demo-shell__recent-icon" />
                    <span className="demo-shell__recent-subject">
                      {entry.subject}
                    </span>
                    <span className="demo-shell__recent-time">{entry.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="demo-shell__user">
          <span className="demo-shell__avatar">Y</span>
          <span className="demo-shell__user-label">
            <span className="demo-shell__user-name">You</span>
            <span className="demo-shell__user-email">you@acme.com</span>
          </span>
        </div>
      </nav>

      <motion.div
        key={contentKey}
        className="demo-shell__content"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function NavRow({
  id,
  label,
  icon: Icon,
  active,
  highlighted,
}: {
  readonly id: NavId;
  readonly label: string;
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  readonly active: boolean;
  readonly highlighted: boolean;
}) {
  return (
    <div className="demo-shell__nav-item">
      <div
        data-cursor-target={id}
        className={`demo-shell__nav-row${active ? " demo-shell__nav-row--active" : ""}`}
      >
        <Icon size={16} className="demo-shell__nav-icon" />
        <span>{label}</span>

        {highlighted && <PulseHighlight />}
      </div>
    </div>
  );
}
