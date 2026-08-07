"use client";

import { memo, useMemo, type ReactNode } from "react";
import {
  Plus,
  LayoutDashboard,
  Library,
  MessageSquare,
  MessagesSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { RecentActivityEntry, RecentActivityGroup } from "../activity/types.js";
import { groupRecentActivityByTime } from "../activity/group-activity.js";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { recentActivityStatusBadge } from "../activity/entry-status-badge.js";
import { ScrollArea } from "../internal/scroll-area.js";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "../internal/tooltip.js";
import { SidebarChrome, SidebarSeparator, navRowClassName } from "./chrome.js";
import type { RenderSidebarLink } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Primary navigation destinations in the workspace sidebar. */
export type WorkspaceNavId =
  | "new-session"
  | "dashboard"
  | "conversations"
  | "library";

/**
 * Recent-activity data for the sidebar's Recents section — the return
 * shape of `useRecentActivity`, narrowed to what the sidebar renders.
 * Deterministic hosts pass frozen fixture entries instead.
 */
export interface WorkspaceSidebarActivity {
  readonly entries: readonly RecentActivityEntry[];
  /** True during the initial fetch; renders loading skeletons. */
  readonly isLoading?: boolean;
  /** Non-null when the fetch failed; renders an inline alert. */
  readonly error?: { readonly message: string } | null;
}

/** Props for {@link WorkspaceSidebar}. */
export interface WorkspaceSidebarProps {
  /**
   * Which primary nav row is the current location, or `null`/omitted
   * when none is (e.g. inside a session). The sidebar renders state
   * only — the host decides what "active" means for its routes.
   */
  readonly activeNav?: WorkspaceNavId | null;
  /** Renders each interactive row. See {@link RenderSidebarLink}. */
  readonly renderLink: RenderSidebarLink;
  /** Recent activity entries plus fetch state. */
  readonly recentActivity: WorkspaceSidebarActivity;
  /** Session id highlighted in Recents, if a session is open. */
  readonly activeSessionId?: string | null;
  /** Workflow-execution id highlighted in Recents, if one is open. */
  readonly activeExecutionId?: string | null;
  /**
   * Optional trailing accessory per recents row — e.g. the desktop
   * app's "running in background" pulse dot. Rendered after the
   * timestamp column, inside the row.
   */
  readonly renderEntryAccessory?: (entry: RecentActivityEntry) => ReactNode;
  /** Footer content — typically the host app's `UserMenu` wrapper. */
  readonly footer: ReactNode;
  /** Reflected as `aria-expanded` on the collapse toggle. @default true */
  readonly isOpen?: boolean;
  /** Called when the collapse toggle is pressed. */
  readonly onCollapse?: () => void;
  /** Passed through to the embedded `OrgSwitcher`. */
  readonly onOrgChanged?: (org: Organization) => void;
  /**
   * Reference instant for time bucketing ("Today"/"Yesterday") and
   * relative stamps ("2h"). Defaults to the live clock. **Deterministic
   * hosts (documentation embeds, video export) must pass a frozen
   * instant** — otherwise the depicted times drift with every replay.
   */
  readonly now?: Date;
}

/**
 * The console's workspace-zone sidebar: org switcher, primary navigation
 * (New Session / Dashboard / Conversations / Library), time-bucketed
 * recent activity, and a user footer.
 *
 * This is the same component the Stigmer web console and desktop app
 * render — hosts differ only in what they return from `renderLink`
 * (their router's link), what they pass as `recentActivity` (live hook
 * data or frozen fixtures), and the `footer` slot. Documentation tours
 * render it too, which is the point: the depicted chrome cannot drift
 * from the product because it *is* the product (stigmer/stigmer#317).
 *
 * Layout note: the sidebar fills its container's height and defines no
 * width — the console's app shell owns the `w-70` (280px) column.
 *
 * @example
 * ```tsx
 * <WorkspaceSidebar
 *   activeNav="library"
 *   renderLink={({ href, children, ...rest }) => (
 *     <Link href={href} {...rest}>{children}</Link>
 *   )}
 *   recentActivity={useRecentActivity()}
 *   footer={<UserMenu />}
 * />
 * ```
 */
export function WorkspaceSidebar({
  activeNav = null,
  renderLink,
  recentActivity,
  activeSessionId = null,
  activeExecutionId = null,
  renderEntryAccessory,
  footer,
  isOpen = true,
  onCollapse,
  onOrgChanged,
  now,
}: WorkspaceSidebarProps) {
  const { entries, isLoading = false, error = null } = recentActivity;

  const groups = useMemo(
    () => groupRecentActivityByTime(entries, now),
    [entries, now],
  );

  return (
    <SidebarChrome
      ariaLabel="Main navigation"
      isOpen={isOpen}
      onCollapse={onCollapse}
      onOrgChanged={onOrgChanged}
      footer={footer}
    >
      <PrimaryNavRow
        id="new-session"
        href="/"
        label="New Session"
        icon={Plus}
        active={activeNav === "new-session"}
        renderLink={renderLink}
      />
      <PrimaryNavRow
        id="dashboard"
        href="/dashboard"
        label="Dashboard"
        icon={LayoutDashboard}
        active={activeNav === "dashboard"}
        renderLink={renderLink}
      />
      {/* MessagesSquare, deliberately not MessageSquare — the singular
          mark is the session glyph in Recents, and the two areas must
          not read as one. */}
      <PrimaryNavRow
        id="conversations"
        href="/conversations"
        label="Conversations"
        icon={MessagesSquare}
        active={activeNav === "conversations"}
        renderLink={renderLink}
      />
      <PrimaryNavRow
        id="library"
        href="/library"
        label="Library"
        icon={Library}
        active={activeNav === "library"}
        renderLink={renderLink}
      />

      <SidebarSeparator />

      {/* Scrollable recents */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <p className="text-sidebar-muted-foreground mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
            Recents
          </p>
          {isLoading ? (
            <RecentsSkeletons />
          ) : error ? (
            <RecentsError message={error.message} />
          ) : groups.length === 0 ? (
            <RecentsEmptyState />
          ) : (
            <ActivityGroupList
              groups={groups}
              activeSessionId={activeSessionId}
              activeExecutionId={activeExecutionId}
              renderLink={renderLink}
              renderEntryAccessory={renderEntryAccessory}
              now={now}
            />
          )}
        </div>
      </ScrollArea>
    </SidebarChrome>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function PrimaryNavRow({
  id,
  href,
  label,
  icon: Icon,
  active,
  renderLink,
}: {
  readonly id: WorkspaceNavId;
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  readonly renderLink: RenderSidebarLink;
}) {
  return (
    <div className="flex-none px-3 py-1">
      {renderLink({
        id,
        href,
        active,
        className: navRowClassName(active),
        "aria-current": active ? "page" : undefined,
        children: (
          <>
            <Icon className="size-4 shrink-0" />
            {label}
          </>
        ),
      })}
    </div>
  );
}

function ActivityGroupList({
  groups,
  activeSessionId,
  activeExecutionId,
  renderLink,
  renderEntryAccessory,
  now,
}: {
  readonly groups: readonly RecentActivityGroup[];
  readonly activeSessionId: string | null;
  readonly activeExecutionId: string | null;
  readonly renderLink: RenderSidebarLink;
  readonly renderEntryAccessory?: (entry: RecentActivityEntry) => ReactNode;
  readonly now?: Date;
}) {
  return (
    <TooltipProvider>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-sidebar-muted-foreground mb-1 px-2 text-[10px] font-medium tracking-wider uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5" role="list">
              {group.entries.map((entry) => (
                <ActivityEntry
                  key={entry.id}
                  entry={entry}
                  activeSessionId={activeSessionId}
                  activeExecutionId={activeExecutionId}
                  renderLink={renderLink}
                  renderEntryAccessory={renderEntryAccessory}
                  now={now}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

const ActivityEntry = memo(function ActivityEntry({
  entry,
  activeSessionId,
  activeExecutionId,
  renderLink,
  renderEntryAccessory,
  now,
}: {
  readonly entry: RecentActivityEntry;
  readonly activeSessionId: string | null;
  readonly activeExecutionId: string | null;
  readonly renderLink: RenderSidebarLink;
  readonly renderEntryAccessory?: (entry: RecentActivityEntry) => ReactNode;
  readonly now?: Date;
}) {
  const isSession = entry.type === "session";
  const isActive = isSession
    ? entry.id === activeSessionId
    : entry.id === activeExecutionId;
  const href = isSession ? `/sessions/${entry.id}` : `/executions/${entry.id}`;
  const TypeIcon = isSession ? MessageSquare : Workflow;
  const statusBadge = recentActivityStatusBadge(entry);

  const row = renderLink({
    id: entry.id,
    href,
    active: isActive,
    "aria-current": isActive ? "page" : undefined,
    entry,
    className: cnActivityRow(isActive),
    children: (
      <>
        <TypeIcon className="mt-0.5 size-3 shrink-0 opacity-50" aria-hidden="true" />
        <span className="line-clamp-2 flex-1">{entry.subject}</span>
        {/* Last-activity stamp + noteworthy status: the list sorts by
            activity while execution names embed creation time, so the row
            must say WHY it is here ("failed · 2h"). */}
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] leading-tight">
          <span className="text-sidebar-muted-foreground tabular-nums">
            {formatRelativeTime(entry.updatedAt, now)}
          </span>
          {statusBadge && (
            <span
              className={
                statusBadge.tone === "destructive"
                  ? "text-destructive"
                  : "text-sidebar-muted-foreground"
              }
            >
              {statusBadge.label}
            </span>
          )}
        </span>
        {renderEntryAccessory?.(entry)}
      </>
    ),
  });

  return (
    <li>
      <Tooltip>
        <TooltipTrigger render={row} />
        <TooltipContent side="right" sideOffset={12}>
          {entry.subject}
        </TooltipContent>
      </Tooltip>
    </li>
  );
});

/** Recents rows are denser than primary nav: 12px text, top-aligned icon. */
function cnActivityRow(active: boolean): string {
  return active
    ? "flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors bg-sidebar-accent text-sidebar-accent-foreground font-medium"
    : "flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
}

function RecentsSkeletons() {
  return (
    <div className="space-y-2 px-2" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="bg-sidebar-muted h-5 animate-pulse rounded"
          style={{ width: `${70 + Math.sin(i * 1.5) * 20}%` }}
        />
      ))}
    </div>
  );
}

function RecentsError({ message }: { readonly message: string }) {
  return (
    <>
      <p className="text-destructive mb-4 px-2 text-xs" role="alert">
        {message}
      </p>
      <RecentsEmptyState />
    </>
  );
}

function RecentsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MessageSquare className="text-sidebar-muted-foreground size-8" />
      <p className="text-sidebar-muted-foreground text-xs">No recent activity</p>
    </div>
  );
}
