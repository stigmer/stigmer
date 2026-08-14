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
import { UNSTYLED_LIST } from "../internal/element-resets.js";
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
  /**
   * Count for the Conversations row's badge: how many conversations
   * want a human right now (`useConversationsWantsHumanCount`). Data as
   * props per the chrome contract — hosts fetch, deterministic hosts
   * (tours) pass a fixture or omit. Hidden at `0`/omitted; the display
   * caps at "99+" while the accessible name keeps the real number.
   */
  readonly conversationsBadgeCount?: number;
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
  conversationsBadgeCount,
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
        accessory={
          conversationsBadgeCount !== undefined && conversationsBadgeCount > 0 ? (
            <WantsHumanBadge count={conversationsBadgeCount} />
          ) : null
        }
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
      <ScrollArea className="stg:flex-1">
        <div className="stg:p-3">
          <p className="stg:text-sidebar-muted-foreground stg:mb-2 stg:px-1 stg:text-[11px] stg:font-semibold stg:tracking-wider stg:uppercase">
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
  accessory = null,
}: {
  readonly id: WorkspaceNavId;
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  readonly renderLink: RenderSidebarLink;
  /** Trailing row content (e.g. the Conversations count pill). */
  readonly accessory?: ReactNode;
}) {
  return (
    <div className="stg:flex-none stg:px-3 stg:py-1">
      {renderLink({
        id,
        href,
        active,
        className: navRowClassName(active),
        "aria-current": active ? "page" : undefined,
        children: (
          <>
            <Icon className="stg:size-4 stg:shrink-0" />
            {label}
            {accessory}
          </>
        ),
      })}
    </div>
  );
}

/**
 * The Conversations row's count pill: how many conversations want a
 * human right now (DD-011 D-f — `needs_attention` OR awaiting-reply
 * while human-held). The visible number caps at "99+"; the accessible
 * name states the meaning with the real number, because a bare "104"
 * read aloud after "Conversations" says nothing.
 */
function WantsHumanBadge({ count }: { readonly count: number }) {
  return (
    <span className="stg:ml-auto stg:flex stg:shrink-0 stg:items-center">
      <span
        aria-hidden="true"
        className="stg:bg-sidebar-primary stg:text-sidebar-primary-foreground stg:rounded-full stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:leading-none stg:font-semibold stg:tabular-nums"
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="stg:sr-only">
        {count === 1
          ? "1 conversation needs a human"
          : `${count} conversations need a human`}
      </span>
    </span>
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
      <div className="stg:space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="stg:text-sidebar-muted-foreground stg:mb-1 stg:px-2 stg:text-[10px] stg:font-medium stg:tracking-wider stg:uppercase">
              {group.label}
            </p>
            <ul className={`${UNSTYLED_LIST} stg:space-y-0.5`} role="list">
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
        <TypeIcon className="stg:mt-0.5 stg:size-3 stg:shrink-0 stg:opacity-50" aria-hidden="true" />
        <span className="stg:line-clamp-2 stg:flex-1">{entry.subject}</span>
        {/* Last-activity stamp + noteworthy status: the list sorts by
            activity while execution names embed creation time, so the row
            must say WHY it is here ("failed · 2h"). */}
        <span className="stg:flex stg:shrink-0 stg:flex-col stg:items-end stg:gap-0.5 stg:text-[10px] stg:leading-tight">
          <span className="stg:text-sidebar-muted-foreground stg:tabular-nums">
            {formatRelativeTime(entry.updatedAt, now)}
          </span>
          {statusBadge && (
            <span
              className={
                statusBadge.tone === "destructive"
                  ? "stg:text-destructive"
                  : "stg:text-sidebar-muted-foreground"
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
    ? "stg:flex stg:items-start stg:gap-2 stg:rounded-lg stg:px-2 stg:py-1.5 stg:text-xs stg:transition-colors stg:bg-sidebar-accent stg:text-sidebar-accent-foreground stg:font-medium"
    : "stg:flex stg:items-start stg:gap-2 stg:rounded-lg stg:px-2 stg:py-1.5 stg:text-xs stg:transition-colors stg:text-sidebar-foreground stg:hover:bg-sidebar-accent stg:hover:text-sidebar-accent-foreground";
}

function RecentsSkeletons() {
  return (
    <div className="stg:space-y-2 stg:px-2" aria-busy="true" aria-label="Loading sessions">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="stg:bg-sidebar-muted stg:h-5 stg:animate-pulse stg:rounded"
          style={{ width: `${70 + Math.sin(i * 1.5) * 20}%` }}
        />
      ))}
    </div>
  );
}

function RecentsError({ message }: { readonly message: string }) {
  return (
    <>
      <p className="stg:text-destructive stg:mb-4 stg:px-2 stg:text-xs" role="alert">
        {message}
      </p>
      <RecentsEmptyState />
    </>
  );
}

function RecentsEmptyState() {
  return (
    <div className="stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-8 stg:text-center">
      <MessageSquare className="stg:text-sidebar-muted-foreground stg:size-8" />
      <p className="stg:text-sidebar-muted-foreground stg:text-xs">No recent activity</p>
    </div>
  );
}
