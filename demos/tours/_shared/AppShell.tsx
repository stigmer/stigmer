import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { Building2, Library, Plus, User } from "lucide-react";
import { PulseHighlight } from "@scenar/react";
import "./AppShell.css";

/** Which primary nav item is selected. */
export type NavId = "new-session" | "library";

const RECENT_SESSIONS = [
  "Draft email copy",
  "Q2 report analysis",
  "Summarize meeting notes",
];

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
  /** Optional right rail (e.g. a `WidgetsSidebar` of execution widgets). */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Schematic web-app layout that frames a tour's real `@stigmer/react`
 * components — an org indicator, primary nav, recent sessions, and a user row
 * around a content area, plus an optional widget rail. It communicates the
 * console's navigation shape without depending on any console internals.
 *
 * Styled entirely with the Stigmer `--stgm-*` design tokens (see AppShell.css),
 * so the chrome and the real components it wraps read as one product surface
 * and flip light/dark together under the single `StigmerProvider` scope.
 */
export function AppShell({
  activeNav,
  highlightNav,
  contentKey,
  slideDirection,
  aside,
  children,
}: AppShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div className="demo-shell">
      <nav className="demo-shell__nav" aria-label="Demo app navigation">
        <div className="demo-shell__org">
          <Building2 size={12} className="demo-shell__org-icon" />
          <span className="demo-shell__org-name">Acme Corp</span>
        </div>

        <div className="demo-shell__nav-group">
          <NavRow
            id="new-session"
            label="New Session"
            icon={Plus}
            active={activeNav === "new-session"}
            highlighted={highlightNav === "new-session"}
          />
          <NavRow
            id="library"
            label="Library"
            icon={Library}
            active={activeNav === "library"}
            highlighted={highlightNav === "library"}
          />
        </div>

        <div className="demo-shell__sep" />

        <div className="demo-shell__recents">
          <p className="demo-shell__recents-label">Recents</p>
          <ul className="demo-shell__recents-list">
            {RECENT_SESSIONS.map((title) => (
              <li key={title} className="demo-shell__recent">
                {title}
              </li>
            ))}
          </ul>
        </div>

        <div className="demo-shell__user">
          <div className="demo-shell__avatar">
            <User size={10} className="demo-shell__user-icon" />
          </div>
          <span className="demo-shell__user-name">You</span>
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

      {aside && (
        <aside className="demo-shell__aside" aria-label="Execution details">
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
    <div
      data-cursor-target={id}
      className={`demo-shell__nav-row${active ? " demo-shell__nav-row--active" : ""}`}
    >
      <Icon size={12} className="demo-shell__nav-icon" />
      <span>{label}</span>

      {highlighted && <PulseHighlight />}
    </div>
  );
}
